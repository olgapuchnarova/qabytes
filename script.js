fetch("./feed.json")
  .then((response) => response.json())
  .then((data) => {
    if (!data || !Array.isArray(data.articles) || data.articles.length === 0) {
      return;
    }

    const articles = data.articles;
    const featured = articles[0];
    const rest = articles.slice(1);

    const featuredContainer = document.getElementById("featured");
    const feedContainer = document.getElementById("feed");

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

    function renderCard(article, isFeatured = false) {
      const titleTag = isFeatured ? "h2" : "h3";
      const title = article.title || "";
      const category = article.category || article.source || "";
      const summary = article.summary || "";
      const takeaway = article.takeaway || article.actionable_takeaway || "";
      const whyItMatters = article.why_it_matters || "";
      const link = article.link || article.url;
      const safeUrl = safeExternalUrl(link);

      const card = document.createElement(safeUrl ? "a" : "article");
      card.className = "card";

      if (safeUrl) {
        card.href = safeUrl;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
      }

      const meta = document.createElement("div");
      meta.className = "card-meta";

      if (whyItMatters) {
        const reason = document.createElement("div");
        reason.className = "why-it-matters";
        reason.textContent = `Why it matters: ${whyItMatters}`;
        meta.appendChild(reason);
      }

      if (article.is_new_today) {
        const badge = document.createElement("div");
        badge.className = "new-badge";
        badge.textContent = "New";
        meta.appendChild(badge);
      }

      if (meta.childElementCount > 0) {
        card.appendChild(meta);
      }

      const heading = document.createElement(titleTag);
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

      return card;
    }

    featuredContainer.replaceChildren(renderCard(featured, true));
    feedContainer.replaceChildren(
      ...rest.map((article) => renderCard(article, false))
    );
  })
  .catch((error) => {
    console.error("Feed load error:", error);
  });
