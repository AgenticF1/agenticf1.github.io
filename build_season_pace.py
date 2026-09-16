"""
Build the Season pace page's data file from the curated pace pipeline output.

Reads (all produced by `python -m pace_model.season_curated_cli --year <year>`):
    analysis_out/season_<year>_pace_curated/pace_by_driver_by_race.csv
    analysis_out/season_<year>_pace_curated/pace_by_team_by_race.csv
    analysis_out/season_<year>_pace_curated/coef_summary_by_race.csv
    analysis_out/season_<year>_pace_curated/chosen_variant.csv
    analysis_out/<race_id>/variant_selection/selection.json
    analysis_out/<race_id>/variant_selection/all_variants_comparison.csv
    analysis_out/<race_id>/variant_selection/variant_metrics.csv

Writes one self-contained JSON the static page fetches:
    agentic_f1_project_page/data/season-<year>-pace.json

No fitting here — this only reshapes CSVs into the shape season-pace.js wants.
Run from the repo root:  conda run -n basic python agentic_f1_project_page/build_season_pace.py
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE = REPO_ROOT / "agentic_f1_project_page"
YEAR = 2026

VARIANT_AXES = [
    (f"{deg}_{traffic}_{scope}_{shape}", deg, traffic, scope, shape)
    for deg in ("shared", "per_compound")
    for traffic in ("pooled", "split")
    for scope in ("all", "top_n")
    for shape in ("quadratic", "linear")
]
# the reference point for "did the choice matter" / rank-shift sensitivity —
# the original baseline model before the degradation_shape axis or the
# per-compound-preferred rule existed.
BASELINE_LABEL = "shared_pooled_all_quadratic"


def _f(v):
    """JSON-safe float (NaN/inf -> None), rounded."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(v):
        return None
    return round(v, 5)


def _country(race_id: str) -> str:
    # "2026-07-19_Belgium_Race" -> "Belgium"; "United_States" -> "United States"
    mid = race_id.split("_", 1)[1].rsplit("_", 1)[0]
    return mid.replace("_", " ")


_SHORT = {
    "United States": "USA", "United Kingdom": "UK", "Netherlands": "Netherlands",
    "Saudi Arabia": "Saudi", "United Arab Emirates": "UAE", "Azerbaijan": "Baku",
}


def _short_label(race_id: str, session_type: str) -> str:
    """Compact axis label — abbreviates the long country names and marks a
    Sprint with a trailing 'S' so 19 columns fit without labels overlapping."""
    c = _country(race_id)
    c = _SHORT.get(c, c)
    return c + " S" if session_type == "Sprint" else c


def _race_pace_rows(g: pd.DataFrame) -> list[dict]:
    rows = []
    fastest = g["pure_pace"].min()
    for _, r in g.sort_values("delta_to_fastest").iterrows():
        rows.append({
            "num": str(r["driver_number"]),
            "name": r["driver_name"],
            "team": r["team"],
            "pure_pace": _f(r["pure_pace"]),
            "gap": _f(r["delta_to_fastest"]),
            "pct": _f(100.0 * r["delta_to_fastest"] / fastest),
            "ci_low": _f(r.get("ci_low")),
            "ci_high": _f(r.get("ci_high")),
            "dtt": _f(r.get("delta_to_teammate")),
            "extrap": bool(r.get("compound_extrapolated", False)),
        })
    return rows


def _team_pace_rows(g: pd.DataFrame) -> list[dict]:
    rows = []
    for _, r in g.sort_values("delta_to_fastest").iterrows():
        rows.append({
            "team": r["team"],
            "team_pace": _f(r["team_pace"]),
            "gap": _f(r["delta_to_fastest"]),
            "n_drivers": int(r["n_drivers"]),
            "low_support": bool(r["low_support"]),
        })
    return rows


# Any driver whose pace under one variant sits more than this far from their own
# median across the 8 variants is a two-stage (per_compound × top_n) breakdown —
# that driver ran a compound the front-runner subset never did, so the
# Frisch–Waugh–Lovell adjustment has nothing to work with. Drop that cell rather
# than let a 5–8 s artefact drive the sensitivity numbers.
OUTLIER_SEC = 2.0


def _variant_analysis(race_id: str, ao: Path):
    """Returns (variants_list, sensitivity). Sensitivity is recomputed here,
    outlier-robust, rather than trusting selection.json's (which is polluted by
    the per_compound × top_n breakdown described above)."""
    d = ao / race_id / "variant_selection"
    comp = pd.read_csv(d / "all_variants_comparison.csv")
    met = pd.read_csv(d / "variant_metrics.csv", index_col=0)
    labels = [v[0] for v in VARIANT_AXES]
    cols = [f"pure_pace_{lab}" for lab in labels]

    # per-driver median across variants → mask cells that are clearly broken
    med = comp[cols].median(axis=1)
    ok = comp[cols].sub(med, axis=0).abs() <= OUTLIER_SEC
    clean = comp[cols].where(ok)

    centred = clean.sub(clean.min(axis=0), axis=1)          # gap to fastest per variant
    row_spread = centred.max(axis=1) - centred.min(axis=1)
    base_rank = clean[f"pure_pace_{BASELINE_LABEL}"].rank()
    per_driver_shift = pd.concat(
        [(clean[c].rank() - base_rank).abs() for c in cols], axis=1
    ).max(axis=1)

    worst_i = row_spread.idxmax() if row_spread.notna().any() else None
    sensitivity = {
        "median_driver_delta_spread_sec": _f(row_spread.median()),
        "max_driver_delta_spread_sec": _f(row_spread.max()),
        "driver_with_max_spread": None if worst_i is None else comp.loc[worst_i, "driver_name"],
        "median_rank_shift": _f(per_driver_shift.median()),
        "max_rank_shift_any_variant": _f(per_driver_shift.max()),
    }

    out = []
    for (label, deg, traffic, scope, shape), col in zip(VARIANT_AXES, cols):
        # absolute fitted lap time per driver under this variant (outlier cells masked)
        laps = {str(n): _f(v) for n, v in zip(comp["driver_number"], clean[col]) if pd.notna(v)}
        m = met.loc[label] if label in met.index else {}
        out.append({
            "label": label, "degradation": deg, "traffic": traffic, "fit_scope": scope,
            "degradation_shape": shape,
            "n_extrap": int(m.get("n_compound_extrapolated", 0) or 0),
            "median_ci_sec": _f(m.get("median_ci_width_sec")),
            "r2": _f(m.get("r2")),
            "traffic_actual": m.get("traffic_mode_actual"),
            "laps": laps,
        })
    return out, sensitivity


def build(year: int = YEAR) -> dict:
    ao = REPO_ROOT / "analysis_out"
    cur = ao / f"season_{year}_pace_curated"
    # Driver/team pace itself comes from the track-specific layer on top of
    # `cur` (currently: Monaco's Pattern A clean-air substitution; Hungary is
    # deliberately reverted back to `cur`'s own curated number — see
    # `track_specific_analysis.season_with_track_specific`'s `skip_races`).
    # Everything else this page needs (chosen_variant, coef_summary, the
    # variant_selection/ dirs) is per-race pipeline metadata that track-specific
    # substitution doesn't touch, so those still read from `cur`.
    ts = ao / f"season_{year}_pace_curated_track_specific"

    # optional hand-curated "what stood out" bullets, keyed by race_id (see
    # todo/season_pace_race_insights_spec.md). Absent until that pass is done.
    insights_path = SITE / "data" / f"race_insights_{year}.json"
    insights = json.loads(insights_path.read_text()) if insights_path.exists() else {}

    drv = pd.read_csv(ts / "pace_by_driver_by_race.csv")
    tm = pd.read_csv(ts / "pace_by_team_by_race.csv")
    coef = pd.read_csv(cur / "coef_summary_by_race.csv").set_index("race_id")
    chosen = pd.read_csv(cur / "chosen_variant.csv").set_index("race_id")

    drv["driver_number"] = drv["driver_number"].astype(str)
    race_ids = list(chosen.index)

    races = []
    for rnd, rid in enumerate(sorted(race_ids), start=1):
        sel = json.loads((ao / rid / "variant_selection" / "selection.json").read_text())
        _drop = {"date", "session_type", "chosen_label", "n_compound_extrapolated",
                 "median_ci_width_sec", "n_low_support_teams"}
        raw_cs = coef.loc[rid].to_dict() if rid in coef.index else {}
        cs = {k: _f(v) for k, v in raw_cs.items()
              if k not in _drop and isinstance(v, (int, float, np.floating)) and _f(v) is not None}
        variants, sens = _variant_analysis(rid, ao)
        # authoritative "does the choice matter": we moved off the default set, or
        # the field genuinely reorders (typical driver shifts more than a place).
        rank_shift = sens.get("median_rank_shift") or 0
        spread = sens.get("median_driver_delta_spread_sec") or 0
        choice_matters = bool(
            sel["chosen_label"] != BASELINE_LABEL or rank_shift > 1 or spread >= 0.15
        )

        # drop the rationale's trailing sensitivity sentence — the page renders
        # those numbers itself, and its phrasing followed the old matters test.
        rationale = sel["rationale"]
        for cut in (" This choice is consequential:", " The 8 variants agree closely"):
            i = rationale.find(cut)
            if i != -1:
                rationale = rationale[:i].rstrip()
                break

        gd = drv[drv["race_id"] == rid]
        gt = tm[tm["race_id"] == rid]
        num_to_name = dict(zip(gd["driver_number"], gd["driver_name"]))
        races.append({
            "race_id": rid,
            "round": rnd,
            "date": sel["date"],
            "country": _country(rid),
            "session_type": sel["session_type"],
            "name": _country(rid) + (" Sprint" if sel["session_type"] == "Sprint" else ""),
            "short": _short_label(rid, sel["session_type"]),
            "chosen_label": sel["chosen_label"],
            "degradation_choice": sel["degradation_choice"],
            "traffic_choice": sel["traffic_choice"],
            "fit_scope_choice": sel["fit_scope_choice"],
            "choice_matters": choice_matters,
            "reason_codes": sel["reason_codes"],
            "rationale": rationale,
            "sensitivity": sens,
            "coef": cs,
            "insights": insights.get(rid, []),
            "tyre_age_laps_remaining_corr": _f(sel.get("tyre_age_laps_remaining_corr")),
            "top_n": [num_to_name.get(str(n), str(n)) for n in (sel.get("top_n_ids") or [])],
            "pace": _race_pace_rows(gd),
            "team_pace": _team_pace_rows(gt),
            "variants": variants,
        })

    # per-driver / per-team season series: gap to fastest that race, in seconds
    # AND as a % of the fastest lap (removes the lap-length bias that makes a
    # 0.3 s gap at Spa look the same as at Monaco). The season number is the
    # mean across the races the driver/team appeared in.
    def _series(df, key, label_col, value_col):
        fastest_by_race = df.groupby("race_id")[value_col].min()
        rows = []
        for name, g in df.groupby(label_col):
            gaps = {}
            for _, r in g.iterrows():
                fastest = fastest_by_race[r["race_id"]]
                gap = r["delta_to_fastest"]
                gaps[r["race_id"]] = {"s": _f(gap), "pct": _f(100.0 * gap / fastest)}
            svals = [v["s"] for v in gaps.values() if v["s"] is not None]
            pvals = [v["pct"] for v in gaps.values() if v["pct"] is not None]
            meta = g.iloc[0]
            row = {
                key: name,
                "team": meta["team"] if key == "name" else name,
                "starts": len(gaps),
                "season_gap": _f(np.mean(svals)) if svals else None,
                "season_pct": _f(np.mean(pvals)) if pvals else None,
                "gaps": gaps,
            }
            if key == "name":
                row["num"] = str(meta["driver_number"])
            rows.append(row)
        rows.sort(key=lambda r: (r["season_pct"] is None, r["season_pct"] or 0))
        return rows

    drivers = _series(drv.rename(columns={"driver_name": "name"}), "name", "name", "pure_pace")
    teams = _series(tm, "team", "team", "team_pace")

    return {
        "generated": date.today().isoformat(),
        "season": year,
        "races": races,
        "drivers": drivers,
        "teams": teams,
    }


def copy_whatif_payload() -> None:
    """The what-if explorer page (pace-whatif.js) runs the exact JS from
    pace_model/whatif_template.html, so it wants that pipeline's payload.json
    verbatim — just relocated into the site's data/ dir. Run
    `python -m pace_model.whatif_cli` to refresh the source."""
    src = REPO_ROOT / "analysis_out" / "pace_whatif" / "payload.json"
    if not src.exists():
        print(f"  (skipped what-if payload — {src.relative_to(REPO_ROOT)} not found; "
              f"run `python -m pace_model.whatif_cli`)")
        return
    dst = SITE / "data" / f"pace-whatif-{YEAR}.json"
    payload = json.loads(src.read_text())
    payload["races"] = [r for r in payload["races"] if not r["id"].endswith("_Sprint")
                        or r.get("n_laps", 0) >= 20]  # drop the thin China Sprint
    dst.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {dst.relative_to(REPO_ROOT)}  ({len(payload['races'])} races, "
          f"{dst.stat().st_size / 1024:.0f} KB)")


def main() -> None:
    data = build(YEAR)
    out = SITE / "data" / f"season-{YEAR}-pace.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"Wrote {out.relative_to(REPO_ROOT)}  "
          f"({len(data['races'])} races, {len(data['drivers'])} drivers, "
          f"{out.stat().st_size / 1024:.0f} KB)")
    copy_whatif_payload()


if __name__ == "__main__":
    main()
