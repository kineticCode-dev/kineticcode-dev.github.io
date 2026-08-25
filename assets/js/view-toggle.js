/* Toggle between "by topic" and "chronological" browsing on the Articles page. */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector("[data-view-toggle]");
    if (!toggle) return;
    var buttons = toggle.querySelectorAll("button[data-view]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-view");
        buttons.forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        document.querySelectorAll("[data-browse-view]").forEach(function (view) {
          view.style.display = view.getAttribute("data-browse-view") === target ? "" : "none";
        });
      });
    });
  });
})();
