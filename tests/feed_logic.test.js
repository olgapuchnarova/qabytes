const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterArticles,
  snapshotArticle,
  sortLatestInsights,
  getSavedArticles,
} = require("../feed_logic.js");

test("filterArticles returns all items for the All filter", () => {
  const items = [
    { id: "1", why_it_matters: "AI in QA" },
    { id: "2", why_it_matters: "Testing strategy" },
  ];

  assert.deepEqual(filterArticles(items, "All"), items);
});

test("filterArticles keeps only matching taxonomy labels", () => {
  const items = [
    { id: "1", why_it_matters: "AI in QA" },
    { id: "2", why_it_matters: "Testing strategy" },
  ];

  assert.deepEqual(filterArticles(items, "AI in QA"), [items[0]]);
});

test("sortLatestInsights orders unread before read, then new, then signal", () => {
  const items = [
    { id: "read-high", is_new_today: true, signal: 5 },
    { id: "unread-old-high", is_new_today: false, signal: 5 },
    { id: "unread-new-low", is_new_today: true, signal: 3 },
    { id: "unread-new-high", is_new_today: true, signal: 4 },
  ];

  const state = {
    "read-high": { read: true },
    "unread-old-high": { read: false },
    "unread-new-low": { read: false },
    "unread-new-high": { read: false },
  };

  const sorted = sortLatestInsights(items, (id) => state[id] || {});

  assert.deepEqual(
    sorted.map((article) => article.id),
    ["unread-new-high", "unread-new-low", "unread-old-high", "read-high"]
  );
});

test("getSavedArticles returns only saved items", () => {
  const items = [{ id: "1", title: "One" }, { id: "2" }, { id: "3", title: "Three" }];
  const state = {
    "1": { saved: true, saved_article: { id: "1", title: "Old one" }, saved_at: "2026-03-31T10:00:00.000Z" },
    "2": { saved: false },
    "3": { saved: true, saved_article: { id: "3", title: "Three" }, saved_at: "2026-03-30T10:00:00.000Z" },
  };

  assert.deepEqual(
    getSavedArticles(items, state),
    [items[0], items[2]]
  );
});

test("getSavedArticles keeps saved snapshots that are no longer in the feed", () => {
  const items = [{ id: "1", title: "Still in feed" }];
  const state = {
    "1": {
      saved: true,
      saved_article: { id: "1", title: "Older title" },
      saved_at: "2026-03-31T10:00:00.000Z",
    },
    "2": {
      saved: true,
      saved_article: {
        id: "2",
        title: "Saved yesterday",
        url: "https://example.com/yesterday",
        why_it_matters: "AI in QA",
      },
      saved_at: "2026-03-31T09:00:00.000Z",
    },
  };

  assert.deepEqual(
    getSavedArticles(items, state).map((article) => article.id),
    ["1", "2"]
  );
  assert.equal(getSavedArticles(items, state)[1].title, "Saved yesterday");
});

test("snapshotArticle keeps the fields needed to render a saved card later", () => {
  const article = {
    id: "abc",
    title: "Saved article",
    url: "https://example.com/article",
    source: "rss",
    source_name: "Example",
    signal: 4,
    why_it_matters: "Testing strategy",
    summary: "Short summary",
    key_points: ["One", "Two"],
    takeaway: "Do this",
    is_new_today: true,
  };

  assert.deepEqual(snapshotArticle(article), {
    id: "abc",
    title: "Saved article",
    url: "https://example.com/article",
    link: "https://example.com/article",
    source: "rss",
    source_name: "Example",
    category: "",
    signal: 4,
    why_it_matters: "Testing strategy",
    summary: "Short summary",
    key_points: ["One", "Two"],
    takeaway: "Do this",
    actionable_takeaway: "Do this",
    is_new_today: true,
  });
});
