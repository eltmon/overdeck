(function () {
  "use strict";

  var MAX_RESULTS = 50;
  var status = document.getElementById("okf-status");
  var results = document.getElementById("okf-results");
  var params = new URLSearchParams(window.location.search);
  var query = (params.get("q") || "").trim();
  var input = document.querySelector('header.site input[name="q"]');
  if (input) {
    input.value = query;
  }
  if (!status || !results) {
    return;
  }
  if (!query) {
    status.textContent = "Type a search term.";
    return;
  }

  var terms = query.toLowerCase().split(/\s+/).filter(function (term) {
    return term.length > 0;
  });

  function count(haystack, term) {
    return haystack.indexOf(term) === -1 ? 0 : 1;
  }

  function render(records) {
    var matches = [];
    records.forEach(function (record) {
      var title = String(record.title || "").toLowerCase();
      var description = String(record.description || "").toLowerCase();
      var text = String(record.text || "").toLowerCase();
      var all = title + " " + description + " " + text;
      var score = 0;
      for (var i = 0; i < terms.length; i += 1) {
        if (all.indexOf(terms[i]) === -1) {
          return;
        }
        score += 3 * count(title, terms[i]) + 2 * count(description, terms[i]) + count(text, terms[i]);
      }
      matches.push({ record: record, score: score });
    });
    matches.sort(function (a, b) {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
    });

    if (matches.length === 0) {
      status.textContent = "No results.";
      return;
    }
    status.textContent = matches.length + " result(s)";
    matches.slice(0, MAX_RESULTS).forEach(function (match) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.setAttribute("href", String(match.record.url));
      link.textContent = String(match.record.title);
      item.appendChild(link);
      if (match.record.description) {
        item.appendChild(document.createTextNode(" "));
        var description = document.createElement("span");
        description.textContent = String(match.record.description);
        item.appendChild(description);
      }
      results.appendChild(item);
    });
  }

  fetch("search-index.json")
    .then(function (response) {
      if (!response.ok) {
        throw new Error("search index unavailable");
      }
      return response.json();
    })
    .then(render)
    .catch(function () {
      status.textContent = "Search needs the site to be served over HTTP.";
    });
})();
