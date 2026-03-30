(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
    return;
  }

  root.QABytesFeedLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function filterArticles(items, activeFilter) {
    if (activeFilter === "All") {
      return items;
    }

    return items.filter((article) => article.why_it_matters === activeFilter);
  }

  function sortLatestInsights(items, getArticleState) {
    return [...items].sort((left, right) => {
      const leftRead = Boolean(getArticleState(left.id).read);
      const rightRead = Boolean(getArticleState(right.id).read);

      if (leftRead !== rightRead) {
        return leftRead ? 1 : -1;
      }

      if (left.is_new_today !== right.is_new_today) {
        return left.is_new_today ? -1 : 1;
      }

      return (right.signal || 0) - (left.signal || 0);
    });
  }

  function getSavedArticles(items, getArticleState) {
    return items.filter((article) => Boolean(getArticleState(article.id).saved));
  }

  return {
    filterArticles,
    sortLatestInsights,
    getSavedArticles,
  };
});
