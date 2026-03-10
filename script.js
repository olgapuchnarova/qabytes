async function loadFeed() {
try {
const response = await fetch("feed.json");
const data = await response.json();

if (!data || data.length === 0) {
  console.log("Feed empty");
  return;
}

const featured = data[0];
const rest = data.slice(1);

const featuredContainer = document.getElementById("featured");
const feedContainer = document.getElementById("feed");

// Build key points safely
let keyPointsHTML = "";

if (featured.key_points && Array.isArray(featured.key_points)) {
  keyPointsHTML += "<strong>Key points:</strong><ul>";

  featured.key_points.forEach(function(point) {
    keyPointsHTML += "<li>" + point + "</li>";
  });

  keyPointsHTML += "</ul>";
}

// Featured article
featuredContainer.innerHTML =
  "<div class='card'>" +
    "<div class='signal'>Signal " + (featured.signal || "-") + "/5</div>" +
    "<h2>" + (featured.title || "") + "</h2>" +
    "<div class='category'>" + (featured.source || "") + "</div>" +
    "<p>" + (featured.summary || "") + "</p>" +
    keyPointsHTML +
    "<strong>Takeaway:</strong>" +
    "<p>" + (featured.takeaway || "") + "</p>" +
    "<a href='" + featured.url + "' target='_blank'>Read original →</a>" +
  "</div>";

// Remaining articles
rest.forEach(function(article) {

let keyPointsHTML = "";

if (article.key_points && Array.isArray(article.key_points)) {
keyPointsHTML += "Key points:";

article.key_points.forEach(function(point) {
  keyPointsHTML += "<li>" + point + "</li>";
});

keyPointsHTML += "</ul>";

}

const articleHTML =
"" +
"Signal " + (article.signal || "-") + "/5" +
"" + (article.title || "") + "" +
"" + (article.source || "") + "" +
"" + (article.summary || "") + "" +
keyPointsHTML +
"Takeaway:" +
"" + (article.takeaway || "") + "" +
"Read original →" +
"";

feedContainer.innerHTML += articleHTML;

});

} catch (error) {
console.error("Feed load error:", error);
}
}

loadFeed();
