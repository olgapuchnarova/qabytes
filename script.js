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

const feedContainer = document.getElementById("feed");
const activeFiltersContainer = document.getElementById("active-filters");
const savedSection = document.getElementById("saved-section");
const savedViewLabel = document.getElementById("saved-view-label");
const savedHeaderToggle = document.getElementById("saved-header-toggle");
const savedHeaderCount = document.getElementById("saved-header-count");
const filterHeaderToggle = document.getElementById("filter-header-toggle");
const filterHeaderCount = document.getElementById("filter-header-count");
const filterSheetBackdrop = document.getElementById("filter-sheet-backdrop");
const filterSheet = document.getElementById("filter-sheet");
const filterSheetBody = document.getElementById("filter-sheet-body");
const filterSheetFooter = document.getElementById("filter-sheet-footer");
const filterSheetClose = document.getElementById("filter-sheet-close");
const savedFeedContainer = document.getElementById("saved-feed");
const scrollTopButton = document.getElementById("scroll-top-button");
const readCompletionDelayMs = 1180;
const unreadCompletionDelayMs = 1020;
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
let isSavedSectionExpanded = false;
let isFilterSheetOpen = false;
let hasInitializedUi = false;
let currentFeedSignature = "";
let lastFeedRefreshAt = 0;
let refreshInFlight = null;

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

function updateArticleState(articleId, changes) {
  articleState[articleId] = {
    ...getArticleState(articleId),
    ...changes,
  };
  saveArticleState();
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

function getFilteredFeedArticles() {
  const selectedSourceIds = getSelectedSourceIdsSet();
  const sourceFilteredArticles = selectedSourceIds
    ? filterArticlesBySources(feedArticles, selectedSourceIds)
    : feedArticles;

  return sortLatestInsights(
    filterArticles(sourceFilteredArticles, activeFilter),
    getArticleState
  );
}

function getVisibleFeedArticles() {
  const filteredArticles = getFilteredFeedArticles();
  const selectedSourceIds = getSelectedSourceIdsSet();
  const isDefaultView =
    activeFilter === "All" && selectedSourceIds === null;

  if (!isDefaultView) {
    return filteredArticles.slice(0, visibleFeedSize);
  }

  return selectArticlesWithSourceCap(filteredArticles, visibleFeedSize, 2);
}

function countActiveFilters() {
  const selectedSourceIds = getSelectedSourceIdsSet();
  return (selectedSourceIds ? selectedSourceIds.size : 0) + (activeFilter === "All" ? 0 : 1);
}

function renderCard(article) {
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
  if (isRead) {
    card.classList.add("is-read");
  }

  if (safeUrl) {
    card.href = safeUrl;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.addEventListener("click", () => {
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

    const nextReadState = !getArticleState(article.id).read;
    updateArticleState(article.id, { read: nextReadState });

    if (nextReadState) {
      card.classList.add("is-read-pending");
      readButton.classList.add("is-read");
      readText.textContent = "Read";
      showDirectionCue(readButton, "down");
      launchReadBurst(readButton);
      window.setTimeout(() => {
        card.classList.add("is-read-exit");
      }, 320);
      window.setTimeout(() => {
        renderSavedSection();
        renderFeed();
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
      renderSavedSection();
      renderFeed();
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

    const nextSavedState = !getArticleState(article.id).saved;
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
    renderSavedSection();
    renderFeed();
  });

  actionsRow.append(readAction, saveAction);
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

  const selectedSourceIds = getSelectedSourceIdsSet();
  const nodes = [];

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
          const nextSelection = new Set(getSelectedSourceIdsSet() || []);
          nextSelection.delete(source.id);
          setSelectedSourceIds([...nextSelection]);
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
      activeFilter = "All";
      renderAll();
    });

    topicPill.appendChild(removeButton);
    nodes.push(topicPill);
  }

  activeFiltersContainer.replaceChildren(...nodes);
}

function renderFilterSheet() {
  if (!filterSheetBody || !filterSheetFooter || !filterHeaderToggle || !filterHeaderCount) {
    return;
  }

  const activeFilterCount = countActiveFilters();
  filterHeaderToggle.setAttribute("aria-expanded", String(isFilterSheetOpen));
  filterHeaderCount.hidden = activeFilterCount === 0;
  filterHeaderCount.textContent = `${activeFilterCount}`;

  if (filterSheetBackdrop) {
    filterSheetBackdrop.hidden = !isFilterSheetOpen;
  }
  if (filterSheet) {
    filterSheet.hidden = !isFilterSheetOpen;
  }

  const availableLabels = new Set(
    feedArticles.map((article) => article.why_it_matters).filter(Boolean)
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
    resetSelectedSourceIds();
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
      const nextSelection = new Set(getSelectedSourceIdsSet() || []);
      if (nextSelection.has(source.id)) {
        nextSelection.delete(source.id);
      } else {
        nextSelection.add(source.id);
      }
      setSelectedSourceIds([...nextSelection]);
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
        activeFilter = label;
        renderAll();
      });
      topicGrid.appendChild(pill);
    });

  topicSection.appendChild(topicGrid);

  const actions = document.createElement("div");
  actions.className = "filter-sheet-actions";

  const actionsLeft = document.createElement("div");
  actionsLeft.className = "filter-sheet-actions-left";
  const hasSelectedSources = Boolean(selectedSourceIds && selectedSourceIds.size > 0);
  const hasTopicFilter = activeFilter !== "All";
  const hasActiveFilters = hasSelectedSources || hasTopicFilter;

  if (hasSelectedSources) {
    const clearSourcesButton = document.createElement("button");
    clearSourcesButton.type = "button";
    clearSourcesButton.className = "filter-sheet-action";
    clearSourcesButton.textContent = "Clear sources";
    clearSourcesButton.addEventListener("click", () => {
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
      activeFilter = "All";
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
      resetSelectedSourceIds();
      activeFilter = "All";
      renderAll();
    });
    actionsLeft.appendChild(clearAllButton);
  }

  if (hasActiveFilters) {
    actions.append(actionsLeft);
  }

  const doneButton = document.createElement("button");
  doneButton.type = "button";
  doneButton.className = "filter-sheet-action filter-sheet-done";
  doneButton.textContent = "Done";
  doneButton.addEventListener("click", () => {
    setFilterSheetOpen(false);
  });
  actions.append(doneButton);

  filterSheetBody.replaceChildren(sourceSection, topicSection);
  filterSheetFooter.replaceChildren(actions);
}

function setFilterSheetOpen(nextState) {
  isFilterSheetOpen = nextState;
  if (document.body) {
    document.body.style.overflow = isFilterSheetOpen ? "hidden" : "";
  }
  renderFilterSheet();
}

function updateScrollTopButton() {
  if (!scrollTopButton) {
    return;
  }

  const shouldShow = window.scrollY > 520;
  scrollTopButton.hidden = !shouldShow;
  scrollTopButton.classList.toggle("is-visible", shouldShow);
}

function createReadDivider(hasUnreadAbove) {
  const divider = document.createElement("div");
  divider.className = "feed-divider";

  const lineLeft = document.createElement("span");
  lineLeft.className = "feed-divider-line";

  const body = document.createElement("div");
  body.className = "feed-divider-body";

  const label = document.createElement("strong");
  label.textContent = hasUnreadAbove
    ? "You're all caught up"
    : "Everything below has been read";

  const sublabel = document.createElement("span");
  sublabel.textContent = hasUnreadAbove
    ? "Read articles continue below"
    : "Your completed articles continue below";

  body.append(label, sublabel);

  const lineRight = document.createElement("span");
  lineRight.className = "feed-divider-line";

  divider.append(lineLeft, body, lineRight);
  return divider;
}

function createEmptyFeedState() {
  const hasSourceFilter = Boolean(getSelectedSourceIdsSet()?.size);
  const hasTopicFilter = activeFilter !== "All";
  const state = document.createElement("div");
  state.className = "feed-empty-state";

  const title = document.createElement("strong");
  title.textContent =
    hasSourceFilter || hasTopicFilter
      ? "No articles match these filters today."
      : "No articles are available right now.";

  const description = document.createElement("p");
  description.textContent =
    hasSourceFilter || hasTopicFilter
      ? "Try removing a source or topic filter to widen the feed."
      : "Please check back in a moment while the latest QA reads load in.";

  state.append(title, description);
  return state;
}

function renderFeed() {
  if (!feedContainer) {
    return;
  }

  const hasSavedFeedOpen =
    isSavedSectionExpanded && getSavedArticles(feedArticles, articleState).length > 0;
  feedContainer.hidden = hasSavedFeedOpen;
  if (hasSavedFeedOpen) {
    return;
  }

  const filtered = getVisibleFeedArticles();
  if (filtered.length === 0) {
    feedContainer.replaceChildren(createEmptyFeedState());
    return;
  }

  const firstReadIndex = filtered.findIndex((article) =>
    Boolean(getArticleState(article.id).read)
  );
  const nodes = [];

  filtered.forEach((article, index) => {
    if (index === firstReadIndex) {
      nodes.push(createReadDivider(firstReadIndex > 0));
    }
    nodes.push(renderCard(article));
  });

  feedContainer.replaceChildren(...nodes);
}

function renderSavedSection() {
  if (!savedSection || !savedFeedContainer || !savedHeaderToggle || !savedHeaderCount) {
    return;
  }

  const savedArticles = getSavedArticles(feedArticles, articleState);

  if (savedArticles.length === 0) {
    savedSection.hidden = true;
    isSavedSectionExpanded = false;
    if (savedViewLabel) {
      savedViewLabel.hidden = true;
      savedViewLabel.replaceChildren();
    }
    savedFeedContainer.hidden = true;
    savedFeedContainer.replaceChildren();
    savedHeaderToggle.setAttribute("aria-expanded", "false");
    savedHeaderToggle.classList.remove("has-saved-items");
    savedHeaderCount.hidden = true;
    savedHeaderCount.textContent = "0";
    return;
  }

  savedSection.hidden = !isSavedSectionExpanded;
  savedHeaderToggle.classList.add("has-saved-items");
  savedHeaderToggle.setAttribute("aria-expanded", String(isSavedSectionExpanded));
  savedHeaderCount.hidden = false;
  savedHeaderCount.textContent = `${savedArticles.length}`;
  if (savedViewLabel) {
    savedViewLabel.hidden = !isSavedSectionExpanded;
    if (isSavedSectionExpanded) {
      const pill = document.createElement("div");
      pill.className = "active-filter-pill saved-view-pill";
      pill.textContent = "Saved";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.setAttribute("aria-label", "Close saved articles view");
      removeButton.textContent = "\u00d7";
      removeButton.addEventListener("click", () => {
        isSavedSectionExpanded = false;
        renderSavedSection();
        renderFeed();
      });

      pill.appendChild(removeButton);
      savedViewLabel.replaceChildren(pill);
    } else {
      savedViewLabel.replaceChildren();
    }
  }
  savedFeedContainer.hidden = !isSavedSectionExpanded;
  savedFeedContainer.replaceChildren(
    ...savedArticles.map((article) => renderCard(article))
  );
}

function renderAll() {
  syncSavedSnapshotsWithFeed();
  renderActiveFilters();
  renderFilterSheet();
  renderSavedSection();
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
  const cacheBuster = Date.now();
  const response = await fetch(`./feed.json?v=${feedCacheKey}&t=${cacheBuster}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Feed request failed with status ${response.status}`);
  }

  return response.json();
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

async function loadFeed({ forceRefresh = false } = {}) {
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

      if (!hasInitializedUi || hasFeedChanged) {
        renderAll();
      }

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

function requestFeedRefresh() {
  loadFeed({ forceRefresh: true }).catch(() => {});
}

function initializeUi() {
  if (savedHeaderToggle) {
    savedHeaderToggle.addEventListener("click", () => {
      if (getSavedArticles(feedArticles, articleState).length === 0) {
        return;
      }
      isSavedSectionExpanded = !isSavedSectionExpanded;
      renderSavedSection();
      renderFeed();
    });
  }

  if (filterHeaderToggle) {
    filterHeaderToggle.addEventListener("click", () => {
      setFilterSheetOpen(!isFilterSheetOpen);
    });
  }

  if (filterSheetClose) {
    filterSheetClose.addEventListener("click", () => {
      setFilterSheetOpen(false);
    });
  }

  if (filterSheetBackdrop) {
    filterSheetBackdrop.addEventListener("click", () => {
      setFilterSheetOpen(false);
    });
  }

  if (scrollTopButton) {
    scrollTopButton.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener("scroll", updateScrollTopButton, { passive: true });
    updateScrollTopButton();
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      requestFeedRefresh();
      return;
    }

    if (document.visibilityState === "visible") {
      requestFeedRefresh();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestFeedRefresh();
    }
  });

  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible") {
      requestFeedRefresh();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isFilterSheetOpen) {
      setFilterSheetOpen(false);
    }
  });
}

initializeUi();
loadFeed().catch(() => {});
