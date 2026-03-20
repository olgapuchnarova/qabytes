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
      const score = article.signal_score || article.signal || "-";
      const link = article.link || article.url;

      const card = document.createElement("div");
      card.className = "card";

      const signal = document.createElement("div");
      signal.className = "signal";
      signal.textContent = `Signal ${score}/5`;
      card.appendChild(signal);

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

      const safeUrl = safeExternalUrl(link);
      if (safeUrl) {
        const anchor = document.createElement("a");
        anchor.href = safeUrl;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = "Read original ->";
        card.appendChild(anchor);
      }

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
