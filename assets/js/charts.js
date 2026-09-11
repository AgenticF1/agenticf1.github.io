/* charts.js — the site's shared ECharts layer.
   Every article chart is built through this file so that:
     - colours, fonts and gridlines come from the CSS design tokens
       (so charts follow light / dark automatically),
     - F1 team colours have one canonical definition,
     - a theme switch rebuilds every chart on the page in one place.

   On a page with charts, load ECharts (UMD, pinned) then this file:
     <script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.6.0/echarts.min.js"></script>
     <script src="../assets/js/charts.js" defer></script>

   Then, in the per-article script, register ONE draw function that builds
   every chart via F1Charts.make():

     F1Charts.onReady(function draw() {
       var c = F1Charts.make(document.getElementById("c1"), { group: "t1" });
       c.setOption({ ...your series... });
       F1Charts.connect("t1");
     });

   F1Charts calls draw() once on load, and again after every theme change
   (it disposes the old instances first). Keep draw() idempotent.            */

(function () {
  var registry = [];
  var drawFns = [];

  /* --- read the live CSS tokens ------------------------------------------ */
  function tokens() {
    var s = getComputedStyle(document.documentElement);
    var g = function (n) { return s.getPropertyValue(n).trim(); };
    return {
      bg: g("--bg"),
      surface: g("--surface"),
      surface2: g("--surface-2"),
      ink: g("--ink"),
      muted: g("--ink-muted"),
      faint: g("--ink-faint"),
      line: g("--line"),
      lineStrong: g("--line-strong"),
      accent: g("--accent"),
      accentInk: g("--accent-ink"),
      pos: g("--pos"),
      neg: g("--neg"),
      font: g("--font-sans"),
      mono: g("--font-mono")
    };
  }

  /* --- F1 team colours — 2026 (OpenF1 /v1/drivers feed) ----------------- */
  var TEAMS = {
    "McLaren":       "#F47600",
    "Mercedes":      "#00D7B6",
    "Ferrari":       "#ED1131",
    "Red Bull":      "#4781D7",
    "Red Bull Racing": "#4781D7",
    "Alpine":        "#00A1E8",
    "Racing Bulls":  "#6C98FF",
    "Aston Martin":  "#229971",
    "Audi":          "#F50537",
    "Cadillac":      "#909090",
    "Haas":          "#9C9FA2",
    "Williams":      "#1868DB"
  };
  function team(name) { return TEAMS[name] || tokens().muted; }

  /* --- colour maths: lighten / darken a hex toward white / black -------- */
  function _rgb(h) {
    h = String(h).replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); });
  }
  function _hex(c) {
    return "#" + c.map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    }).join("");
  }
  function mix(a, b, t) {
    var pa = _rgb(a), pb = _rgb(b);
    return _hex(pa.map(function (v, i) { return v + (pb[i] - v) * t; }));
  }
  function lighten(hex, amount) { return mix(hex, "#ffffff", amount == null ? 0.4 : amount); }
  function darken(hex, amount) { return mix(hex, "#000000", amount == null ? 0.3 : amount); }

  /* colours for a set of drivers: each gets their team colour, and where
     two share a team the second one is lightened so they stay distinct.
     teamOf: {ACR: "McLaren", ...}. Returns {ACR: "#hex", ...}.            */
  function driverColors(acrs, teamOf) {
    var seen = {}, out = {};
    acrs.forEach(function (a) {
      var tm = teamOf[a];
      var base = tm ? team(tm) : tokens().muted;
      out[a] = seen[tm] ? lighten(base, 0.42) : base;
      seen[tm] = true;
    });
    return out;
  }

  /* categorical palette for series with no team meaning — cool, even hues */
  function palette() {
    var t = tokens();
    return [t.accent, "#6E8B7B", "#9A8FB0", "#C2916A", "#7FA9BD", "#8C8F98"];
  }

  /* --- the registered "f1" theme -------------------------------------- */
  function base() {
    var t = tokens();
    var axisName = { color: t.faint, fontSize: 10 };
    return {
      color: palette(),
      textStyle: { fontFamily: t.font, color: t.muted, fontSize: 12 },
      animation: false,
      grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
      title: { textStyle: { color: t.ink, fontSize: 13, fontWeight: 600 } },
      legend: {
        textStyle: { color: t.ink, fontSize: 11 },
        inactiveColor: t.faint,
        icon: "roundRect", itemWidth: 12, itemHeight: 8, itemGap: 14
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: t.surface,
        borderColor: t.lineStrong,
        borderWidth: 1,
        padding: [6, 9],
        textStyle: { color: t.ink, fontSize: 11 },
        axisPointer: { lineStyle: { color: t.lineStrong }, crossStyle: { color: t.lineStrong } }
      },
      categoryAxis: {
        nameTextStyle: axisName,
        axisLine: { lineStyle: { color: t.line } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10 },
        splitLine: { show: false }
      },
      valueAxis: {
        nameTextStyle: axisName,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: t.line, type: "dashed" } }
      }
    };
  }

  /* a themed slider/inside dataZoom pair — spread into a chart's option */
  function zoom(opts) {
    opts = opts || {};
    var t = tokens();
    return [
      { type: "inside", filterMode: opts.filterMode || "none",
        zoomOnMouseWheel: true, moveOnMouseWheel: false },
      { type: "slider", filterMode: opts.filterMode || "none",
        show: opts.slider !== false, height: 18, bottom: 6,
        start: opts.start, end: opts.end,
        borderColor: t.line, fillerColor: "rgba(128,128,128,.10)",
        handleStyle: { color: t.muted }, moveHandleStyle: { color: t.muted },
        textStyle: { color: t.muted, fontSize: 9 },
        labelFormatter: opts.labelFormatter,
        dataBackground: { lineStyle: { color: t.line }, areaStyle: { color: t.line } } }
    ];
  }

  function register() {
    if (!window.echarts) return false;
    echarts.registerTheme("f1", base());
    return true;
  }

  /* --- instance lifecycle ------------------------------------------- */
  function make(el, opts) {
    if (!el) return null;
    if (!window.echarts) { console.warn("charts.js: ECharts not loaded"); return null; }
    register();
    opts = opts || {};
    var chart = echarts.init(el, "f1", { renderer: opts.renderer || "canvas" });
    if (opts.group) chart.group = opts.group;
    registry.push(chart);
    return chart;
  }

  function connect(group) { if (window.echarts) echarts.connect(group); }

  function disposeAll() {
    registry.forEach(function (c) { if (c && !(c.isDisposed && c.isDisposed())) c.dispose(); });
    registry.length = 0;
  }

  function runDraws() {
    register();
    drawFns.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  }

  /* register a draw function; run it now and after every theme change */
  function onReady(fn) {
    drawFns.push(fn);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { register(); fn(); });
    } else {
      register(); fn();
    }
  }

  function resizeAll() {
    registry.forEach(function (c) { if (c && !(c.isDisposed && c.isDisposed())) c.resize(); });
  }

  /* --- wheel/drag zoom + pan for an inline <svg> figure -----------------
     Keeps the view inside the SVG's original viewBox; double-click resets.
     For hand-drawn SVG figures (track maps) that aren't ECharts charts.   */
  function svgZoom(svg, opts) {
    if (!svg || !svg.getAttribute("viewBox")) return;
    opts = opts || {};
    var min = opts.minScale || 1, max = opts.maxScale || 6;
    var v = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
    var home = { x: v[0], y: v[1], w: v[2], h: v[3] };
    var cur = { x: home.x, y: home.y, w: home.w, h: home.h };
    var apply = function () { svg.setAttribute("viewBox", cur.x + " " + cur.y + " " + cur.w + " " + cur.h); };
    var clamp = function () {
      cur.w = Math.min(home.w, Math.max(home.w / max, cur.w));
      cur.h = Math.min(home.h, Math.max(home.h / max, cur.h));
      cur.x = Math.max(home.x, Math.min(cur.x, home.x + home.w - cur.w));
      cur.y = Math.max(home.y, Math.min(cur.y, home.y + home.h - cur.h));
    };
    svg.style.cursor = "grab";
    svg.style.touchAction = "none";
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = svg.getBoundingClientRect();
      var mx = cur.x + (e.clientX - r.left) / r.width * cur.w;
      var my = cur.y + (e.clientY - r.top) / r.height * cur.h;
      var f = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      if (home.w / (cur.w * f) < min) f = home.w / (cur.w * min);
      cur.x = mx - (mx - cur.x) * f;
      cur.y = my - (my - cur.y) * f;
      cur.w *= f; cur.h *= f;
      clamp(); apply();
    }, { passive: false });
    var drag = null;
    svg.addEventListener("pointerdown", function (e) {
      drag = { x: e.clientX, y: e.clientY, vx: cur.x, vy: cur.y };
      svg.setPointerCapture(e.pointerId); svg.style.cursor = "grabbing";
    });
    svg.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var r = svg.getBoundingClientRect();
      cur.x = drag.vx - (e.clientX - drag.x) / r.width * cur.w;
      cur.y = drag.vy - (e.clientY - drag.y) / r.height * cur.h;
      clamp(); apply();
    });
    var end = function () { drag = null; svg.style.cursor = "grab"; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("dblclick", function () {
      cur = { x: home.x, y: home.y, w: home.w, h: home.h }; apply();
    });
  }

  document.addEventListener("themechange", function () { disposeAll(); runDraws(); });
  window.addEventListener("resize", resizeAll);
  // late re-measure: fonts / layout settle after first paint (standalone pages)
  window.addEventListener("load", resizeAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resizeAll);
  if (window.ResizeObserver) new ResizeObserver(resizeAll).observe(document.documentElement);

  window.F1Charts = {
    tokens: tokens, teams: TEAMS, team: team, palette: palette,
    lighten: lighten, darken: darken, mix: mix, driverColors: driverColors,
    base: base, zoom: zoom, make: make, connect: connect,
    onReady: onReady, resizeAll: resizeAll, svgZoom: svgZoom
  };
})();
