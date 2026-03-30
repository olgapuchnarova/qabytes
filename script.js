fetch("./feed.json")
  .then((response) => response.json())
  .then((data) => {
    if (!data || !Array.isArray(data.articles) || data.articles.length === 0) {
      return;
    }

    const feedArticles = data.articles;
    const feedContainer = document.getElementById("feed");
    const filtersContainer = document.getElementById("filters");
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

      const readRow = document.createElement("div");
      readRow.className = "card-actions";

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
      readRow.append(readButton, readText);

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
            renderFilters();
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
          renderFilters();
          renderFeed();
        }, unreadCompletionDelayMs);
      });

      card.appendChild(readRow);

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

    function sortLatestInsights(items) {
      return [...items].sort((left, right) => {
        const leftRead = getArticleState(left.id).read;
        const rightRead = getArticleState(right.id).read;

        if (leftRead !== rightRead) {
          return leftRead ? 1 : -1;
        }

        if (left.is_new_today !== right.is_new_today) {
          return left.is_new_today ? -1 : 1;
        }

        return (right.signal || 0) - (left.signal || 0);
      });
    }

    function filterArticles(items) {
      if (activeFilter === "All") {
        return items;
      }

      return items.filter(
        (article) => article.why_it_matters === activeFilter
      );
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
      const filtered = sortLatestInsights(filterArticles(feedArticles));
      feedContainer.replaceChildren(
        ...filtered.map((article) => renderCard(article))
      );
    }

    renderFilters();
    renderFeed();
  })
  .catch((error) => {
    console.error("Feed load error:", error);
  });
