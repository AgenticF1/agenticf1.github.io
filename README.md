# AgenticF1 (website)

Static site, no build step for the blog. The **Season pace** page has a data
build (below). Deploys as-is to GitHub Pages (serve this folder as the site
root, or set Pages to the `agentic_f1_project_page/` subdirectory).

## Layout

```
index.html            Post index. Renders posts/posts.json, tag filter.
about.html             What the project is + how the model works.
season-pace.html       Per-race driver/team pace for the season + per-race fit choice.
race.html              ?r=<race_id> — one race's full breakdown (8-variant comparison).
pace-whatif.html       #race=<race_id> — drag the estimated coefficients, watch pace move.
data/*.json            Season-pace + what-if data, written by build_season_pace.py.
build_season_pace.py   Reads analysis_out/ → data/season-2026-pace.json + data/pace-whatif-2026.json.
posts/posts.json       The post manifest — single source of truth for the index.
blog/*.html            One file per post.
templates/
  head.html            Shared <head> markup (copy per page, fix asset paths).
  post-template.html    Starting point for a new post.
assets/
  css/
    tokens.css         All colours / spacing / type steps / radii. Edit here first.
    base.css           Reset + element defaults + reusable text levels (.t-*).
    layout.css          Page frame: header, footer, container, grids, side rail.
    components.css      Cards, chips, tags, tables, findings, buttons, post list.
    blog.css            Article-only styles (loaded on post + about pages).
  js/
    theme.js            system / light / dark toggle (localStorage), fires `themechange`.
    nav.js              Mobile nav + current-page highlight.
    toc.js              Builds the side-rail table of contents + scrollspy.
                        Picks up `.part[id]` as group headings and
                        `.section-head[id]` / `h2[id]` as entries.
    posts.js            Renders the index list and tag filter from posts.json.
    charts.js           The shared ECharts layer. Every article chart goes through it:
                        F1Charts.make(el,{group}) inits a token-themed instance and
                        registers it; F1Charts.onReady(draw) runs draw() now and again
                        after each theme switch (old instances disposed first);
                        F1Charts.team("McLaren") / F1Charts.teams is the one canonical
                        2026 team-colour map; F1Charts.zoom() a themed dataZoom pair.
                        F1Charts.svgZoom(svgEl) adds wheel-zoom + drag-pan +
                        dbl-click-reset to a hand-drawn inline <svg> figure.
                        F1Charts.team("McLaren") a livery colour; .lighten/.darken
                        shift a hex; .driverColors(acrs, {ACR:team}) gives each
                        driver their team colour, lightening the 2nd of a pair.
                        Load it NON-deferred, after ECharts, before the per-post script.
    math.js             Render LaTeX with KaTeX, themed via the tokens. Static:
                        <div data-tex="\\Delta t = ...">. Dynamic: F1Math.tex(el, src).
                        Colour a term theme-safely with \\htmlClass{tex-accent}{...}
                        / {tex-neg}. Load KaTeX (cdnjs 0.16.x, JS + CSS) then math.js
                        on posts with equations.
```

The article table of contents renders into the LEFT side rail
(`.with-rail__rail`), compact (11px) with auto-numbered entries and `.part`
group headings; `--content` (800px) is the shared body width for the index and
every article.

CSS load order is always: `tokens → base → layout → components → [blog]`.

## Add a post

1. `cp templates/post-template.html blog/2026-09-19-hungary-degradation.html`
2. Fill in title, dek, byline, sections. Delete the chart block if unused.
3. Add an entry to `posts/posts.json`:

   ```json
   {
     "title": "Where Hungary's tyres went",
     "date": "2026-09-19",
     "url": "blog/2026-09-19-hungary-degradation.html",
     "dek": "One line stating the finding.",
     "tags": ["race", "hungary", "tyres", "2026"]
   }
   ```

   Set `"draft": true` to keep it out of the index while you work.

## Design rules (keep these)

- Neutral cool greys; one muted steel-blue accent. No pure black, no saturated
  reds/greens — `--pos` / `--neg` are muted on purpose.
- No shadows, and no card outlines: `.card` is borderless, separation is the
  `--surface` / `--bg` background step. `.card--outline` exists if ever needed.
- F1 team colours (charts only) come from `F1Charts.teams` — the saturated 2026
  livery hex values, the one exception to the muted-palette rule, and only inside
  a chart.
- Structural dividers: `.part` uses a 2px accent rule, `.section-head` a 2px
  `--ink` rule; body separation is one hairline `--line`.
- No emoji.
- Type comes from the `.t-*` levels and the `--step-*` scale, not ad-hoc sizes.
- Every colour must be a `var(--token)` — never a literal hex in a component.
- Keep each file short. New component → new block in `components.css`, or a new
  file if it is a page type of its own.

## Season pace page

`season-pace.html`, `race.html` and `pace-whatif.html` all read JSON from
`data/`, rebuilt by `build_season_pace.py` from the analysis pipeline. Run
order (from the repo root, in the `basic` env):

```
python -m pace_model.season_curated_cli --year 2026        # per-race 8-variant selection (slow)
python -m pace_model.whatif_cli --year 2026                 # the what-if slider payload
python agentic_f1_project_page/build_race_explainers.py     # → data/race-explainers-2026.json (refits the chosen variant per race)
python agentic_f1_project_page/build_season_pace.py         # → data/season-2026-pace.json + data/pace-whatif-2026.json
```

`build_race_explainers.py` produces the per-term partial-residual clouds that
`race.html` Section 04 ("How each effect was fitted") re-draws natively — a
web port of `pace_model.visualize`'s `model_explainer.png`. `build_season_pace.py`
also merges an optional hand-curated `data/race_insights_2026.json` (the "What
stood out" bullets — see `todo/season_pace_race_insights_spec.md`) if present.

`season.css` / `whatif.css` are the page-type stylesheets; `season-pace.js`,
`season-race.js`, `pace-whatif.js` the renderers. Charts go through the shared
`F1Charts` layer like every other chart on the site.

## Local preview

`fetch()` (used by `posts.js`) needs HTTP, not `file://`:

```
cd agentic_f1_project_page && python -m http.server 8000
# open http://localhost:8000
```

## Existing post

`blog/2026-09-05-nobody-qualified-on-pace.html` is generated, not hand-written:
its builder lives at
`session_specific_analysis/2026-09-05_monza_quali_slipstream_blog/build2.py`
(reads the `*.json` beside it, writes this file directly). It is fully on the
shared suite — the only page-local code is the per-post chart `<script>` at the
end of the body, which is inherent per-post work. Re-run `build2.py` to
regenerate; don't hand-edit the HTML.
