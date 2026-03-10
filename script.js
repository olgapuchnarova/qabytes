fetch('feed.json')
.then(response => response.json())
.then(data => {

```
if (!data || data.length === 0) return;

const featured = data[0];
const rest = data.slice(1);

// FEATURED ARTICLE
document.getElementById("featured").innerHTML = `
  <div class="card">
    <div class="signal">Signal ${featured.signal}/5</div>
    <h2>${featured.title}</h2>
    <div class="category">${featured.source}</div>
    <p>${featured.summary}</p>

    <strong>Key points:</strong>
    <ul>
      ${featured.key_points.map(p => `<li>${p}</li>`).join("")}
    </ul>

    <strong>Takeaway:</strong>
    <p>${featured.takeaway}</p>

    <a href="${featured.url}" target="_blank">Read original →</a>
  </div>
`;

// REST OF THE FEED
rest.forEach(article => {
  document.getElementById("feed").innerHTML += `
    <div class="card">
      <div class="signal">Signal ${article.signal}/5</div>
      <h3>${article.title}</h3>
      <div class="category">${article.source}</div>
      <p>${article.summary}</p>
      <a href="${article.url}" target="_blank">Read →</a>
    </div>
  `;
});
```

})
.catch(error => {
console.error("Feed load error:", error);
});
