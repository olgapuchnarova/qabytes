fetch('feed.json')
.then(response => response.json())
.then(data => {

if (!data || data.length === 0) return;

const featured = data[0];
const rest = data.slice(1);

const featuredContainer = document.getElementById("featured");
const feedContainer = document.getElementById("feed");

function renderKeyPoints(points) {
  if (!points || !Array.isArray(points)) return "";

  let html = "<strong>Key points:</strong><ul>";

  points.forEach(point => {
    html += "<li>" + point + "</li>";
  });

  html += "</ul>";

  return html;
}

function renderCard(article, isFeatured = false) {

  const titleTag = isFeatured ? "h2" : "h3";

  return `
    <div class="card">
      <div class="signal">Signal ${article.signal_score || article.signal || "-"}/5</div>
      <${titleTag}>${article.title || ""}</${titleTag}>
      <div class="category">${article.category || article.source || ""}</div>

      <p>${article.summary || ""}</p>

      ${renderKeyPoints(article.key_points)}

      <strong>Takeaway:</strong>
      <p>${article.takeaway || article.actionable_takeaway || ""}</p>

      <a href="${article.link || article.url}" target="_blank">Read original →</a>
    </div>
  `;
}

// Render featured
featuredContainer.innerHTML = renderCard(featured, true);

// Render rest
rest.forEach(article => {
  feedContainer.innerHTML += renderCard(article, false);
});


})
.catch(error => {
console.error("Feed load error:", error);
});
