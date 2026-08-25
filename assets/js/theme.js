/* Theme toggle — dark by default, light on demand. Persisted in localStorage. */
(function () {
  function getStored() {
    try { return localStorage.getItem("kc-theme"); } catch (e) { return null; }
  }
  function setStored(value) {
    try { localStorage.setItem("kc-theme", value); } catch (e) { /* ignore */ }
  }
  function currentTheme() {
    // Dark is the unconditional default (per spec): only an explicit
    // data-theme="light" (set here, or restored from localStorage on
    // load) switches it. We deliberately do not fall back to the OS
    // color-scheme preference.
    var attr = document.documentElement.getAttribute("data-theme");
    return attr === "light" ? "light" : "dark";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector("[data-theme-toggle]");
    if (!toggle) return;
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      setStored(next);
    });
  });
})();
