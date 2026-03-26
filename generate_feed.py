import hashlib
import json
import os
import random
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

OUTPUT_FILE = "feed.json"
RAW_FILE = "raw_candidates.json"
STATE_FILE = "feed_state.json"

TARGET_FEED_SIZE = 10
MIN_FEED_ARTICLES = 3
MIN_NEW_ARTICLES = 3
ARTICLE_TTL_DAYS = 14
MAX_ANALYZE_CANDIDATES = 25

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
    "https://www.ministryoftesting.com/articles/rss",
    "https://testing.googleblog.com/feeds/posts/default",
    "https://blog.testproject.io/feed/",
    "https://automationpanda.com/feed/",
    "https://martinfowler.com/feed.atom",
    "https://www.thoughtworks.com/rss/insights.xml",
    "https://increment.com/feed.xml",
    "https://stackoverflow.blog/feed/",
    "https://thenewstack.io/feed/",
    "https://www.infoq.com/testing/rss/",
]


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

    return {
        "id": record["id"],
        "title": record["title"],
        "url": record["canonical_url"],
        "source": record["source"],
        "signal": record["signal"],
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
        parsed = feedparser.parse(feed)
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

    response = client.chat.completions.create(
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


def generate_feed():
    now = utc_now()
    today_str = now.strftime("%Y-%m-%d")
    today = now.date()
    random.seed(today_str)
    state = load_state()

    articles = []
    articles += get_rss_articles()
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
    random.shuffle(candidate_pool)
    articles = candidate_pool[:MAX_ANALYZE_CANDIDATES]
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
        article_copy["is_new_today"] = state[article["id"]]["times_shown"] == 0
        scored_articles.append(article_copy)

    new_candidates = [
        article for article in scored_articles if article["is_new_today"]
    ]
    existing_candidates = [
        article for article in scored_articles if not article["is_new_today"]
    ]

    new_candidates.sort(key=lambda article: article["_score"], reverse=True)
    existing_candidates.sort(key=lambda article: article["_score"], reverse=True)

    selected = []
    selected_ids = set()

    def take_from(pool, limit):
        taken = 0
        for item in pool:
            if item["id"] in selected_ids:
                continue
            selected.append(item)
            selected_ids.add(item["id"])
            taken += 1
            if taken >= limit:
                break

    if new_candidates:
        take_from(new_candidates, 1)

    remaining_new_needed = max(0, MIN_NEW_ARTICLES - len(selected))
    if remaining_new_needed > 0:
        take_from(new_candidates[1:], remaining_new_needed)

    target_size = max(MIN_FEED_ARTICLES, TARGET_FEED_SIZE)
    remaining_slots = max(0, target_size - len(selected))
    if remaining_slots > 0:
        combined_pool = sorted(
            new_candidates + existing_candidates,
            key=lambda article: article["_score"],
            reverse=True,
        )
        take_from(combined_pool, remaining_slots)

    featured_id = selected[0]["id"] if selected else None
    featured_article = next(
        (article for article in selected if article["id"] == featured_id),
        None,
    )
    remaining_articles = [
        article for article in selected if article["id"] != featured_id
    ]
    remaining_articles.sort(key=lambda article: article["_score"], reverse=True)
    final_feed = ([featured_article] if featured_article else []) + remaining_articles

    for article in final_feed:
        state_record = state[article["id"]]
        state_record["last_shown_at"] = today_str
        state_record["times_shown"] += 1
        state_record["status"] = "active"
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
        "articles": final_feed,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2)

    print("Feed generation complete")


if __name__ == "__main__":
    generate_feed()
