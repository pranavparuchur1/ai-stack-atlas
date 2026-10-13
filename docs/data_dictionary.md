# Data dictionary

Source of truth: `pipeline/models.py` (Pydantic). JSON Schemas for every published file are in
`schema/` (`uv run pipeline export-schema`), and the web app's TypeScript types are generated
from them (`npm run types` in `web/`).

## Curated inputs (`data/`)

### companies.yaml → `companies`
| Field | Type | Notes |
|---|---|---|
| id | str `[a-z0-9]+` | stable key used everywhere |
| name | str | |
| ticker | str \| null | yfinance convention: `NVDA`, `000660.KS`, `8035.T`, `SU.PA`; null if private |
| live_symbol | str \| null | US symbol for the live WebSocket when the priced ticker is foreign (e.g. `SKHY`) |
| exchange | str \| null | |
| currency | ISO 4217 | currency of `ticker`'s quote |
| is_public | bool | flip to `true` + add `ticker` when a company IPOs |
| primary_layer | layer id | the one layer its full cap counts in |
| secondary_layers | [layer id] | graph tags + segment mode only |
| hq_country | ISO 3166 alpha-2 | |
| logo_url | str \| null | |
| listing_note | str \| null | ADR ratios, share classes, recent IPOs |

### private_valuations.yaml → `private_valuations`
| Field | Type | Notes |
|---|---|---|
| company_id | id | |
| valuation | float > 0 | in `currency` |
| currency | ISO 4217 | converted to USD at the FX rate on `as_of_date` |
| basis | str | `post_money` |
| as_of_date | date | date the round closed/was reported |
| round | str | |
| source_url | URL | |
| confidence | enum | reported \| credible_press \| estimated |
| notes | str \| null | |

### edges.yaml → `edges`
| Field | Type | Notes |
|---|---|---|
| source_id, target_id | id | `source <direction> target` |
| relation_type | enum | equity_stake, compute_contract, chip_supply, memory_supply, foundry, equipment_supply, power_ppa, cloud_hosting, distribution_partnership, revenue_customer |
| direction | enum | `supplies_to` (money flows target → source) \| `invests_in` (equity_stake only) |
| magnitude_usd | float ≥ 0 \| null | only when publicly reported |
| magnitude_basis | enum \| null | contract_total \| monthly_run_rate \| investment_amount \| stake_value — required iff magnitude set |
| stake_pct | 0–1 \| null | equity_stake only, when reported |
| supplier_revenue_share | 0–1 \| null | share of the supplier's revenue (e.g. 10-K major-customer tables) |
| confidence | enum | evidence for the relationship: reported \| credible_press \| estimated |
| evidence_url | URL | required |
| evidence_date | date | when the source reported it (≤ today) |
| notes | str (≥ 10 chars) | must explain any undisclosed figure |

Primary key `(source_id, target_id, relation_type)`.

### segments.yaml → `segments`
`company_id, fiscal_year, source_url, notes, shares: {layer_id | other: fraction}` — shares sum to 1.

### backtest_events.yaml → `events`
`id, name, date, effective_date (first session able to react), description, source_url,
prior_source_url, scenario {company_id, type, pct, valuation_usd, prior_valuation_usd}`.

## Warehouse (`data/warehouse/atlas.duckdb`)

| Table | Key | Content |
|---|---|---|
| layers, companies, edges, private_valuations, segments | natural keys | curated data, replaced each run |
| raw_prices | (ticker, date) | close in listing currency, source, loaded_at |
| fx_rates | (currency, date) | USD per unit |
| fundamentals | (company_id, as_of) | shares (listing units), revenue TTM (+ USD) |
| prices | (company_id, ts, granularity) | price, price_ccy, fx_rate, market_cap_usd, source |
| events | id | saved scenarios (seeded from backtest events): type + params JSON |
| pipeline_runs | run_id | status, as_of, row counts, check results |

## Published files (`web/public/data/`)

| File | Model | Content |
|---|---|---|
| snapshot_latest.json | `Snapshot` | layers with totals in both modes, companies with marks, edges |
| history/YYYY-MM-DD.json | `Snapshot` | one per trading day (last run of the day) |
| analytics.json | `Analytics` | layer index series, correlation matrix, betas, corr-to-layer, vol, 1y returns |
| prices_1y.json | `PriceSeries` | daily close and USD cap per listed company |
| model.json | `ModelParams` | propagation-model defaults (from `config/model.yaml`) |
| backtests.json | `Backtests` | per event: pre-event caps, market-adjusted 1/3/5-day returns, allowed edge ids |
| lineage.json | `Lineage` | run status, sources, row counts, checks, lineage DAG, recent runs |
