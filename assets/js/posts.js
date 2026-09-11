/* posts.js — render the post index from posts/posts.json and drive the
   tag filter. Single source of truth for "what has been published" is that
   JSON file; adding a post = adding one entry there (see README).

   Expects on the page:
     <div data-posts data-posts-src="posts/posts.json"
          data-posts-limit="0">        (0 = all)
     <div data-post-filter></div>       (optional; chips injected here)
   Renders a <ul class="post-list"> into [data-posts].                    */

(function () {
  var fmt = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "2-digit" });

  document.addEventListener("DOMContentLoaded", function () {
    var mount = document.querySelector("[data-posts]");
    if (!mount) return;

    var src = mount.getAttribute("data-posts-src") || "posts/posts.json";
    var limit = parseInt(mount.getAttribute("data-posts-limit") || "0", 10);

    fetch(src, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        var posts = (data.posts || [])
          .filter(function (p) { return !p.draft; })
          .sort(function (a, b) { return (a.date < b.date ? 1 : -1); });
        if (limit > 0) posts = posts.slice(0, limit);
        render(mount, posts);
        buildFilter(posts, mount);
      })
      .catch(function () {
        mount.innerHTML =
          '<p class="t-note">Post list unavailable. When viewing locally, serve the ' +
          'folder over HTTP (e.g. <code>python -m http.server</code>) rather than ' +
          'opening the file directly.</p>';
      });
  });

  function render(mount, posts) {
    if (!posts.length) {
      mount.innerHTML = '<p class="t-note">No posts yet.</p>';
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "post-list";
    posts.forEach(function (p) {
      var li = document.createElement("li");
      if (p.tags) li.dataset.tags = p.tags.join(" ");
      li.innerHTML =
        '<a class="post-item" href="' + escAttr(p.url) + '">' +
          '<span class="post-item__meta">' + dateLabel(p.date) + '</span>' +
          '<span>' +
            '<span class="post-item__title">' + esc(p.title) + '</span>' +
            (p.dek ? '<span class="post-item__dek"> — ' + esc(p.dek) + '</span>' : '') +
            (p.tags ? '<span class="post-item__tags chip-row">' +
              p.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') +
              '</span>' : '') +
          '</span>' +
        '</a>';
      ul.appendChild(li);
    });
    mount.innerHTML = "";
    mount.appendChild(ul);
  }

  function buildFilter(posts, mount) {
    var host = document.querySelector("[data-post-filter]");
    if (!host) return;
    var tags = {};
    posts.forEach(function (p) { (p.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
    var names = Object.keys(tags).sort();
    if (!names.length) return;

    host.innerHTML = '<div class="chip-row" role="group" aria-label="Filter posts by tag"></div>';
    var row = host.firstChild;
    var active = null;

    function chip(label, value) {
      var b = document.createElement("button");
      b.className = "chip";
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", value === active ? "true" : "false");
      b.addEventListener("click", function () {
        active = (active === value) ? null : value;
        row.querySelectorAll(".chip").forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === b && active !== null));
        });
        mount.querySelectorAll(".post-list > li").forEach(function (li) {
          var t = (li.dataset.tags || "").split(" ");
          li.hidden = active !== null && t.indexOf(active) === -1;
        });
      });
      return b;
    }

    row.appendChild(chip("All", null));
    names.forEach(function (n) { row.appendChild(chip(n, n)); });
  }

  function dateLabel(iso) {
    var d = new Date(iso + "T00:00:00");
    return isNaN(d) ? esc(iso) : fmt.format(d);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function escAttr(s) { return esc(s); }
})();
