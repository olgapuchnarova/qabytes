fetch('data/feed.json')
  .then(response => response.json())
  .then(data => {

    if (data.length === 0) return;

    const featured = data[0];
    const rest = data.slice(1);

    document.getElementById("featured").innerHTML = `
      <div class="card">
        <div class="signal">Signal ${featured.signal_score}/5</div>
        <h2>${featured.title}</h2>
        <div class="category">${featured.category}</div>
        <p>${featured.summary}</p>
        <strong>Why this matters:</strong>
        <p>${featured.why_this_matters}</p>
        <strong>Takeaway:</strong>
        <p>${featured.actionable_takeaway}</p>
        <a href="${featured.link}" target="_blank">Read original →</a>
      </div>
    `;

    rest.forEach(article => {
      document.getElementById("feed").innerHTML += `
        <div class="card">
          <div class="signal">Signal ${article.signal_score}/5</div>
          <h3>${article.title}</h3>
          <div class="category">${article.category}</div>
          <p>${article.summary}</p>
          <a href="${article.link}" target="_blank">Read →</a>
        </div>
      `;
    });

  });
