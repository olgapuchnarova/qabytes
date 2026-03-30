import unittest
from datetime import date

import generate_feed


class GenerateFeedTests(unittest.TestCase):
    def test_canonicalize_url_removes_tracking_params(self):
        url = (
            "https://Example.com/articles/test/?utm_source=newsletter"
            "&fbclid=abc123&keep=yes#fragment"
        )

        self.assertEqual(
            generate_feed.canonicalize_url(url),
            "https://example.com/articles/test?keep=yes",
        )

    def test_ensure_state_record_sets_first_seen_and_expiry(self):
        state = {}
        article = {"title": "Useful article", "url": "https://example.com/post"}

        article_id, record = generate_feed.ensure_state_record(
            article, state, "2026-03-30"
        )

        self.assertEqual(record["id"], article_id)
        self.assertEqual(record["first_seen_at"], "2026-03-30")
        self.assertEqual(record["expires_at"], "2026-04-13")
        self.assertEqual(record["times_shown"], 0)
        self.assertEqual(record["status"], "active")

    def test_is_expired_only_after_expiry_date(self):
        record = {"expires_at": "2026-04-13"}

        self.assertFalse(generate_feed.is_expired(record, date(2026, 4, 13)))
        self.assertTrue(generate_feed.is_expired(record, date(2026, 4, 14)))

    def test_select_feed_articles_prefers_minimum_new_items(self):
        scored_articles = [
            {"id": "new-1", "_score": 9.0, "is_new_today": True},
            {"id": "new-2", "_score": 8.0, "is_new_today": True},
            {"id": "new-3", "_score": 7.0, "is_new_today": True},
            {"id": "old-1", "_score": 10.0, "is_new_today": False},
            {"id": "old-2", "_score": 6.0, "is_new_today": False},
        ]

        selected = generate_feed.select_feed_articles(
            scored_articles,
            target_feed_size=4,
            min_feed_articles=3,
            min_new_articles=3,
        )

        self.assertEqual([article["id"] for article in selected[:3]], ["new-1", "new-2", "new-3"])
        self.assertEqual(len(selected), 4)
        self.assertEqual(selected[3]["id"], "old-1")

    def test_select_feed_articles_falls_back_to_existing_when_needed(self):
        scored_articles = [
            {"id": "new-1", "_score": 8.0, "is_new_today": True},
            {"id": "old-1", "_score": 9.0, "is_new_today": False},
            {"id": "old-2", "_score": 7.5, "is_new_today": False},
        ]

        selected = generate_feed.select_feed_articles(
            scored_articles,
            target_feed_size=3,
            min_feed_articles=3,
            min_new_articles=3,
        )

        self.assertEqual([article["id"] for article in selected], ["new-1", "old-1", "old-2"])


if __name__ == "__main__":
    unittest.main()
