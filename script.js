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
const filtersContainer = document.getElementById("filters");
const sourceControlsContainer = document.getElementById("source-controls");
const feedStatusContainer = document.getElementById("feed-status");
const savedSection = document.getElementById("saved-section");
const savedHeaderToggle = document.getElementById("saved-header-toggle");
const savedHeaderCount = document.getElementById("saved-header-count");
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
let isSourcePanelExpanded = false;
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
  sourcePreferences = {
    selectedSourceIds: [...new Set(nextSourceIds)],
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

  saveButton.appendChild(createBookmarkIcon());

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

function renderSourceControls() {
  if (!sourceControlsContainer) {
    return;
  }

  if (availableSources.length === 0) {
    sourceControlsContainer.replaceChildren();
    return;
  }

  const selectedSourceIds = getSelectedSourceIdsSet();
  const panel = document.createElement("div");
  panel.className = "source-panel";

  const header = document.createElement("div");
  header.className = "source-panel-header";

  const title = document.createElement("div");
  title.className = "source-panel-title";
  const titleStrong = document.createElement("strong");
  titleStrong.textContent = "Sources";
  const titleText = document.createElement("span");
  titleText.textContent = selectedSourceIds
    ? `${selectedSourceIds.size} source${selectedSourceIds.size === 1 ? "" : "s"} selected`
    : "No source filter applied";
  title.append(titleStrong, titleText);

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "source-panel-toggle";
  toggleButton.textContent = isSourcePanelExpanded ? "Hide sources" : "Choose sources";
  toggleButton.setAttribute("aria-expanded", String(isSourcePanelExpanded));
  toggleButton.addEventListener("click", () => {
    isSourcePanelExpanded = !isSourcePanelExpanded;
    renderSourceControls();
  });

  header.append(title, toggleButton);
  panel.appendChild(header);

  if (isSourcePanelExpanded) {
    const actions = document.createElement("div");
    actions.className = "source-panel-actions";

    const selectAllButton = document.createElement("button");
    selectAllButton.type = "button";
    selectAllButton.className = "source-utility-button";
    selectAllButton.textContent = "Show all";
    selectAllButton.addEventListener("click", () => {
      resetSelectedSourceIds();
      renderAll();
    });

    const qaFocusedButton = document.createElement("button");
    qaFocusedButton.type = "button";
    qaFocusedButton.className = "source-utility-button";
    qaFocusedButton.textContent = "QA-focused";
    qaFocusedButton.addEventListener("click", () => {
      const qaFocusedIds = availableSources
        .filter((source) => !["devto", "hn"].includes(source.id))
        .map((source) => source.id);
      setSelectedSourceIds(qaFocusedIds.length > 0 ? qaFocusedIds : getAllSourceIds());
      renderAll();
    });

    const hideDevButton = document.createElement("button");
    hideDevButton.type = "button";
    hideDevButton.className = "source-utility-button";
    hideDevButton.textContent = "Hide DEV";
    hideDevButton.addEventListener("click", () => {
      const withoutDev = getAllSourceIds().filter((sourceId) => sourceId !== "devto");
      setSelectedSourceIds(withoutDev.length > 0 ? withoutDev : getAllSourceIds());
      renderAll();
    });

    actions.append(selectAllButton, qaFocusedButton, hideDevButton);
    panel.appendChild(actions);

    const grid = document.createElement("div");
    grid.className = "source-pill-grid";

    availableSources.forEach((source) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "source-pill";
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
      grid.appendChild(pill);
    });

    panel.appendChild(grid);
  }

  sourceControlsContainer.replaceChildren(panel);
}

function renderFilters() {
  if (!filtersContainer) {
    return;
  }

  const availableLabels = new Set(
    feedArticles.map((article) => article.why_it_matters).filter(Boolean)
  );

  const chips = taxonomyLabels
    .filter((label) => label === "All" || availableLabels.has(label))
    .map((label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-chip";
      if (label === activeFilter) {
        button.classList.add("is-active");
      }
      button.textContent = label;
      button.addEventListener("click", () => {
        activeFilter = label;
        renderFilters();
        renderFeedStatus();
        renderFeed();
      });
      return button;
    });

  filtersContainer.replaceChildren(...chips);
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

function renderFeedStatus() {
  if (!feedStatusContainer) {
    return;
  }

  const filteredArticles = getFilteredFeedArticles();
  const visibleArticles = getVisibleFeedArticles();
  const selectedSourceIds = getSelectedSourceIdsSet();
  const isSourceFilterActive = selectedSourceIds !== null;

  if (visibleArticles.length >= visibleFeedSize || filteredArticles.length === feedArticles.length) {
    feedStatusContainer.hidden = true;
    feedStatusContainer.replaceChildren();
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "feed-status";

  const strong = document.createElement("strong");
  strong.textContent = filteredArticles.length === 0 ? "No articles match right now" : "Filtered view";

  const text = document.createElement("span");
  if (filteredArticles.length === 0) {
    text.textContent = !isSourceFilterActive && activeFilter === "All"
      ? "There are no articles available in today's pool yet."
      : "Try turning on more sources or resetting your filters.";
  } else if (!isSourceFilterActive && activeFilter === "All") {
    text.textContent = `Only ${visibleArticles.length} articles are available in today's default view right now.`;
  } else {
    text.textContent = `Only ${filteredArticles.length} articles match your selected sources${activeFilter !== "All" ? ` and ${activeFilter.toLowerCase()} filter` : ""}.`;
  }

  wrapper.append(strong, text);

  if (isSourceFilterActive) {
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Show all sources";
    resetButton.addEventListener("click", () => {
      resetSelectedSourceIds();
      renderAll();
    });
    wrapper.appendChild(resetButton);
  }

  if (activeFilter !== "All") {
    const clearFilterButton = document.createElement("button");
    clearFilterButton.type = "button";
    clearFilterButton.textContent = "Clear topic filter";
    clearFilterButton.addEventListener("click", () => {
      activeFilter = "All";
      renderAll();
    });
    wrapper.appendChild(clearFilterButton);
  }

  feedStatusContainer.hidden = false;
  feedStatusContainer.replaceChildren(wrapper);
}

function renderFeed() {
  if (!feedContainer) {
    return;
  }

  const filtered = getVisibleFeedArticles();
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
  savedFeedContainer.hidden = !isSavedSectionExpanded;
  savedFeedContainer.replaceChildren(
    ...savedArticles.map((article) => renderCard(article))
  );
}

function renderAll() {
  syncSavedSnapshotsWithFeed();
  renderSourceControls();
  renderSavedSection();
  renderFilters();
  renderFeedStatus();
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
}

initializeUi();
loadFeed().catch(() => {});
