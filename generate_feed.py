import os
import json
import feedparser
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

OUTPUT_FILE = "feed.json"
MAX_ARTICLES = 15

HEADERS = {
    "User-Agent": "Mozilla/5.0 (QABytes Feed Bot)"
}

# ---------------------------
# RSS SOURCES
# ---------------------------

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

# ---------------------------
# TEXT EXTRACTION
# ---------------------------

def extract_text(url):

    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")

        paragraphs = soup.find_all("p")

        text = " ".join(p.get_text() for p in paragraphs)

        return text[:6000]

    except Exception:
        return ""


# ---------------------------
# RSS ARTICLES
# ---------------------------

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


# ---------------------------
# REDDIT
# ---------------------------

def get_reddit_posts():

    subreddits = [
        "QualityAssurance",
        "softwaretesting",
        "TestAutomation"
    ]

    posts = []

    for sub in subreddits:

        url = f"https://www.reddit.com/r/{sub}/new.json?limit=10"

        try:

            r = requests.get(url, headers=HEADERS, timeout=10)

            data = r.json()

            for item in data["data"]["children"]:

                post = item["data"]

                title = post["title"]

                if len(title) < 20:
                    continue

                if "job" in title.lower():
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


# ---------------------------
# DEV.TO
# ---------------------------

def get_devto_articles():

    tags = ["testing", "quality-assurance", "ai", "devops"]

    articles = []

    for tag in tags:

        url = f"https://dev.to/api/articles?tag={tag}&per_page=8"

        try:

            r = requests.get(url, headers=HEADERS, timeout=10)

            data = r.json()

            for article in data:

                title = article["title"]

                if len(title) < 20:
                    continue

                if "job" in title.lower():
                    continue

                articles.append({
                    "title": title,
                    "url": article["url"],
                    "source": "devto"
                })

        except Exception:
            continue

    return articles


# ---------------------------
# HACKER NEWS
# ---------------------------

def get_hn_articles():

    url = "https://hn.algolia.com/api/v1/search?query=testing"

    articles = []

    try:

        r = requests.get(url, headers=HEADERS, timeout=10)

        data = r.json()

        for item in data["hits"][:10]:

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


# ---------------------------
# AI ANALYSIS
# ---------------------------

def analyze_article(article, text):

    prompt = f"""
You curate a daily intelligence briefing for QA engineers.

ARTICLE TITLE:
{article['title']}

ARTICLE TEXT:
{text}

Return JSON:

{{
"signal": 1-5,
"summary": "short summary",
"key_points": ["p1","p2","p3"],
"takeaway": "practical takeaway"
}}

Return ONLY JSON.
"""

    try:

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.2,
            messages=[{"role": "user", "content": prompt}]
        )

        content = response.choices[0].message.content

        return json.loads(content)

    except Exception:

        return None


# ---------------------------
# MAIN GENERATOR
# ---------------------------

def generate_feed():

    articles = []

    articles += get_rss_articles()
    articles += get_reddit_posts()
    articles += get_devto_articles()
    articles += get_hn_articles()

    print(f"Collected {len(articles)} raw articles")

    processed = []

    for article in articles:

        text = article.get("text")

        if not text:
            text = extract_text(article["url"])

        if not text:
            continue

        analysis = analyze_article(article, text)

        if not analysis:
            continue

        if analysis["signal"] < 3:
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

    processed.sort(key=lambda x: x["signal"], reverse=True)

    if not processed:

        print("No AI-approved articles — falling back to raw feed")

        processed = articles[:MAX_ARTICLES]

    processed = processed[:MAX_ARTICLES]

    with open(OUTPUT_FILE, "w") as f:
        json.dump(processed, f, indent=2)

    print(f"Generated {len(processed)} curated articles")


if __name__ == "__main__":
    generate_feed()
