# AI Stack Atlas — Architecture & Build Plan

## Context
This is a new public portfolio repo: a near-real-time market map of the AI economy, organized as a stack from Power at the bottom up to Applications. It has a cited dependency graph and a transparent shock-propagation simulator. It has to show data-engineering depth (pipeline, checks, lineage, CI) and also be a polished product UI. It starts empty, with nothing to reuse except my conventions from earlier projects (uv, Python 3.12, ruff, pytest, GitHub Actions).

**Facts checked on 2026-10-13 that change the seed list:**
- **SpaceX (SPCX):** it acquired xAI in Feb 2026 and IPO'd in June 2026 at about $1.78T. Your decision: SPCX is a live ticker with primary layer **Models**, and the segment split counts only its AI share.
- **Anthropic and OpenAI:** both filed confidential S-1s in June 2026 and neither has priced. They start as private nodes. The schema flips a company to a live ticker by setting `is_public: true` plus `ticker`, with no code change.
- **Cerebras:** it filed an S-1 in April 2026. I'll check its listing status in Phase 2.

**Pacing (your decision):** I stop for this plan and for the Phase 2 edge review. Phases 3–8 run straight through, with a commit and a report after each. I stop before creating the GitHub repo or pushing anything.

## Repo, tooling, conventions
- **Location:** `C:\Users\prana\Desktop\claude\ai-stack-atlas`. It is a standalone repo, run `git init` there, and later published as `github.com/pranavparuchur1/ai-stack-atlas`, only after you confirm.
- **Python:** 3.12 managed by uv. On this machine, prepend the pip-user Scripts dir to PATH and set `PYTHONIOENCODING=utf-8`.
- **Node:** 22. npm workspace in `web/`.
- **Commits:** conventional commits, one per phase. **No Co-Authored-By trailer**, per your standing rule.
- **Design skill:** the `frontend-design` skill is not installed in this environment. Instead I'll use the `dataviz` skill (palette validator, chart rules) and your saved design rules. Those rules: no templated cards, hairlines and typographic lists, one deliberate motion moment.

## Architecture
```
data/*.yaml (curated, cited, PR-able)          providers: yfinance (default) | Finnhub | Polygon (env keys)
        │                                                  │
        ▼                                                  ▼
 pipeline.validate.schemas (Pydantic)        pipeline.extract (prices, shares, revenue, FX) ── incremental by max(ts)
        └──────────────┬───────────────────────────────────┘
                       ▼
        pipeline.transform (FX→USD, market cap, layer attribution, analytics)
                       ▼
        pipeline.validate.checks (pandera + domain checks)  ── any FAIL → exit 1, nothing published
                       ▼
        pipeline.load → DuckDB (data/warehouse/atlas.duckdb, upserts)
                      → web/public/data/{snapshot_latest, analytics, prices_1y, backtests, lineage}.json + history/YYYY-MM-DD.json
                       ▼
        web/ (Vite+React static SPA on GitHub Pages) ── optional Finnhub WebSocket overlay (user key, localStorage)
```

**Key choices**
1. **A single propagation engine, written in TypeScript** (`web/src/engine/`). The browser runs both the simulator and the backtests on it. The pipeline only exports the backtest *inputs*: market caps at t−1, actual market-adjusted returns over windows of 1–5 days, and the edges that were known on the event date. That avoids two diverging implementations, and Vitest covers the engine.
2. **The backtests have no look-ahead.** A backtest uses only edges whose `evidence_date` is on or before the event date.
3. **Snapshot commits go to a `data` branch, not `main`.** Committing every 30 minutes would bury the portfolio history. `refresh-data.yml` commits to `data`. `deploy.yml` runs on `workflow_run`, because a push made with `GITHUB_TOKEN` can't trigger other workflows. It also runs on a push to main. It builds from main's code plus the `data` branch's `web/public/data/`. A seed snapshot is also committed to `main`, so a fresh clone works offline.
4. **The data contract is generated, not written twice.** Pydantic models are the source of truth. `pipeline export-schema` writes JSON Schema, then `json-schema-to-typescript` generates `web/src/types/generated.ts`. CI fails if the generated file is out of date.
5. **The JSON is split for performance.** `snapshot_latest.json` is small and loads on first paint. `prices_1y.json`, `analytics.json` and `backtests.json` load lazily by view. Each view is a lazy route chunk, which keeps Lighthouse at 90 or above even with D3 and Framer Motion.
6. **Every DuckDB write is an idempotent upsert** on its natural key. The extract step fetches only dates after `max(ts)` for each company, and does a full 1-year backfill on a cold start. CI restores the DuckDB file from `actions/cache` and falls back to a backfill if the cache is missing.

## File tree
```
ai-stack-atlas/
├─ pyproject.toml  uv.lock  .python-version  .pre-commit-config.yaml  .env.example  LICENSE  README.md
├─ config/
│  ├─ pipeline.yaml        # provider order, thresholds (private-valuation staleness days, price staleness)
│  └─ model.yaml           # per-relation elasticities, decay=0.5, max_hops=3, beta blend α, null-magnitude assumption
├─ data/
│  ├─ layers.yaml          # id, name, order, accent token
│  ├─ companies.yaml       # ~75 companies, 8–15 per layer
│  ├─ private_valuations.yaml
│  ├─ edges.yaml           # every edge cited
│  ├─ segments.yaml        # revenue-segment → layer weights for multi-layer cos (cited 10-K/S-1 segment notes)
│  └─ backtest_events.yaml # 3 verified historical events
├─ pipeline/
│  ├─ cli.py               # `uv run pipeline [run|backfill|check|export-schema]`
│  ├─ config.py  models.py # Pydantic entities (single source of truth)
│  ├─ extract/  {providers/base.py, yfinance.py, finnhub.py, polygon.py, prices.py, fundamentals.py, fx.py, curated.py}
│  ├─ transform/{fx_normalize.py, market_cap.py, attribution.py, analytics.py, backtest_inputs.py}
│  ├─ validate/ {schemas.py (pandera), checks.py, report.py}
│  └─ load/     {warehouse.py (DuckDB DDL + upserts), snapshot.py (atomic write), lineage.py}
├─ tests/                  # pytest; fake provider fixture → zero network
├─ web/
│  ├─ package.json vite.config.ts tailwind tokens, eslint, vitest, playwright.config.ts
│  ├─ public/data/         # seed snapshot (main) / live snapshots (data branch)
│  └─ src/
│     ├─ engine/ {propagate.ts, channels.ts, why.ts, backtest.ts, *.test.ts}
│     ├─ state/  (zustand stores: selection, scenario, settings, live)
│     ├─ data/   (TanStack Query loaders), live/finnhub.ts
│     ├─ components/ (TickerTape, LayerBand, CompanyTile, Drawer, Tooltip, Disclaimer…)
│     └─ views/  {Stack, Network, Flow, Simulator, Analytics, Health}
├─ docs/ methodology.md  data_dictionary.md  adding_a_company.md
└─ .github/workflows/ ci.yml  refresh-data.yml  deploy.yml
```

## Data schema (DuckDB, exported as JSON)
These are the spec's entities. **Additions are marked ✚, each with its reason.**

| Table | Columns |
|---|---|
| `layers` ✚ | id, name, order, accent |
| `companies` | id, name, ticker, exchange, currency, is_public, primary_layer, secondary_layers[], hq_country, logo_url, ✚`listing_note` (e.g. "ADR", "KRX common") |
| `prices` | company_id, ts, price, market_cap_usd, source, ✚`price_ccy`, ✚`fx_rate`, ✚`granularity` (daily/intraday). PK (company_id, ts, granularity) |
| `fundamentals` ✚ | company_id, as_of, shares_outstanding, revenue_ttm_usd, source. Market cap needs shares, and the revenue-exposure channel needs revenue. |
| `fx_rates` ✚ | currency, date, usd_per_unit, source |
| `private_valuations` | company_id, valuation_usd, as_of_date, round, source_url |
| `segments` ✚ | company_id, layer_id, share, fiscal_year, source_url. Shares must sum to 1. |
| `edges` | source_id, target_id, relation_type, direction, magnitude_usd, magnitude_basis, confidence, evidence_url, evidence_date, notes, ✚`stake_pct` (equity_stake only, nullable). Mark-to-market needs a %, and most deals report only dollars invested. |
| `events` | id, name, type, params (JSON), created_at |
| `analytics_*` ✚ | daily_returns, layer_index (cap-weighted), correlation, beta (company × layer), vol_60d |
| `pipeline_runs` ✚ | run_id, started_at, finished_at, status, row_counts, check_results. This feeds `lineage.json`. |

- **Enums:** the spec's `relation_type` and `confidence` lists, plus `direction ∈ {supplies_to, invests_in, buys_from}`. `magnitude_basis ∈ {contract_total, annual_run_rate, capex_commitment, investment_amount, ppa_capacity_value, null}`.
- **No fabricated figures.** If no figure is public, then `magnitude_usd = null`, `confidence = estimated`, and the reasoning goes in `notes`.

**Layer attribution.** The *primary* mode puts each company's whole market cap into its primary layer, so nothing is counted twice. The *segment* mode computes cap × segment share for each layer. For SPCX, segments.yaml assigns only the share disclosed for its AI segment to Models. In both modes the layer totals must reconcile to the sum over all companies; that is a check.

## Data quality checks (any FAIL exits 1 and leaves the previous snapshot in place)
**Spec checks:**
- No negative market caps (FAIL)
- Every edge's endpoints exist (FAIL)
- Every edge has an evidence URL that is a valid http(s) URL (FAIL)
- FX rates are present for every non-USD listing on every date used (FAIL)
- A private valuation older than N days only WARNS
- Layer totals reconcile in both attribution modes (FAIL)

**Additions:**
- No duplicate edges, and no edge from a company to itself
- `evidence_date` is not in the future
- `confidence=estimated` is required when `magnitude_usd` is null
- Segment shares sum to 1 (within 1e-6)
- Every company has a price or a private valuation
- A stale latest price, more than 3 trading days old, WARNS
- A one-day market-cap jump above 60% WARNS, because it usually means bad shares data

Results go to `lineage.json` and the Pipeline Health view.

## Analytics (pipeline)
1-year daily returns; cap-weighted layer indices; correlation matrix; beta of each company to each layer index; rolling 60-day volatility. Private companies are excluded from the price analytics, which is documented. In the simulator they use only the graph channels.

## Propagation model (`web/src/engine`, documented in docs/methodology.md)
1. **Mechanical channel.** Holders of an equity stake take the change as `stake_pct × ΔV_target / holder_mcap`. When `stake_pct` is unknown, the edge is shown but skipped, and the "why" text flags it.
2. **Revenue-exposure channel.** `Δ%_i = elasticity[relation] × (magnitude_usd / revenue_i) × shock%`. Demand shocks travel upstream and supply shocks travel downstream. A null magnitude uses an explicit, labelled assumption from `model.yaml`; it is never presented as data.
3. **Spillover.** BFS by hop with `decay^hop`, up to `max_hops`, with weights normalized across outgoing edges. The result is blended with `β_{i, layer(source)} × shock%` using weight α.
4. **Output for each affected company:** %, $Δ, hop count, the channel, and a "why" chain built from edge templates with source links.
5. **Sliders** for elasticities, decay, hops and α, recomputed live.
6. A persistent disclaimer.

**Backtest mode:** I'll verify 3 candidate events in Phase 6:
- DeepSeek-R1 selloff, 2025-01-27
- OpenAI–AMD deal, 2025-10-06
- Oracle–OpenAI compute contract, 2025-09-10

The backtest compares predicted moves with actual SPY-adjusted returns over 1–5 days, and shows MAE, the share with the right direction, and Spearman rank correlation.

## Frontend
- **Libraries:** Vite, React, TypeScript, Tailwind, D3 (force, sankey, hierarchy), Zustand, TanStack Query and Framer Motion. HashRouter, because the site is static on Pages.
- **Concept:** a geological cross-section. The six layers are strata stacked bottom-up, and the same layer colour runs through every view.
- **Look:** dark terminal theme plus a light mode, tabular monospace numerals, hairline rules, dense tables.
- **Palette:** six layer colours validated for colour-vision deficiency with the dataviz validator. No single neon accent.
- **Motion:** one deliberate moment, the shock rippling hop by hop. Elsewhere only the flash on a live tick.
- **Views:** the 6 views and the Drawer from the spec.
- **Keyboard:** ←/→ cycles companies, Enter opens the Drawer, Esc closes it, `/` searches.
- **Responsive:** down to 768px.

**Live mode.** You paste a Finnhub key in Settings. It is stored only in `localStorage`, inside try/catch. The site then opens a WebSocket and subscribes to at most 50 US symbols, the free-tier cap, which I'll verify. Non-US listings stay on the snapshot. Each tick recomputes market cap from price × the shares in the snapshot and flashes the change. The indicator shows LIVE, or "Snapshot · updated N min ago".

## Phases (one commit each)
1. **Plan.** This document. ✅ once you approve it.
2. **Graph research.** Web-verify every ticker and its public/private status, then write the YAML with citations, including segments.yaml. ⛔ STOP: I show you a summary table of the edges to review.
3. **Pipeline.** Extract, transform, validate and load; analytics; snapshots and lineage; pytest at ≥80% coverage; `refresh-data.yml`.
4. **Design system, app shell and Stack View**, on real data.
5. **Network View and the Company Drawer.**
6. **Event Simulator and backtests**, plus Vitest for the engine.
7. **Sankey, Analytics, Pipeline Health and live mode.**
8. **Polish.** README with a Mermaid diagram and a GIF, the docs, the Playwright smoke test, `ci.yml` and `deploy.yml`, and Lighthouse CI. Then a skeptical review that lists the 10 biggest weaknesses and fixes them. ⛔ I stop before creating the remote and pushing.

## Verification
- **Pipeline:** `uv run pipeline` with no keys produces the JSON outputs and all checks pass. `uv run pytest --cov=pipeline` reaches ≥80%. ruff and `mypy --strict` are clean.
- **Web:** `npm run dev` in the browser preview, then click a company. The Drawer must show its edges with evidence links one click away. Then run "Anthropic IPO at $X" and check the ranked table spans 4 or more layers, each row with a "why" chain and sources.
- **Tests and lint:** Vitest for the engine, the Playwright smoke test (load → company → IPO → table), eslint and tsc.
- **Lighthouse:** at least 90 on the preview build.
- **Fabrication audit:** a script lists every numeric figure in data/*.yaml next to its source URL, so you can spot-check it in Phase 2.
