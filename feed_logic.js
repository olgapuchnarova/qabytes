(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
    return;
  }

  root.QABytesFeedLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function snapshotArticle(article) {
    return {
      id: article.id,
      title: article.title || "",
      url: article.url || article.link || "",
      link: article.link || article.url || "",
      source: article.source || "",
      source_name: article.source_name || article.source || "",
      category: article.category || "",
      signal: article.signal || 0,
      why_it_matters: article.why_it_matters || "",
      summary: article.summary || "",
      key_points: Array.isArray(article.key_points) ? [...article.key_points] : [],
      takeaway: article.takeaway || article.actionable_takeaway || "",
      actionable_takeaway: article.actionable_takeaway || article.takeaway || "",
      is_new_today: Boolean(article.is_new_today),
    };
  }

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

  function getSavedArticles(feedArticles, articleState) {
    const feedById = new Map(feedArticles.map((article) => [article.id, article]));
    const savedArticles = [];

    Object.entries(articleState || {}).forEach(([articleId, state]) => {
      if (!state || !state.saved) {
        return;
      }

      const currentArticle = feedById.get(articleId);
      const savedSnapshot =
        state.saved_article && typeof state.saved_article === "object"
          ? state.saved_article
          : null;
      const mergedArticle = currentArticle
        ? { ...(savedSnapshot || {}), ...currentArticle }
        : savedSnapshot;

      if (!mergedArticle || !mergedArticle.id) {
        return;
      }

      savedArticles.push({
        ...mergedArticle,
        _saved_at: state.saved_at || "",
      });
    });

    savedArticles.sort((left, right) =>
      (right._saved_at || "").localeCompare(left._saved_at || "")
    );

    return savedArticles.map(({ _saved_at, ...article }) => article);
  }

  return {
    filterArticles,
    snapshotArticle,
    sortLatestInsights,
    getSavedArticles,
  };
});
