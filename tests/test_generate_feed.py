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

    def test_source_id_for_is_stable_per_source(self):
        self.assertEqual(
            generate_feed.source_id_for({"source": "devto", "source_name": "DEV Community"}),
            "devto",
        )
        self.assertEqual(
            generate_feed.source_id_for({"source": "rss", "source_name": "Google Testing Blog"}),
            "rss:google-testing-blog",
        )

    def test_select_analysis_candidates_balances_sources_round_robin(self):
        candidate_pool = [
            {"id": "dev-1", "source": "devto", "source_name": "DEV Community"},
            {"id": "dev-2", "source": "devto", "source_name": "DEV Community"},
            {"id": "rss-1", "source": "rss", "source_name": "Google Testing Blog"},
            {"id": "rss-2", "source": "rss", "source_name": "Google Testing Blog"},
        ]

        selected = generate_feed.select_analysis_candidates(candidate_pool, limit=4)

        self.assertEqual(len(selected), 4)
        self.assertEqual(
            {generate_feed.source_id_for(article) for article in selected[:2]},
            {"devto", "rss:google-testing-blog"},
        )

    def test_select_feed_articles_applies_per_source_cap(self):
        scored_articles = [
            {"id": "dev-1", "_score": 10.0, "is_new_today": True, "source_id": "devto"},
            {"id": "dev-2", "_score": 9.5, "is_new_today": True, "source_id": "devto"},
            {"id": "dev-3", "_score": 9.0, "is_new_today": True, "source_id": "devto"},
            {"id": "rss-1", "_score": 8.5, "is_new_today": False, "source_id": "rss:one"},
            {"id": "rss-2", "_score": 8.0, "is_new_today": False, "source_id": "rss:two"},
        ]

        selected = generate_feed.select_feed_articles(
            scored_articles,
            target_feed_size=4,
            min_feed_articles=4,
            min_new_articles=1,
            max_per_source=2,
        )

        self.assertEqual([article["id"] for article in selected], ["dev-1", "dev-2", "rss-1", "rss-2"])

    def test_build_available_sources_returns_sorted_unique_sources(self):
        articles = [
            {"source_id": "rss:b", "source_name": "Beta"},
            {"source_id": "rss:a", "source_name": "Alpha"},
            {"source_id": "rss:b", "source_name": "Beta"},
        ]

        self.assertEqual(
            generate_feed.build_available_sources(articles),
            [
                {"id": "rss:a", "label": "Alpha"},
                {"id": "rss:b", "label": "Beta"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
