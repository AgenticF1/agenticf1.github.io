/* theme.js — light / dark toggle.
   The <html data-theme> attribute is set as early as possible by a tiny inline
   snippet in each page's <head> (see templates/head.html); this file wires the
   toggle button. One click always flips to the opposite of what is on screen. */

(function () {
  var KEY = "theme";

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  // what the viewer actually sees right now
  function effective() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }

  function apply(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    reflect(mode);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { mode: mode } }));
  }

  function reflect(mode) {
    var btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    btn.setAttribute("data-mode", mode);
    btn.setAttribute("aria-label", "Switch to " + (mode === "dark" ? "light" : "dark") + " theme");
    btn.setAttribute("aria-pressed", String(mode === "dark"));
  }

  document.addEventListener("DOMContentLoaded", function () {
    reflect(effective());
    var btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      apply(effective() === "dark" ? "light" : "dark");
    });
  });

  // follow the OS while the viewer has not made an explicit choice
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (!stored()) reflect(effective());
    });
  }
})();
