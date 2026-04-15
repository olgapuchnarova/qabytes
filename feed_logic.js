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
      source_id: article.source_id || article.source || "",
      category: article.category || "",
      signal: article.signal || 0,
      rank_score:
        typeof article.rank_score === "number" ? article.rank_score : article.signal || 0,
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

  function filterArticlesBySources(items, selectedSourceIds) {
    if (!(selectedSourceIds instanceof Set) || selectedSourceIds.size === 0) {
      return [];
    }

    return items.filter((article) => selectedSourceIds.has(article.source_id));
  }

  function getAvailableSources(items, declaredSources) {
    if (Array.isArray(declaredSources) && declaredSources.length > 0) {
      return [...declaredSources].sort((left, right) =>
        (left.label || "").localeCompare(right.label || "")
      );
    }

    const seen = new Map();
    items.forEach((article) => {
      if (!article.source_id || seen.has(article.source_id)) {
        return;
      }
      seen.set(article.source_id, {
        id: article.source_id,
        label: article.source_name || article.source_id,
      });
    });

    return [...seen.values()].sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }

  function selectArticlesWithSourceCap(items, limit, maxPerSource) {
    if (!Array.isArray(items) || limit <= 0) {
      return [];
    }

    if (!maxPerSource || maxPerSource < 1) {
      return items.slice(0, limit);
    }

    const selected = [];
    const selectedIds = new Set();
    const sourceCounts = new Map();

    items.forEach((article) => {
      if (selected.length >= limit) {
        return;
      }

      const sourceId = article.source_id || "";
      const nextCount = (sourceCounts.get(sourceId) || 0) + 1;
      if (nextCount > maxPerSource) {
        return;
      }

      selected.push(article);
      selectedIds.add(article.id);
      sourceCounts.set(sourceId, nextCount);
    });

    if (selected.length >= limit) {
      return selected;
    }

    items.forEach((article) => {
      if (selected.length >= limit || selectedIds.has(article.id)) {
        return;
      }

      selected.push(article);
      selectedIds.add(article.id);
    });

    return selected;
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

      const leftScore =
        typeof left.rank_score === "number" ? left.rank_score : left.signal || 0;
      const rightScore =
        typeof right.rank_score === "number" ? right.rank_score : right.signal || 0;

      return rightScore - leftScore;
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
    filterArticlesBySources,
    getAvailableSources,
    selectArticlesWithSourceCap,
    snapshotArticle,
    sortLatestInsights,
    getSavedArticles,
  };
});
