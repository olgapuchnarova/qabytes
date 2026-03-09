import os
import json
import feedparser
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

OUTPUT_FILE = "public/feed.json"

RSS_FEEDS = [
    "https://www.ministryoftesting.com/articles/rss",
    "https://martinfowler.com/feed.atom",
    "https://testing.googleblog.com/feeds/posts/default",
    "https://dev.to/feed/tag/testing",
    "https://dev.to/feed/tag/quality-assurance",
    "https://dev.to/feed/tag/ai",
]

MAX_ARTICLES = 15


def extract_text(url):
    try:
        r = requests.get(url, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")

        paragraphs = soup.find_all("p")
        text = " ".join([p.get_text() for p in paragraphs])

        return text[:6000]

    except Exception:
        return ""


def get_articles():
    articles = []

    for feed in RSS_FEEDS:
        parsed = feedparser.parse(feed)

        for entry in parsed.entries[:5]:
            articles.append({
                "title": entry.title,
                "url": entry.link,
                "source": feed
            })

    return articles


def analyze_article(article, text):

    prompt = f"""
You are curating a **daily intelligence feed for QA engineers and QA leaders**.

The audience wants:
- industry insights
- testing culture
- AI in software development
- engineering leadership
- modern development practices
- lessons learned

Avoid overly technical tutorials or code-heavy implementation guides.

ARTICLE TITLE:
{article['title']}

ARTICLE TEXT:
{text}

Return JSON with the following structure:

{{
 "signal": number from 1 to 5,
 "summary": "2-3 sentence summary",
 "key_points": ["bullet1","bullet2","bullet3","bullet4","bullet5"],
 "takeaway": "one clear takeaway for QA engineers or leaders"
}}

SCORING RULES:

5 = exceptional insight, industry trend, leadership or future of testing  
4 = strong insight or thoughtful discussion  
3 = useful but somewhat generic  
2 = mostly technical tutorial  
1 = irrelevant to QA / testing / engineering culture

IMPORTANT:
Use the full scale. Only a few articles should be 5.
Many should be 2 or 3.

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


def generate_feed():

    articles = get_articles()

    processed = []

    for article in articles:

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

    print(f"Generated {len(processed)} articles")


if __name__ == "__main__":
    generate_feed()
