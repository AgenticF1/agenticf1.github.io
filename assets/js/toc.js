/* toc.js — build an in-page table of contents from an article's structure and
   highlight the section currently in view (scrollspy).

   Usage: <nav class="toc" data-toc data-toc-source=".article"></nav>

   Picks up, in document order:
     .part[id]            → a group heading (e.g. "Part one")
     h2[id] / .section-head[id] → a numbered entry

   Optional label override on any of them:
     <h2 id="s1" data-toc-label="Short label">Full heading</h2>              */

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var mount = document.querySelector("[data-toc]");
    if (!mount) return;
    var source = document.querySelector(mount.getAttribute("data-toc-source") || ".article");
    if (!source) return;

    var nodes = Array.prototype.slice.call(
      source.querySelectorAll(".part[id], h2[id], .section-head[id]")
    );
    var entries = nodes.filter(function (n) { return !n.classList.contains("part"); });
    if (entries.length < 2) { mount.hidden = true; return; }

    var list = document.createElement("ol");
    var links = [];

    function labelOf(node) {
      if (node.getAttribute("data-toc-label")) return node.getAttribute("data-toc-label");
      var h = node.querySelector("h2, .part__d");
      return (h ? h.textContent : node.textContent).trim();
    }

    var n = 0;
    nodes.forEach(function (node) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + node.id;
      if (node.classList.contains("part")) {
        li.className = "toc__group";
        a.textContent = labelOf(node);
      } else {
        n += 1;
        var num = document.createElement("span");
        num.className = "toc__n";
        num.textContent = n;
        a.appendChild(num);
        a.appendChild(document.createTextNode(labelOf(node)));
        links.push({ a: a, node: node });
      }
      li.appendChild(a);
      list.appendChild(li);
    });

    var title = document.createElement("p");
    title.className = "toc__title";
    title.textContent = mount.getAttribute("data-toc-title") || "On this page";
    mount.appendChild(title);
    mount.appendChild(list);

    if (!("IntersectionObserver" in window)) return;
    var current = null;
    var io = new IntersectionObserver(function (entryList) {
      entryList.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        if (current) current.removeAttribute("aria-current");
        var match = links.find(function (l) { return l.node === entry.target; });
        if (match) { match.a.setAttribute("aria-current", "true"); current = match.a; }
      });
    }, { rootMargin: "0px 0px -70% 0px", threshold: 0 });

    links.forEach(function (l) { io.observe(l.node); });
  });
})();
