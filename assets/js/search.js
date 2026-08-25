/*
 * Robust keyword search for the Articles page.
 *
 * Goal (from spec): typing "matrix computation", "MatrixComputation" or
 * "matrix_computation" must all find the same results. We do this by
 * normalizing both the query and the indexed text the same way:
 *   1. split camelCase / PascalCase boundaries ("MatrixComputation" -> "Matrix Computation")
 *   2. replace underscores/hyphens with spaces
 *   3. lowercase everything
 *   4. strip anything that isn't a letter, number or space
 *   5. collapse repeated whitespace
 * Then every whitespace-separated token in the query must appear as a
 * substring somewhere in the normalized haystack (AND semantics).
 */
(function () {
  function normalize(str) {
    return String(str || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_\-]+/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9À-ɏ\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(normalized) {
    return normalized.split(" ").filter(Boolean);
  }

  function buildHaystack(entry) {
    return normalize(
      [entry.title, entry.excerpt, entry.categoryLabel, (entry.tags || []).join(" ")].join(" ")
    );
  }

  function cardHtml(entry) {
    var tagStyle = entry.categoryColor ? ' style="--tag-color:' + entry.categoryColor + '"' : "";
    return (
      '<a class="article-card" href="' + entry.url + '">' +
      '<div class="article-card__media"><img src="' + entry.logo + '" alt="" loading="lazy" width="64" height="64"></div>' +
      '<div class="article-card__body">' +
      '<span class="article-card__tag"' + tagStyle + ">" + entry.categoryLabel + "</span>" +
      '<h3 class="article-card__title">' + entry.title + "</h3>" +
      '<p class="article-card__excerpt">' + entry.excerpt + "</p>" +
      '<div class="article-card__meta"><span>' + entry.dateDisplay + "</span><span>" + entry.minutes + " " + entry.minReadLabel + "</span></div>" +
      "</div></a>"
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    var root = document.querySelector("[data-search-root]");
    if (!root) return;

    var input = root.querySelector("[data-search-input]");
    var status = root.querySelector("[data-search-status]");
    var resultsView = document.querySelector("[data-view-search]");
    var resultsGrid = resultsView ? resultsView.querySelector("[data-search-results]") : null;
    var browseViews = document.querySelectorAll("[data-browse-view]");
    var indexUrl = root.getAttribute("data-index-url");
    var noResultsText = root.getAttribute("data-no-results") || "No results.";
    var resultsFoundText = root.getAttribute("data-results-found") || "results";
    var minReadLabel = root.getAttribute("data-min-read-label") || "min";

    var data = [];
    var ready = false;

    fetch(indexUrl)
      .then(function (r) { return r.json(); })
      .then(function (json) {
        data = json.map(function (entry) {
          entry.minReadLabel = minReadLabel;
          entry._haystack = buildHaystack(entry);
          return entry;
        });
        ready = true;
      })
      .catch(function () {
        if (status) status.textContent = "";
      });

    function showBrowse(show) {
      browseViews.forEach(function (el) {
        el.style.display = show ? "" : "none";
      });
      if (resultsView) resultsView.style.display = show ? "none" : "";
    }

    input.addEventListener("input", function () {
      var raw = input.value;
      var normalizedQuery = normalize(raw);
      if (!normalizedQuery) {
        showBrowse(true);
        if (status) status.textContent = "";
        return;
      }
      if (!ready) return;

      var tokens = tokenize(normalizedQuery);
      var matches = data.filter(function (entry) {
        return tokens.every(function (t) { return entry._haystack.indexOf(t) !== -1; });
      });

      showBrowse(false);
      if (resultsGrid) {
        resultsGrid.innerHTML = matches.map(cardHtml).join("") ||
          '<p class="text-muted">' + noResultsText + "</p>";
      }
      if (status) {
        status.textContent = matches.length ? matches.length + " " + resultsFoundText : noResultsText;
      }
    });
  });
})();
