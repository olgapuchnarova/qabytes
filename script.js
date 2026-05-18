const feedCacheKey = "__BUILD_VERSION__";
const feedRefreshThrottleMs = 60 * 1000;
const defaultVisibleFeedSize = 10;
const articleStateStorageKey = "qabytes_article_state";
const sourcePreferencesStorageKey = "qabytes_source_preferences";
const {
  filterArticles,
  filterArticlesBySources,
  getAvailableSources,
  selectArticlesWithSourceCap,
  snapshotArticle,
  sortLatestInsights,
  getSavedArticles,
} = globalThis.QABytesFeedLogic;
const analytics = globalThis.QABytesAnalytics || null;

const feedContainer = document.getElementById("feed");
const activeFiltersContainer = document.getElementById("active-filters");
const savedHeaderToggle = document.getElementById("saved-header-toggle");
const savedHeaderCount = document.getElementById("saved-header-count");
const readHeaderToggle = document.getElementById("read-header-toggle");
const readHeaderCount = document.getElementById("read-header-count");
const filtersPanelToggle = document.getElementById("filters-panel-toggle");
const filtersPanelCount = document.getElementById("filters-panel-count");
const filtersPanelBody = document.getElementById("filters-panel-body");
const scrollTopButton = document.getElementById("scroll-top-button");
const readCompletionDelayMs = 1180;
const unreadCompletionDelayMs = 1020;
const readDismissDelayMs = 760;
const readListRetentionMs = 30 * 24 * 60 * 60 * 1000;
const readListMaxItems = 50;
const taxonomyLabels = [
  "All",
  "Strategic shift",
  "Testing strategy",
  "AI in QA",
  "Leadership signal",
  "Process warning",
  "Tooling trend",
  "Reliability lesson",
  "Governance risk",
  "Cost implication",
  "Quality practice",
  "Industry change",
  "Actionable idea",
];

let feedArticles = [];
let availableSources = [];
let visibleFeedSize = defaultVisibleFeedSize;
let activeFilter = "All";
let currentViewMode = "default";
let isFiltersPanelOpen = false;
let hasInitializedUi = false;
let currentFeedSignature = "";
let lastFeedRefreshAt = 0;
let refreshInFlight = null;
let currentFeedGeneratedAt = "";
let hasTrackedSessionEnd = false;
const bundledFeedData = globalThis.QABytesFeedData || null;

const scrollDepthMilestones = [25, 50, 75, 90];
const reachedScrollDepthMilestones = new Set();
const sessionMetrics = {
  articlesOpenedCount: 0,
  articlesMarkedReadCount: 0,
  articlesSavedCount: 0,
  filtersUsed: new Set(),
  maxScrollDepthPercent: 0,
};

function loadArticleState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(articleStateStorageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Failed to read article state:", error);
    return {};
  }
}

function loadSourcePreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(sourcePreferencesStorageKey) || "{}");
    if (!parsed || typeof parsed !== "object") {
      return { selectedSourceIds: null };
    }

    return {
      selectedSourceIds: Array.isArray(parsed.selectedSourceIds)
        ? parsed.selectedSourceIds
        : null,
    };
  } catch (error) {
    console.warn("Failed to read source preferences:", error);
    return { selectedSourceIds: null };
  }
}

let articleState = loadArticleState();
let sourcePreferences = loadSourcePreferences();

function saveArticleState() {
  localStorage.setItem(articleStateStorageKey, JSON.stringify(articleState));
}

function saveSourcePreferences() {
  localStorage.setItem(sourcePreferencesStorageKey, JSON.stringify(sourcePreferences));
}

function getArticleState(articleId) {
  return articleState[articleId] || { opened: false, read: false };
}

function pruneReadArticleState(now = Date.now()) {
  let hasChanges = false;
  const readEntries = [];

  Object.entries(articleState).forEach(([articleId, state]) => {
    if (!state || !state.read) {
      return;
    }

    const parsedReadAt = Date.parse(state.read_at || "");
    const readAt = Number.isFinite(parsedReadAt) ? parsedReadAt : now;

    if (!state.read_at) {
      articleState[articleId] = {
        ...state,
        read_at: new Date(readAt).toISOString(),
      };
      hasChanges = true;
    }

    readEntries.push({ articleId, readAt });
  });

  const expiredArticleIds = new Set(
    readEntries
      .filter(({ readAt }) => now - readAt > readListRetentionMs)
      .map(({ articleId }) => articleId)
  );

  const overflowArticleIds = new Set(
    readEntries
      .filter(({ articleId }) => !expiredArticleIds.has(articleId))
      .sort((left, right) => right.readAt - left.readAt)
      .slice(readListMaxItems)
      .map(({ articleId }) => articleId)
  );

  [...expiredArticleIds, ...overflowArticleIds].forEach((articleId) => {
    articleState[articleId] = {
      ...getArticleState(articleId),
      read: false,
      read_at: null,
    };
    hasChanges = true;
  });

  if (hasChanges) {
    saveArticleState();
  }
}

function updateArticleState(articleId, changes) {
  articleState[articleId] = {
    ...getArticleState(articleId),
    ...changes,
  };
  saveArticleState();
  if (Object.prototype.hasOwnProperty.call(changes, "read")) {
    pruneReadArticleState();
  }
}

function getAllSourceIds() {
  return availableSources.map((source) => source.id);
}

function getSelectedSourceIdsSet() {
  const allSourceIds = getAllSourceIds();
  const storedSourceIds = Array.isArray(sourcePreferences.selectedSourceIds)
    ? sourcePreferences.selectedSourceIds.filter((sourceId) => allSourceIds.includes(sourceId))
    : null;

  if (!storedSourceIds || storedSourceIds.length === 0) {
    return null;
  }

  return new Set(storedSourceIds);
}

function setSelectedSourceIds(nextSourceIds) {
  const normalizedSourceIds = [...new Set(nextSourceIds)].filter((sourceId) =>
    getAllSourceIds().includes(sourceId)
  );

  sourcePreferences = {
    selectedSourceIds: normalizedSourceIds.length > 0 ? normalizedSourceIds : null,
  };
  saveSourcePreferences();
}

function resetSelectedSourceIds() {
  sourcePreferences = { selectedSourceIds: null };
  saveSourcePreferences();
}

function getSavedCount() {
  return Object.values(articleState).filter((state) => Boolean(state?.saved)).length;
}

function getReadCount() {
  return Object.values(articleState).filter((state) => Boolean(state?.read)).length;
}

function getSourceCount(items) {
  return new Set(
    items.map((article) => article.source_id || article.source || "").filter(Boolean)
  ).size;
}

function getNewTodayCount(items) {
  return items.filter((article) => article.is_new_today).length;
}

function getVisibleArticleCount() {
  return getFilteredFeedArticles().length;
}

function getArticleAnalyticsProperties(article, context = {}) {
  const state = getArticleState(article.id);

  return {
    article_id: article.id,
    article_title: article.title || "",
    source_id: article.source_id || article.source || "",
    source_name: article.source_name || article.source || "",
    category: article.category || "",
    why_it_matters: article.why_it_matters || "",
    rank_score:
      typeof article.rank_score === "number" ? article.rank_score : article.signal || 0,
    is_new_today: Boolean(article.is_new_today),
    list_position: Number.isFinite(context.listPosition) ? context.listPosition : null,
    active_filter: context.activeFilter || activeFilter,
    view_mode: context.viewMode || currentViewMode,
    was_read_before: Boolean(state.read),
    was_saved_before: Boolean(state.saved),
  };
}

function recordFilterUsage(filterName) {
  if (filterName) {
    sessionMetrics.filtersUsed.add(filterName);
  }
}

function trackFilterSelected(filterName, previousFilter) {
  recordFilterUsage(filterName);
  analytics?.trackFilterSelected({
    filter_name: filterName,
    previous_filter: previousFilter,
    visible_article_count: getVisibleArticleCount(),
    view_mode: currentViewMode,
  });
}

function getScrollDepthPercent() {
  const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollHeight <= 0) {
    return 100;
  }

  const progress = Math.min(window.scrollY / scrollHeight, 1);
  return Math.round(progress * 100);
}

function trackScrollDepthIfNeeded() {
  const depthPercent = getScrollDepthPercent();
  sessionMetrics.maxScrollDepthPercent = Math.max(
    sessionMetrics.maxScrollDepthPercent,
    depthPercent
  );

  scrollDepthMilestones.forEach((milestone) => {
    if (depthPercent < milestone || reachedScrollDepthMilestones.has(milestone)) {
      return;
    }

    reachedScrollDepthMilestones.add(milestone);
    analytics?.trackScrollDepthReached({
      depth_percent: milestone,
      active_filter: activeFilter,
      article_count_visible: getVisibleArticleCount(),
      view_mode: currentViewMode,
    });
  });
}

function trackSessionEnd() {
  if (hasTrackedSessionEnd) {
    return;
  }

  hasTrackedSessionEnd = true;
  analytics?.trackSessionEnd({
    articles_opened_count: sessionMetrics.articlesOpenedCount,
    articles_marked_read_count: sessionMetrics.articlesMarkedReadCount,
    articles_saved_count: sessionMetrics.articlesSavedCount,
    filters_used_count: sessionMetrics.filtersUsed.size,
    max_scroll_depth_percent: sessionMetrics.maxScrollDepthPercent,
  });
}

function syncSavedSnapshotsWithFeed() {
  let didChange = false;

  feedArticles.forEach((article) => {
    const state = getArticleState(article.id);
    if (!state.saved) {
      return;
    }

    articleState[article.id] = {
      ...state,
      saved_article: snapshotArticle(article),
    };
    didChange = true;
  });

  if (didChange) {
    saveArticleState();
  }
}

function showDirectionCue(button, direction) {
  const cue = document.createElement("span");
  cue.className = `direction-cue direction-cue-${direction}`;
  cue.textContent = direction === "down" ? "\u2193" : "\u2191";
  button.appendChild(cue);
  cue.addEventListener("animationend", () => cue.remove());
}

function setText(element, value) {
  element.textContent = value || "";
  return element;
}

function safeExternalUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch (error) {
    console.warn("Invalid article URL:", value, error);
  }

  return null;
}

function renderKeyPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "key-points";

  const heading = document.createElement("strong");
  heading.textContent = "Key points:";
  wrapper.appendChild(heading);

  const list = document.createElement("ul");
  points.forEach((point) => {
    const item = document.createElement("li");
    item.textContent = point;
    list.appendChild(item);
  });
  wrapper.appendChild(list);

  return wrapper;
}

function createBookmarkIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 14 18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "bookmark-icon save-toggle-icon");

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute(
    "d",
    "M3 1.25h8a1.75 1.75 0 0 1 1.75 1.75v13.05l-5.75-3.43-5.75 3.43V3A1.75 1.75 0 0 1 3 1.25Z"
  );
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);

  return svg;
}

function createTrashIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "trash-icon dismiss-read-icon");

  const paths = [
    "M3 6h18",
    "M8 6V4.5A2.5 2.5 0 0 1 10.5 2h3A2.5 2.5 0 0 1 16 4.5V6",
    "M19 6l-1 14.5A1.6 1.6 0 0 1 16.4 22H7.6A1.6 1.6 0 0 1 6 20.5L5 6",
    "M10 11v6",
    "M14 11v6",
  ];

  paths.forEach((pathData) => {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  });

  return svg;
}

function getFilteredFeedArticles() {
  return getScopedFilteredArticles();
}

function getDefaultViewArticles() {
  return selectArticlesWithSourceCap(
    sortLatestInsights(feedArticles, getArticleState),
    visibleFeedSize,
    2
  );
}

function getSavedViewArticles() {
  return sortLatestInsights(getSavedArticles(feedArticles, articleState), getArticleState);
}

function getReadViewArticles() {
  return feedArticles
    .filter((article) => Boolean(getArticleState(article.id).read))
    .sort((left, right) => {
      const leftReadAt = getArticleState(left.id).read_at || "";
      const rightReadAt = getArticleState(right.id).read_at || "";

      if (leftReadAt !== rightReadAt) {
        return rightReadAt.localeCompare(leftReadAt);
      }

      return sortLatestInsights([left, right], getArticleState)[0] === left ? -1 : 1;
    });
}

function getCurrentViewArticles() {
  if (currentViewMode === "saved") {
    return getSavedViewArticles();
  }

  if (currentViewMode === "read") {
    return getReadViewArticles();
  }

  return getDefaultViewArticles();
}

function getScopedFilteredArticles() {
  const scopedArticles = getCurrentViewArticles();
  const selectedSourceIds = getSelectedSourceIdsSet();
  const sourceFilteredArticles = selectedSourceIds
    ? filterArticlesBySources(scopedArticles, selectedSourceIds)
    : scopedArticles;
  return filterArticles(sourceFilteredArticles, activeFilter);
}

function countActiveFilters() {
  const selectedSourceIds = getSelectedSourceIdsSet();
  return (selectedSourceIds ? selectedSourceIds.size : 0) + (activeFilter === "All" ? 0 : 1);
}

function getCurrentViewLabel() {
  if (currentViewMode === "saved") {
    return "Saved";
  }

  if (currentViewMode === "read") {
    return "Read";
  }

  return null;
}

function findNextVisibleArticleId(articleId) {
  const visibleArticles = getFilteredFeedArticles();
  const currentIndex = visibleArticles.findIndex((item) => item.id === articleId);
  const nextArticle = visibleArticles[currentIndex + 1];
  return nextArticle?.id || null;
}

function scrollArticleToTop(articleId) {
  if (!articleId || !feedContainer) {
    return;
  }

  const target = [...feedContainer.querySelectorAll(".card")].find(
    (card) => card.dataset.articleId === articleId
  );
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderCard(article, context = {}) {
  const title = article.title || "";
  const category =
    article.category || article.source_name || article.source || "";
  const summary = article.summary || "";
  const takeaway = article.takeaway || article.actionable_takeaway || "";
  const whyItMatters = article.why_it_matters || "";
  const link = article.link || article.url;
  const safeUrl = safeExternalUrl(link);
  const state = getArticleState(article.id);
  const isRead = Boolean(state.read);
  const isSaved = Boolean(state.saved);

  const card = document.createElement(safeUrl ? "a" : "article");
  card.className = "card";
  card.dataset.articleId = article.id;
  if (isRead) {
    card.classList.add("is-read");
  }

  if (safeUrl) {
    card.href = safeUrl;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.addEventListener("click", () => {
      sessionMetrics.articlesOpenedCount += 1;
      analytics?.trackArticleOpened({
        ...getArticleAnalyticsProperties(article, context),
      });
      updateArticleState(article.id, { opened: true });
    });
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";

  if (whyItMatters) {
    const reason = document.createElement("div");
    reason.className = "why-it-matters";
    reason.textContent = `Why it matters: ${whyItMatters}`;
    meta.appendChild(reason);
  }

  if (article.is_new_today && !isRead) {
    const badge = document.createElement("div");
    badge.className = "new-badge";
    badge.textContent = "New";
    meta.appendChild(badge);
  }

  if (meta.childElementCount > 0) {
    card.appendChild(meta);
  }

  const heading = document.createElement("h3");
  heading.textContent = title;
  card.appendChild(heading);

  const categoryNode = document.createElement("div");
  categoryNode.className = "category";
  categoryNode.textContent = category;
  card.appendChild(categoryNode);

  card.appendChild(setText(document.createElement("p"), summary));

  const keyPoints = renderKeyPoints(article.key_points);
  if (keyPoints) {
    card.appendChild(keyPoints);
  }

  const takeawayLabel = document.createElement("strong");
  takeawayLabel.textContent = "Takeaway:";
  card.appendChild(takeawayLabel);
  card.appendChild(setText(document.createElement("p"), takeaway));

  const actionsRow = document.createElement("div");
  actionsRow.className = "card-actions";

  const readAction = document.createElement("div");
  readAction.className = "card-action";

  const readButton = document.createElement("button");
  readButton.type = "button";
  readButton.className = "read-toggle";
  if (isRead) {
    readButton.classList.add("is-read");
  }
  readButton.setAttribute(
    "aria-label",
    isRead ? "Mark as unread" : "Mark as read"
  );

  const readIcon = document.createElement("span");
  readIcon.className = "read-toggle-icon";
  readIcon.textContent = "\u2713";
  readButton.appendChild(readIcon);

  const readText = document.createElement("span");
  readText.className = "read-toggle-text";
  readText.textContent = isRead ? "Read" : "Mark read";
  readAction.append(readButton, readText);

  readButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const previousState = getArticleState(article.id);
    const nextReadState = !previousState.read;
    const nextArticleId = nextReadState ? findNextVisibleArticleId(article.id) : null;
    analytics?.trackArticleMarkedRead({
      ...getArticleAnalyticsProperties(article, context),
      previous_read_state: Boolean(previousState.read),
      new_read_state: nextReadState,
    });
    updateArticleState(
      article.id,
      nextReadState
        ? {
            read: true,
            read_at:
              getArticleState(article.id).read_at || new Date().toISOString(),
          }
        : {
            read: false,
            read_at: null,
          }
    );

    if (nextReadState) {
      sessionMetrics.articlesMarkedReadCount += 1;
      card.classList.add("is-read-pending");
      readButton.classList.add("is-read");
      readText.textContent = "Read";
      showDirectionCue(readButton, "down");
      launchReadBurst(readButton);
      window.setTimeout(() => {
        card.classList.add("is-read-exit");
      }, 320);
      window.setTimeout(() => {
        renderAll();
        requestAnimationFrame(() => scrollArticleToTop(nextArticleId));
      }, readCompletionDelayMs);
      return;
    }

    readButton.classList.remove("is-read");
    readText.textContent = "Mark read";
    showDirectionCue(readButton, "up");
    window.setTimeout(() => {
      card.classList.add("is-unread-exit");
    }, 300);
    window.setTimeout(() => {
      renderAll();
    }, unreadCompletionDelayMs);
  });

  const saveAction = document.createElement("div");
  saveAction.className = "card-action card-action-save";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "save-toggle";
  if (isSaved) {
    saveButton.classList.add("is-saved");
  }
  saveButton.setAttribute(
    "aria-label",
    isSaved ? "Remove from saved" : "Save for later"
  );

  const saveIcon = createBookmarkIcon();
  saveButton.appendChild(saveIcon);

  const saveText = document.createElement("span");
  saveText.className = "save-toggle-text";
  saveText.textContent = isSaved ? "Saved" : "Save";
  saveAction.append(saveButton, saveText);

  saveButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const previousState = getArticleState(article.id);
    const nextSavedState = !previousState.saved;
    const articleAnalyticsProperties = getArticleAnalyticsProperties(article, context);
    updateArticleState(
      article.id,
      nextSavedState
        ? {
            saved: true,
            saved_at:
              getArticleState(article.id).saved_at || new Date().toISOString(),
            saved_article: snapshotArticle(article),
          }
        : {
            saved: false,
            saved_at: null,
            saved_article: null,
          }
    );
    analytics?.trackArticleSaved({
      ...articleAnalyticsProperties,
      previous_saved_state: Boolean(previousState.saved),
      new_saved_state: nextSavedState,
      saved_count_after: getSavedCount(),
    });
    if (nextSavedState) {
      sessionMetrics.articlesSavedCount += 1;
    }
    renderAll();
  });

  actionsRow.append(readAction, saveAction);

  if (currentViewMode === "read" && isRead) {
    const dismissReadAction = document.createElement("div");
    dismissReadAction.className = "card-action card-action-dismiss-read";

    const dismissReadButton = document.createElement("button");
    dismissReadButton.type = "button";
    dismissReadButton.className = "dismiss-read-toggle";
    dismissReadButton.setAttribute("aria-label", "Remove from read list");
    dismissReadButton.appendChild(createTrashIcon());

    const dismissReadText = document.createElement("span");
    dismissReadText.className = "dismiss-read-toggle-text";
    dismissReadText.textContent = "Remove";
    dismissReadAction.append(dismissReadButton, dismissReadText);

    dismissReadButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      dismissReadButton.disabled = true;
      dismissReadButton.setAttribute("aria-label", "Removed from read list");
      dismissReadText.textContent = "Removed";
      card.classList.add("is-read-dismissed");

      window.setTimeout(() => {
        updateArticleState(article.id, { read: false, read_at: null });
        renderAll();
      }, readDismissDelayMs);
    });

    actionsRow.appendChild(dismissReadAction);
  }
  card.appendChild(actionsRow);

  return card;
}

function launchReadBurst(button) {
  const colors = ["#00cec8", "#d3d3ff", "#000080"];

  for (let index = 0; index < 12; index += 1) {
    const particle = document.createElement("span");
    particle.className = "read-burst";
    particle.style.backgroundColor = colors[index % colors.length];
    particle.style.setProperty("--burst-size", `${8 + Math.random() * 6}px`);
    particle.style.setProperty("--burst-x", `${(Math.random() - 0.5) * 110}px`);
    particle.style.setProperty("--burst-y", `${-26 - Math.random() * 54}px`);
    particle.style.setProperty("--burst-rotate", `${Math.random() * 220}deg`);
    button.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove());
  }
}

function renderActiveFilters() {
  if (!activeFiltersContainer) {
    return;
  }

  const nodes = [];
  const currentViewLabel = getCurrentViewLabel();
  const selectedSourceIds = getSelectedSourceIdsSet();

  if (currentViewLabel) {
    const modePill = document.createElement("div");
    modePill.className = "active-filter-pill active-filter-pill-mode";
    modePill.textContent = currentViewLabel;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Close ${currentViewLabel.toLowerCase()} view`);
    removeButton.textContent = "\u00d7";
    removeButton.addEventListener("click", () => {
      currentViewMode = "default";
      renderAll();
    });

    modePill.appendChild(removeButton);
    nodes.push(modePill);
  }

  if (selectedSourceIds) {
    availableSources
      .filter((source) => selectedSourceIds.has(source.id))
      .forEach((source) => {
        const pill = document.createElement("div");
        pill.className = "active-filter-pill";
        pill.textContent = `Source: ${source.label}`;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.setAttribute("aria-label", `Remove ${source.label} source filter`);
        removeButton.textContent = "\u00d7";
        removeButton.addEventListener("click", () => {
          const previousFilter = `source:${source.label}`;
          const nextSelection = new Set(getSelectedSourceIdsSet() || []);
          nextSelection.delete(source.id);
          setSelectedSourceIds([...nextSelection]);
          trackFilterSelected("source:all", previousFilter);
          renderAll();
        });

        pill.appendChild(removeButton);
        nodes.push(pill);
      });
  }

  if (activeFilter !== "All") {
    const topicPill = document.createElement("div");
    topicPill.className = "active-filter-pill active-filter-pill-topic";
    topicPill.textContent = `Topic: ${activeFilter}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${activeFilter} topic filter`);
    removeButton.textContent = "\u00d7";
    removeButton.addEventListener("click", () => {
      const previousFilter = activeFilter;
      activeFilter = "All";
      trackFilterSelected("All", previousFilter);
      renderAll();
    });

    topicPill.appendChild(removeButton);
    nodes.push(topicPill);
  }

  activeFiltersContainer.replaceChildren(...nodes);
}

function renderFiltersPanel() {
  if (!filtersPanelBody || !filtersPanelToggle || !filtersPanelCount) {
    return;
  }

  const activeFilterCount = countActiveFilters();
  filtersPanelToggle.setAttribute("aria-expanded", String(isFiltersPanelOpen));
  filtersPanelCount.hidden = activeFilterCount === 0;
  filtersPanelCount.textContent = `${activeFilterCount}`;
  filtersPanelBody.hidden = !isFiltersPanelOpen;
  const toggleIcon = filtersPanelToggle.querySelector(".filters-panel-toggle-icon");
  if (toggleIcon) {
    toggleIcon.textContent = isFiltersPanelOpen ? "\u2212" : "+";
  }

  const availableLabels = new Set(
    getCurrentViewArticles().map((article) => article.why_it_matters).filter(Boolean)
  );
  const selectedSourceIds = getSelectedSourceIdsSet();

  const sourceSection = document.createElement("div");
  sourceSection.className = "filter-sheet-section";
  sourceSection.appendChild(Object.assign(document.createElement("strong"), {
    className: "filter-sheet-section-title",
    textContent: "Sources",
  }));

  const sourceGrid = document.createElement("div");
  sourceGrid.className = "filter-sheet-grid";

  const allSourcesPill = document.createElement("button");
  allSourcesPill.type = "button";
  allSourcesPill.className = "filter-choice-pill";
  allSourcesPill.classList.add(selectedSourceIds === null ? "is-selected" : "is-deselected");
  allSourcesPill.textContent = "All";
  allSourcesPill.addEventListener("click", () => {
    const previousFilter = selectedSourceIds ? "source:custom" : "source:all";
    resetSelectedSourceIds();
    trackFilterSelected("source:all", previousFilter);
    renderAll();
  });
  sourceGrid.appendChild(allSourcesPill);

  availableSources.forEach((source) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "filter-choice-pill";
    const isSelected = selectedSourceIds ? selectedSourceIds.has(source.id) : false;
    pill.classList.add(isSelected ? "is-selected" : "is-deselected");
    pill.textContent = source.label;
    pill.addEventListener("click", () => {
      const previousFilter = selectedSourceIds?.has(source.id)
        ? `source:${source.label}`
        : selectedSourceIds
          ? "source:custom"
          : "source:all";
      const nextSelection = new Set(getSelectedSourceIdsSet() || []);
      if (nextSelection.has(source.id)) {
        nextSelection.delete(source.id);
      } else {
        nextSelection.add(source.id);
      }
      setSelectedSourceIds([...nextSelection]);
      trackFilterSelected(`source:${source.label}`, previousFilter);
      renderAll();
    });
    sourceGrid.appendChild(pill);
  });

  sourceSection.appendChild(sourceGrid);

  const topicSection = document.createElement("div");
  topicSection.className = "filter-sheet-section";
  topicSection.appendChild(Object.assign(document.createElement("strong"), {
    className: "filter-sheet-section-title",
    textContent: "Topics",
  }));

  const topicGrid = document.createElement("div");
  topicGrid.className = "filter-sheet-grid";

  taxonomyLabels
    .filter((label) => label === "All" || availableLabels.has(label))
    .forEach((label) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "filter-choice-pill";
      pill.classList.add(label === activeFilter ? "is-selected" : "is-deselected");
      pill.textContent = label;
      pill.addEventListener("click", () => {
        const previousFilter = activeFilter;
        activeFilter = activeFilter === label ? "All" : label;
        trackFilterSelected(activeFilter, previousFilter);
        renderAll();
      });
      topicGrid.appendChild(pill);
    });

  topicSection.appendChild(topicGrid);

  const actions = document.createElement("div");
  actions.className = "filters-panel-actions";

  const actionsLeft = document.createElement("div");
  actionsLeft.className = "filters-panel-actions-left";
  const hasSelectedSources = Boolean(selectedSourceIds && selectedSourceIds.size > 0);
  const hasTopicFilter = activeFilter !== "All";
  const hasActiveFilters = hasSelectedSources || hasTopicFilter;

  if (hasSelectedSources) {
    const clearSourcesButton = document.createElement("button");
    clearSourcesButton.type = "button";
    clearSourcesButton.className = "filter-sheet-action";
    clearSourcesButton.textContent = "Clear sources";
    clearSourcesButton.addEventListener("click", () => {
      trackFilterSelected("source:all", "source:custom");
      resetSelectedSourceIds();
      renderAll();
    });
    actionsLeft.appendChild(clearSourcesButton);
  }

  if (hasTopicFilter) {
    const clearTopicButton = document.createElement("button");
    clearTopicButton.type = "button";
    clearTopicButton.className = "filter-sheet-action";
    clearTopicButton.textContent = "Clear topic";
    clearTopicButton.addEventListener("click", () => {
      const previousFilter = activeFilter;
      activeFilter = "All";
      trackFilterSelected("All", previousFilter);
      renderAll();
    });
    actionsLeft.appendChild(clearTopicButton);
  }

  if (hasActiveFilters) {
    const clearAllButton = document.createElement("button");
    clearAllButton.type = "button";
    clearAllButton.className = "filter-sheet-action";
    clearAllButton.textContent = "Clear all";
    clearAllButton.addEventListener("click", () => {
      const previousFilter = activeFilter !== "All" ? activeFilter : "source:custom";
      resetSelectedSourceIds();
      activeFilter = "All";
      trackFilterSelected("All", previousFilter);
      renderAll();
    });
    actionsLeft.appendChild(clearAllButton);
    actions.append(actionsLeft);
  }
  const panelNodes = [sourceSection, topicSection];
  if (hasActiveFilters) {
    panelNodes.push(actions);
  }
  filtersPanelBody.replaceChildren(...panelNodes);
}

function updateScrollTopButton() {
  if (!scrollTopButton) {
    return;
  }

  const shouldShow = window.scrollY > 520;
  scrollTopButton.hidden = !shouldShow;
  scrollTopButton.classList.toggle("is-visible", shouldShow);
}

function createEmptyFeedState() {
  const hasSourceFilter = Boolean(getSelectedSourceIdsSet()?.size);
  const hasTopicFilter = activeFilter !== "All";
  const viewLabel = getCurrentViewLabel();
  const state = document.createElement("div");
  state.className = "feed-empty-state";

  const title = document.createElement("strong");
  if (hasSourceFilter || hasTopicFilter) {
    title.textContent = viewLabel
      ? `No ${viewLabel.toLowerCase()} articles match these filters.`
      : "No articles match these filters today.";
  } else if (viewLabel === "Saved") {
    title.textContent = "No saved articles yet.";
  } else if (viewLabel === "Read") {
    title.textContent = "No read articles yet.";
  } else {
    title.textContent = "No articles are available right now.";
  }

  const description = document.createElement("p");
  if (hasSourceFilter || hasTopicFilter) {
    description.textContent = "Try removing a source or topic filter to widen the feed.";
  } else if (viewLabel === "Saved") {
    description.textContent = "Articles you save will show up here for easy revisiting.";
  } else if (viewLabel === "Read") {
    description.textContent = "Articles you mark as read will collect here for later review.";
  } else {
    description.textContent = "Please check back in a moment while the latest QA reads load in.";
  }

  state.append(title, description);
  return state;
}

function renderFeed() {
  if (!feedContainer) {
    return;
  }

  const filtered = getFilteredFeedArticles();
  if (filtered.length === 0) {
    feedContainer.replaceChildren(createEmptyFeedState());
    return;
  }

  feedContainer.replaceChildren(
    ...filtered.map((article, index) =>
      renderCard(article, {
        listPosition: index + 1,
        activeFilter,
        viewMode: currentViewMode,
      })
    )
  );
}

function renderViewControls() {
  if (!savedHeaderToggle || !savedHeaderCount || !readHeaderToggle || !readHeaderCount) {
    return;
  }

  const savedArticles = getSavedArticles(feedArticles, articleState);
  const readCount = feedArticles.filter((article) => Boolean(getArticleState(article.id).read)).length;

  savedHeaderToggle.classList.toggle("has-saved-items", savedArticles.length > 0);
  savedHeaderToggle.setAttribute("aria-expanded", String(currentViewMode === "saved"));
  savedHeaderCount.hidden = savedArticles.length === 0;
  savedHeaderCount.textContent = `${savedArticles.length}`;

  readHeaderToggle.classList.toggle("has-read-items", readCount > 0);
  readHeaderToggle.setAttribute("aria-expanded", String(currentViewMode === "read"));
  readHeaderCount.hidden = readCount === 0;
  readHeaderCount.textContent = `${readCount}`;
}

function renderAll() {
  pruneReadArticleState();
  syncSavedSnapshotsWithFeed();
  renderActiveFilters();
  renderFiltersPanel();
  renderViewControls();
  renderFeed();
}

function getFeedSignature(data) {
  const generatedAt =
    data && typeof data.generated_at === "string" ? data.generated_at : "";
  const firstArticleId =
    data &&
    Array.isArray(data.articles) &&
    data.articles[0] &&
    typeof data.articles[0].id === "string"
      ? data.articles[0].id
      : "";

  return `${generatedAt}:${firstArticleId}:${Array.isArray(data?.articles) ? data.articles.length : 0}`;
}

async function fetchFeed() {
  if (window.location.protocol === "file:" && bundledFeedData) {
    return bundledFeedData;
  }

  const cacheBuster = Date.now();
  try {
    const response = await fetch(`./feed.json?v=${feedCacheKey}&t=${cacheBuster}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Feed request failed with status ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (bundledFeedData) {
      console.warn("Falling back to bundled feed data:", error);
      return bundledFeedData;
    }
    throw error;
  }
}

function shouldRefreshFeed(forceRefresh) {
  if (forceRefresh) {
    return true;
  }

  if (!lastFeedRefreshAt) {
    return true;
  }

  return Date.now() - lastFeedRefreshAt >= feedRefreshThrottleMs;
}

async function loadFeed({ forceRefresh = false, reason = "initial" } = {}) {
  if (!shouldRefreshFeed(forceRefresh)) {
    return null;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = fetchFeed()
    .then((data) => {
      if (!data || !Array.isArray(data.articles) || data.articles.length === 0) {
        return null;
      }

      lastFeedRefreshAt = Date.now();
      const nextSignature = getFeedSignature(data);
      const hasFeedChanged = nextSignature !== currentFeedSignature;

      feedArticles = data.articles.map((article) => ({
        ...article,
        source_id: article.source_id || article.source,
      }));
      availableSources = getAvailableSources(feedArticles, data.available_sources);
      visibleFeedSize = Number.isFinite(data.default_feed_size)
        ? data.default_feed_size
        : defaultVisibleFeedSize;
      currentFeedSignature = nextSignature;
      currentFeedGeneratedAt = data.generated_at || "";

      if (!hasInitializedUi || hasFeedChanged) {
        renderAll();
      }

      analytics?.trackFeedLoaded({
        article_count: feedArticles.length,
        source_count: getSourceCount(feedArticles),
        new_today_count: getNewTodayCount(feedArticles),
        feed_generated_at: currentFeedGeneratedAt,
        load_reason: reason,
        feed_changed: hasFeedChanged,
      });

      hasInitializedUi = true;
      return data;
    })
    .catch((error) => {
      console.error("Feed load error:", error);
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

function requestFeedRefresh(reason = "manual") {
  loadFeed({ forceRefresh: true, reason }).catch(() => {});
}

function initializeUi() {
  pruneReadArticleState();
  analytics?.init({ nextSiteVersion: feedCacheKey });
  analytics?.trackSessionStart({
    saved_count: getSavedCount(),
    read_count: getReadCount(),
  });
  analytics?.trackPageView({
    has_saved_articles: getSavedCount() > 0,
    saved_count: getSavedCount(),
    active_filter: activeFilter,
    view_mode: currentViewMode,
  });

  if (savedHeaderToggle) {
    savedHeaderToggle.addEventListener("click", () => {
      const nextViewMode = currentViewMode === "saved" ? "default" : "saved";
      analytics?.trackSavedPanelToggled({
        new_state: nextViewMode === "saved" ? "expanded" : "collapsed",
        saved_count: getSavedCount(),
      });
      currentViewMode = currentViewMode === "saved" ? "default" : "saved";
      renderAll();
    });
  }

  if (readHeaderToggle) {
    readHeaderToggle.addEventListener("click", () => {
      currentViewMode = currentViewMode === "read" ? "default" : "read";
      renderAll();
    });
  }

  if (filtersPanelToggle) {
    filtersPanelToggle.addEventListener("click", () => {
      isFiltersPanelOpen = !isFiltersPanelOpen;
      renderFiltersPanel();
    });
  }

  if (scrollTopButton) {
    scrollTopButton.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener("scroll", () => {
      updateScrollTopButton();
      trackScrollDepthIfNeeded();
    }, { passive: true });
    updateScrollTopButton();
    trackScrollDepthIfNeeded();
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      requestFeedRefresh("refresh_pageshow");
      return;
    }

    if (document.visibilityState === "visible") {
      requestFeedRefresh("refresh_pageshow");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestFeedRefresh("refresh_visibility");
    }
  });

  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible") {
      requestFeedRefresh("refresh_focus");
    }
  });

  window.addEventListener("pagehide", () => {
    trackSessionEnd();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isFiltersPanelOpen) {
      isFiltersPanelOpen = false;
      renderFiltersPanel();
    }
  });
}

initializeUi();
loadFeed({ reason: "initial" }).catch(() => {});
