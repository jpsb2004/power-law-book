# THESIS INITIATION REPORT

## Beyond the Hyper-Scalers: Quantifying the Physical Bottlenecks of the Global AI CapEx Supercycle

**Live page:** https://jpsb2004.github.io/power-law-book/
· **Interactive dashboard:** https://beyondthehyperscalersjpsb.streamlit.app/
· **Daily note:** [`latest_briefing.md`](latest_briefing.md)

---

## Thesis

The market prices AI capital expenditure as a semiconductor cycle. It is a
**physical infrastructure** cycle. Compute demand is compounding faster than the
systems that feed it — uranium and gas, grid interconnection, transformers,
land, and the strategic metals inside all of it — can be permitted, financed and
built.

Chips are fungible on a two-year horizon. **Interconnection queues are not.** The
book is positioned long the constraint and long the ground it stands on, with a
third of the notional held against the possibility that the whole thesis is one
trade wearing three hats.

| Bucket | Target | Claim | Positions |
|---|---|---|---|
| **I · Energy** | 38% | The buildout is constrained by fuel, molecules and the ground it stands on | URA, NLR, PETR4.SA, 2222.SR, LB, NBIS, CRWV |
| **II · Compute** | 32% | The demand side — silicon, fabs, and the firms selling the output | TSM, AMD, PLTR, VGT, 2357.TW, ^KS11, AINF.L |
| **III · Ballast** | 30% | What survives if the first two are the same bet | GLD, AVDV, JPM, RARA11.SA |

Equal weight within each bucket, integer remainder to the most liquid names.
Every position carries a thesis **and its falsification condition** in
[`lib/holdings.js`](lib/holdings.js). Three the author disagrees with, stated in
the repo rather than buried:

- **NBIS and CRWV are classified in Energy but consume power rather than supply
  it.** They are compute landlords. They are also the same trade twice.
- **VGT overlaps half its own bucket** — it already holds AMD's peers and the
  megacaps, diluting single-name risk without adding a new bet.
- **RARA11.SA is not ballast.** It is a concentrated, policy-driven rare-earth
  basket that will likely fall *with* the book, not against it.

---

## Data architecture

Structured as an **ontology**: every fact is attached to an asset entity and
carries a source saying where it came from and when. Nothing floats free.

```
                    lib/holdings.js          the book: tickers, weights, buckets,
                          |                  thesis, falsification
                          v
   lib/analytics.js  <--  lib/build-snapshot.js  --> data/snapshot.json
   returns, FX, deviations   fetch + validate           (the contract)
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

18 instruments, 7 venues, 6 currencies, no API key.

FX is applied **date by date, not at today's spot** — converting a year of
Korean prices at the current KRW rate would book twelve months of currency moves
onto the last session. Pairs are `USDBRL=X`, `USDSAR=X`, `USDKRW=X`, `USDTWD=X`,
`USDGBP=X`, and the direction is *derived per pair* rather than hardcoded, so a
`GBPUSD=X`-style pair still converts correctly. Inverting it inflates a position
by the square of the rate.

The result is visible in the note: Petrobras runs **+36% in reais, +46% in
dollars**; ASUSTeK **+51% locally, +47% in dollars**.

| Condition | Behaviour |
|---|---|
| Transient upstream error (429, 5xx) | Retry with exponential backoff; 404 is not retried — that is a wrong ticker |
| One ticker fails | Recorded; the other 17 proceed |
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
   eighteen. Asking a model to summarise eighteen streams of nothing produces
   eighteen paragraphs of nothing.
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
year of daily data across six currencies, including a fund with three weeks of
history, cannot support an estimated correlation structure; one built on it
would look rigorous and be noise. Sensitivities are set per position rather than
per bucket, because the buckets are not internally uniform — a grid bottleneck
is good for a uranium miner and bad for a neocloud, and both sit in Energy.

Combining scenarios sums the shocks, which assumes independence they do not
have. The dashboard says so on screen.

---

## Running it

```bash
npm ci && pip install -r requirements.txt

npm run refresh                      # fetch, validate, rebuild the static page
python scripts/build_briefing.py     # RSS + synthesis -> latest_briefing.md
streamlit run app.py                 # dashboard on :8501
```

`npm run refresh` exits `0` published / `2` rejected / `1` crashed. A rejected
refresh leaves the previous snapshot and live page untouched — a stale page
beats a corrupted one, and CI treats a rejection as a successful defence rather
than a failure.

**CI/CD:** [`.github/workflows/daily_refresh.yml`](.github/workflows/daily_refresh.yml)
runs weekdays at 22:00 UTC — fetch → validate → generate note → commit via
`stefanzweifel/git-auto-commit-action@v5` → deploy Pages. See
[DEPLOY.md](DEPLOY.md).

The Streamlit dashboard is deployed separately on Streamlit Community Cloud —
GitHub Pages serves static files only and cannot run a Python process. The split
is deliberate: Pages carries the static research note (instant, no cold start),
Streamlit carries the interactive dashboard (stress toggles, filtering).

Because the dashboard reads artifacts committed by CI rather than fetching
anything, Streamlit Cloud's redeploy-on-push means the daily job feeds both
deployments from one commit.

---

## CV summary

> **Global Macro Research Engine** — an 18-position, 3-bucket thesis portfolio
> across 7 exchanges and 6 currencies, with an automated daily research
> pipeline. Node data layer (FX-normalised returns and deviation metrics, with a
> validation gate that rejects suspect data rather than publishing it), Python
> research layer (ontology-mapped RSS ingestion from Google News, SEC EDGAR and
> CVM; orchestrator-worker LLM synthesis into an ER-format daily note), and a
> Streamlit dashboard with scenario stress-testing. Runs unattended on GitHub
> Actions and deploys itself.
>
> Skills: financial data engineering · multi-currency normalisation · data
> quality gating · LLM orchestration · CI/CD · Next.js / TypeScript / Python.

Do **not** quote the performance figures as a track record. They are a
backward-looking simulation of the current weights over a window ending today —
the most flattering possible framing. The drawdown column matters more than the
return column, and saying so first is worth more than the number.

---

## Disclaimer

**This is not investment advice.** It is not a recommendation, an offer or a
solicitation to buy or sell any security, and it is not a statement that any
position described here is suitable for anyone. It is a personal research
exercise built to practise market analysis.

Performance figures are a backward-looking simulation of the current weights,
not a track record. Positions were selected with hindsight over a window ending
on the day of writing. Figures are gross of commission, spread, ETF expense,
withholding tax and FX costs; the lived return would be lower. Scenario impacts
are hand-specified assumptions, not forecasts.

Prices are delayed, sourced from a free public endpoint, and have not been
reconciled against a paid vendor. They may be wrong. News items are retrieved
from third-party feeds and are not verified. Past performance says nothing about
future returns. Do your own research and speak to a licensed adviser before
making any investment decision.
