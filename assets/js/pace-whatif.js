/* pace-whatif.js — clean-air pace what-if explorer.
   Ported from pace_model/whatif_template.html. Loads data/pace-whatif-<year>.json
   (from `python -m pace_model.whatif_cli`, reshaped by build_season_pace.py),
   then lets the user drag each estimated nuisance coefficient and watch every
   driver's derived clean-air pace and rank move. Opens on ?/#race=<race_id>. */

(function () {
  "use strict";
  var URL = "data/pace-whatif-2026.json";
  var PAYLOAD = null;
  var $ = function (s) { return document.querySelector(s); };
  var fmt = function (x, d) { d = d == null ? 3 : d; return (x >= 0 ? "+" : "") + x.toFixed(d); };
  var CURVE_COLORS = {
    SOFT: "#D8402E", MEDIUM: "#C7971F", HARD: "#8B8B95",
    ALL: "#3A6EA5", INTERMEDIATE: "#2E7D6B", WET: "#2F7BD0"
  };
  var R, coef;
  var els = {};
  var curveSvgEl = null;
  var showAbs = true;

  function hashRace() {
    var m = (location.hash || "").match(/race=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Labels for the generic slider builder (makeSlider/sectionEl) only — kept
  // free of each slider's own section-title word, since the title already
  // says it (e.g. "Dirty air / closeness" wouldn't repeat "Dirty air" here).
  // Compound offset / degradation sliders build their own labels directly
  // (tyreCol/offsetLine), not through this map.
  function labelFor(k) {
    var map = {
      closeness: "At 0 s gap (s/lap)",
      closeness_battle: "Battle (s/lap at 0 s gap)",
      closeness_lapping: "Lapping (s/lap at 0 s gap)",
      overtake_mode: "≤1.0 s gap (s/lap)",
      overtake_mode_battle: "Battle (s/lap)",
      overtake_mode_lapping: "Lapping (s/lap)",
      laps_remaining: "Per lap remaining (s)",
      track_temperature: "Sensitivity (s/°C)"
    };
    return map[k] || k;
  }

  // One word per end, so the slider's own direction is legible without
  // reading the section note. Only covers the generic-slider keys.
  function endWordsFor(k) {
    if (k.indexOf("closeness") === 0) return ["Cleaner", "Dirtier"];
    if (k.indexOf("overtake_mode") === 0) return ["Boosted", "Reduced"];
    if (k === "laps_remaining") return ["Weaker", "Stronger"];
    if (k === "track_temperature") return ["Weaker", "Stronger"];
    return null;
  }

  function paceOf(d, c) {
    var s = d.calib + d.obs_mean_lap;
    for (var k in c) s += c[k] * (R.ref_feat[k] - d.fbar[k]);
    return s;
  }

  function ceilingFor(k) {
    if (k.indexOf("_sq") >= 0) return 0.02;
    if (k.indexOf("tyre_age") === 0) return 0.30;
    if (k === "laps_remaining" || k === "track_temperature") return 0.06;
    if (k.indexOf("closeness") === 0 || k.indexOf("overtake_mode") === 0) return 0.60;
    if (k.indexOf("compound_") === 0) return 1.20;
    return 0.5;
  }

  function makeSlider(k) {
    var base = R.coef[k], sd = R.std[k], cap = ceilingFor(k);
    var span = sd != null ? 4 * sd : Math.max(0.5 * Math.abs(base), 0.05);
    span = Math.min(span, cap);
    span = Math.max(span, cap * 0.15);
    var min = base - span, max = base + span, step = span / 200;
    var wrap = document.createElement("div");
    wrap.className = "ctl";
    var words = endWordsFor(k);
    var label = labelFor(k);
    wrap.innerHTML =
      '<div class="row"><label title="' + label.replace(/"/g, "&quot;") + '">' + label + "</label>" +
      '<span><span class="val"></span> <span class="delta"></span></span></div>' +
      '<div class="sliderwrap"><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + base + '">' +
      '<div class="track-bg"></div><div class="ci"></div><div class="base"></div></div>' +
      (words ? '<div class="endlabels"><span>' + words[0] + "</span><span>" + words[1] + "</span></div>" : "");
    var range = wrap.querySelector("input");
    if (sd != null) {
      var lo = Math.max(0, ((base - 2 * sd) - min) / (max - min) * 100);
      var hi = Math.min(100, ((base + 2 * sd) - min) / (max - min) * 100);
      var ci = wrap.querySelector(".ci");
      ci.style.left = lo + "%"; ci.style.width = Math.max(0, hi - lo) + "%";
    }
    wrap.querySelector(".base").style.left = "calc(" + ((base - min) / (max - min) * 100) + "% - 1px)";
    range.addEventListener("input", function () { coef[k] = +range.value; refresh(); });
    els[k] = { range: range, valEl: wrap.querySelector(".val"), deltaEl: wrap.querySelector(".delta") };
    return wrap;
  }

  function sectionEl(title, hint, keys, extra) {
    var s = document.createElement("section");
    s.className = "grp";
    s.innerHTML = '<div class="grp__head"><h3 title="' + title.replace(/"/g, "&quot;") + '">' + title + '</h3><button class="link" data-reset>reset</button></div>';
    if (hint) s.insertAdjacentHTML("beforeend", '<div class="note">' + hint + "</div>");
    keys.forEach(function (k) { s.appendChild(makeSlider(k)); });
    if (extra) s.appendChild(extra);
    s.querySelector("[data-reset]").addEventListener("click", function () {
      keys.forEach(function (k) { coef[k] = R.coef[k]; els[k].range.value = R.coef[k]; });
      refresh();
    });
    return s;
  }

  function curveSvg() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "curve");
    svg.setAttribute("viewBox", "0 0 400 150");
    svg._paths = {};
    R.groups.forEach(function (g) {
      var p = document.createElementNS(ns, "path");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", CURVE_COLORS[g.key] || "#888");
      p.setAttribute("stroke-width", "1.8");
      svg.appendChild(p); svg._paths[g.key] = p;
    });
    var ref = document.createElementNS(ns, "line");
    ref.setAttribute("stroke", "var(--ink-faint)"); ref.setAttribute("stroke-dasharray", "3 3");
    svg._ref = ref; svg.appendChild(ref);
    var zero = document.createElementNS(ns, "line");
    zero.setAttribute("stroke", "var(--line)"); svg._zero = zero; svg.appendChild(zero);
    return svg;
  }

  function drawCurves(svg) {
    var maxAge = R.max_tyre_age, W = 400, H = 150, padL = 6, padR = 6, padT = 8, padB = 14;
    var ymin = 0, ymax = 0.001;
    var series = R.groups.map(function (g) {
      var lin = coef[g.lin], quad = coef[g.quad], pts = [];
      var base = g.key === R.ref_compound ? 0 : (coef["compound_" + g.key] || 0);
      for (var i = 0; i <= 40; i++) {
        var a = maxAge * i / 40, y = base + lin * a + quad * a * a;
        pts.push([a, y]); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      }
      return { g: g, pts: pts };
    });
    var sx = function (a) { return padL + a / maxAge * (W - padL - padR); };
    var sy = function (y) { return padT + (ymax - y) / (ymax - ymin) * (H - padT - padB); };
    series.forEach(function (o) {
      svg._paths[o.g.key].setAttribute("d", o.pts.map(function (p, i) {
        return (i ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1);
      }).join(" "));
    });
    svg._ref.setAttribute("x1", sx(R.ref.tyre_age)); svg._ref.setAttribute("x2", sx(R.ref.tyre_age));
    svg._ref.setAttribute("y1", padT); svg._ref.setAttribute("y2", H - padB);
    svg._zero.setAttribute("x1", padL); svg._zero.setAttribute("x2", W - padR);
    svg._zero.setAttribute("y1", sy(0)); svg._zero.setAttribute("y2", sy(0));
  }

  // One "axis" line: label + track + value, on the shared [domainMin, domainMax]
  // scale so every compound's offset is visually comparable. A slider for a
  // real compound, or a fixed dot at 0 for the reference compound.
  function offsetLine(compound, domainMin, domainMax, zeroPct) {
    var isRef = compound === R.ref_compound;
    var wrap = document.createElement("div");
    wrap.className = "axis axis--inline";

    var label = document.createElement("div");
    label.className = "axis__label";
    label.title = isRef ? compound + " — reference compound, pinned at 0" : "Base offset vs " + R.ref_compound;
    label.textContent = "Base pace";
    wrap.appendChild(label);

    if (isRef) {
      var refTrack = document.createElement("div");
      refTrack.className = "axis__track axis__ref";
      refTrack.innerHTML = '<div class="zero" style="left:' + zeroPct + '%"></div>' +
        '<div class="dot" style="left:' + zeroPct + '%" title="Reference — pinned at 0, no fitted uncertainty"></div>';
      var refVal = document.createElement("div");
      refVal.className = "axis__val muted";
      refVal.textContent = "0.000 ref";
      wrap.appendChild(refTrack); wrap.appendChild(refVal);
      return wrap;
    }

    var k = "compound_" + compound, base = R.coef[k], sd = R.std[k];
    var min = domainMin, max = domainMax, step = (max - min) / 400;
    var track = document.createElement("div");
    track.className = "axis__track";
    track.innerHTML =
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + base + '">' +
      '<div class="track-bg"></div><div class="zero" style="left:' + zeroPct + '%"></div><div class="ci"></div><div class="base"></div>';
    var range = track.querySelector("input");
    if (sd != null) {
      var loPct = Math.max(0, ((base - 2 * sd) - min) / (max - min) * 100);
      var hiPct = Math.min(100, ((base + 2 * sd) - min) / (max - min) * 100);
      var ci = track.querySelector(".ci");
      ci.style.left = loPct + "%"; ci.style.width = Math.max(0, hiPct - loPct) + "%";
    }
    track.querySelector(".base").style.left = "calc(" + ((base - min) / (max - min) * 100) + "% - 1px)";
    var val = document.createElement("div");
    val.className = "axis__val";
    val.innerHTML = '<span class="v"></span><span class="delta"></span>';
    range.addEventListener("input", function () { coef[k] = +range.value; refresh(); });
    els[k] = { range: range, valEl: val.querySelector(".v"), deltaEl: val.querySelector(".delta") };
    wrap.appendChild(track); wrap.appendChild(val);
    return wrap;
  }

  function tyreCol(k, label, base, sd) {
    var cap = ceilingFor(k);
    var span = sd != null ? 4 * sd : Math.max(0.5 * Math.abs(base), 0.05);
    span = Math.min(span, cap); span = Math.max(span, cap * 0.15);
    var min = base - span, max = base + span, step = span / 200;
    var col = document.createElement("div");
    col.className = "tyre-col";
    col.innerHTML = "<label>" + label + "</label>" +
      '<div class="sliderwrap"><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + base + '">' +
      '<div class="track-bg"></div><div class="ci"></div><div class="base"></div></div>' +
      '<div class="tyre-col__val"><span class="v"></span><span class="delta"></span></div>';
    var range = col.querySelector("input");
    if (sd != null) {
      var lo = Math.max(0, ((base - 2 * sd) - min) / (max - min) * 100);
      var hi = Math.min(100, ((base + 2 * sd) - min) / (max - min) * 100);
      var ci = col.querySelector(".ci");
      ci.style.left = lo + "%"; ci.style.width = Math.max(0, hi - lo) + "%";
    }
    col.querySelector(".base").style.left = "calc(" + ((base - min) / (max - min) * 100) + "% - 1px)";
    range.addEventListener("input", function () { coef[k] = +range.value; refresh(); });
    els[k] = { range: range, valEl: col.querySelector(".v"), deltaEl: col.querySelector(".delta") };
    return col;
  }

  // One shared axis (base offset) + one row per compound (linear/curvature),
  // merged into a single section — the curve figure includes the offset so
  // the gap between curves is real relative pace, not just relative wear.
  function compoundPaceSection() {
    var nonRef = R.compounds_nonref.filter(function (c) { return ("compound_" + c) in R.coef; });
    var offsetKeys = nonRef.map(function (c) { return "compound_" + c; });
    var degKeys = R.groups.reduce(function (acc, g) { return acc.concat([g.lin, g.quad]); }, []);
    var allKeys = offsetKeys.concat(degKeys);

    var s = document.createElement("section");
    s.className = "grp";
    s.innerHTML = '<div class="grp__head"><h3 title="Compound pace">Compound pace</h3>' +
      (allKeys.length ? '<button class="link" data-reset>reset</button>' : "") + "</div>" +
      '<div class="note">' + R.ref_compound + " pinned at 0. Each compound: base offset on top, " +
      "linear/curvature degradation below — includes the offset, so curve gaps are real relative pace.</div>";

    var lo = 0, hi = 0;
    offsetKeys.forEach(function (k) {
      var sd = R.std[k], cap = ceilingFor(k), base = R.coef[k];
      var span = sd != null ? 4 * sd : Math.max(0.5 * Math.abs(base), 0.05);
      span = Math.min(span, cap); span = Math.max(span, cap * 0.15);
      lo = Math.min(lo, base - span); hi = Math.max(hi, base + span);
    });
    var pad = Math.max((hi - lo) * 0.15, 0.02);
    var domainMin = lo - pad, domainMax = hi + pad;
    var zeroPct = ((0 - domainMin) / (domainMax - domainMin) * 100).toFixed(2);

    if (!R.groups.length) {
      nonRef.concat([R.ref_compound]).forEach(function (compound) {
        var row = document.createElement("div");
        row.className = "tyre-row";
        row.innerHTML = '<div class="tyre-row__head"><i style="background:' + (CURVE_COLORS[compound] || "#888") + '"></i>' + compound + "</div>";
        row.appendChild(offsetLine(compound, domainMin, domainMax, zeroPct));
        s.appendChild(row);
      });
      s.insertAdjacentHTML("beforeend",
        '<div class="note">Degradation curves not fitted this race — tyre age was too collinear with race ' +
        "progress, so its effect is folded into fuel + track evolution below.</div>");
    } else {
      // Not every compound with a base-offset coefficient necessarily has a
      // fitted degradation group too (e.g. too few clean laps on it) — union
      // R.groups with compounds_nonref so that one still gets an offset row,
      // just without a linear/curvature line.
      var groupByKey = {};
      R.groups.forEach(function (g) { groupByKey[g.key] = g; });
      var rowCompounds = R.groups.map(function (g) { return g.key; });
      nonRef.forEach(function (c) { if (rowCompounds.indexOf(c) === -1) rowCompounds.push(c); });

      rowCompounds.forEach(function (compound) {
        var g = groupByKey[compound];
        var row = document.createElement("div");
        row.className = "tyre-row";
        row.innerHTML = '<div class="tyre-row__head"><i style="background:' + (CURVE_COLORS[compound] || "#888") +
          '"></i>' + (g ? g.compounds : compound) + (g ? '<span class="chip">' + g.n_drivers + " drv</span>" : "") + "</div>";
        row.appendChild(offsetLine(compound, domainMin, domainMax, zeroPct));
        if (g) {
          var cols = document.createElement("div");
          cols.className = "tyre-cols";
          cols.appendChild(tyreCol(g.lin, "Linear (s/lap)", R.coef[g.lin], R.std[g.lin]));
          cols.appendChild(tyreCol(g.quad, "Curvature (s/lap²)", R.coef[g.quad], R.std[g.quad]));
          row.appendChild(cols);
        } else {
          row.insertAdjacentHTML("beforeend", '<div class="note">No degradation curve fitted for ' + compound + " this race.</div>");
        }
        s.appendChild(row);
      });

      curveSvgEl = curveSvg();
      var legend = document.createElement("div");
      legend.className = "legend";
      legend.innerHTML = R.groups.map(function (g) {
        return '<span title="' + g.n_drivers + ' drivers on ' + g.compounds + '"><i style="background:' +
          (CURVE_COLORS[g.key] || "#888") + '"></i>' + g.compounds + " " + g.n_drivers + "</span>";
      }).join("") + '<span title="Dashed line marks the reference tyre age used elsewhere on this page">' +
        "dashed = age " + R.ref.tyre_age.toFixed(0) + "</span>";
      var box = document.createElement("div");
      box.appendChild(curveSvgEl); box.appendChild(legend);
      s.appendChild(box);
    }

    if (allKeys.length) {
      s.querySelector("[data-reset]").addEventListener("click", function () {
        allKeys.forEach(function (k) { coef[k] = R.coef[k]; els[k].range.value = R.coef[k]; });
        refresh();
      });
    }
    return s;
  }

  function buildSections() {
    var host = $("#wi-sections");
    host.innerHTML = "";
    for (var k in els) delete els[k];
    var split = R.traffic_mode === "split";
    var cK = split ? ["closeness_battle", "closeness_lapping"] : ["closeness"];
    var oK = split ? ["overtake_mode_battle", "overtake_mode_lapping"] : ["overtake_mode"];

    var dirtyAir = sectionEl("Dirty air / closeness",
      (split ? "Fitted separately for wheel-to-wheel battles vs lapping backmarkers. "
        : (R.traffic_fallback ? "Fell back to pooled — too few laps to split. " : "Pooled across all traffic. ")) +
      "Left weakens the dirty-air penalty, right strengthens it.",
      cK.filter(function (k) { return k in R.coef; }));
    if (!split && R.traffic_fallback) {
      var dirtyAirNote = dirtyAir.querySelector(".note");
      if (dirtyAirNote) dirtyAirNote.title = R.traffic_fallback;
    }
    host.appendChild(dirtyAir);
    host.appendChild(sectionEl("Overtake mode",
      "Left strengthens the overtake-mode boost, right weakens it.",
      oK.filter(function (k) { return k in R.coef; })));
    host.appendChild(compoundPaceSection());

    host.appendChild(sectionEl("Fuel + track evolution",
      "Combined effect of burning fuel and a rubbering-in track, per lap remaining. " +
      "Left weakens this effect, right strengthens it.", ["laps_remaining"]));
    host.appendChild(sectionEl("Track temperature",
      "Usually a small effect. " +
      "Left weakens the temperature effect, right strengthens it.", ["track_temperature"]));
  }

  function refresh() {
    var rows = R.drivers.map(function (d) { return { d: d, p: paceOf(d, coef), b: d.baseline_pure_pace }; });
    rows.sort(function (a, b) { return a.p - b.p; });
    var baseOrder = R.drivers.map(function (d) { return { num: d.num, b: d.baseline_pure_pace }; })
      .sort(function (a, b) { return a.b - b.b; });
    var baseRank = {};
    baseOrder.forEach(function (x, i) { baseRank[x.num] = i + 1; });
    var lead = rows[0].p;
    var abs = showAbs;
    $("#wi-col-toggle").textContent = abs ? "Lap time" : "Δ lead";
    var maxD = Math.max.apply(null, rows.map(function (r) { return r.p - lead; }).concat([0.001]));

    var tb = $("#wi-tbl tbody");
    tb.innerHTML = "";
    var biggest = null;
    rows.forEach(function (r, i) {
      var cr = i + 1, br = baseRank[r.d.num], mv = br - cr;
      if (!biggest || Math.abs(mv) > Math.abs(biggest.mv)) biggest = { name: r.d.name, mv: mv };
      var dLead = r.p - lead, vsBase = r.p - r.b;
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + cr + "</td>" +
        '<td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + r.d.color + ';margin-right:6px"></span>' +
        r.d.name + (r.d.extrapolated ? '<span class="chip">extrap</span>' : "") + "</td>" +
        "<td>" + (abs ? r.p.toFixed(3) : fmt(dLead, 3)) + "</td>" +
        '<td class="barcell"><div class="barbox"><div class="bar" style="width:' + (dLead / maxD * 100).toFixed(1) + "%;background:" + r.d.color + '"></div></div></td>' +
        '<td class="' + (vsBase < -0.001 ? "mv-up" : vsBase > 0.001 ? "mv-down" : "") + '">' + (Math.abs(vsBase) < 0.0005 ? "·" : fmt(vsBase, 3)) + "</td>" +
        '<td class="' + (mv > 0 ? "mv-up" : mv < 0 ? "mv-down" : "") + '">' + (mv > 0 ? "▲" + mv : mv < 0 ? "▼" + (-mv) : "·") + "</td>";
      tb.appendChild(tr);
    });

    var changed = Object.keys(coef).some(function (k) { return Math.abs(coef[k] - R.coef[k]) > 1e-9; });
    $("#wi-movers").innerHTML = !changed ? "At the fitted parameters — this is the model's own estimate."
      : (biggest && biggest.mv ? "Biggest rank move: <b>" + biggest.name + "</b> " +
          (biggest.mv > 0 ? "▲ " + biggest.mv : "▼ " + (-biggest.mv)) + " place" + (Math.abs(biggest.mv) > 1 ? "s" : "") + "."
          : "Pace shifted but the order held.");

    for (var k in els) {
      els[k].valEl.textContent = (+coef[k]).toFixed(k.indexOf("_sq") >= 0 ? 4 : 3);
      var dd = coef[k] - R.coef[k];
      els[k].deltaEl.textContent = Math.abs(dd) < 1e-9 ? "" : "(" + fmt(dd, k.indexOf("_sq") >= 0 ? 4 : 3) + ")";
    }
    if (curveSvgEl) drawCurves(curveSvgEl);
  }

  function loadRace(id) {
    R = PAYLOAD.races.filter(function (r) { return r.id === id; })[0] || PAYLOAD.races[0];
    coef = Object.assign({}, R.coef);
    $("#wi-meta").textContent = R.n_laps + " clean laps · " + R.drivers.length + " drivers";
    buildSections();
    refresh();
    try { localStorage.setItem("whatif_race", R.id); } catch (e) {}
  }

  function init() {
    var sel = $("#wi-race");
    PAYLOAD.races.forEach(function (r) {
      var o = document.createElement("option");
      o.value = r.id; o.textContent = r.label;
      sel.appendChild(o);
    });
    var start = hashRace();
    if (!start) { try { start = localStorage.getItem("whatif_race"); } catch (e) {} }
    if (start && PAYLOAD.races.some(function (r) { return r.id === start; })) sel.value = start;
    sel.addEventListener("change", function () { loadRace(sel.value); });
    var toggle = $("#wi-col-toggle");
    toggle.addEventListener("click", function () { showAbs = !showAbs; refresh(); });
    toggle.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showAbs = !showAbs; refresh(); }
    });
    $("#wi-reset").addEventListener("click", function () {
      coef = Object.assign({}, R.coef);
      for (var k in els) els[k].range.value = R.coef[k];
      refresh();
    });
    window.addEventListener("hashchange", function () {
      var id = hashRace();
      if (id && PAYLOAD.races.some(function (r) { return r.id === id; })) { sel.value = id; loadRace(id); }
    });
    loadRace(sel.value);
  }

  // Excluded from the race picker — not a data/model change, just hidden here.
  var EXCLUDED_RACES = ["2026-03-14_China_Sprint"];

  document.addEventListener("DOMContentLoaded", function () {
    fetch(URL).then(function (r) { return r.json(); }).then(function (d) {
      PAYLOAD = d;
      PAYLOAD.races = PAYLOAD.races.filter(function (r) { return EXCLUDED_RACES.indexOf(r.id) === -1; });
      init();
    }).catch(function (e) {
      console.error(e);
      $("#wi-sections").innerHTML = '<p class="t-note">Could not load the what-if data.</p>';
    });
  });
})();
