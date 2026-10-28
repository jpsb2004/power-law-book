# The Power Law Book

## Thesis initiation report: quantifying the physical bottlenecks of the global AI CapEx supercycle

**Live page:** https://jpsb2004.github.io/power-law-book/
· **Interactive dashboard:** https://beyondthehyperscalersjpsb.streamlit.app/
· **Daily note:** [`latest_briefing.md`](latest_briefing.md)

> **Built entirely with [Claude Code](https://claude.com/claude-code).** The thesis,
> the twenty-three positions, the weights and the condition that would prove each one
> wrong are mine. Every line of code — data pipeline, validation, statistics, page,
> dashboard — was written by Claude Code, Anthropic's AI coding agent, under my
> direction. I am not a programmer, and this project does not claim I am. What it
> shows is using AI to build the tools that test my own thesis — and then acting on
> what those tools found (see [How this was built](#how-this-was-built)).

---

## Thesis

The market prices AI capital expenditure as a semiconductor cycle. It is a
**physical infrastructure** cycle. Compute demand is compounding faster than the
systems that feed it — uranium and gas, grid interconnection, transformers,
land, and the strategic metals inside all of it — can be permitted, financed and
built.

Chips are fungible on a two-year horizon. **Interconnection queues are not.** The
book is positioned long the constraint and long the ground it stands on, with a
fifth of the notional held against the possibility that the whole thesis is
one trade wearing three hats.

| Bucket | Claim | Positions |
|---|---|---|
| **I · Substrate** | The buildout is constrained by fuel, molecules, the ground it stands on and the grid equipment that connects it | URA, NLR, PETR4.SA, 2222.SR, LB, NBIS, CRWV, ETN, HUBB |
| **II · Compute** | The demand side — silicon, fabs, and the firms selling the output | TSM, AMD, PLTR, VGT, 2357.TW, EWY, AINF.L, ASML |
| **III · Materials** | The minerals the buildout cannot design around, and whose supply is set by export policy | RARA11.SA |
| **IV · Ballast** | What survives if the rest of the book is the same bet | GLD, SGOV, AVDV, JPM, IEUR |

Targets are `bucket_targets` in [`data/positions.json`](data/positions.json); live weights
are on the [page](https://jpsb2004.github.io/power-law-book/).
Equal weight within each bucket, integer remainder to the most liquid names.
Bucket weights are fixed; there is no "provisional" allocation.
Every position carries a thesis **and its falsification condition** in
[`data/positions.json`](data/positions.json). Classification calls worth
arguing with, stated in the repo rather than buried:

- **VGT overlaps half its own bucket** — it already holds AMD's peers and the
  megacaps, diluting single-name risk without adding a new bet.
- **RARA11.SA is not ballast, so it has its own Materials bucket.** It is a
  concentrated, policy-driven rare-earth basket that will likely fall *with* the
  book, not against it. It was in Ballast until 2026-10-14 (see
  [`CHANGELOG.md`](CHANGELOG.md)).

---

## Data architecture

Structured as an **ontology**: every fact is attached to an asset entity and
carries a source saying where it came from and when. Nothing floats free.

```
                    lib/holdings.js          the book: tickers, weights, buckets,
                          |                  thesis, falsification
                          v
   lib/analytics.js  <--  lib/build-snapshot.js  --> data/snapshot.json
   returns, FX, hedging,     fetch + validate           (the contract)
   deviations, factors
                          |                                  |
        +-----------------+                                  |
        |                                                    v
        v                                    research/ontology.py  strict schema
   app/ (Next.js)                                            |     check + lineage
   live, per-request                                         |
                                            +----------------+----------------+
                                            |                                 |
                                   research/feeds.py                   app.py (Streamlit)
                                   RSS -> entities                     dashboard
                                            |
                                   research/briefing.py
                                   orchestrator-worker -> latest_briefing.md
```

**One market-data implementation, not two.** Python does not fetch prices or
recompute returns. `lib/analytics.js` owns that maths, is exercised by the
published page and the live app, and writes `data/snapshot.json`. The research
layer consumes that artifact and validates it against a declared schema. A
second implementation in a second language would drift from the first, and the
brief for this work was explicitly *zero breakage to existing deviation maths*.

`research/ontology.py` fails loudly — missing fields, unknown buckets, weights
that do not total 100 raise `SchemaError` rather than rendering a dashboard of
blanks.

### Multi-exchange normalisation

23 instruments, 7 venues, 5 currencies, no API key.

FX is applied **date by date, not at today's spot** — converting a year of
Korean prices at the current KRW rate would book twelve months of currency moves
onto the last session. Pairs are `USDBRL=X`, `USDSAR=X`, `USDKRW=X`, `USDTWD=X`,
`USDGBP=X`, and the direction is *derived per pair* rather than hardcoded, so a
`GBPUSD=X`-style pair still converts correctly. Inverting it inflates a position
by the square of the rate.

The result is visible on the live page, which shows each line's local and USD
return side by side.

| Condition | Behaviour |
|---|---|
| Transient upstream error (429, 5xx) | Retry with exponential backoff; 404 is not retried — that is a wrong ticker |
| One ticker fails | Recorded; the rest proceed |
| A currency has no rate | Position drops out of USD figures — **not** passed through as if it were dollars |
| Quote currency ≠ declared | Exchange wins, warning raised — catches relistings |
| Position younger than the window | Coverage recorded and flagged |
| Non-overlapping calendars | Cross-market joins key on calendar date, not timestamp |

One caught in build: `meta.chartPreviousClose` is **range-relative** — on a 1-year
fetch it returns the close from a *year* ago. Day-change is derived from the
series instead.

### Deviation metrics

Built alongside the existing return statistics, not inside them — `describe()`
is relied on by the validator and the published page, and its shape is left
alone.

`sigma` is the day's move in standard deviations of that position's **own**
trailing return distribution. It is the only honest way to compare a 3% day in
GLD with a 3% day in CRWV. The dashboard alerts at ±2σ.

### Total return

Every series is the **dividend-adjusted** close, so returns include reinvested
distributions and are net of each fund's own fee. Price-only closes read a
T-bill fund paying ~4% a year as flat and understate high-payout lines like
PETR4 and 2222.SR by their whole yield. Indices (^KS11) have no dividends to
adjust and use the plain close.

### Index construction

The headline curve holds each line in value and **rebalances to target weight
on the first session of each month** (`rebalance.base_case` in
`data/positions.json`). Until 14 Oct 2026 it rebalanced every session, which
harvests a rebalancing premium no real book collects at zero cost; the page
now shows daily, monthly and buy-and-hold side by side, each gross and net of
stated costs (trading bps, FX spread, dividend withholding — `cost_assumptions`),
with a reconciliation from the weighted sum of line returns to the headline.
A line that lists mid-window joins at the next rebalance (buy and hold: at its
first close, by trimming the others).

Before the daily-rebalanced version, the curve averaged weighted *prices*. That is a
price-weighted index, where a $400 GLD share outvoted a $5 KOSPI point (in USD)
eighty to one and a fund listing mid-window moved the level by its price alone.
It understated the 1-year return by ~8pp. The method is folded into the refresh
log's book fingerprint, so the switch shows as **rebased**, not as a day's
return.

---

## Analysis layers

All computed in `lib/analytics.js` + `lib/build-snapshot.js`, written to
`data/snapshot.json`, rendered on the page. Each is **non-fatal**: a failed
fetch is recorded and the refresh still publishes, because the book itself is
unaffected.

### FX-hedged view

A toggle switches the curve, headline stats, YTD chart and table between
**unhedged USD** and **FX-hedged USD**.

Hedged is *not* the local return. A rolled forward hedge earns or pays the rate
differential, so hedged ≈ local + (r<sub>USD</sub> − r<sub>CCY</sub>), accrued
daily. For reais that carry is a large cost, which can absorb most of the FX
gain on Petrobras; the current rates are on the page. Rates come from a dated
series where one exists (USD 13-week T-bills, BRL CDI) and otherwise from the
dated policy-rate table in `data/positions.json` (`fx_hedge`), held flat across
the window; `check-book` fails if a book currency has no rate. Not modelled:
cross-currency basis, the onshore/offshore NDF gap for KRW, TWD and BRL, and the cross term on gains.

### EWY, measured against ^KS11

Every line in the book is investable. Until 14 Oct 2026 the Korea line was the
KOSPI index itself (`^KS11`), which cannot be bought; the book now holds `EWY`
and keeps the index as its reference. The page reports the **difference in
exposure** rather than a "substitution cost", since MSCI's 25/50 caps and New
York trading hours make EWY a different exposure that can run ahead of the index
as easily as behind it: weekly tracking error, correlation, beta, the return gap,
average traded value, and the whole book re-run with the index in place of EWY.

Seoul closes ~10 hours after one New York close and ~14 before the next, so each
Seoul close is paired with the **previous** NY close (`clock_lag_sessions: 1`).
Same-date pairing measures the time zone, not the fund. SOXX was considered and
rejected: a US semiconductor basket is a different bet, not a Korea proxy.

### Backtest vs track record

Every return, volatility and drawdown on the page, the dashboard and the PDF is
a **hindsight backtest**: today's weights replayed over the past twelve months,
with positions chosen knowing how that year went. Each is labelled so on the
KPI row itself.

The **live record** is separate (`data/track.json`, written by `extendTrack`):
chain-linked forward from its inception, one entry per trading day every venue
has closed, and never revised — a later change to the book changes only what
comes after it. The first scheduled refresh that finds no file starts it, so
its inception is the first run after the P0 changes were merged. Every change
to the book or its method is dated in `book_changes` (`data/positions.json`)
and rendered as a change log on the page and in the PDF.

### Benchmarks and risk-adjusted returns

The book is shown beside VGT (US tech, also a holding), ACWI (global equity)
and a 60/40 blend of ACWI and AGG, over one shared window cut by calendar date
and rebased to 100. For each: return, volatility, Sharpe and Sortino (in excess
of SGOV's total return, i.e. the T-bill rate actually earned), beta to ACWI and
max drawdown; and for the book against each benchmark, excess return, tracking
error, information ratio and beta. Beta, tracking error and IR use weekly
returns for the same time-zone reason as the factor regressions. An IR needs to
clear about 2 over one year before it says anything; the page states which do.

Volatility is annualised at each series' **own** observation frequency. The
book curve runs on the union of seven venues' calendars (~309 observations a
year, Riyadh trades Sundays), so the old `sqrt(252)` understated it by about a
tenth; measured on a single New York calendar it agrees with the corrected
figure.

### Factor exposure (three years, three factors)

Weekly USD returns in excess of T-bills (SGOV) for the book, each bucket and
each Ballast line, over three years, regressed on global equity (ACWI),
semiconductors (SMH) and energy (XLE) — none of them a holding, so no bucket is
regressed on itself. Lines that listed later join the long-run curve when they
list. The page adds a rolling 52-week beta to ACWI and SMH, shows each bucket's
loadings beside its name, and states the conclusion the numbers support:
returns are explained by exposure; an intercept in a hindsight backtest
measures selection, not an edge. Over three years Ballast loads 0.74 on global
equity — diversification by degree, not a hedge.

### Tail risk and stress tests

Historical one-day VaR/CVaR (95%, 99%) from the headline year and one-week
VaR/CVaR from three years; today's weights held through 2022's bear market, the
2023 rate spike, the DeepSeek day and the April 2025 tariff shock, beside VGT,
ACWI and 60/40 over the same dates; a hypothetical 40% tech fall through the
book's measured beta; and the three stated scenarios. Windows, stated shocks
(with their rationale) and the stand-ins for lines that did not exist yet
(NBIS/CRWV → SMH, LB → TPL, RARA11.SA → REMX, AINF.L → VGT) live in
`data/scenarios.json`, which the page, the dashboard and the PDF all read.

---

## RSS engine

Published feeds only. **No custom scrapers.**

| Feed | Role | Note |
|---|---|---|
| `google-news-rss` | Per-entity coverage | Queried in the language of the listing venue — B3 names searched in Portuguese |
| `sec-edgar-atom` | Authoritative US filings | SEC requires a contact User-Agent and rate-limits; both honoured |
| `cvm-atom` | Brazilian regulator | `gov.br/cvm/.../RSS`. **CVM publishes no per-company filing feed** — those live in the RAD/ENET portal, which would need a scraper. Attached at book level, not faked as company news |

Each item keeps its origin, so the briefing can weight a regulator filing
differently from an aggregator headline. EDGAR titles are boilerplate
(`"8-K - Current report"`), so they are stamped with ticker and filing date to
become real citations.

---

## Briefing synthesis

Orchestrator-worker, with the filter **before** the model calls:

1. **Select** — only positions that earn attention: a ≥2σ move, a data-quality
   fault, or a failed quote. On a quiet day this is three positions, not
   twenty. Asking a model to summarise twenty streams of nothing produces
   twenty paragraphs of nothing.
2. **Workers** — one call per selected position, seeing only its own entity.
   Bounded context per call.
3. **Orchestrator** — the only call that sees the whole book. Receives worker
   notes plus aggregates, writes the note.

Output is `latest_briefing.md`: Summary → Signals → Thesis check → Scenario on
deck → Watch, in ER vocabulary.

**No API key required.** Without `ANTHROPIC_API_KEY` a deterministic renderer
produces the same structure from the data alone, so CI never fails for want of a
secret. Set the key locally, or as a repository secret, to enable synthesis.

---

## Stress tests

Three scenarios — Grid Bottleneck, CapEx Retrenchment, Geopolitical Shock —
toggleable and combinable in the dashboard.

The shocks are **stated assumptions, not estimates from a covariance matrix.** A
year of daily data across five currencies, including a fund with a few months of
history, cannot support an estimated correlation structure; one built on it
would look rigorous and be noise. Sensitivities are set per position rather than
per bucket, because the buckets are not internally uniform — a grid bottleneck
is good for a uranium miner and bad for a neocloud, and both sit in Substrate.

Combining scenarios sums the shocks, which assumes independence they do not
have. The dashboard says so on screen.

---

## Running it

```bash
npm ci && pip install -r requirements-dev.txt

npm test && python -m pytest tests   # unit tests (no network)
npm run refresh                      # fetch, validate, rebuild the static page
python scripts/verify_independent.py # recompute three lines independently
python scripts/make_pdf.py           # the thesis PDF, from the same snapshot
python scripts/build_briefing.py     # RSS + synthesis -> latest_briefing.md
streamlit run app.py                 # dashboard on :8501
```

`npm run refresh` exits `0` published / `2` rejected / `1` crashed. A rejected
refresh leaves the previous snapshot and live page untouched — a stale page
beats a corrupted one, and CI treats a rejection as a successful defence rather
than a failure.

**CI/CD:** [`.github/workflows/daily_refresh.yml`](.github/workflows/daily_refresh.yml)
runs weekdays at 22:17 UTC — unit tests → fetch → validate → generate note →
independent verification → PDF → commit (snapshot, history, live record,
prices CSV, verification, PDF) → deploy Pages. See [DEPLOY.md](DEPLOY.md).

The Streamlit dashboard is deployed separately on Streamlit Community Cloud —
GitHub Pages serves static files only and cannot run a Python process. The split
is deliberate: Pages carries the static research note (instant, no cold start),
Streamlit carries the interactive dashboard (stress toggles, filtering).

Because the dashboard reads artifacts committed by CI rather than fetching
anything, Streamlit Cloud's redeploy-on-push means the daily job feeds both
deployments from one commit.

### Data handling and reproducibility

- **Prices.** Daily closes from Yahoo's chart endpoint. Returns use the
  dividend-adjusted close (Yahoo's ratio method), so every series is a total
  return; splits are applied to the whole history by the provider, and the
  validator flags a clean 2x/3x/4x jump between runs. Bars are keyed by the
  exchange's own trading date (FX bars arrive stamped 23:00 UTC the day
  before; keyed by UTC date they converted every non-USD close at the next
  day's rate until 14 Oct 2026). A session still open at run time is never
  published as a close.
- **Second source.** Each refresh compares the unadjusted close of AMD, TSM,
  JPM, GLD and VGT with Nasdaq's published closes, session by session; a gap
  above 0.5% is flagged. On 14 Oct 2026: 125 sessions, largest gap 0.001%.
- **Independent recomputation.** `scripts/verify_independent.py` refetches AMD,
  PETR4.SA (with USDBRL) and GLD using only the Python standard library,
  recomputes YTD, one-year return and volatility, and writes
  `research/verification.xlsx` — the raw closes plus Excel formulas that redo
  the calculation — and `data/verification.json`. On 14 Oct 2026 the largest
  difference from the pipeline was 0.0004pp. It is what exposed the FX dating
  error above.
- **Saved data.** `data/prices.csv` holds every line's USD total-return closes
  for the window; `data/snapshot.json` every derived figure; `data/track.json`
  the live record. All are committed on each refresh.
- **Pinned.** Node dependencies by `package-lock.json`, Python by
  `requirements.txt` / `requirements-dev.txt`, Python 3.12 by `.python-version`.
- **Tests.** `tests/*.test.mjs` (return, FX, hedge carry, regression,
  rebalancing, risk, stress, live record, data fetching) and
  `tests/test_research.py`; both run in CI before every refresh.

---

## How this was built

Entirely with [Claude Code](https://claude.com/claude-code). The division of
labour:

| Mine | Claude Code's |
|---|---|
| The thesis and the four-bucket structure | All code: Node data layer, Python research layer, Streamlit dashboard, this page |
| Every position, its weight, and what would prove it wrong | FX normalisation, total-return series, validation gate, CI/CD |
| Which questions to test (is Ballast really a hedge? what does KOSPI cost to hold?) | The statistics that answer them: factor regressions, tracking error, hedged returns |
| Deciding what to do with the answers | Explaining the results in plain language so I could decide |

The AI also found things I would not have: the headline index was
price-weighted rather than return-weighted, understating the 1-year return by
~8pp; returns ignored dividends; and the Ballast bucket, tested against tech and
energy factors, turned out to be diversification rather than a hedge. Two
positions (SGOV, XLP) were added to the Ballast as a direct result of that test.

## CV summary

> **The Power Law Book** — built a 23-position thematic equity portfolio on AI
> compute and the energy it consumes, across 7 exchanges and 5 currencies;
> developed an FX-hedged USD return model, benchmark and risk-adjusted
> comparison, factor regressions, risk-contribution, effective-bets and
> stress-test analytics, refreshed and published automatically every weekday
> (Node, Python; AI-assisted coding with Claude Code).
>
> Documented the limitations (hindsight bias, costs, rebalancing), validated the
> data against a second source and an independent recomputation, and changed
> the book when the tests said so.

Do **not** put the return on a CV as a result. If a number is mentioned, label
it **backtest**: it replays today's weights over a year chosen after the fact.
The measured findings are the better line — e.g. the book behaves like about
two independent bets, and per unit of risk it did not beat simply holding VGT.

---

## Disclaimer

**This is not investment advice.** It is not a recommendation, an offer or a
solicitation to buy or sell any security, and it is not a statement that any
position described here is suitable for anyone. It is a personal research
exercise built to practise market analysis.

Performance figures are a backward-looking simulation of the current weights,
not a track record. Positions were selected with hindsight over a window ending
on the day of writing. Headline figures are gross of commission, spread,
withholding tax and FX costs (fund fees are inside fund prices); the page shows
a net-of-cost series under stated assumptions. Scenario impacts
are hand-specified assumptions, not forecasts.

Prices are delayed, sourced from a free public endpoint, and cross-checked
against a second free source, not a paid vendor. They may be wrong. News items are retrieved
from third-party feeds and are not verified. Past performance says nothing about
future returns. Do your own research and speak to a licensed adviser before
making any investment decision.

It is an educational exercise, not a securities analysis report: the author is
not a CVM-registered securities analyst (Resolução CVM 20) or investment
adviser.
