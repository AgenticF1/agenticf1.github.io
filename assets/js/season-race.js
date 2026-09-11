/* season-race.js — the per-race breakdown page (race.html?r=<race_id>).
   Reads data/season-2026-pace.json (pace + coefficients) and
   data/race-explainers-2026.json (the per-term partial-residual clouds). */

(function () {
  "use strict";
  var PACE_URL = "data/season-2026-pace.json";
  var EXPLAIN_URL = "data/race-explainers-2026.json";
  var RACE = null, EXPLAIN = null;

  function qparam(k) { return new URLSearchParams(location.search).get(k); }
  function fmt(v, dp) { return v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(dp == null ? 2 : dp); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  var COMPOUND_COLS = { SOFT: "#D8402E", MEDIUM: "#C7971F", HARD: "#8B8B95",
                        INTERMEDIATE: "#3f9b46", WET: "#2f6fb0" };

  /* ---------- header + fitted parameters ---------- */
  function fillHeader() {
    document.getElementById("r-eyebrow").textContent = "Round " + RACE.round + " · " + RACE.date;
    document.getElementById("r-title").textContent = RACE.name + " — race pace";
    document.title = RACE.name + " race pace — AgenticF1";
    document.getElementById("r-whatif").href =
      "pace-whatif.html#race=" + encodeURIComponent(RACE.race_id);
  }

  function fillParams() {
    var c = RACE.coef || {};
    var items = [];
    function add(label, key, dp, unit) {
      if (c[key] == null) return;
      items.push("<div><dt>" + label + "</dt><dd>" + c[key].toFixed(dp) + (unit || "") + "</dd></div>");
    }
    add("Tyre wear, mid-stint", "tyre_deg_slope_at_median_age_sec_per_lap", 3, " s/lap");
    ["SOFT", "MEDIUM", "HARD"].forEach(function (g) {
      add("Tyre wear, " + g.toLowerCase(), "tyre_deg_slope_" + g, 3, " s/lap");
    });
    add("Fuel burn + track rubbering-in", "race_progress_coef_sec_per_lap_remaining", 3, " s/lap");
    add("Track temperature", "track_temperature_coef_sec_per_degC", 3, " s/°C");
    add("Time lost right behind a car", "closeness_coef_sec_at_gap_zero", 2, " s");
    add("Behind a car in a fight", "closeness_battle_coef_sec_at_gap_zero", 2, " s");
    add("Behind a car being lapped", "closeness_lapping_coef_sec_at_gap_zero", 2, " s");
    add("Overtake-mode gain (within 1 s)", "overtake_mode_leq_1_0s_effect_sec", 2, " s");
    add("Overtake-mode gain, in a fight", "overtake_mode_battle_leq_1_0s_effect_sec", 2, " s");

    var lead = document.getElementById("r-params-lead");
    lead.textContent =
      "Before comparing drivers, the model removes the things that have nothing to do " +
      "with how quick the car was — tyre wear, fuel load, track temperature and dirty " +
      "air. Here is how big each of those was at " + RACE.name + ".";
    document.getElementById("r-params").innerHTML = items.join("") ||
      "<div><dt>Tyre wear</dt><dd>not separable this race</dd></div>";
  }

  /* ---------- fitted pace chart ---------- */
  function drawPace() {
    var el = document.getElementById("c_pace");
    if (!el) return;
    var t = F1Charts.tokens();
    var teamOf = {}; RACE.pace.forEach(function (d) { teamOf[d.name] = d.team; });
    var colors = F1Charts.driverColors(RACE.pace.map(function (d) { return d.name; }), teamOf);
    var rows = RACE.pace.slice().reverse();
    var names = rows.map(function (d) { return d.name + (d.extrap ? " *" : ""); });
    var fastest = Math.min.apply(null, RACE.pace.map(function (d) { return d.pure_pace; }));
    var xmin = Math.floor((fastest - 0.4) * 10) / 10;

    document.getElementById("r-pace-sub").textContent =
      "Every driver's lap time once the effects below are taken out, so the only thing " +
      "left is the car and driver. Whiskers show how tightly that is pinned down." +
      (rows.some(function (d) { return d.extrap; }) ? "  * ran an unusual compound — read with care." : "");

    var err = rows.map(function (d, i) {
      return d.ci_low == null ? null : [i, d.ci_low, d.ci_high];
    }).filter(Boolean);

    el.style.height = (rows.length * 22 + 64) + "px";
    var c = F1Charts.make(el);
    c.setOption({
      grid: { left: 8, right: 30, top: 30, bottom: 34, containLabel: true },
      xAxis: { type: "value", name: "fitted lap time  (s)", nameLocation: "middle", nameGap: 30,
               min: xmin, scale: true },
      yAxis: { type: "category", data: names, axisLabel: { fontSize: 10 } },
      tooltip: {
        trigger: "item",
        formatter: function (p) {
          var d = rows[p.dataIndex];
          return d.name + "<br>lap <b>" + d.pure_pace.toFixed(3) + " s</b>" +
            "<br>gap " + fmt(d.gap) + " s" + (d.pct == null ? "" : " · " + d.pct.toFixed(2) + "%") +
            (d.ci_low == null ? "" : "<br>range " + d.ci_low.toFixed(3) + " … " + d.ci_high.toFixed(3)) +
            (d.dtt == null ? "" : "<br>vs teammate " + fmt(d.dtt) + " s");
        }
      },
      series: [
        {
          type: "bar", barMaxWidth: 12,
          itemStyle: { color: function (p) { return colors[rows[p.dataIndex].name] || t.muted; },
                       borderRadius: [0, 3, 3, 0] },
          data: rows.map(function (d) { return d.pure_pace; })
        },
        {
          type: "custom", renderItem: renderWhisker, data: err, z: 3,
          silent: true, itemStyle: { borderColor: t.ink },
          encode: { x: [1, 2], y: 0 },
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: t.lineStrong, width: 1, type: "dashed" },
            label: { show: true, formatter: "fastest", color: t.faint, fontSize: 10,
                     position: "end", distance: [0, 5] },
            data: [{ xAxis: fastest }]
          }
        }
      ]
    }, true);
  }

  function renderWhisker(params, api) {
    var i = api.value(0), lo = api.coord([api.value(1), i]), hi = api.coord([api.value(2), i]);
    var h = 4;
    var style = { stroke: api.style().borderColor || "#888", lineWidth: 1 };
    return {
      type: "group", children: [
        { type: "line", shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: style },
        { type: "line", shape: { x1: lo[0], y1: lo[1] - h, x2: lo[0], y2: lo[1] + h }, style: style },
        { type: "line", shape: { x1: hi[0], y1: hi[1] - h, x2: hi[0], y2: hi[1] + h }, style: style }
      ]
    };
  }

  /* ---------- fitted pace distribution (spread across fitting runs) ---------- */
  function drawVariantSpread() {
    var el = document.getElementById("c_variants");
    if (!el) return;
    var t = F1Charts.tokens();
    var chosen = RACE.variants.filter(function (x) { return x.label === RACE.chosen_label; })[0];

    var rows = RACE.pace.map(function (d) {
      var vals = RACE.variants.map(function (v) { return v.laps[d.num]; })
        .filter(function (x) { return x != null; });
      if (!vals.length) return null;
      return { name: d.name, num: d.num,
               lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals),
               chosen: chosen ? chosen.laps[d.num] : null };
    }).filter(Boolean).sort(function (a, b) {
      var av = a.chosen == null ? 1e9 : a.chosen, bv = b.chosen == null ? 1e9 : b.chosen;
      return av - bv;
    });

    var fastest = Math.min.apply(null, rows.map(function (r) { return r.lo; }));
    var xmin = Math.floor((fastest - 0.4) * 10) / 10;
    var names = rows.map(function (r) { return r.name; });
    var ranges = rows.map(function (r, i) { return [r.lo, r.hi, i]; });
    var picks = rows.map(function (r, i) { return r.chosen == null ? null : [r.chosen, i]; }).filter(Boolean);

    el.style.height = (rows.length * 20 + 64) + "px";
    var c = F1Charts.make(el);
    c.setOption({
      grid: { left: 8, right: 26, top: 12, bottom: 40, containLabel: true },
      xAxis: { type: "value", name: "fitted lap time  (s)", nameLocation: "middle", nameGap: 30,
               min: xmin, scale: true },
      yAxis: { type: "category", data: names, inverse: true, axisLabel: { fontSize: 10 } },
      tooltip: {
        trigger: "item", formatter: function (p) {
          var r = rows[p.value[p.value.length - 1] != null ? p.value[p.value.length - 1] : p.dataIndex];
          return r.name + "<br>[" + r.lo.toFixed(2) + ", " + r.hi.toFixed(2) + "]" +
            (r.chosen == null ? "" : "<br><b>" + r.chosen.toFixed(2) + "</b>");
        }
      },
      series: [
        {
          type: "custom", data: ranges, z: 1, encode: { x: [0, 1], y: 2 }, silent: true,
          renderItem: function (params, api) {
            var i = api.value(2), a = api.coord([api.value(0), i]), b = api.coord([api.value(1), i]);
            return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
                     style: { stroke: t.lineStrong, lineWidth: 3, lineCap: "round" } };
          }
        },
        { type: "scatter", data: picks, z: 3, symbolSize: 7, itemStyle: { color: t.accent } }
      ]
    }, true);
  }

  /* ---------- insights ---------- */
  function fillInsights() {
    var list = RACE.insights || [];
    var sec = document.getElementById("insights-section");
    if (!list.length) { sec.hidden = true; return; }
    sec.hidden = false;
    document.getElementById("r-insights").innerHTML = list.map(function (x) {
      return '<li><span class="insight-tag">' + esc(x.tag) + "</span>" + esc(x.text) + "</li>";
    }).join("");
  }

  /* ---------- "how each effect was fitted" panels ---------- */
  var PANELS = [
    ["tyre", "Tyre wear", "tyre age  (laps)"],
    ["fuel", "Fuel + track evolution", "laps remaining"],
    ["temp", "Track temperature", "track temp  (°C)"],
    ["traffic", "Time lost in dirty air", "closeness  (0 clear · 1 on the tail)"],
    ["overtake", "Overtake mode", ""],
    ["compound", "Starting tyre offset", ""]
  ];

  // y-axis unit label per panel, rendered as a CSS-rotated overlay outside
  // the chart canvas — see the comment at its usage site in drawExplainers.
  var AXIS_UNIT = {
    tyre: "residual (s)", fuel: "residual (s)", temp: "residual (s)",
    traffic: "residual (s)", overtake: "residual (s)", compound: "s vs reference"
  };

  // the fitted size of each effect, pulled from the chosen fit's coefficients —
  // shown next to the panel title so the picture carries its own answer.
  function signed(v, dp, unit) { return (v >= 0 ? "+" : "") + v.toFixed(dp) + (unit || ""); }
  function panelSub(key, panel) {
    var c = RACE.coef || {};
    if (key === "tyre") {
      if (panel && panel.mode === "per_compound") {
        var parts = ["SOFT", "MEDIUM", "HARD"].map(function (g) {
          var s = c["tyre_deg_slope_" + g];
          return s == null ? null : g[0] + " " + signed(s, 3);
        }).filter(Boolean);
        return parts.length ? parts.join("  ") + " s/lap" : "";
      }
      if (panel && panel.mode === "dropped") return "folded into fuel";
      var m = c.tyre_deg_slope_at_median_age_sec_per_lap;
      return m == null ? "" : signed(m, 3, " s/lap") + " at mid-stint";
    }
    if (key === "fuel") return c.race_progress_coef_sec_per_lap_remaining == null ? ""
      : signed(c.race_progress_coef_sec_per_lap_remaining, 3, " s per lap");
    if (key === "temp") return c.track_temperature_coef_sec_per_degC == null ? ""
      : signed(c.track_temperature_coef_sec_per_degC, 3, " s/°C");
    if (key === "traffic") {
      if (panel && panel.mode === "split") {
        var b = c.closeness_battle_coef_sec_at_gap_zero, l = c.closeness_lapping_coef_sec_at_gap_zero;
        var s = [];
        if (b != null) s.push("fight " + signed(b, 2));
        if (l != null) s.push("lapping " + signed(l, 2));
        return s.length ? s.join("  ") + " s on the tail" : "";
      }
      return c.closeness_coef_sec_at_gap_zero == null ? ""
        : signed(c.closeness_coef_sec_at_gap_zero, 2, " s") + " on the tail";
    }
    if (key === "overtake") {
      if (panel && panel.mode === "split") {
        var ob = c.overtake_mode_battle_leq_1_0s_effect_sec, ol = c.overtake_mode_lapping_leq_1_0s_effect_sec;
        var q = [];
        if (ob != null) q.push("fight " + signed(ob, 2));
        if (ol != null) q.push("lapping " + signed(ol, 2));
        return q.length ? q.join("  ") + " s" : "";
      }
      return c.overtake_mode_leq_1_0s_effect_sec == null ? ""
        : signed(c.overtake_mode_leq_1_0s_effect_sec, 2, " s") + " within 1 s";
    }
    if (key === "compound") return panel && panel.reference
      ? "base pace vs the " + panel.reference.toLowerCase() + " tyre" : "";
    return "";
  }

  function drawExplainers() {
    var host = document.getElementById("r-explain");
    if (!host) return;
    var ex = EXPLAIN && EXPLAIN.races ? EXPLAIN.races[RACE.race_id] : null;
    if (!ex) { host.innerHTML = '<p class="t-note">No fitted-effect detail for this race.</p>'; return; }
    host.innerHTML = "";
    PANELS.forEach(function (p) {
      var panel = ex.panels[p[0]];
      var sub = panelSub(p[0], panel);
      // The stat line ("fight -0.21  lapping -0.03 s") used to be an
      // ECharts-internal title, positioned in canvas-local coordinates —
      // it could never reliably line up with the plain-HTML <h3> above it,
      // which is why it kept drifting (too close to the edge, floating
      // over the plot, not aligned with the panel title...). Rendering it
      // as a normal HTML element between the two means it shares the same
      // card padding as the h3 and is aligned with it by construction.
      var subHtml = sub ? '<div class="explain-panel__sub">' + esc(sub) + "</div>" : "";
      // Same reasoning as the stat line above, applied to the y-axis unit
      // label: ECharts' rotated yAxis.name + containLabel has proven
      // unreliable across three different attempts (invisible off-canvas,
      // floating unaligned with the axis, overlapping the tick numbers
      // with wasted margin beside it) — the interaction itself is the
      // problem, not any one set of pixel values. A plain CSS-rotated
      // overlay outside the canvas is fully predictable instead.
      var axisLabel = AXIS_UNIT[p[0]] || "";
      var axisLabelHtml = axisLabel
        ? '<div class="explain-axis-label">' + esc(axisLabel) + "</div>" : "";
      var card = document.createElement("div");
      card.className = "explain-panel";
      card.innerHTML = '<h3 class="explain-panel__t">' + p[1] + "</h3>" + subHtml +
        '<div class="explain-chart-wrap">' + axisLabelHtml +
        '<div class="explain-chart" id="ex_' + p[0] + '"></div></div>';
      host.appendChild(card);
      var el = card.querySelector(".explain-chart");
      if (p[0] === "compound") drawCompound(el, panel);
      else if (p[0] === "overtake") drawOvertake(el, panel);
      else if (p[0] === "tyre") drawTyre(el, panel, p[2]);
      else if (p[0] === "traffic") drawTraffic(el, panel, p[2]);
      else drawScatterFit(el, panel, p[2]);
    });
  }

  function baseScatterOption(t, xname) {
    return {
      // left: 22 reserves room for the .explain-axis-label CSS overlay
      // (~16px rotated text) sitting just outside the canvas; containLabel
      // expands beyond that as needed for the tick-number labels
      // themselves, which is the one thing it's always handled correctly.
      grid: { left: 22, right: 18, top: 14, bottom: 30, containLabel: true },
      xAxis: { type: "value", scale: true, name: xname, nameLocation: "middle", nameGap: 25,
               nameTextStyle: { color: t.faint, fontSize: 11 }, axisLabel: { fontSize: 11 },
               splitLine: { lineStyle: { color: t.line, opacity: 0.5 } } },
      yAxis: { type: "value", scale: true, axisLabel: { fontSize: 11 },
               splitLine: { lineStyle: { color: t.line, opacity: 0.5 } } },
      tooltip: { show: false }
    };
  }

  function drawScatterFit(el, panel, xname) {
    var t = F1Charts.tokens();
    var c = F1Charts.make(el);
    if (!panel || !panel.points) { el.parentNode.style.display = "none"; return; }
    var o = baseScatterOption(t, xname);
    o.series = [
      { type: "scatter", data: panel.points, symbolSize: 4, large: true,
        itemStyle: { color: t.accent, opacity: 0.28 } },
      { type: "line", data: panel.line, showSymbol: false, z: 3,
        lineStyle: { color: t.ink, width: 2 } }
    ];
    c.setOption(o, true);
  }

  function drawTyre(el, panel, xname) {
    var t = F1Charts.tokens();
    var c = F1Charts.make(el);
    if (!panel || panel.mode === "dropped" || !panel.points) {
      c.setOption({ title: { text: "folded into the fuel effect\n(tyre age tracked lap number\ntoo closely to separate)", left: "center",
        top: "middle", textStyle: { color: t.faint, fontSize: 11, lineHeight: 15, align: "center" } } }, true);
      return;
    }
    var o = baseScatterOption(t, xname);
    var byC = {};
    panel.points.forEach(function (pt) { (byC[pt[2]] = byC[pt[2]] || []).push([pt[0], pt[1]]); });
    var series = Object.keys(byC).map(function (cmp) {
      return { type: "scatter", data: byC[cmp], symbolSize: 4, large: true,
               itemStyle: { color: COMPOUND_COLS[cmp] || t.muted, opacity: 0.3 } };
    });
    (panel.curves || []).forEach(function (cv) {
      series.push({ type: "line", data: cv.line, showSymbol: false, z: 3,
        lineStyle: { color: cv.compound ? (COMPOUND_COLS[cv.compound] || t.ink) : t.ink, width: 2 } });
    });
    o.series = series;
    c.setOption(o, true);
  }

  function drawTraffic(el, panel, xname) {
    var t = F1Charts.tokens();
    var c = F1Charts.make(el);
    if (!panel || !panel.series || !panel.series.length) { el.parentNode.style.display = "none"; return; }
    var SPLIT_COLS = { battle: "#3671C6", lapping: "#D8402E" };
    var o = baseScatterOption(t, xname);
    var series = [];
    panel.series.forEach(function (s) {
      var col = s.cls ? SPLIT_COLS[s.cls] : t.accent;
      series.push({ type: "scatter", data: s.points || [], symbolSize: 4, large: true,
        itemStyle: { color: col, opacity: 0.28 } });
      if (s.line) series.push({ type: "line", data: s.line, showSymbol: false, z: 3,
        lineStyle: { color: s.cls ? col : t.ink, width: 2 } });
    });
    o.series = series;
    c.setOption(o, true);
  }

  function jitter(i, seed) {
    var v = (Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453);
    return v - Math.floor(v);
  }
  function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / (a.length || 1); }
  function stdev(a) {
    var m = mean(a);
    return Math.sqrt(a.reduce(function (s, y) { return s + (y - m) * (y - m); }, 0) / (a.length || 1));
  }
  function kde1d(vals, grid, bw) {
    return grid.map(function (g) {
      var s = 0;
      for (var j = 0; j < vals.length; j++) { var u = (g - vals[j]) / bw; s += Math.exp(-0.5 * u * u); }
      return s / (vals.length * bw * 2.5066283);
    });
  }

  function drawOvertake(el, panel) {
    var t = F1Charts.tokens();
    var c = F1Charts.make(el);
    if (!panel || !panel.groups || !panel.groups.length) { el.parentNode.style.display = "none"; return; }
    var groups = panel.groups;
    var cats = groups.map(function (g) { return g.label; });

    // tight axis padding: a 0.5s-rounded buffer (the original) could waste
    // up to a third of the vertical canvas on pure margin beyond the actual
    // residuals — rounding to 0.2 with a slimmer buffer keeps the violins
    // themselves filling 82-94% of the box instead of 66-91%.
    var all = [];
    groups.forEach(function (g) { all = all.concat(g.resid); });
    var ymin = Math.floor((Math.min.apply(null, all) - 0.06) * 5) / 5;
    var ymax = Math.ceil((Math.max.apply(null, all) + 0.06) * 5) / 5;
    var yGrid = []; for (var k = 0; k <= 40; k++) yGrid.push(ymin + (ymax - ymin) * k / 40);

    var violins = groups.map(function (g, gi) {
      if (g.resid.length < 12) return null;
      var bw = 1.06 * stdev(g.resid) * Math.pow(g.resid.length, -0.2) || 0.2;
      var d = kde1d(g.resid, yGrid, bw);
      var dmax = Math.max.apply(null, d) || 1;
      return { gi: gi, dens: d.map(function (x) { return x / dmax; }),
               col: gi % 2 ? t.accent : t.muted };
    });
    var jitPts = [];
    groups.forEach(function (g, gi) {
      g.resid.forEach(function (v, i) { jitPts.push([gi + (jitter(i, gi) - 0.5) * 0.62, v]); });
    });
    var means = groups.map(function (g, gi) { return [gi, mean(g.resid)]; });

    c.setOption({
      // left: 22, see baseScatterOption's grid comment.
      grid: { left: 22, right: 18, top: 16, bottom: 10, containLabel: true },
      xAxis: { type: "value", min: -0.5, max: groups.length - 0.5,
               axisTick: { show: false }, axisLine: { show: false },
               axisLabel: { fontSize: 11, color: t.muted, lineHeight: 13,
                 customValues: groups.map(function (_, i) { return i; }),
                 formatter: function (v) { return cats[Math.round(v)] || ""; } },
               splitLine: { show: false } },
      yAxis: { type: "value", min: ymin, max: ymax,
               axisLabel: { fontSize: 11, formatter: function (v) { return v.toFixed(1); } },
               splitLine: { lineStyle: { color: t.line, opacity: 0.5 } } },
      tooltip: { show: false },
      series: [
        { type: "custom", data: violins.map(function (_, i) { return i; }), silent: true, z: 1,
          renderItem: function (params, api) {
            var v = violins[params.dataIndex];
            if (!v) return null;
            var w = 0.48, pts = [];
            v.dens.forEach(function (dd, i) { pts.push(api.coord([v.gi + dd * w, yGrid[i]])); });
            for (var i = v.dens.length - 1; i >= 0; i--) pts.push(api.coord([v.gi - v.dens[i] * w, yGrid[i]]));
            return { type: "polygon", shape: { points: pts },
                     style: { fill: v.col, opacity: 0.18, stroke: v.col, lineWidth: 1.25 } };
          } },
        { type: "scatter", data: jitPts, symbolSize: 4, large: true, z: 2,
          itemStyle: { color: t.ink, opacity: 0.22 } },
        { type: "scatter", data: means, symbol: "rect", symbolSize: [38, 4], z: 4,
          itemStyle: { color: t.ink } }
      ]
    }, true);
  }

  function drawCompound(el, panel) {
    var t = F1Charts.tokens();
    var c = F1Charts.make(el);
    if (!panel || !panel.bars || !panel.bars.length) { el.parentNode.style.display = "none"; return; }
    var bars = panel.bars;
    c.setOption({
      grid: { left: 22, right: 18, top: 16, bottom: 16, containLabel: true },
      xAxis: { type: "category", data: bars.map(function (b) { return b.compound; }),
               axisLabel: { fontSize: 12 }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { fontSize: 11 },
               splitLine: { lineStyle: { color: t.line, opacity: 0.5 } } },
      tooltip: { trigger: "item", valueFormatter: function (v) { return v.toFixed(3) + " s"; } },
      series: [{
        type: "bar", barMaxWidth: 84, barCategoryGap: "30%",
        data: bars.map(function (b) {
          return { value: b.offset,
                   itemStyle: { color: b.low_support ? t.faint : (COMPOUND_COLS[b.compound] || t.accent),
                                borderRadius: 3, opacity: b.is_ref ? 0.35 : 1 } };
        })
      }]
    }, true);
  }

  /* ---------- boot ---------- */
  function notFound(msg) {
    document.getElementById("r-title").textContent = "Race not found";
    var lead = document.getElementById("r-params-lead");
    if (lead) lead.textContent = msg || "";
  }

  function render() {
    fillHeader();
    fillParams();
    fillInsights();
    F1Charts.onReady(function () {
      if (!RACE) return;
      drawPace();
      drawVariantSpread();
      drawExplainers();
    });
    drawPace();
    drawVariantSpread();
    drawExplainers();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var rid = qparam("r");
    if (!rid) { notFound("No race specified."); return; }
    Promise.all([
      fetch(PACE_URL).then(function (r) { return r.json(); }),
      fetch(EXPLAIN_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      RACE = res[0].races.filter(function (x) { return x.race_id === rid; })[0];
      EXPLAIN = res[1];
      if (!RACE) { notFound("No data for “" + rid + "”."); return; }
      render();
    }).catch(function (e) { console.error(e); notFound("Could not load race data."); });
  });
})();
