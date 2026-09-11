/* math.js — render LaTeX with KaTeX, themed through the site tokens.

   Load KaTeX (cdnjs) then this file on any post with maths:
     <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.css">
     <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script>
     <script src="../assets/js/math.js" defer></script>

   Static equation:  <div data-tex="v(g) = v_0 + A\,e^{-g/\tau}"></div>
                     add data-tex-inline for inline mode.
   Colour a term with the site palette (theme-safe, unlike \textcolor):
     \htmlClass{tex-accent}{...}   /  \htmlClass{tex-neg}{...}
   Dynamic equation (numbers from data): call F1Math.tex(el, "…") yourself.  */

(function () {
  var BASE = { throwOnError: false, strict: false, trust: true };

  function tex(el, src, opts) {
    if (!el || !window.katex) return;
    try {
      katex.render(src, el, Object.assign({ displayMode: true }, BASE, opts || {}));
      el.dataset.texDone = "1";
    } catch (e) { console.error("katex", e); }
  }

  function render(root) {
    (root || document).querySelectorAll("[data-tex]").forEach(function (el) {
      if (el.dataset.texDone) return;
      tex(el, el.getAttribute("data-tex"), { displayMode: !el.hasAttribute("data-tex-inline") });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { render(); });
  } else { render(); }

  window.F1Math = { render: render, tex: tex };
})();
