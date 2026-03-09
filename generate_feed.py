import os
import json
import feedparser
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

OUTPUT_FILE = "public/feed.json"
MAX_ARTICLES = 15

# ---------------------------
# RSS SOURCES (high quality)
# ---------------------------

RSS_FEEDS = [

    # QA / Testing
    "https://www.ministryoftesting.com/articles/rss",
    "https://testing.googleblog.com/feeds/posts/default",
    "https://blog.testproject.io/feed/",
    "https://automationpanda.com/feed/",

    # Engineering culture / practices
    "https://martinfowler.com/feed.atom",
    "https://www.thoughtworks.com/rss/insights.xml",
    "https://increment.com/feed.xml",

    # Tech leadership / dev trends
    "https://stackoverflow.blog/feed/",
    "https://thenewstack.io/feed/",
    "https://www.infoq.com/testing/rss/",
]

# ---------------------------
# BASIC ARTICLE TEXT EXTRACTOR
# ---------------------------

def extract_text(url):

    try:
        r = requests.get(url, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")

        paragraphs = soup.find_all("p")

        text = " ".join([p.get_text() for p in paragraphs])

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
# REDDIT SOURCE
# ---------------------------

def get_reddit_posts():

    subreddits = [
        "QualityAssurance",
        "softwaretesting",
        "TestAutomation"
    ]

    posts = []

    headers = {"User-Agent": "qa-feed-bot"}

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
# DEV.TO API
# ---------------------------

def get_devto_articles():

    tags = [
        "testing",
        "quality-assurance",
        "ai",
        "devops"
    ]

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


# ---------------------------
# SOFTWARE TESTING WEEKLY
# ---------------------------

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


# ---------------------------
# AI ANALYSIS
# ---------------------------

def analyze_article(article, text):

    prompt = f"""
You are curating a **daily intelligence feed for QA engineers and QA leaders**.

Preferred topics:

• AI in development or testing
• QA leadership
• testing culture
• engineering practices
• CI/CD and quality strategy
• lessons learned in real teams

Avoid:

• deep coding tutorials
• framework setup guides
• low value discussions

ARTICLE TITLE:
{article['title']}

ARTICLE TEXT:
{text}

Return JSON:

{{
"signal": number 1-5,
"summary": "2-3 sentence summary",
"key_points": ["point1","point2","point3"],
"takeaway": "one actionable insight"
}}

SCORING RULES

5 = exceptional industry insight  
4 = strong insight or thoughtful analysis  
3 = useful but generic  
2 = mostly technical tutorial  
1 = irrelevant

IMPORTANT:
Use the full scoring range.
Only a few articles should receive 5.

Return ONLY JSON.
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}]
    )

    content = response.choices[0].message.content

    try:
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
    articles += get_testing_weekly()

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

    processed = processed[:MAX_ARTICLES]

    os.makedirs("public", exist_ok=True)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(processed, f, indent=2)

    print(f"Generated {len(processed)} curated articles")


if __name__ == "__main__":
    generate_feed()
