/* nav.js — mobile nav disclosure + mark the current page's link.
   Expects: <button class="nav-toggle" data-nav-toggle aria-expanded="false">
            <nav class="site-nav" id="site-nav"> ... </nav> */

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.getElementById("site-nav");

    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.getAttribute("data-open") === "true";
        nav.setAttribute("data-open", String(!open));
        toggle.setAttribute("aria-expanded", String(!open));
      });
    }

    // current-page highlight, tolerant of trailing slash / index.html
    var here = location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
    document.querySelectorAll(".site-nav a").forEach(function (a) {
      var target = a.getAttribute("href");
      if (!target || target.charAt(0) === "#") return;
      var path = new URL(a.href).pathname.replace(/index\.html$/, "").replace(/\/$/, "");
      if (path === here) a.setAttribute("aria-current", "page");
    });
  });
})();
