import feedparser
import requests
from bs4 import BeautifulSoup
import json
import os
from openai import OpenAI
from datetime import datetime

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

RSS_FEEDS = [
    "https://www.ministryoftesting.com/articles.rss",
    "https://www.stickyminds.com/rss.xml",
    "https://www.utest.com/feed",
    "https://testing.googleblog.com/feeds/posts/default",
    "https://martinfowler.com/feed.atom",
    "https://netflixtechblog.com/feed",
    "https://openai.com/blog/rss.xml",
    "https://www.infoq.com/feed/"
]

def fetch_article_content(url):
    try:
        response = requests.get(url, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        paragraphs = soup.find_all("p")
        text = " ".join([p.get_text() for p in paragraphs])
        return text[:8000]
    except:
        return ""

def analyze_article(title, content):

    prompt = f"""
You are the editorial engine behind QABytes.

Audience:
QA Engineers and QA Leads.

Your job:
Analyze the article and return STRICT JSON.

Rules:
- Be sharp.
- No buzzwords.
- Penalize marketing fluff.
- Reward strategic engineering shifts.
- Score signal from 1-5 (integer only).

Return ONLY valid JSON:

{{
"summary": "...",
"why_this_matters": "...",
"signal_score": 1,
"category": "...",
"actionable_takeaway": "..."
}}

Article Title:
{title}

Article Content:
{content}
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a senior QA strategist."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.4
    )

    return response.choices[0].message.content

def main():
    articles = []

    for feed_url in RSS_FEEDS:
        feed = feedparser.parse(feed_url)

        for entry in feed.entries[:3]:
            title = entry.title
            link = entry.link
            content = fetch_article_content(link)

            if len(content) < 500:
                continue

            try:
                ai_response = analyze_article(title, content)
                parsed = json.loads(ai_response)

                articles.append({
                    "title": title,
                    "link": link,
                    "summary": parsed["summary"],
                    "why_this_matters": parsed["why_this_matters"],
                    "signal_score": parsed["signal_score"],
                    "category": parsed["category"],
                    "actionable_takeaway": parsed["actionable_takeaway"],
                    "date": datetime.utcnow().isoformat()
                })

            except Exception as e:
                print("Error processing:", title)

    articles = sorted(articles, key=lambda x: x["signal_score"], reverse=True)

    os.makedirs("data", exist_ok=True)

    with open("data/feed.json", "w") as f:
        json.dump(articles[:15], f, indent=2)

if __name__ == "__main__":
    main()
