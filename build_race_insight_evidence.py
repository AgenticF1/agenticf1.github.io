"""
Mechanical evidence pass for per-race "what stood out" insights
(see todo/season_pace_race_insights_spec.md).

Computes season-wide distributions of every fitted coefficient and flags
per-race outliers (>=1.5 SD from the season median, or top/bottom 2), plus
pace-vs-finish-position deltas (from the race pkl, joined against actual
finish status — finished / classified-but-retired-late / unclassified DNF,
per the real >=90%-of-winner's-distance F1 rule, so a low finishing
position caused by a stopped car isn't reported as a pace/strategy story)
and teammate-gap deviations from each team's own season norm (both a
coarse absolute-magnitude pass for the full grid, and a lower RELATIVE-only
pass just for Red Bull/Mercedes/McLaren/Ferrari, whose season-norm gaps are
already tight — 0.13-0.48s — so a 0.15-0.3s move there is proportionally as
big a story as a 0.5s+ move at a midfield team with a wider natural gap).
This is the auditable evidence base a human then reads to hand-write
agentic_f1_project_page/data/race_insights_<year>.json — it does not
itself write prose.

Writes:
  analysis_out/season_<year>_pace_curated/insight_evidence.csv (long
    format: race_id, category, metric, value, z, note)
  analysis_out/season_<year>_pace_curated/finish_status.csv (every
    driver x race: last_lap, total_laps, pct_complete, finish_status)

Run: conda run -n basic python agentic_f1_project_page/build_race_insight_evidence.py
"""
from __future__ import annotations

import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
YEAR = 2026
CUR = REPO_ROOT / "analysis_out" / f"season_{YEAR}_pace_curated"
AO = REPO_ROOT / "analysis_out"
RACE_DATA = REPO_ROOT / "race_data" / str(YEAR)

# F1's actual classification rule is >=90% of winner's distance; below that a
# retirement gets no numeric result at all. We treat 90-95% as "classified
# but did retire" (worth saying so) vs >=95% as a normal finish (possibly
# lapped) vs <90% as unclassified/retired.
FINISH_PCT = 0.95
CLASSIFIED_DNF_PCT = 0.90

TOP4_TEAMS = {"Red Bull Racing", "Mercedes", "McLaren", "Ferrari"}

COEF_COLS = [
    "tyre_deg_slope_at_median_age_sec_per_lap",
    "tyre_deg_slope_SOFT",
    "tyre_deg_slope_MEDIUM",
    "race_progress_coef_sec_per_lap_remaining",
    "track_temperature_coef_sec_per_degC",
    "closeness_coef_sec_at_gap_zero",
    "closeness_battle_coef_sec_at_gap_zero",
    "closeness_lapping_coef_sec_at_gap_zero",
    "overtake_mode_leq_1_0s_effect_sec",
    "overtake_mode_battle_leq_1_0s_effect_sec",
    "overtake_mode_lapping_leq_1_0s_effect_sec",
    "r2",
    "median_ci_width_sec",
]

rows = []


def add(race_id, category, metric, value, z, note=""):
    rows.append({"race_id": race_id, "category": category, "metric": metric,
                 "value": value, "z": z, "note": note})


def main():
    coef = pd.read_csv(CUR / "coef_summary_by_race.csv")
    drv = pd.read_csv(CUR / "pace_by_driver_by_race.csv")
    chosen = pd.read_csv(CUR / "chosen_variant.csv")
    drv["driver_number"] = drv["driver_number"].astype(str)

    # --- 1. coefficient outliers across the season ---
    for col in COEF_COLS:
        if col not in coef.columns:
            continue
        s = coef[col]
        med = s.median()
        sd = s.std(ddof=0)
        if not np.isfinite(sd) or sd == 0:
            continue
        z = (s - med) / sd
        for rid, val, zval in zip(coef["race_id"], s, z):
            if pd.notna(zval) and abs(zval) >= 1.5:
                add(rid, "coef_outlier", col, val, zval,
                    f"season median {med:.4f}, this race {val:.4f}")

    # r2 / ci width: also flag worst 2 explicitly (low r2, high ci) even if <1.5 SD
    for col, worst in [("r2", "low"), ("median_ci_width_sec", "high")]:
        s = coef.set_index("race_id")[col]
        ordered = s.sort_values(ascending=(worst == "low"))
        for rid in ordered.index[:2]:
            add(rid, "fit_quality_rank", col, s[rid], np.nan, f"season {worst} rank <=2")

    # n_compound_extrapolated / n_low_support_teams: any race with >0
    for col in ["n_compound_extrapolated", "n_low_support_teams"]:
        for _, r in coef.iterrows():
            if pd.notna(r[col]) and r[col] > 0:
                add(r["race_id"], "data_quality", col, r[col], np.nan, "")

    # --- 2. variant sensitivity (already computed by season_curated_cli) ---
    for _, r in chosen.iterrows():
        add(r["race_id"], "variant_sensitivity", "chosen_label", r["chosen_label"], np.nan,
            f"choice_matters={r['choice_matters']}, "
            f"max_spread={r['max_driver_delta_spread_sec']:.2f}s, "
            f"max_rank_shift={r['max_rank_shift_any_variant']}")

    # --- 3. teammate-gap deviation from each team's own season norm ---
    # one row per (race, team): the driver who was AHEAD that race, so the
    # direction of an unusual swap is legible directly from the row.
    drv["abs_dtt"] = drv["delta_to_teammate"].abs()
    team_norm = drv.groupby("team")["abs_dtt"].median()
    team_n = drv.groupby("team")["abs_dtt"].count()
    for (rid, team), g in drv.groupby(["race_id", "team"]):
        if len(g) != 2 or team_n.get(team, 0) < 4:
            continue
        norm = team_norm[team]
        gap = g["abs_dtt"].iloc[0]  # symmetric within the pair
        if norm <= 0:
            continue
        dev = gap - norm
        big_widen = dev >= 0.25 and dev / norm >= 0.8
        big_narrow = dev <= -0.15 and dev / norm <= -0.6
        if not (big_widen or big_narrow):
            continue
        ahead = g.loc[g["delta_to_teammate"].idxmin()]
        behind = g.loc[g["delta_to_teammate"].idxmax()]
        add(rid, "teammate_gap", team, gap, np.nan,
            f"season norm |gap|={norm:.3f}s, this race={gap:.3f}s "
            f"({'widened' if big_widen else 'narrowed'}); "
            f"{ahead['driver_name']} ahead of {behind['driver_name']} by {gap:.3f}s")

    # --- 3b. top-4 teams get a much lower, RELATIVE-only bar. Red Bull /
    # Mercedes / McLaren / Ferrari run season-norm gaps of ~0.13-0.48s (far
    # tighter than the midfield's 0.2-0.6s), so a 0.2s move is proportionally
    # a much bigger story there than the same absolute number at, say, Aston
    # Martin — the flat absolute floor above would silently drop it.
    for (rid, team), g in drv.groupby(["race_id", "team"]):
        if team not in TOP4_TEAMS or len(g) != 2 or team_n.get(team, 0) < 4:
            continue
        norm = team_norm[team]
        gap = g["abs_dtt"].iloc[0]
        if norm <= 0:
            continue
        dev = gap - norm
        rel = dev / norm
        if abs(rel) < 0.35:
            continue
        ahead = g.loc[g["delta_to_teammate"].idxmin()]
        behind = g.loc[g["delta_to_teammate"].idxmax()]
        add(rid, "teammate_gap_top4", team, gap, np.nan,
            f"season norm |gap|={norm:.3f}s, this race={gap:.3f}s "
            f"({'widened' if rel > 0 else 'narrowed'} {abs(rel)*100:.0f}%); "
            f"{ahead['driver_name']} ahead of {behind['driver_name']} by {gap:.3f}s")

    # --- 4. consistency_std outliers (fast AND inconsistent, or fast AND rock solid) ---
    cs = drv["consistency_std"]
    med, sd = cs.median(), cs.std(ddof=0)
    for _, r in drv.iterrows():
        if pd.isna(r["consistency_std"]) or sd == 0:
            continue
        z = (r["consistency_std"] - med) / sd
        if abs(z) >= 1.5 and r["delta_to_fastest"] <= drv[drv.race_id == r.race_id]["delta_to_fastest"].quantile(0.5):
            add(r["race_id"], "consistency", r["driver_name"], r["consistency_std"], z,
                f"team={r['team']}, delta_to_fastest={r['delta_to_fastest']:.3f}s")

    # --- 4b. team-vs-team pace: rank swings, unusually close/far gaps between
    # specific pairs, and same-team Sprint-vs-Race swings within a weekend.
    tm = pd.read_csv(CUR / "pace_by_team_by_race.csv")
    tm["rank"] = tm.groupby("race_id")["delta_to_fastest"].rank()
    season_rank = tm.groupby("team")["rank"].median()
    season_gap = tm.groupby("team")["delta_to_fastest"].median()

    # a team's rank swinging hard from its own season-typical rank
    for _, r in tm.iterrows():
        typ = season_rank.get(r["team"])
        if typ is None:
            continue
        shift = r["rank"] - typ
        if abs(shift) >= 2.5:
            add(r["race_id"], "team_rank_shift", r["team"], r["rank"], np.nan,
                f"season-typical rank={typ:.1f}, this race rank={r['rank']:.0f} "
                f"({'worse' if shift > 0 else 'better'} than usual), "
                f"gap_to_fastest={r['delta_to_fastest']:.3f}s")

    # gap between consecutive-ranked teams this race — flag an unusually
    # tight (a team nipping at the one above) or unusually wide gap, judged
    # against that SAME pair's typical gap across the season where they
    # were adjacent, and always surfaced whenever a top-4 team is involved
    # (a midfield team closing on a front-runner is the headline case).
    TOP4 = {"Red Bull Racing", "Mercedes", "McLaren", "Ferrari"}
    for rid, g in tm.groupby("race_id"):
        g = g.sort_values("rank")
        rows_g = list(g.itertuples())
        for a, b in zip(rows_g, rows_g[1:]):
            gap = b.delta_to_fastest - a.delta_to_fastest
            if a.team in TOP4 or b.team in TOP4 or gap <= 0.15:
                add(rid, "team_pair_gap", f"{a.team} -> {b.team}", gap, np.nan,
                    f"rank {a.rank:.0f}->{b.rank:.0f}, gap={gap:.3f}s "
                    f"({a.team} at +{a.delta_to_fastest:.3f}s, {b.team} at +{b.delta_to_fastest:.3f}s)")

    # same team, Sprint vs Race at the same weekend — group by COUNTRY only
    # (not the date-prefixed race_id: a weekend's Sprint and Race are pulled
    # on different calendar dates, e.g. "2026-05-02_United_States_Sprint" vs
    # "2026-05-03_United_States_Race", so stripping the suffix alone doesn't
    # merge them).
    tm["weekend"] = tm["race_id"].str.split("_", n=1).str[1] \
        .str.replace("_Sprint", "", regex=False).str.replace("_Race", "", regex=False)
    for (wknd, team), g in tm.groupby(["weekend", "team"]):
        if g["session_type"].nunique() < 2:
            continue
        sprint = g[g["session_type"] == "Sprint"]
        race_ = g[g["session_type"] == "Race"]
        if sprint.empty or race_.empty:
            continue
        s_rank, r_rank = sprint["rank"].iloc[0], race_["rank"].iloc[0]
        if abs(s_rank - r_rank) >= 3:
            add(race_["race_id"].iloc[0], "team_sprint_vs_race", team, r_rank - s_rank, np.nan,
                f"sprint rank={s_rank:.0f} (+{sprint['delta_to_fastest'].iloc[0]:.3f}s), "
                f"race rank={r_rank:.0f} (+{race_['delta_to_fastest'].iloc[0]:.3f}s)")

    # --- 5. compound_extrapolated drivers, per race ---
    for _, r in drv[drv["compound_extrapolated"] == True].iterrows():
        add(r["race_id"], "compound_extrapolated", r["driver_name"], r["pure_pace"], np.nan,
            f"team={r['team']}")

    # --- 6. pace rank vs finishing position (needs the race pkl), WITH the
    # actual finish status attached — a low finish rank that's really a DNF
    # (car stopped) is a different story from one where the driver drove the
    # full distance and still finished low (real strategy/traffic/pace loss).
    finish_status_rows = []
    for rid in sorted(coef["race_id"].unique()):
        pkl_path = RACE_DATA / f"{rid}.pkl"
        if not pkl_path.exists():
            continue
        with open(pkl_path, "rb") as f:
            race = pickle.load(f)
        finish = {}
        last_lap = {}
        for num, d in race["drivers"].items():
            pos = d.get("position")
            if pos is not None and len(pos):
                finish[str(num)] = pos.sort_values("date")["position"].iloc[-1]
            laps = d.get("laps")
            if laps is not None and len(laps):
                # a lap_number can be logged with a NaN lap_duration when the
                # car retires mid-lap (or an incident lap is only partially
                # timed) — that's not a completed lap, so counting it
                # overstates how far the driver actually got (caught on
                # Leclerc's Spain retirement: lap 63 was logged with no
                # duration after a 125s incident lap 62).
                completed = laps.loc[laps["lap_duration"].notna(), "lap_number"]
                if len(completed):
                    last_lap[str(num)] = completed.max()
        total_laps = max(last_lap.values()) if last_lap else None

        g = drv[drv["race_id"] == rid].copy()
        if g.empty or total_laps is None:
            continue
        g["pace_rank"] = g["pure_pace"].rank()
        g["finish_pos"] = g["driver_number"].map(finish)
        g["last_lap"] = g["driver_number"].map(last_lap)
        g["pct_complete"] = g["last_lap"] / total_laps

        def status(pct):
            if pd.isna(pct):
                return "unknown"
            if pct >= FINISH_PCT:
                return "finished"
            if pct >= CLASSIFIED_DNF_PCT:
                return "classified_dnf"  # retired late, still scored
            return "dnf_unclassified"

        g["finish_status"] = g["pct_complete"].apply(status)
        for _, r in g.iterrows():
            finish_status_rows.append({
                "race_id": rid, "driver_name": r["driver_name"], "team": r["team"],
                "last_lap": r["last_lap"], "total_laps": total_laps,
                "pct_complete": round(r["pct_complete"], 3) if pd.notna(r["pct_complete"]) else None,
                "finish_status": r["finish_status"],
            })

        g = g.dropna(subset=["finish_pos"])
        if g.empty:
            continue
        g["finish_rank"] = g["finish_pos"].rank()
        g["rank_diff"] = g["finish_rank"] - g["pace_rank"]
        for _, r in g.reindex(g["rank_diff"].abs().sort_values(ascending=False).index[:4]).iterrows():
            if abs(r["rank_diff"]) < 3:
                continue
            pct_str = f"{r['pct_complete']:.2f}" if pd.notna(r["pct_complete"]) else "?"
            last_lap_str = f"{int(r['last_lap'])}" if pd.notna(r["last_lap"]) else "?"
            add(rid, "pace_vs_result", r["driver_name"], r["rank_diff"], np.nan,
                f"pace_rank={r['pace_rank']:.0f}, finish_pos={int(r['finish_pos'])}, "
                f"delta_to_fastest={r['delta_to_fastest']:.3f}s, team={r['team']}, "
                f"finish_status={r['finish_status']}, "
                f"last_lap={last_lap_str}/{total_laps}, pct_complete={pct_str}")

    finish_status_out = pd.DataFrame(finish_status_rows)
    finish_status_path = CUR / "finish_status.csv"
    finish_status_out.to_csv(finish_status_path, index=False)
    print(f"Wrote {finish_status_path.relative_to(REPO_ROOT)} ({len(finish_status_out)} rows)")

    out = pd.DataFrame(rows)
    out_path = CUR / "insight_evidence.csv"
    out.to_csv(out_path, index=False)
    print(f"Wrote {out_path.relative_to(REPO_ROOT)} ({len(out)} rows, "
          f"{out['race_id'].nunique()} races)")
    print(out["category"].value_counts())


if __name__ == "__main__":
    main()
