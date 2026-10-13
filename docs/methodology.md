# Methodology

How AI Stack Atlas turns prices, filings and press releases into layer totals, a dependency
graph and a shock simulator — and how far you should trust each piece.

> **Illustrative model, not a forecast or financial advice.**

---

## 1. The stack

Seven layers, bottom to top: **Power & Energy → Data Center Infra → Semicap & Foundry (3a) →
Chips & Memory (3b) → Cloud & Hyperscalers → Foundation Models → Applications**
(`data/layers.yaml`). 67 companies (`data/companies.yaml`): 57 listed, 10 private.

Every company has exactly one **primary layer** and optional **secondary layers**.

### Attribution modes (the header toggle)

| Mode | Rule | Why |
|---|---|---|
| **Primary layer** (default) | 100% of a company's market cap counts in its primary layer. | No double counting; layer totals sum to the stack total. |
| **By segment** | Market cap × the share of revenue each reported segment represents, mapped to layers (`data/segments.yaml`). Revenue outside the AI stack (Amazon retail, Starlink, Samsung phones…) goes to an *outside the stack* bucket, shown but never drawn in a band. | Shows how much of a conglomerate's value is "AI stack" by its own segment reporting. |

Both modes reconcile to the same company total — this is a pipeline check
(`layer_totals_reconcile`). Segment shares are revenue shares, not profit or value shares; e.g.
Meta and Alphabet move almost entirely to *Apps* in segment mode because their revenue is
advertising, and Samsung's semiconductor division is counted wholly as *Chips* because Samsung
does not report foundry revenue separately. SpaceX (which absorbed xAI in Feb 2026) has
primary layer *Models* by design; segment mode counts only its reported AI segment (17% of
2025 revenue).

## 2. Market data pipeline

```
data/*.yaml ──► Pydantic validation ─┐
yfinance bars / FX / fundamentals ───┤──► DuckDB (idempotent upserts) ──► transforms ──► 15 checks ──► JSON
optional Finnhub / Polygon quotes ───┘                                                     (FAIL = nothing published)
```

* **Prices:** daily closes from yfinance for every listed company; with `FINNHUB_API_KEY` or
  `POLYGON_API_KEY` set, fresher quotes overwrite today's bar for US listings.
* **Incremental loads:** each run fetches only from the earliest last-loaded date minus a 5-day
  overlap (revisions are upserted on `(ticker, date)`); a cold start backfills 400 days.
* **Shares:** `marketCap / currentPrice` from Yahoo's quote summary, which keeps the count in the
  listing's own units — ADR-equivalent for TSMC, all share classes for Alphabet and SpaceX.
* **Market cap (USD)** = close × shares × FX. FX is `CCY→USD` from yfinance, as-of joined
  backward so a Seoul session on a US holiday still has a rate. KRW (SK hynix, Samsung), JPY
  (Tokyo Electron) and EUR (Schneider) listings are converted; revenue reported in TWD/EUR is
  converted the same way.
* **Private companies** are marked at their last *closed, priced* round
  (`data/private_valuations.yaml`), converted at the FX rate on the round date. Reported talks
  are deliberately excluded. Rounds older than 365 days raise a WARN.

### Data-quality checks (`pipeline/validate/checks.py`)

| Check | Level | |
|---|---|---|
| edges_reference_companies | FAIL | every edge endpoint exists |
| edges_have_evidence | FAIL | every edge has an http(s) evidence URL |
| edges_unique_and_not_self | FAIL | no duplicates / self-loops |
| undisclosed_magnitudes_explained | FAIL | a null $ value must come with a note saying why |
| layers_and_segments_valid | FAIL | layers resolve; segment shares sum to 1 |
| private_companies_have_valuation | FAIL | |
| evidence_not_in_future | FAIL | |
| frame_schemas | FAIL | pandera schemas for raw prices, FX and marks |
| no_negative_market_caps | FAIL | |
| every_company_marked | FAIL | every company has a cap or valuation |
| fx_present | FAIL | FX for every non-USD listing on every priced date |
| layer_totals_reconcile | FAIL | both attribution modes sum to the company total |
| private_valuations_fresh | WARN | > 365 days old |
| prices_fresh | WARN | latest price > 4 calendar days old |
| no_implausible_jumps | WARN | 1-day move > 60% (usually bad share data) |

A note on `confidence`: the brief asked for `confidence = estimated` whenever a magnitude is
undisclosed. The atlas instead uses `confidence` for **how well-evidenced the relationship
itself is** (a Constellation–Microsoft PPA is *reported* even though its price is not), and
treats an undisclosed magnitude as its own, explicitly checked state. Collapsing the two would
draw well-documented contracts as dashed "estimated" lines.

### Analytics

On daily **USD market-cap returns** over the last 12 months (dates where ≥ 50% of companies
traded; gaps ≤ 3 days forward-filled):

* **Layer index** — cap-weighted with the previous day's caps:
  `r_L,t = Σ_i w_i,t−1 · r_i,t`, level = 100 · Π(1 + r_L).
  *Listed companies only.* The Models index is SpaceX alone (listed June 2026).
* **Correlation** — pairwise Pearson, ≥ 60 shared observations.
* **Beta** of company *i* to layer *L*: `cov(r_i, r_L) / var(r_L)`.
* **Volatility** — rolling 60-day standard deviation × √252.

Dividends are ignored; share counts are held constant over the window.

## 3. The dependency graph

118 edges in `data/edges.yaml`, each with an `evidence_url` and `evidence_date`, a relation type
(`equity_stake, compute_contract, chip_supply, memory_supply, foundry, equipment_supply,
power_ppa, cloud_hosting, distribution_partnership, revenue_customer`) and confidence
(`reported` = company filing/release, `credible_press`, `estimated`). Magnitudes are recorded
only when publicly reported, with their basis (`contract_total`, `monthly_run_rate`,
`investment_amount`, `stake_value`); 79 of 118 are undisclosed and stay null.
`docs/fabrication_audit.md` lists every figure next to its source.

## 4. Propagation model

Implemented once, in TypeScript (`web/src/engine/`), and used by the simulator, the drawer's
exposure lists and the backtests. All parameters live in `config/model.yaml` (published as
`model.json`) and can be changed with the simulator's sliders.

### 4.1 Edge sensitivities (`channels.ts`)

How much a 1.0 move in company *F* moves neighbour *T* through one cited edge:

| Mechanism | Direction | Weight |
|---|---|---|
| **Mark-to-market** | investee → investor | `stake × cap_investee / cap_investor` |
| **Demand** (revenue exposure) | customer → supplier | `elasticity[rel].up × min(1, annual_contract / revenue_supplier)` |
| **Supply** | supplier → customer | `elasticity[rel].down × min(1, annual_contract / revenue_customer)` |

* `annual_contract` = contract total ÷ `contract_years` (5), or monthly run-rate × 12.
  Investment amounts are not revenue.
* A reported supplier revenue share (e.g. Meta = 21% of Arista revenue) is used directly.
* **Undisclosed contract value** → assumed `null_magnitude_share` (2%) of the party's revenue.
* **Undisclosed stake %** → `invested amount ÷ current value of the investee` — a deliberate
  floor (the stake has usually appreciated). Contingent warrants with no size are skipped.
* Every assumption used is printed next to the step in the why-chain. None are silent.

### 4.2 Scenarios (`propagate.ts`)

| Event | Source's own move | Signals emitted |
|---|---|---|
| IPO at valuation *V* | `V / last_round − 1` | mark-to-market to holders; demand = move × `valuation_to_demand` |
| Valuation change / earnings ±x | x | same as IPO |
| Demand shock (capex change ±x) | 0 (no assumed own-price move) | demand = x |
| Supply shock (capacity −x) | −x | mark-to-market; supply = −x |

### 4.3 Hops

* **Hop 1:** direct channels.
* **Hops 2…`max_hops` (3):** every reached company re-emits the mechanism that reached it,
  multiplied by `decay` (0.5) per extra hop. Mark-to-market travels only to further holders,
  demand only upstream, supply only downstream. Paths are simple; each company expands once
  (at its shortest hop), but receives every contribution that reaches it within `max_hops`.
* **Empirical channel (hop ≥ 2 only):**
  `pct = (1 − α) · graph + α · β_i,layer(S) · move_S · cap_S / Σ cap_listed(layer S)`,
  α = `beta_blend` (0.3). It exists only when the source is **listed** — betas were estimated on
  indices of listed companies, which a private round or IPO is not part of.
* **Output** per company: modelled %, $ change (= % × cap), hop, the contributions (each a path
  of cited edges) and the layer-level $ waterfall.

### 4.4 Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `elasticity[rel].up/down` | 0.3–1.0 | pass-through per relation and direction |
| `decay` | 0.5 | per extra hop |
| `max_hops` | 3 | |
| `beta_blend` | 0.3 | weight of the empirical channel (hop ≥ 2, listed sources) |
| `valuation_to_demand` | 0.1 | a +10% valuation reads as +1% demand for suppliers (see §5) |
| `contract_years` | 5 | annualisation of multi-year totals |
| `null_magnitude_share` | 2% | assumed exposure for undisclosed contracts |

## 5. Backtests

Three verified 2026 events (`data/backtest_events.yaml`), replayed **without look-ahead**: only
edges with `evidence_date ≤ event date`, market caps from the prior close, and the empirical
beta channel switched off (betas are estimated on returns *after* these events, so using them
would be look-ahead). All replay inputs are frozen in `backtests.json`, which is rebuilt only
when the events, edges, companies or private valuations change. Predictions are
compared with **market-adjusted returns** (stock − SPY) over 1, 3 and 5 sessions, against a
**do-nothing baseline** that predicts 0% for every company.

Results with the default parameters (companies the model moved that are listed):

<!-- backtest:start -->
| Event | Window | n | Model MAE | Do-nothing MAE | Direction right | Spearman ρ |
|---|---|---|---|---|---|---|
| Anthropic Series H at $965B | 1d | 20 | 1.64% | 1.65% | 83% | 0.34 |
| OpenAI raises $110B at $730B pre-money | 1d | 24 | 4.57% | 4.04% | 9% | −0.41 |
| Alphabet raises 2026 capex guidance | 1d | 10 | 1.58% | 1.96% | 100% | 0.78 |
| **Pooled** | 1d | 54 | 2.93% | 2.77% | 45% | 0.02 |
| **Pooled** | 3d | 54 | 7.79% | 7.59% | 40% | 0.08 |
| **Pooled** | 5d | 54 | 8.46% | 8.46% | 50% | 0.06 |
<!-- backtest:end -->

_Generated from the committed snapshot by `npm run backtest:report` (web/); a test fails if this table drifts._

**Reading this honestly**

* The model **does not beat doing nothing** on pooled error. Its predicted moves are small
  (tenths of a percent) against event-window noise of several percent.
* The **capex shock** is the one case with real signal: on the first session every supplier moved
  in the predicted direction and the ranking correlates (ρ = 0.78, n = 10).
* **Valuation rounds at private labs** carry little next-day information for suppliers: the
  Anthropic round was reported a month earlier; on the OpenAI round, CoreWeave fell 18% the next
  day while the model predicted a small gain.
* `valuation_to_demand` was lowered from 0.5 → 0.1 after these runs (0.05–0.1 scored best).
  That is calibration on the evaluation set — with n = 3 events, treat all of this as a sanity
  check, not validation.
* Remaining look-ahead in the replay: revenue (TTM as of the build) and share counts are not
  point-in-time.

## 5b. Value flow

The Sankey draws only disclosed, revenue-type contracts, annualised as above, from payer to
supplier. Flows that run *up* the stack (e.g. NVIDIA buying CoreWeave capacity) and the 69
relationships without a disclosed value are listed beside it rather than guessed.

## 6. Design

The seven layer colours alternate dark/light band to band, like geological strata. That
alternation is also what keeps adjacent layers separable under colour-vision deficiency. The
palette was checked with a computational validator (OKLCH lightness band, chroma floor,
adjacent-pair CVD ΔE ≥ 8 under protan/deutan simulation, normal-vision ΔE ≥ 15, ≥ 3:1
contrast) separately for the dark (`#0d0f12`) and light (`#f6f5f1`) surfaces; both pass.
Identity is never colour-alone: every band and series is labelled. The only animation besides
live-tick flashes is the simulator's hop-by-hop ripple, and it respects `prefers-reduced-motion`.

## 7. Limitations

* **Coverage, not completeness.** 118 relationships are the well-documented ones; most supply
  relationships (e.g. NVIDIA's customers) are not publicly itemised. Absence of an edge is not
  evidence of no relationship. Six companies currently have none.
* **Evidence dates ≠ start dates.** `evidence_date` is when a source reported a relationship,
  which can be long after it began (TSMC–NVIDIA). The backtest filter is therefore conservative.
* **Constant shares** over the 1-year window; buybacks and issuance drift.
* **Private marks are stale by construction** (last priced round); five are > 1 year old.
* **Revenue exposure uses TTM revenue** for every company, including fast-growing ones.
* **Undisclosed values** default to a 2% revenue-exposure assumption — labelled everywhere, but
  it is still an assumption.
* **Models layer index** = SpaceX alone, since June 2026.
* yfinance is an unofficial API; the pipeline fails loudly (checks) rather than publishing gaps.
