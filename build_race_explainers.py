"""
Build the per-race "how each effect was fitted" data for race.html Section 04 —
a web-native re-draw of pace_model.visualize's model_explainer.png.

For every 2026 Race/Sprint, refit the pace model with the *chosen* variant's
degradation + traffic mode (pace_model.season_curated_cli picked it), compute the
partial-residual cloud + fitted line for each model term, downsample it, and write
one compact JSON:

    agentic_f1_project_page/data/race-explainers-<year>.json

Run from the repo root:
    conda run -n basic python agentic_f1_project_page/build_race_explainers.py

Note: for the 3 races whose chosen variant is a front-runner (top_n) fit, the
panels here show the full-field refit — the term *shapes* are the same; the
headline coefficients on the page still come from the curated top_n fit.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # repo root, for pace_model

from pace_model.fit import fit_pace_model
from pace_model.race_loading import load_clean_race
from pace_model.variant_cache import load_or_fit_variants
from pace_model.visualize import partial_residual

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE = REPO_ROOT / "agentic_f1_project_page"
YEAR = 2026
MAX_POINTS = 160          # per panel — enough to read the cloud, small on the wire
RNG = np.random.default_rng(0)

COMPOUND_ORDER = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"]


def _r(v, dp=2):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, dp) if np.isfinite(v) else None


def _sample(idx: np.ndarray) -> np.ndarray:
    if len(idx) <= MAX_POINTS:
        return idx
    return np.sort(RNG.choice(idx, MAX_POINTS, replace=False))


def _bulk(presid: np.ndarray) -> np.ndarray:
    """indices whose residual sits in the 1st–99th percentile — one wild lap
    would otherwise flatten the whole panel (same clip pace_model.visualize uses)."""
    lo, hi = np.nanpercentile(presid, [1, 99])
    return np.where((presid >= lo) & (presid <= hi))[0]


def _linear_panel(model_df, X, model, fn, scale_info, col):
    """scatter of partial residuals vs `col` + the fitted straight line."""
    if col not in fn:
        return None
    presid = partial_residual(model_df, X, model, fn, [col])
    x = model_df[col].to_numpy(dtype=float)
    keep = _sample(_bulk(presid))
    coef = dict(zip(fn, model.coef_))
    mean, std = scale_info[col]
    xs = np.array([x.min(), x.max()])
    ys = coef[col] * ((xs - mean) / std)
    ys += presid.mean() - ys.mean()
    return {
        "points": [[_r(x[i]), _r(presid[i])] for i in keep],
        "line": [[_r(xs[0]), _r(ys[0])], [_r(xs[1]), _r(ys[1])]],
    }


def _tyre_panel(model_df, X, model, fn, scale_info, extra):
    # degradation_shape="linear" fits have no "tyre_age_sq"/"tyre_age_sq__<group>"
    # term at all (see fit_pace_model) — same guard as pace_model.visualize's
    # panel_tyre_age/panel_tyre_age_per_compound, which this mirrors.
    coef = dict(zip(fn, model.coef_))
    group_cols = [c for c in fn if c.startswith("tyre_age__")]

    if "tyre_age" in fn:                                   # shared curve
        quadratic = "tyre_age_sq" in fn
        tyre_cols = ["tyre_age", "tyre_age_sq"] if quadratic else ["tyre_age"]
        presid = partial_residual(model_df, X, model, fn, tyre_cols)
        age = model_df["tyre_age"].to_numpy(dtype=float)
        keep = _sample(_bulk(presid))
        tm, ts = scale_info["tyre_age"]
        xs = np.linspace(age.min(), age.max(), 24)
        curve = coef["tyre_age"] * ((xs - tm) / ts)
        if quadratic:
            sm, ss = scale_info["tyre_age_sq"]
            curve = curve + coef["tyre_age_sq"] * ((xs ** 2 - sm) / ss)
        curve += presid.mean() - curve.mean()
        return {
            "mode": "shared",
            "points": [[_r(age[i]), _r(presid[i]), model_df["compound"].iat[i]] for i in keep],
            "curves": [{"label": "all compounds", "compound": None,
                        "line": [[_r(a), _r(c)] for a, c in zip(xs, curve)]}],
        }

    if group_cols:                                         # one line per compound group
        presid = partial_residual(model_df, X, model, fn, group_cols)
        age = model_df["tyre_age"].to_numpy(dtype=float)
        groups = model_df["compound"].map(extra["compound_groups"])
        keep = _sample(_bulk(presid))
        tm, ts = scale_info["tyre_age"]          # per-group cols reuse the base scaling
        sm, ss = scale_info.get("tyre_age_sq", (0.0, 1.0))
        curves = []
        for g in sorted(set(groups.dropna())):
            col, sq = f"tyre_age__{g}", f"tyre_age_sq__{g}"
            if col not in coef:
                continue
            m = (groups == g).to_numpy()
            if not m.any():
                continue
            xs = np.linspace(age[m].min(), age[m].max(), 24)
            c = coef[col] * ((xs - tm) / ts)
            if sq in coef:
                c = c + coef[sq] * ((xs ** 2 - sm) / ss)
            c += presid[m].mean() - c.mean()
            curves.append({"label": g, "compound": g,
                           "line": [[_r(a), _r(v)] for a, v in zip(xs, c)]})
        return {
            "mode": "per_compound",
            "points": [[_r(age[i]), _r(presid[i]), model_df["compound"].iat[i]] for i in keep],
            "curves": curves,
        }

    return {"mode": "dropped"}   # collinear with laps_remaining this race


def _traffic_panel(model_df, X, model, fn, scale_info):
    if "closeness" in fn:
        p = _linear_panel(model_df, X, model, fn, scale_info, "closeness")
        return None if p is None else {"mode": "pooled", "series": [dict(p, label="all traffic", cls=None)]}

    split = [("closeness_battle", "battle"), ("closeness_lapping", "lapping")]
    cols = [c for c, _ in split if c in fn]
    if not cols:
        return None
    presid = partial_residual(model_df, X, model, fn, cols)
    coef = dict(zip(fn, model.coef_))
    tc = model_df["traffic_class"].to_numpy()
    series = []
    for col, cls in split:
        if col not in fn:
            continue
        m = (tc == cls)
        if not m.any():
            continue
        x = model_df.loc[m, col].to_numpy(dtype=float)
        pr = presid[m.to_numpy() if hasattr(m, "to_numpy") else m]
        keep = _sample(_bulk(pr))
        mean, std = scale_info[col]
        xs = np.array([x.min(), x.max()])
        ys = coef[col] * ((xs - mean) / std)
        ys += pr.mean() - ys.mean()
        series.append({
            "label": cls, "cls": cls,
            "points": [[_r(x[i]), _r(pr[i])] for i in keep],
            "line": [[_r(xs[0]), _r(ys[0])], [_r(xs[1]), _r(ys[1])]],
        })
    return {"mode": "split", "series": series}


def _overtake_panel(model_df, X, model, fn):
    if "overtake_mode" in fn:
        presid = partial_residual(model_df, X, model, fn, ["overtake_mode"])
        on = (model_df["overtake_mode"] == 1).to_numpy()
        return {"mode": "pooled", "groups": [
            {"label": "gap > 1.0 s", "on": False, "resid": [_r(v) for v in _pick(presid[~on])]},
            {"label": "overtake mode", "on": True, "resid": [_r(v) for v in _pick(presid[on])]},
        ]}

    cols = [c for c in ("overtake_mode_battle", "overtake_mode_lapping") if c in fn]
    if not cols:
        return None
    presid = partial_residual(model_df, X, model, fn, cols)
    on = model_df["overtake_mode"].fillna(False).astype(bool).to_numpy()
    tc = model_df["traffic_class"].to_numpy()
    groups = []
    for cls in ("battle", "lapping"):
        short = "fight" if cls == "battle" else "lapping"
        for tag, is_on, mask in ((f"{short}\n> 1 s", False, (tc == cls) & ~on),
                                 (f"{short}\novertake", True, (tc == cls) & on)):
            if mask.any():
                groups.append({"label": tag, "on": is_on,
                               "resid": [_r(v) for v in _pick(presid[mask])]})
    return {"mode": "split", "groups": groups}


def _pick(arr):
    arr = np.asarray(arr, dtype=float)
    if len(arr) > 8:
        lo, hi = np.nanpercentile(arr, [1, 99])
        arr = arr[(arr >= lo) & (arr <= hi)]
    if len(arr) <= MAX_POINTS:
        return arr
    return RNG.choice(arr, MAX_POINTS, replace=False)


def _compound_panel(deg_df):
    """Pace offset per compound vs the reference compound on a fresh (age 1) tyre — the fit's own
    offset_at_age1_sec (pace_model.summarize.add_fresh_offsets), so the bars are the dummy plus each
    compound's tyre-age curve read at its start, not the offset at the mean tyre age. A compound
    only 1-2 cars ran can't be separated from those cars' own pace — left off this panel."""
    is_ref = deg_df["compound"].str.startswith("(reference:")
    if not is_ref.any():
        return {"reference": None, "bars": []}
    ref = deg_df.loc[is_ref, "compound"].iloc[0][len("(reference: "):-1]
    rows = deg_df.assign(compound=deg_df["compound"].where(~is_ref, ref)).set_index("compound")
    present = [c for c in COMPOUND_ORDER if c in rows.index and rows.at[c, "n_drivers"] >= 3]
    if len(present) < 2:      # ~everyone on one compound (typical sprint) — no story here
        return {"reference": None, "bars": []}
    return {"reference": ref, "bars": [
        {"compound": c, "offset": _r(float(rows.at[c, "offset_at_age1_sec"]), 3),
         "low_support": False, "is_ref": c == ref} for c in present]}


def build(year: int = YEAR) -> dict:
    cur = REPO_ROOT / "analysis_out" / f"season_{year}_pace_curated"
    chosen = pd.read_csv(cur / "chosen_variant.csv")
    pkl_dir = REPO_ROOT / "race_data" / str(year)

    out = {}
    for _, row in chosen.iterrows():
        rid = row["race_id"]
        pkl = pkl_dir / f"{rid}.pkl"
        if not pkl.exists():
            print(f"  skip {rid} — no pkl")
            continue
        deg = row["degradation_choice"]
        traffic = row["traffic_choice"]
        shape = row["degradation_shape_choice"]
        print(f"  {rid}  ({deg} / {traffic} / {shape})")
        _race, df, _nm, _tm, _dg = load_clean_race(pkl)
        model, fn, mdf, X, si, extra = fit_pace_model(
            df, degradation_mode=deg, traffic_mode=traffic, degradation_shape=shape,
        )
        out[rid] = {
            "degradation_mode": extra["degradation_mode"],
            "traffic_mode": extra["traffic_mode"],
            "degradation_shape": extra["degradation_shape"],
            "fit_scope": row["fit_scope_choice"],
            "panels": {
                "tyre": _tyre_panel(mdf, X, model, fn, si, extra),
                "fuel": _linear_panel(mdf, X, model, fn, si, "laps_remaining"),
                "temp": _linear_panel(mdf, X, model, fn, si, "track_temperature"),
                "traffic": _traffic_panel(mdf, X, model, fn, si),
                "overtake": _overtake_panel(mdf, X, model, fn),
                "compound": _compound_panel(load_or_fit_variants(pkl, [row["chosen_label"]], verbose=False)
                                             .fits[row["chosen_label"]].degradation_df),
            },
        }
    return out


def main() -> None:
    data = {"season": YEAR, "races": build(YEAR)}
    dst = SITE / "data" / f"race-explainers-{YEAR}.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, separators=(",", ":")))
    print(f"\nWrote {dst.relative_to(REPO_ROOT)}  "
          f"({len(data['races'])} races, {dst.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
