import hashlib
import json
import os
import random
import re
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import feedparser
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

OUTPUT_FILE = "feed.json"
RAW_FILE = "raw_candidates.json"
STATE_FILE = "feed_state.json"

DEFAULT_VISIBLE_FEED_SIZE = 10
PUBLISHED_POOL_SIZE = 45
MIN_FEED_ARTICLES = 12
MIN_NEW_ARTICLES = 5
ARTICLE_TTL_DAYS = 14
MAX_ANALYZE_CANDIDATES = 90
MAX_SOURCE_ITEMS_IN_POOL = 8
INVALID_STORED_URL_PATTERNS = ["/blog/product/", "/blog/category/", "/articles/list"]

WHY_IT_MATTERS_OPTIONS = [
    "Strategic shift",
    "Testing strategy",
    "AI in QA",
    "Leadership signal",
    "Process warning",
    "Tooling trend",
    "Reliability lesson",
    "Governance risk",
    "Cost implication",
    "Quality practice",
    "Industry change",
    "Actionable idea",
]

RSS_FEEDS = [
    {
        "url": "https://www.ministryoftesting.com/articles/rss",
        "name": "Ministry of Testing",
    },
    {
        "url": "https://testing.googleblog.com/feeds/posts/default",
        "name": "Google Testing Blog",
    },
    {
        "url": "https://automationpanda.com/feed/",
        "name": "Automation Panda",
    },
    {
        "url": "https://martinfowler.com/feed.atom",
        "name": "Martin Fowler",
    },
    {
        "url": "https://www.thoughtworks.com/rss/insights.xml",
        "name": "Thoughtworks",
    },
    {
        "url": "https://increment.com/feed.xml",
        "name": "Increment",
    },
    {
        "url": "https://stackoverflow.blog/feed/",
        "name": "Stack Overflow Blog",
    },
    {
        "url": "https://thenewstack.io/feed/",
        "name": "The New Stack",
    },
    {
        "url": "https://feed.infoq.com/Testing/",
        "name": "InfoQ",
    },
]

HTML_SOURCES = [
    {
        "url": "https://www.ministryoftesting.com/articles",
        "name": "Ministry of Testing",
        "source": "html",
        "link_pattern": "/articles/",
        "exclude_patterns": ["/articles/list"],
    },
    {
        "url": "https://www.tricentis.com/blog/category/quality-engineering",
        "name": "Tricentis",
        "source": "html",
        "link_pattern": "/blog/",
        "exclude_patterns": ["/blog/category/", "/blog/product/", "/blog/page/"],
    },
]

client = None


def get_openai_client():
    global client
    if client is None:
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return client


def utc_now():
    return datetime.now(UTC)


def canonicalize_url(url):
    try:
        parts = urlsplit(url)
        query_pairs = [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not key.lower().startswith("utm_")
            and key.lower() not in {"fbclid", "gclid", "mc_cid", "mc_eid"}
        ]
        cleaned_parts = (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path.rstrip("/") or "/",
            urlencode(query_pairs, doseq=True),
            "",
        )
        return urlunsplit(cleaned_parts)
    except Exception:
        return url


def article_id_for(url):
    canonical_url = canonicalize_url(url)
    return hashlib.sha256(canonical_url.encode("utf-8")).hexdigest()[:16]


def slugify(value):
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "source"


def source_id_for(article):
    base = article.get("source") or "source"
    source_name = article.get("source_name") or base
    if base in {"devto", "hn", "testing-weekly"}:
        return base
    if base == "reddit":
        return slugify(source_name.replace("Reddit ", ""))
    return f"{base}:{slugify(source_name)}"


def load_state():
    if not os.path.exists(STATE_FILE):
        return {}

    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}

    return data if isinstance(data, dict) else {}


def save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def is_expired(record, today):
    expires_at = record.get("expires_at")
    if not expires_at:
        return False

    try:
        return today > datetime.strptime(expires_at, "%Y-%m-%d").date()
    except ValueError:
        return False


def ensure_state_record(article, state, today_str):
    article_id = article_id_for(article["url"])
    canonical_url = canonicalize_url(article["url"])
    record = state.get(article_id)

    if record is None:
        expires_at = (
            datetime.strptime(today_str, "%Y-%m-%d") + timedelta(days=ARTICLE_TTL_DAYS)
        ).strftime("%Y-%m-%d")
        record = {
            "id": article_id,
            "canonical_url": canonical_url,
            "title": article["title"],
            "first_seen_at": today_str,
            "last_shown_at": None,
            "expires_at": expires_at,
            "times_shown": 0,
            "status": "active",
        }
        state[article_id] = record
    else:
        record["canonical_url"] = canonical_url
        record["title"] = article["title"]

    return article_id, record


def build_article_from_state(record):
    required_fields = [
        "title",
        "canonical_url",
        "source",
        "source_name",
        "signal",
        "why_it_matters",
        "summary",
        "key_points",
        "takeaway",
        "first_seen_at",
        "expires_at",
    ]
    if any(field not in record for field in required_fields):
        return None
    if any(pattern in record["canonical_url"] for pattern in INVALID_STORED_URL_PATTERNS):
        return None

    return {
        "id": record["id"],
        "title": record["title"],
        "url": record["canonical_url"],
        "source": record["source"],
        "source_name": record["source_name"],
        "source_id": record.get(
            "source_id",
            source_id_for({
                "source": record["source"],
                "source_name": record["source_name"],
            }),
        ),
        "signal": record["signal"],
        "rank_score": record.get("rank_score", float(record["signal"])),
        "why_it_matters": record["why_it_matters"],
        "summary": record["summary"],
        "key_points": record["key_points"],
        "takeaway": record["takeaway"],
        "first_seen_at": record["first_seen_at"],
        "last_shown_at": record.get("last_shown_at"),
        "expires_at": record["expires_at"],
    }


def extract_text(url):
    try:
        response = requests.get(url, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        paragraphs = soup.find_all("p")
        text = " ".join([p.get_text() for p in paragraphs])
        return text[:6000]
    except Exception:
        return ""


def get_rss_articles():
    articles = []
    for feed in RSS_FEEDS:
        parsed = feedparser.parse(feed["url"])
        for entry in parsed.entries[:5]:
            title = entry.title
            if len(title) < 20:
                continue
            if "job" in title.lower():
                continue
            articles.append({
                "title": title,
                "url": entry.link,
                "source": "rss",
                "source_name": feed["name"],
            })
    return articles


def get_html_articles():
    articles = []
    seen_urls = set()

    for source in HTML_SOURCES:
        try:
            response = requests.get(source["url"], timeout=10)
            soup = BeautifulSoup(response.text, "html.parser")
        except Exception:
            continue

        for link in soup.select("a[href]"):
            title = link.get_text(strip=True)
            href = link.get("href")

            if not href or not title:
                continue
            if len(title) < 20:
                continue
            if "job" in title.lower():
                continue

            absolute_url = urljoin(source["url"], href)
            if source["link_pattern"] not in absolute_url:
                continue
            if any(pattern in absolute_url for pattern in source.get("exclude_patterns", [])):
                continue
            if absolute_url in seen_urls:
                continue

            seen_urls.add(absolute_url)
            articles.append({
                "title": title,
                "url": absolute_url,
                "source": source["source"],
                "source_name": source["name"],
            })

    return articles


def get_reddit_posts():
    subreddits = ["QualityAssurance", "softwaretesting", "TestAutomation"]
    headers = {"User-Agent": "qa-feed-bot"}
    posts = []

    for sub in subreddits:
        url = f"https://www.reddit.com/r/{sub}/new.json?limit=10"
        try:
            response = requests.get(url, headers=headers, timeout=10)
            data = response.json()
            for item in data["data"]["children"]:
                post = item["data"]
                title = post["title"]

                if len(title) < 20:
                    continue
                if "job" in title.lower():
                    continue
                if title.strip().endswith("?"):
                    continue

                posts.append({
                    "title": title,
                    "url": post["url"],
                    "text": post.get("selftext", ""),
                    "source": "reddit",
                    "source_name": f"Reddit r/{sub}",
                })
        except Exception:
            continue

    return posts


def get_devto_articles():
    tags = ["testing", "quality-assurance", "ai", "devops"]
    articles = []

    for tag in tags:
        url = f"https://dev.to/api/articles?tag={tag}&per_page=10"
        try:
            response = requests.get(url, timeout=10)
            data = response.json()

            for article in data:
                title = article["title"]

                if len(title) < 20:
                    continue
                if "job" in title.lower():
                    continue
                if "tutorial" in title.lower():
                    continue

                articles.append({
                    "title": title,
                    "url": article["url"],
                    "source": "devto",
                    "source_name": "DEV Community",
                })
        except Exception:
            continue

    return articles


def get_hn_articles():
    url = "https://hn.algolia.com/api/v1/search?query=testing"
    articles = []

    try:
        response = requests.get(url, timeout=10)
        data = response.json()

        for item in data["hits"][:15]:
            title = item.get("title")
            link = item.get("url")

            if not title or not link:
                continue
            if len(title) < 20:
                continue

            articles.append({
                "title": title,
                "url": link,
                "source": "hn",
                "source_name": "Hacker News",
            })
    except Exception:
        pass

    return articles


def get_testing_weekly():
    url = "https://softwaretestingweekly.com/issues/"
    articles = []

    try:
        response = requests.get(url, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        links = soup.select("article a")

        for link in links[:20]:
            title = link.get_text(strip=True)
            href = link.get("href")

            if not href:
                continue
            if len(title) < 20:
                continue

            articles.append({
                "title": title,
                "url": href,
                "source": "testing-weekly",
                "source_name": "Software Testing Weekly",
            })
    except Exception:
        pass

    return articles


def analyze_article(article, text):
    prompt = f"""
You are curating a high-quality daily feed for QA engineers and QA leaders.

Focus on:
- industry trends
- AI in software/testing
- engineering culture
- lessons learned
- testing strategy

Avoid:
- tutorials
- setup guides
- overly technical content

ARTICLE TITLE:
{article['title']}

ARTICLE TEXT:
{text}

Return JSON:

{{
"signal": 1-5,
"why_it_matters": "choose one short phrase from the approved list",
"summary": "2-3 sentences",
"key_points": ["point1","point2","point3"],
"takeaway": "one key insight"
}}

SCORING:
5 = exceptional insight
4 = strong insight
3 = useful but generic
2 = technical/tutorial
1 = irrelevant

APPROVED WHY IT MATTERS OPTIONS:
{json.dumps(WHY_IT_MATTERS_OPTIONS)}

Use full range. Only few 5s.
Choose exactly one approved why_it_matters option.

Return ONLY JSON.
"""

    response = get_openai_client().chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        return json.loads(response.choices[0].message.content)
    except Exception:
        return None


def score_article(article):
    return article["signal"] + random.uniform(0, 0.5)


def select_analysis_candidates(candidate_pool, limit=MAX_ANALYZE_CANDIDATES):
    grouped = {}
    for article in candidate_pool:
        source_id = source_id_for(article)
        grouped.setdefault(source_id, []).append(article)

    source_ids = list(grouped.keys())
    random.shuffle(source_ids)
    for source_id in source_ids:
        random.shuffle(grouped[source_id])

    selected = []
    while source_ids and len(selected) < limit:
        remaining_source_ids = []
        for source_id in source_ids:
            articles = grouped[source_id]
            if not articles:
                continue
            selected.append(articles.pop())
            if len(selected) >= limit:
                break
            if articles:
                remaining_source_ids.append(source_id)
        source_ids = remaining_source_ids

    return selected


def select_feed_articles(
    scored_articles,
    target_feed_size=PUBLISHED_POOL_SIZE,
    min_feed_articles=MIN_FEED_ARTICLES,
    min_new_articles=MIN_NEW_ARTICLES,
    max_per_source=MAX_SOURCE_ITEMS_IN_POOL,
):
    new_candidates = [
        article for article in scored_articles if article.get("is_new_today")
    ]
    existing_candidates = [
        article for article in scored_articles if not article.get("is_new_today")
    ]

    new_candidates.sort(key=lambda article: article["_score"], reverse=True)
    existing_candidates.sort(key=lambda article: article["_score"], reverse=True)

    selected = []
    selected_ids = set()
    source_counts = {}

    def take_from(pool, limit):
        taken = 0
        for item in pool:
            if item["id"] in selected_ids:
                continue
            source_id = item.get("source_id") or source_id_for(item)
            if source_counts.get(source_id, 0) >= max_per_source:
                continue
            selected.append(item)
            selected_ids.add(item["id"])
            source_counts[source_id] = source_counts.get(source_id, 0) + 1
            taken += 1
            if taken >= limit:
                break

    if new_candidates:
        take_from(new_candidates, 1)

    remaining_new_needed = max(0, min_new_articles - len(selected))
    if remaining_new_needed > 0:
        take_from(new_candidates[1:], remaining_new_needed)

    target_size = max(min_feed_articles, target_feed_size)
    remaining_slots = max(0, target_size - len(selected))
    if remaining_slots > 0:
        combined_pool = sorted(
            new_candidates + existing_candidates,
            key=lambda article: article["_score"],
            reverse=True,
        )
        take_from(combined_pool, remaining_slots)

    return selected


def build_available_sources(articles):
    seen = {}
    for article in articles:
        source_id = article["source_id"]
        if source_id in seen:
            continue
        seen[source_id] = {
            "id": source_id,
            "label": article["source_name"],
        }
    return sorted(seen.values(), key=lambda source: source["label"].lower())


def generate_feed():
    now = utc_now()
    today_str = now.strftime("%Y-%m-%d")
    today = now.date()
    random.seed(today_str)
    state = load_state()

    articles = []
    articles += get_rss_articles()
    articles += get_html_articles()
    articles += get_reddit_posts()
    articles += get_devto_articles()
    articles += get_hn_articles()
    articles += get_testing_weekly()

    print("Total scraped:", len(articles))

    deduped_candidates = {}
    for article in articles:
        article_id = article_id_for(article["url"])
        if article_id not in deduped_candidates:
            deduped_candidates[article_id] = article

    candidate_pool = list(deduped_candidates.values())
    articles = select_analysis_candidates(candidate_pool)
    print("Candidates selected for analysis:", len(articles))

    with open(RAW_FILE, "w", encoding="utf-8") as f:
        json.dump(articles, f, indent=2)

    processed = []
    with_text = 0
    expired_count = 0
    seen_ids = set()

    for article in articles:
        article_id, state_record = ensure_state_record(article, state, today_str)
        seen_ids.add(article_id)

        if is_expired(state_record, today):
            state_record["status"] = "expired"
            expired_count += 1
            continue

        text = article.get("text") or extract_text(article["url"])

        if not text:
            continue

        with_text += 1
        analysis = analyze_article(article, text)

        if not analysis:
            continue

        if analysis.get("signal", 0) < 2:
            continue

        why_it_matters = analysis.get("why_it_matters")
        if why_it_matters not in WHY_IT_MATTERS_OPTIONS:
            why_it_matters = "Actionable idea"

        processed_article = {
            "id": article_id,
            "title": article["title"],
            "url": state_record["canonical_url"],
            "source": article["source"],
            "source_name": article.get("source_name") or article["source"],
            "source_id": source_id_for(article),
            "signal": analysis["signal"],
            "why_it_matters": why_it_matters,
            "summary": analysis["summary"],
            "key_points": analysis["key_points"],
            "takeaway": analysis["takeaway"],
            "first_seen_at": state_record["first_seen_at"],
            "last_shown_at": state_record.get("last_shown_at"),
            "expires_at": state_record["expires_at"],
        }
        processed.append(processed_article)
        state_record.update({
            "source": processed_article["source"],
            "source_name": processed_article["source_name"],
            "source_id": processed_article["source_id"],
            "signal": processed_article["signal"],
            "why_it_matters": processed_article["why_it_matters"],
            "summary": processed_article["summary"],
            "key_points": processed_article["key_points"],
            "takeaway": processed_article["takeaway"],
        })

    for article_id, record in state.items():
        if article_id in seen_ids:
            continue
        if is_expired(record, today):
            record["status"] = "expired"
            continue
        article = build_article_from_state(record)
        if article:
            processed.append(article)

    print("After text extraction:", with_text)
    print("After AI filtering:", len(processed))
    print("Expired candidates skipped:", expired_count)

    deduped = {}
    for article in processed:
        existing = deduped.get(article["id"])
        if existing is None or article["signal"] > existing["signal"]:
            deduped[article["id"]] = article

    scored_articles = []
    for article in deduped.values():
        article_copy = article.copy()
        article_copy["_score"] = score_article(article_copy)
        article_copy["rank_score"] = round(article_copy["_score"], 4)
        article_copy["is_new_today"] = article["first_seen_at"] == today_str
        scored_articles.append(article_copy)

    selected = select_feed_articles(scored_articles)
    new_candidates = [
        article for article in scored_articles if article["is_new_today"]
    ]

    final_feed = sorted(selected, key=lambda article: article["_score"], reverse=True)
    featured_id = final_feed[0]["id"] if final_feed else None

    for article in final_feed:
        state_record = state[article["id"]]
        state_record["last_shown_at"] = today_str
        state_record["times_shown"] += 1
        state_record["status"] = "active"
        state_record["rank_score"] = article["rank_score"]
        article["last_shown_at"] = today_str
        article["featured"] = article["id"] == featured_id
        article.pop("_score", None)

    save_state(state)

    print("New candidates available:", len(new_candidates))
    print(
        "Existing candidates reused:",
        sum(1 for article in final_feed if not article["is_new_today"]),
    )
    print("Final feed size:", len(final_feed))

    final_output = {
        "generated_at": now.isoformat(),
        "pool_size": len(final_feed),
        "default_feed_size": DEFAULT_VISIBLE_FEED_SIZE,
        "available_sources": build_available_sources(final_feed),
        "articles": final_feed,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2)

    print("Feed generation complete")


if __name__ == "__main__":
    generate_feed()
