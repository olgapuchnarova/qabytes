const feedCacheKey = "20260330-3";
const {
  filterArticles,
  sortLatestInsights,
  getSavedArticles,
} = globalThis.QABytesFeedLogic;

fetch(`./feed.json?v=${feedCacheKey}`)
  .then((response) => response.json())
  .then((data) => {
    if (!data || !Array.isArray(data.articles) || data.articles.length === 0) {
      return;
    }

    const feedArticles = data.articles;
    const feedContainer = document.getElementById("feed");
    const filtersContainer = document.getElementById("filters");
    const savedSection = document.getElementById("saved-section");
    const savedHeaderToggle = document.getElementById("saved-header-toggle");
    const savedHeaderCount = document.getElementById("saved-header-count");
    const savedFeedContainer = document.getElementById("saved-feed");
    const storageKey = "qabytes_article_state";
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
    let activeFilter = "All";
    let isSavedSectionExpanded = false;

    function loadArticleState() {
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (error) {
        console.warn("Failed to read article state:", error);
        return {};
      }
    }

    let articleState = loadArticleState();

    function saveArticleState() {
      localStorage.setItem(storageKey, JSON.stringify(articleState));
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
        updateArticleState(article.id, { saved: nextSavedState });
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
            renderFeed();
          });
          return button;
        });

      filtersContainer.replaceChildren(...chips);
    }

    function renderFeed() {
      const filtered = sortLatestInsights(
        filterArticles(feedArticles, activeFilter),
        getArticleState
      );
      feedContainer.replaceChildren(
        ...filtered.map((article) => renderCard(article))
      );
    }

    function renderSavedSection() {
      if (!savedSection || !savedFeedContainer || !savedHeaderToggle || !savedHeaderCount) {
        return;
      }

      const savedArticles = getSavedArticles(feedArticles, getArticleState);

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

    if (savedHeaderToggle) {
      savedHeaderToggle.addEventListener("click", () => {
        if (!feedArticles.some((article) => getArticleState(article.id).saved)) {
          return;
        }
        isSavedSectionExpanded = !isSavedSectionExpanded;
        renderSavedSection();
      });
    }

    renderSavedSection();
    renderFilters();
    renderFeed();
  })
  .catch((error) => {
    console.error("Feed load error:", error);
  });
