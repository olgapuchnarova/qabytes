import os
import json
import feedparser
import requests
from bs4 import BeautifulSoup
from openai import OpenAI
from datetime import datetime
import random

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

OUTPUT_FILE = "public/feed.json"
RAW_FILE = "public/raw_candidates.json"

MAX_ARTICLES = 30

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

def extract_text(url):
    try:
        r = requests.get(url, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
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
                "source": "rss"
            })
    return articles

def get_reddit_posts():
    subreddits = ["QualityAssurance", "softwaretesting", "TestAutomation"]
    headers = {"User-Agent": "qa-feed-bot"}
    posts = []

    for sub in subreddits:
        url = f"https://www.reddit.com/r/{sub}/new.json?limit=10"
        try:
            r = requests.get(url, headers=headers, timeout=10)
            data = r.json()
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
                    "source": "reddit"
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
            r = requests.get(url, timeout=10)
            data = r.json()

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
                    "source": "devto"
                })
        except Exception:
            continue

    return articles

def get_hn_articles():
    url = "https://hn.algolia.com/api/v1/search?query=testing"
    articles = []

    try:
        r = requests.get(url, timeout=10)
        data = r.json()

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
                "source": "hn"
            })
    except Exception:
        pass

    return articles

def get_testing_weekly():
    url = "https://softwaretestingweekly.com/issues/"
    articles = []

    try:
        r = requests.get(url, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
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
                "source": "testing-weekly"
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

Use full range. Only few 5s.

Return ONLY JSON.
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}]
    )

    try:
        return json.loads(response.choices[0].message.content)
    except Exception:
        return None

def generate_feed():

    today_seed = datetime.utcnow().strftime("%Y-%m-%d")
    random.seed(today_seed)

    articles = []
    articles += get_rss_articles()
    articles += get_reddit_posts()
    articles += get_devto_articles()
    articles += get_hn_articles()
    articles += get_testing_weekly()

    print("Total scraped:", len(articles))

    os.makedirs("public", exist_ok=True)

    with open(RAW_FILE, "w") as f:
        json.dump(articles, f, indent=2)

    processed = []
    with_text = 0

    for article in articles:

        text = article.get("text") or extract_text(article["url"])

        if not text:
            continue

        with_text += 1

        analysis = analyze_article(article, text)

        if not analysis:
            continue

        if analysis["signal"] < 2:
            continue

        processed.append({
            "title": article["title"],
            "url": article["url"],
            "source": article["source"],
            "signal": analysis["signal"],
            "summary": analysis["summary"],
            "key_points": analysis["key_points"],
            "takeaway": analysis["takeaway"]
        })

    print("After text extraction:", with_text)
    print("After AI filtering:", len(processed))

    def score(article):
        return article["signal"] + random.uniform(0, 0.5)

    processed.sort(key=score, reverse=True)
    final_feed = processed[:MAX_ARTICLES]

    final_feed.sort(key=score, reverse=True)

    print("Final feed size:", len(final_feed))

    # 🔥 Force change every run
    final_output = {
        "generated_at": datetime.utcnow().isoformat(),
        "articles": final_feed
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(final_output, f, indent=2)

    print("Feed generation complete")


if __name__ == "__main__":
    generate_feed()
