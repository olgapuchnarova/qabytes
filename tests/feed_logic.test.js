const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterArticles,
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
  const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const state = {
    "1": { saved: true },
    "2": { saved: false },
    "3": { saved: true },
  };

  assert.deepEqual(
    getSavedArticles(items, (id) => state[id] || {}),
    [items[0], items[2]]
  );
});
