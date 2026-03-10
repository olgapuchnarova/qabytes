fetch("feed.json")
.then(function (response) {
return response.json();
})
.then(function (data) {

```
if (!data || data.length === 0) {
  console.log("Feed empty");
  return;
}

var featured = data[0];
var rest = data.slice(1);

var keyPointsHTML = "";

if (featured.key_points && Array.isArray(featured.key_points)) {
  for (var i = 0; i < featured.key_points.length; i++) {
    keyPointsHTML += "<li>" + featured.key_points[i] + "</li>";
  }
  keyPointsHTML = "<strong>Key points:</strong><ul>" + keyPointsHTML + "</ul>";
}

var featuredHTML =
  "<div class=\"card\">" +
    "<div class=\"signal\">Signal " + (featured.signal || "-") + "/5</div>" +
    "<h2>" + (featured.title || "") + "</h2>" +
    "<div class=\"category\">" + (featured.source || "") + "</div>" +
    "<p>" + (featured.summary || "") + "</p>" +
    keyPointsHTML +
    "<strong>Takeaway:</strong>" +
    "<p>" + (featured.takeaway || "") + "</p>" +
    "<a href=\"" + featured.url + "\" target=\"_blank\">Read original →</a>" +
  "</div>";

document.getElementById("featured").innerHTML = featuredHTML;

var feedContainer = document.getElementById("feed");

for (var j = 0; j < rest.length; j++) {

  var article = rest[j];

  var articleHTML =
    "<div class=\"card\">" +
      "<div class=\"signal\">Signal " + (article.signal || "-") + "/5</div>" +
      "<h3>" + (article.title || "") + "</h3>" +
      "<div class=\"category\">" + (article.source || "") + "</div>" +
      "<p>" + (article.summary || "") + "</p>" +
      "<a href=\"" + article.url + "\" target=\"_blank\">Read →</a>" +
    "</div>";

  feedContainer.innerHTML += articleHTML;
}
```

})
.catch(function (error) {
console.error("Feed load error:", error);
});
