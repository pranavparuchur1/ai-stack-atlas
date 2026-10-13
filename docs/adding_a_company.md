# Adding a company or a relationship

Pull requests that add well-sourced edges are welcome. The bar is simple: **every edge needs a
public source, and no number goes in that the source does not state.**

## 1. Add the company — `data/companies.yaml`

```yaml
- {id: lambda, name: Lambda, ticker: null, exchange: null, currency: USD, is_public: false,
   primary_layer: cloud, secondary_layers: [], hq_country: US}
```

* `id`: lowercase letters/digits, unique.
* Listed companies: `ticker` in yfinance form (`NVDA`, `000660.KS`, `8035.T`, `SU.PA`) and the
  quote `currency`. Check it returns a price: `uv run python -c "import yfinance as y; print(y.Ticker('TICKER').info['currentPrice'])"`.
* Private companies: add a row to `data/private_valuations.yaml` with the last **closed, priced**
  round and its source. Reported talks don't count.
* If it's a conglomerate, consider a revenue-segment split in `data/segments.yaml`.

## 2. Add relationships — `data/edges.yaml`

```yaml
- source_id: crwv          # the supplier (or the investor, for equity_stake)
  target_id: openai        # the customer (or the investee)
  relation_type: compute_contract
  direction: supplies_to   # invests_in for equity_stake
  magnitude_usd: 22400000000      # ONLY if the source states it; else null
  magnitude_basis: contract_total # contract_total | monthly_run_rate | investment_amount | stake_value | null
  confidence: reported     # reported (company filing/release) | credible_press | estimated
  evidence_url: https://...
  evidence_date: 2025-09-25  # date of the source
  notes: Up to $11.9B + $4B + $6.5B = ~$22.4B total per CoreWeave. Ceilings, not guaranteed spend.
```

Rules the pipeline enforces (`uv run pipeline check`, also a pre-commit hook):

* both companies exist; no duplicates or self-loops;
* `evidence_url` is a URL and `evidence_date` is not in the future;
* `magnitude_usd` and `magnitude_basis` are set together; `stake_pct` only on equity stakes;
* if the value is undisclosed, `notes` must say so (and why it matters).

Conventions:

* Prefer primary sources (SEC filings, company newsrooms) over press; prefer press over blogs.
* Multi-year totals stay totals — the model annualises them; don't pre-divide.
* "Up to" figures are recorded with that caveat in `notes`.
* Analyst estimates are not magnitudes; put them in `notes` if useful.

## 3. Check it

```bash
uv run pipeline check      # curated data only, no network
uv run pytest -q
uv run pipeline            # full run with prices
```

Then open the Network view and the company's drawer to make sure it reads correctly.
