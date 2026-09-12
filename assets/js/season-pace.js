/* season-pace.js — the Season pace page.
   Fetches data/season-<year>-pace.json (built by build_season_pace.py) and
   renders the driver chart, team chart and the per-race "how it was fitted"
   list. All chart theming / rebuild-on-theme-change goes through F1Charts. */

(function () {
  "use strict";
  var DATA = null;
  var URL = "data/season-2026-pace.json";
  var metric = "pct"; // "pct" | "s" — the number the heatmap / team lines show

  /* ---------- data ---------- */
  function load(cb) {
    if (DATA) { cb(DATA); return; }
    fetch(URL).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (d) { DATA = d; cb(d); }).catch(function (e) {
      console.error("season-pace: load failed", e);
      var el = document.getElementById("race-list");
      if (el) el.innerHTML = '<li><p class="t-note">Could not load season data.</p></li>';
    });
  }

  function fmt(v, dp) { return v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(dp == null ? 2 : dp); }
  function pctFmt(v) { return v == null ? "–" : v.toFixed(2) + "%"; }

  // shared geometry so the driver heatmap and the team chart line their race
  // columns up exactly, and so their columns scroll at the same width.
  var COL_W = 34;
  function raceCats() {
    return DATA.races.map(function (r) { return r.short || r.name; }).concat(["", "Season"]);
  }
  function isDark(bg) {
    var h = String(bg).replace("#", "");
    if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  }
  function heatColors(dark) {
    // fastest (on pace) -> slowest (off pace): green -> yellow -> red
    return dark
      ? ["#2f7a4c", "#5d924e", "#9a9145", "#b87b43", "#c05f43", "#bf4438"]
      : ["#3a9b57", "#8fc46a", "#dfe08a", "#f3d072", "#e59355", "#cf4b3b"];
  }

  /* ---------- driver heatmap ---------- */
  function drawDrivers() {
    var el = document.getElementById("c_drivers");
    if (!el || !DATA) return;
    var t = F1Charts.tokens();
    var dark = isDark(t.bg);
    // driver names stay in a frozen left pane; the race columns scroll
    // horizontally in their own pane — see F1Charts.splitScroll.
    var split = F1Charts.splitScroll(el, { axisWidth: 118 });

    var drivers = DATA.drivers;               // already sorted fastest-first
    var names = drivers.map(function (d) { return d.name; });
    var cats = raceCats();
    var seasonCol = cats.length - 1;
    var key = metric === "pct" ? "pct" : "s";
    var gridTop = 6, gridBottom = 74, rightPad = 84;

    var data = [], vmax = 0.001;
    drivers.forEach(function (d, yi) {
      DATA.races.forEach(function (r, xi) {
        var g = d.gaps[r.race_id];
        if (!g || g[key] == null) return;
        data.push([xi, yi, g[key]]);
        vmax = Math.max(vmax, g[key]);
      });
      var sv = metric === "pct" ? d.season_pct : d.season_gap;
      if (sv != null) { data.push([seasonCol, yi, sv]); vmax = Math.max(vmax, sv); }
    });

    // frozen pane: names only, same grid.top/bottom (in px) as the
    // scrollable body below so the rows line up exactly.
    split.axis.setOption({
      grid: { left: 108, right: 0, top: gridTop, bottom: gridBottom, containLabel: false },
      xAxis: { type: "category", data: [""], show: false },
      yAxis: {
        type: "category", data: names, inverse: true,
        axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
        axisLabel: { fontSize: 10, color: t.muted }
      },
      series: []
    }, true);

    split.setBodyMinWidth(cats.length * COL_W + rightPad);
    split.body.setOption({
      grid: { left: 4, right: rightPad, top: gridTop, bottom: gridBottom, containLabel: false },
      xAxis: {
        type: "category", data: cats, boundaryGap: true,
        axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
        axisLabel: { fontSize: 10, rotate: 40, interval: 0,
          color: function (v) { return v === "Season" ? t.ink : t.muted; } }
      },
      yAxis: {
        type: "category", data: names, inverse: true,
        axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
        axisLabel: { show: false }
      },
      visualMap: {
        min: 0, max: Math.ceil(vmax * 10) / 10, calculable: true,
        orient: "vertical", right: 6, top: "middle", itemWidth: 10, itemHeight: 150,
        text: ["off pace", "on pace"], textStyle: { color: t.muted, fontSize: 10 },
        inRange: { color: heatColors(dark) }
      },
      tooltip: {
        trigger: "item", position: "top",
        formatter: function (p) {
          var d = drivers[p.value[1]];
          if (p.value[0] === seasonCol) {
            return d.name + "<br>season average · " + pctFmt(d.season_pct) + " · " + fmt(d.season_gap) + " s";
          }
          var r = DATA.races[p.value[0]], g = d.gaps[r.race_id] || {};
          return d.name + " — " + r.name + "<br>" + pctFmt(g.pct) + " off fastest · " + fmt(g.s) + " s";
        }
      },
      series: [{
        type: "heatmap", data: data,
        label: { show: true, fontSize: 9,
          formatter: function (p) { return p.value[2] == null ? "" : p.value[2].toFixed(2); },
          color: dark ? "#e8e8ea" : "#33302e" },
        itemStyle: { borderColor: t.surface, borderWidth: 1.5 },
        emphasis: { disabled: true }
      }]
    }, true);
  }

  function drawMetricToggle() {
    var host = document.getElementById("driver-controls");
    if (!host) return;
    host.innerHTML = "";
    [["pct", "% off fastest"], ["s", "gap in seconds"]].forEach(function (o) {
      var b = document.createElement("button");
      b.className = "btn"; b.type = "button"; b.textContent = o[1];
      b.setAttribute("aria-pressed", String(metric === o[0]));
      b.addEventListener("click", function () { metric = o[0]; drawMetricToggle(); drawDrivers(); drawTeams(); });
      host.appendChild(b);
    });
  }

  /* ---------- team pace evolution ---------- */
  // team-name legend lives outside the chart, in plain HTML — it doesn't
  // need to scroll with the race columns, and keeping it out of the
  // ECharts option means the frozen axis pane and the scrollable body
  // pane don't have to agree on where a two-row legend would sit.
  function drawTeamLegend(teams) {
    var host = document.getElementById("team-legend");
    if (!host) return;
    host.innerHTML = teams.map(function (tm) {
      return '<span><span class="swatch" style="background:' + F1Charts.team(tm.team) +
        '"></span>' + tm.team + "</span>";
    }).join("");
  }

  function drawTeams() {
    var el = document.getElementById("c_teams");
    if (!el || !DATA) return;
    var t = F1Charts.tokens();
    // value axis stays in a frozen left pane; the race columns scroll
    // horizontally in their own pane — see F1Charts.splitScroll.
    var split = F1Charts.splitScroll(el, { axisWidth: 56 });
    var cats = raceCats();
    var teams = DATA.teams;                   // sorted fastest-first
    var key = metric === "pct" ? "pct" : "s";
    var gridTop = 8, gridBottom = 74, rightPad = 16;

    var series = [], missed = [], vmax = 0.001;
    teams.forEach(function (tm) {
      var vals = DATA.races.map(function (r) {
        var g = tm.gaps[r.race_id];
        var v = (g && g[key] != null) ? g[key] : null;
        if (v != null) vmax = Math.max(vmax, v);
        return v;
      });
      // spacer (null), then the season average as an isolated point in the
      // "Season" column — connectNulls:false keeps it off the line
      var sv = metric === "pct" ? tm.season_pct : tm.season_gap;
      if (sv != null) vmax = Math.max(vmax, sv);
      series.push({
        name: tm.team, type: "line", connectNulls: false,
        showSymbol: true, symbolSize: 5,
        emphasis: { focus: "series", lineStyle: { width: 3.6 } },
        blur: { lineStyle: { opacity: 0.15 } },
        lineStyle: { width: 2.4, color: F1Charts.team(tm.team) },
        itemStyle: { color: F1Charts.team(tm.team) },
        data: vals.concat([null, sv == null ? null : { value: sv, symbolSize: 9 }])
      });
      vals.forEach(function (v, xi) {
        if (v != null) return;                // team ran this race
        var before = null, after = null, j;
        for (j = xi - 1; j >= 0; j--) { if (vals[j] != null) { before = vals[j]; break; } }
        for (j = xi + 1; j < vals.length; j++) { if (vals[j] != null) { after = vals[j]; break; } }
        var yv = (before != null && after != null) ? (before + after) / 2
               : (before != null ? before : (after != null ? after
               : (metric === "pct" ? tm.season_pct : tm.season_gap)));
        missed.push({ value: [xi, yv], _c: F1Charts.team(tm.team) });
      });
    });
    if (missed.length) {
      series.push({
        name: "missed race", type: "custom", data: missed, silent: true, z: 8,
        encode: { x: 0, y: 1 },
        renderItem: function (params, api) {
          var p = api.coord([api.value(0), api.value(1)]);
          var s = 4.5, col = missed[params.dataIndex]._c;
          var st = { stroke: col, lineWidth: 2, lineCap: "round" };
          return { type: "group", children: [
            { type: "line", shape: { x1: p[0] - s, y1: p[1] - s, x2: p[0] + s, y2: p[1] + s }, style: st },
            { type: "line", shape: { x1: p[0] - s, y1: p[1] + s, x2: p[0] + s, y2: p[1] - s }, style: st }
          ] };
        }
      });
    }

    // both panes get the same explicit y-axis domain (rather than each
    // auto-scaling to its own data — the axis pane has none) so their
    // gridlines/ticks land on the same rows.
    var yMax = Math.ceil(vmax * 1.05 * 10) / 10;

    split.axis.setOption({
      grid: { left: 32, right: 4, top: gridTop, bottom: gridBottom, containLabel: false },
      xAxis: { type: "category", data: [""], show: false },
      yAxis: {
        type: "value", min: 0, max: yMax,
        axisLabel: { fontSize: 10, color: t.muted, formatter: metric === "pct" ? "{value}%" : "{value}" }
      },
      series: []
    }, true);

    split.setBodyMinWidth(cats.length * COL_W + rightPad);
    split.body.setOption({
      grid: { left: 4, right: rightPad, top: gridTop, bottom: gridBottom, containLabel: false },
      tooltip: {
        trigger: "axis", order: "valueAsc",
        valueFormatter: function (v) { return v == null ? "–" : (metric === "pct" ? v.toFixed(2) + "%" : fmt(v) + " s"); }
      },
      xAxis: {
        type: "category", data: cats, boundaryGap: true,
        axisTick: { show: false },
        axisLabel: { fontSize: 10, rotate: 40, interval: 0,
          color: function (v) { return v === "Season" ? t.faint : t.muted; } }
      },
      yAxis: {
        type: "value", min: 0, max: yMax,
        axisLine: { show: false }, axisLabel: { show: false }
      },
      series: series
    }, true);

    drawTeamLegend(teams);
  }

  /* ---------- per-race list ---------- */
  function paramReadout(race) {
    var coef = race.coef || {};
    var items = [];
    function add(label, key, dp, unit) {
      if (coef[key] == null) return;
      items.push("<div><dt>" + label + "</dt><dd>" + coef[key].toFixed(dp) + (unit || "") + "</dd></div>");
    }
    add("Tyre deg, mid-stint", "tyre_deg_slope_at_median_age_sec_per_lap", 3, " s/lap");
    ["SOFT", "MEDIUM", "HARD"].forEach(function (g) {
      add("Tyre deg, " + g.toLowerCase(), "tyre_deg_slope_" + g, 3, " s/lap");
    });
    add("Fuel + track evolution", "race_progress_coef_sec_per_lap_remaining", 3, " s/lap");
    add("Dirty air, 0 s gap", "closeness_coef_sec_at_gap_zero", 2, " s");
    add("Dirty air, wheel-to-wheel", "closeness_battle_coef_sec_at_gap_zero", 2, " s");
    add("Dirty air, lapped traffic", "closeness_lapping_coef_sec_at_gap_zero", 2, " s");
    add("Overtake mode (≤ 1 s)", "overtake_mode_leq_1_0s_effect_sec", 2, " s");
    add("Overtake mode, wheel-to-wheel", "overtake_mode_battle_leq_1_0s_effect_sec", 2, " s");
    add(race.fit_scope_choice === "top_n" ? "Model R² (front-runners)" : "Model R²", "r2", 3, "");
    return '<dl class="coef-readout">' + items.join("") + "</dl>";
  }

  function buildList() {
    var host = document.getElementById("race-list");
    if (!host || !DATA) return;
    host.innerHTML = "";
    DATA.races.forEach(function (race) {
      var li = document.createElement("li");
      var pid = "rp-" + race.race_id;
      var rq = encodeURIComponent(race.race_id);
      li.innerHTML =
        '<button class="race-row" type="button" aria-expanded="false" aria-controls="' + pid + '">' +
          '<span class="race-row__rnd">R' + race.round + "</span>" +
          "<span>" +
            '<span class="race-row__name">' + race.name + "</span>" +
            '<span class="race-row__meta">' + race.session_type + " · " + race.date + "</span>" +
          "</span>" +
          '<span class="race-row__chev" aria-hidden="true">+</span>' +
        "</button>" +
        '<div class="race-panel" id="' + pid + '" hidden>' +
          paramReadout(race) +
          '<a class="race-panel__link" href="race.html?r=' + rq + '">Pace breakdown &rarr;</a>' +
        "</div>";

      var btn = li.querySelector(".race-row");
      var panel = li.querySelector(".race-panel");
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        btn.querySelector(".race-row__chev").textContent = open ? "+" : "–";
        panel.hidden = open;
      });
      host.appendChild(li);
    });
  }

  /* ---------- wire up ---------- */
  F1Charts.onReady(function () {
    if (!DATA) return;
    drawDrivers();
    drawTeams();
  });

  document.addEventListener("DOMContentLoaded", function () {
    drawMetricToggle();
    load(function () {
      drawDrivers();
      drawTeams();
      buildList();
    });
  });
})();
