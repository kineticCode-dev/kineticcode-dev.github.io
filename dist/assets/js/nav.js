/* Mobile nav toggle + language switcher dropdown. */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var navToggle = document.querySelector("[data-nav-toggle]");
    if (navToggle) {
      navToggle.addEventListener("click", function () {
        document.body.classList.toggle("nav-open");
      });
    }

    document.querySelectorAll("[data-lang-switch]").forEach(function (el) {
      var trigger = el.querySelector("[data-lang-trigger]");
      if (!trigger) return;
      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        var isOpen = el.classList.contains("is-open");
        document.querySelectorAll(".lang-switch.is-open").forEach(function (open) {
          open.classList.remove("is-open");
        });
        if (!isOpen) el.classList.add("is-open");
      });
    });

    document.addEventListener("click", function () {
      document.querySelectorAll(".lang-switch.is-open").forEach(function (el) {
        el.classList.remove("is-open");
      });
    });
  });
})();
