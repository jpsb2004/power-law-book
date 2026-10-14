# Changelog

Every change to the pipeline, the analytics or the book, with the numbers it
moved. Item IDs refer to the external review (`Power_Law_Book_Review_and_Fix_List.md`).
Before/after figures are recomputed from data, never copied from the review.

## 2026-10-14 — P2 Second source, independent recomputation, reproducibility, legal; FX dating fix

- **Fix: FX dating.** Yahoo stamps FX daily bars at 23:00 UTC of the previous
  day; keyed by UTC date, every non-USD close was converted at the next day's
  rate. Bars are now keyed by the exchange's trading date. Found by the
  independent recomputation: PETR4.SA one-year return 128.46% (pipeline) vs
  127.73% (independent) before the fix, 127.734% vs 127.734% after; volatility
  31.77% → 30.46%. Book unhedged one-year +35.5% → +35.3%; hedged +33.6%
  unchanged at one decimal.
- **Second source.** `lib/crosscheck.js` compares Yahoo's unadjusted closes for
  AMD, TSM, JPM, GLD and VGT with Nasdaq's, session by session, every refresh
  (125 sessions, largest gap 0.001%); a gap above 0.5% is a validator warning.
- **Independent recomputation.** `scripts/verify_independent.py` (standard
  library only) and `research/verification.xlsx` (Excel formulas) recompute
  AMD, PETR4.SA and GLD; largest difference 0.0004pp. Runs in CI.
- **Reproducibility.** Python dependencies pinned (`requirements.txt`, with
  `reportlab`, which the PDF needed but was missing; `requirements-dev.txt`);
  `data/prices.csv` saved on every refresh; the PDF is rebuilt and committed
  by CI from the same snapshot; pytest runs in CI. README documents adjusted
  closes, splits, dividends, the second source and how to rerun everything.
- **Legal.** Page, dashboard, PDF and README state it is an educational
  exercise and the author is not a CVM-registered securities analyst
  (Resolução CVM 20) or adviser.
- **CV summary** in the README rewritten to the review's wording, with the
  instruction to label any return as a backtest.

## 2026-10-14 — P1-3 Overlap and concentration; P1-4 valuation and testable thesis

- **P1-3.** New section "How many bets twenty lines are": correlation heatmap
  of weekly USD returns; effective number of bets (Meucci entropy over
  principal components) **2.0** of 19 lines, the first component carrying
  **83%** of the book's variance; single points of failure with their capital
  and risk share — US AI capex 29% of capital / **57% of risk**, nuclear fuel
  11% / 17%, Taiwan 9% / 9%, Korea memory 4% / 7%; top-10 look-through
  exposures from each fund's published top holdings (a floor; coverage shown).
  The PDF's "closer to 19 independent bets" now reads the measured figure.
- **P1-4.** Valuation by line (forward and trailing P/E, EV/EBITDA, FCF and
  dividend yield; Yahoo quoteSummary, dated). Statement ratios are dropped
  when statements and quote are in different currencies (TSM ADR) and
  holdings-level fund ratios are not used. The Compute trim rule is checked
  against the data: basket forward P/E 24.1x vs the 32x cap. A variant view,
  horizon, review/exit rules and five portfolio falsifiers with live readings
  (`thesis` in positions.json — **drafted from the existing thesis text, for
  the author to own**). Today one falsifier is triggered: Compute out-returned
  Energy by 55.7pp over twelve months against a 20pp threshold.
- Dashboard: "Thesis & Valuation" tab; PDF: valuation snapshot, variant view
  and falsifier table, effective-bets paragraph.
- Tests: `tests/structure.test.mjs` (3 cases).

## 2026-10-14 — P1-1 Tail risk and stress tests; P1-2 three-factor, three-year exposure; P0-3 loadings

- **P1-2.** Factor regression moved from one year on VGT + XLE to three years
  (weekly, excess of SGOV) on ACWI + SMH + XLE. VGT dropped as a factor because
  it is a holding. Rolling 52-week beta chart. The page states the conclusion:
  returns are explained by exposure; intercepts near t = 2 in a hindsight
  backtest measure selection. Also fixes a method error: raw returns had put
  the risk-free rate into alpha (SGOV showed +4.4% "alpha" at t = 57; ~0 now).
  Book (2023-10 → 2026-10): β ACWI 0.66, SMH 0.26, XLE 0.07, R² 0.69. Ballast:
  β ACWI 0.74 (t 13), R² 0.66 — not a hedge over three years (one-year VGT/XLE
  view had shown 0.14).
- **P0-3.** Each bucket card shows its measured loadings ("trades like"):
  Energy β ACWI 0.67 / SMH 0.27 / XLE 0.20 — it trades as AI and market risk
  more than as energy, which the page now says beside the name.
- **P1-1.** One-day VaR 95% 2.4% (CVaR 3.0%), 99% 3.5% (3.9%); one-week VaR
  95% 4.1% (5.5%), 99% 8.8%. Today's weights held through: 2022 bear −17.1%
  (ACWI −26.4%, VGT −34.5%), 2023 rate spike −2.4%, DeepSeek day −6.1%, April
  2025 tariff shock −13.4%; tech −40% via β 0.73 → −29.1%. Stated scenarios
  now carry numbers in the PDF too (CapEx −17.1%, Taiwan −8.6%), which the PDF
  had described as "unmodelled".
- Stated shocks moved from `research/scenarios.py` to `data/scenarios.json`
  (with each scenario's rationale), so Python and Node read one table.
- Tests: `tests/longrun.test.mjs` (3 cases).

## 2026-10-14 — P1-5 FX labels, dated hedge rates, BRL view; P0-3/P0-4 remainders; P2 wording

- **P1-5.** FX labels now give both numbers, named: the percentage-point gap
  between USD and local returns, and the currency's own move,
  (1 + USD) / (1 + local) − 1 (PETR4.SA: +21.0pp gap, real +10.7%). The hedge
  carry uses dated daily rates for USD (13-week T-bills, ^IRX) and BRL (CDI,
  Banco Central SGS 4389); SAR, TWD and GBP keep the dated policy-rate table. A
  sensitivity shows the hedged book with every non-USD hedge 1pp a year
  dearer (NDF basis). The FX caption justifies the USD base and shows the
  unhedged book measured in reais.
  Numbers (same data): hedged 1y +33.88% → +33.75%, YTD +42.23% → +42.13%;
  PETR4.SA hedged YTD +81.6% → +80.3% (CDI was 14.90% a year ago, not the
  13.75% table). Basis −1pp: hedged 1y −0.31pp. In BRL: 1y +24.6%, YTD +32.5%.
- **P0-3.** JPM tagged "credit beta, not ballast"; NBIS and CRWV tagged "power
  consumer, not supplier" (page, dashboard table, PDF headings).
- **P0-4.** Memo text no longer argues from sizes the book does not hold: AMD
  ("held at the same weight as its bucket peers"), NLR (thematic
  concentration "at an ordinary 5% line"), LB ("the hinge of the thesis, held
  at an ordinary 5% line").
- **P2 wording.** "Global macro" replaced by "thematic equity portfolio" (page
  title and eyebrow, Next.js app, dashboard docstring, briefing prompt).
- Tests: `tests/fx.test.mjs` (7 cases: FX conversion, currency move, flat and
  dated hedge carry, basis shift, OLS).

## 2026-10-14 — P0-2 Backtest vs track record: labels, live record, change log

**Decision (author):** the live record's inception is the first scheduled
refresh after the P0 changes are merged.

**What changed**

- KPI row (page), dashboard caption and PDF cover now say **"Hindsight
  backtest — not a track record"**; the PDF box is "Backtest metrics" and adds
  the Sharpe ratio; the 1-year card names the rule and "gross".
- `lib/analytics.js` — `extendTrack`: chain-linked, forward-only record.
  Appends every day all venues have closed (the earliest last close among
  lines no more than five days stale), linked by that day's move in the
  current curve; never revises a recorded day; records the book fingerprint
  on each point.
- `scripts/refresh.mjs` — writes `data/track.json` after a validated refresh;
  the workflow commits it alongside the snapshot. No file is committed from
  this branch: the first CI run after merge creates it and sets the inception.
- Page: a "Live since …" tile closes the KPI row (with "starts with the next
  scheduled refresh" until then); a new **Change log** section. Dashboard and
  PDF show the same.
- `data/positions.json` — `book_changes`: six dated entries (composition and
  method), the ones before 2026-10-14 reconstructed from git history.
- Stale counts fixed: PDF, dashboard and docs said "six currencies" and "a
  fund with three weeks of history"; now computed (five currencies; RARA11.SA
  with ~12 weeks).
- Tests: `tests/track.test.mjs` (5 cases); `check-page.mjs` checks the flag,
  the live tile and the change log.

**Numbers:** none of the backtest figures change in this item. The live
record has no return until its second recorded day.

## 2026-10-14 — P0-5 Monthly rebalancing as the base case; buy-and-hold and net-of-cost series; reconciliation

**What changed**

- `lib/analytics.js` — `rebalancedIndex`: holdings tracked in value, rebalanced
  to target on the first session of each period (`daily` / `monthly` /
  `quarterly` / `never` = buy and hold), optionally net of costs; with
  `daily` and no costs it reproduces the old index exactly (tested).
  `dividendYields` reads each ex-date from the adjusted vs unadjusted close;
  `fetchSeries` now keeps the unadjusted close (`p`) for that.
- `data/positions.json` — `rebalance.base_case: "monthly"` and
  `cost_assumptions` (trading 5 bps US / 15 bps elsewhere per dollar traded,
  FX spread 10 bps on non-USD trades, withholding by listing currency: USD 30,
  BRL 0, SAR 5, TWD 21, GBP 0), with their caveats. All stated assumptions.
- `lib/build-snapshot.js` — the headline and every book-like curve (bucket
  curves, the index re-run, the 60/40 blend) use the base rule;
  `snapshot.rebalancing` carries five variants per view and the
  reconciliation. `INDEX_METHOD` bumped, so the refresh log shows "rebased".
- `page/template.html` — table of variants and a four-step reconciliation in
  §Performance; KPI note, method notes and benchmark caption name the rule.
- `app.py` — the same table in the Benchmarks tab. `README.md` updated.
- Tests: `tests/rebalance.test.mjs` (5 cases); `check-page.mjs` covers it.

**Numbers** — same market data; FX-hedged unless stated:

| | Before (daily) | After (monthly base case) |
|---|---|---|
| 1y / YTD | +34.91% / +42.53% | +33.88% / +42.23% |
| Unhedged 1y / YTD | +36.62% / +44.33% | +35.62% / +44.06% |
| Volatility / max DD | 24.53% / −14.33% | 24.42% / −14.20% |
| Index level (unhedged / hedged) | 136.62 / 134.91 | 135.62 / 133.88 |
| Sharpe | 1.19 | 1.17 |
| Excess vs VGT / ACWI / 60/40 | −1.4 / +16.4 / +24.9 pp | −2.4 / +15.4 / +24.0 pp |
| IR vs VGT / ACWI / 60/40 | 0.00 / 1.02 / 1.37 | −0.06 / 0.96 / 1.33 |

Variants over the window (hedged): daily +34.9% (309 rebalances, 241%
turnover/yr); monthly +33.9% (12, 56%); buy and hold +31.7% (15%, the one
trade being RARA11's listing). Net of costs: monthly +33.2% (trading −0.22pp,
withholding −0.47pp); buy and hold +31.1%.

Reconciliation: weighted sum of line returns +31.7% = buy and hold +31.7%;
monthly rebalancing adds +2.2pp; daily adds a further +1.0pp. The review's
rough estimate of a ~6pp gap compared a weighted YTD column with the headline
YTD; measured over one window, the rebalancing effect is ~3pp.

## 2026-10-14 — P0-4 Sizing rule stated; risk contribution table

**Decision (author):** keep the weights; state the rule as near equal-weight
by design instead of "weight is the only real expression of conviction".

**What changed**

- `page/template.html` — §Allocation now opens with the sizing rule in one
  sentence, and adds "Equal capital is not equal risk": share of the book's
  variance per bucket and per line, risk ÷ weight, weekly vol and correlation
  to the book, with a computed lead sentence and method note.
- `lib/analytics.js` — `riskContributions`: Euler decomposition, weight ×
  cov(line, book) ÷ var(book), on weekly log returns; lines under 26 weeks of
  history are flagged `short`.
- `lib/build-snapshot.js` — `snapshot.risk` for both the unhedged and hedged
  views, with bucket totals.
- `app.py` — the same table in the Allocation tab; sizing sentence updated.
- `scripts/make_pdf.py` — one computed sentence in §2 on capital vs risk.
- Tests: 2 cases in `tests/risk.test.mjs`; `check-page.mjs` covers the block.

**Numbers** (FX-hedged view, 52 weeks to 2026-10-13):

| Bucket | Weight | Share of risk | Risk ÷ weight |
|---|---|---|---|
| Energy | 38% | 48.6% | 1.28 |
| Compute | 32% | 40.4% | 1.26 |
| Materials | 5% | 9.4% (11 weeks, indicative) | 1.88 |
| Ballast | 25% | 5.0% | 0.20 |

Largest lines: CRWV 17.0% of risk on 5% of capital, NBIS 15.7%, URA 10.2%.
Negative (diversifying): PETR4.SA −2.8%, 2222.SR −0.2%, XLP −0.1%. Shares sum
to 103% because RARA11.SA's covariance covers 11 weeks only.

**For the author:** a few memo texts in `data/positions.json` still argue from
conviction-sized weights that the book does not hold — AMD ("kept smaller than
a conviction bet would be", at the same 5% as its peers), NLR ("conviction is
high enough to accept concentration") and LB ("the hinge of the whole book",
at 5%). Left as written; they are the author's voice.

## 2026-10-14 — P0-1 Benchmarks and risk-adjusted metrics; volatility annualisation fix

**What changed**

- `lib/holdings.js` — `BENCHMARKS` (VGT; ACWI; 60/40 ACWI/AGG, rebalanced
  daily), `MARKET = ACWI`, `RISK_FREE = SGOV`.
- `lib/analytics.js` — `riskStats` (return, annualised return, vol, Sharpe and
  Sortino in excess of the T-bill fund read on the series' own calendar, max
  drawdown, weekly beta to the market), `relativeStats` (excess return,
  weekly tracking error, information ratio, beta with t-stat), `windowed`
  (shared window by calendar date, rebased to 100), `periodsPerYear`.
- **Fix:** `annualisedVol` annualised every series with `sqrt(252)`. The book
  curve has ~309 observations a year (union of seven venues' calendars), so
  its volatility was understated. It now uses each series' own frequency.
  Cross-check: the hedged book on a single New York calendar (250
  observations) gives 24.6%; lag-1 autocorrelation of the union series is
  −0.02, so the extra observations are real variance.
- `lib/build-snapshot.js` — `buildBenchmarks` writes `snapshot.benchmarks`.
- `page/template.html` — new section "Against the benchmarks": chart with a
  dashed, end-labelled line per benchmark; absolute and relative tables; the
  reading below them is computed (best Sharpe, which IRs clear 2, beta).
- `app.py` — "Benchmarks" tab with the same two tables.
- Tests: `tests/risk.test.mjs` (8 cases); `check-page.mjs` checks the section.

**Numbers** — window 2025-10-14 → 2026-10-13, USD total return:

| Series | Return | Vol | Sharpe | Sortino | β ACWI | Max DD |
|---|---|---|---|---|---|---|
| Book, FX-hedged | +34.9% | 24.6% | 1.19 | 1.79 | 1.26 | −14.3% |
| Book, unhedged | +36.9% | 24.8% | 1.24 | 1.87 | 1.28 | −14.4% |
| VGT | +36.3% | 24.5% | 1.24 | 1.84 | 1.47 | −16.4% |
| ACWI | +18.5% | 13.9% | 1.03 | 1.53 | 1.00 | −9.7% |
| 60/40 | +10.0% | 9.3% | 0.68 | 0.98 | 0.66 | −6.6% |

Hedged book against each: VGT −1.4pp (TE 13.1%, IR 0.00); ACWI +16.4pp (TE
13.5%, IR 1.02); 60/40 +24.9pp (TE 15.4%, IR 1.37). No IR clears 2.
Risk-free (SGOV) earned 3.7% annualised.

| Volatility | Before | After |
|---|---|---|
| Book, hedged (KPI) | 22.15% | 24.53% |
| Book, unhedged | 22.39% | 24.81% |
| Largest change on a single position | — | 2357.TW 42.3% → 41.4% |

## 2026-10-14 — P0-6 Every line investable: EWY replaces ^KS11

**What changed**

- `data/positions.json` — `^KS11` is `status: "substituted"` (kept as history,
  with `substituted_by`, `substituted_on`, `substitution_reason`); `EWY` (iShares
  MSCI South Korea ETF, NYSE Arca, USD) is active in Compute at the same 4%, with
  `^KS11` as its `reference` index.
- `lib/build-snapshot.js` — `buildReferences` measures a held fund against its
  reference index: the index is converted to USD date by date, tracking keeps
  the one-session Seoul/New York lag, and the book is re-run holding the index
  instead. The old index→proxy path is kept for any future index line.
- `page/template.html` — the section now says the book **holds** EWY and reports
  the **difference in exposure** (was "tracking difference"/"substitution
  cost"); the method note reads "Korea is held through a fund, not the index".
- `research/scenarios.py`, `research/feeds.py`, `scripts/make_pdf.py`,
  `README.md` — EWY in place of ^KS11. The scenario shocks were set for the
  index and carried over unchanged; the module docstring says so.

**Numbers** — same market data, P0-3 code vs P0-6 code:

| | Before (^KS11 held) | After (EWY held) |
|---|---|---|
| Unhedged YTD / 1y | +43.85% / +36.09% | +44.33% / +36.62% |
| Hedged YTD / 1y | +41.70% / +34.08% | +42.53% / +34.91% |
| Hedged vol / max DD | 21.21% / −14.46% | 22.15% / −14.33% |
| Unhedged index level | 136.09 | 136.62 (log shows "rebased") |
| Currencies in the book | 6 | 5 (KRW leaves) |
| Book β to tech (VGT) / R² | 0.82 / 0.65 | 0.85 / 0.67 |
| Compute β to tech / R² | 1.21 / 0.78 | 1.28 / 0.81 |
| EWY vs ^KS11, USD: TE / ρ / β | 30.1% / 0.81 / 0.93 | unchanged |
| EWY − ^KS11, YTD / 1y | +13.0pp / +26.3pp | unchanged |
| Book-level difference, YTD / 1y | +0.48pp / +0.53pp | unchanged (sign now "held minus index") |

Volatility and tech beta rise because EWY trades in New York hours alongside
the rest of the book; the Seoul close was partly out of sync with it, which
damped measured co-movement.

## 2026-10-14 — P0-3 Bucket classification: RARA11.SA moves to a Materials bucket

**Decision (author):** keep Energy at 38% and Compute at 32%; move RARA11.SA out
of Ballast into a new **Materials** bucket (5%); Ballast becomes 25%. NBIS and
CRWV stay in Energy with their existing caveat. No position weight changes, so
the index, returns, volatility and drawdown are unchanged.

**What changed**

- `data/positions.json` — `bucket_targets` now Energy 38 / Compute 32 /
  Materials 5 / Ballast 25; RARA11.SA `bucket: "materials"`; its falsification
  note and PDF rationale no longer say "this is not ballast".
- `lib/holdings.js`, `research/ontology.py`, `lib/holdings.d.ts`, `lib/quotes.ts`
  — fourth sleeve, numeral III; Ballast becomes IV. Python and the PDF read the
  bucket order from `ontology.BUCKET_ORDER` instead of hand-kept lists.
- Colour: Materials `#65389F` (light) / `#8156C0` (dark), chosen with the
  dataviz palette validator against the three existing hues (all pairs; every
  check passes, worst CVD ΔE 10.0 light / 9.2 dark).
- `page/template.html` — prose no longer assumes three buckets; the factor
  table's thesis column reads "ρ to I–III" from the sleeve list; a bucket block
  too narrow for its heading shows the numeral only (the 5% heading collided
  with Ballast's).
- `research/scenarios.py` — the capex note's "ballast is only 30%" is filled
  from live weights.
- `research/discipline.py` — **draft** Materials entry rule, for the author to
  edit.
- `scripts/make_pdf.py`, `app.py`, `README.md` — four buckets everywhere.

**Numbers** — both snapshots built from the same market data minutes apart:

| | Before | After |
|---|---|---|
| Bucket weights | Energy 38 / Compute 32 / Ballast 30 | Energy 38 / Compute 32 / Materials 5 / Ballast 25 |
| Hedged YTD / 1y / vol | +41.70% / +34.08% / 21.21% | unchanged |
| Ballast β tech (t) | 0.17 (2.1) | 0.14 (1.9) |
| Ballast β energy (t) | 0.00 (0.0) | 0.00 (0.1) |
| Ballast R² | 0.10 | 0.09 |
| Ballast ρ to rest of book | 0.29 (to Energy + Compute) | 0.28 (to Energy + Compute + Materials) |
| Materials regression | — | 11 weeks of history, too short to regress |

## 2026-10-14 — D-1 Data integrity: stale final bars, intraday prints, date and log labels

Covers review items P2 "Date/number mismatches" and P2 "Suspicious data point",
the false allocation sentence named under P0-3, and a defect the review did not
list.

**What was wrong**

- *Day moves published as zero.* When the scheduled run starts shortly after a
  close, Yahoo still serves that session's bar with a null close. `fetchSeries`
  forward-filled it from the previous day, so the day-change and sigma read
  exactly 0. The 14 Oct 00:44 UTC snapshot showed 16 of 20 positions unchanged;
  the 10 Oct snapshot showed 15. The 2σ alert panel and the ER note were built
  on those zeros.
- *Intraday prints published as closes.* The 22:00 UTC cron started between
  00:44 and 02:46 UTC the next day, while Seoul and Taipei were trading, and
  `price` came from the live quote. The refresh log's "^KS11 −9.7%" on 13 Oct
  was 6,625.93 (8 Oct close; 9 Oct was a Korean holiday) against 5,980.06, a
  mid-session print on 13 Oct: two sessions and an intraday price, not a day.
- *Header a day behind.* `fmtDate` used the reader's time zone with a UTC
  clock time, so a run at 14 Oct 00:44 UTC read "13 Oct, 00:44 UTC" in São
  Paulo. Curve axis dates had the same shift.
- *Log level vs. headline.* The refresh log recorded the unhedged index while
  the KPI cards can show the hedged one (135.39 vs 133.43 on 14 Oct).
- *False sentence.* §03 said Ballast "carries the largest single allocation";
  Energy is 38%, Ballast 30%.
- *Zero volume.* A zero final volume (common on B3) was reported as "0.00x
  average" instead of missing.

**What changed**

- `lib/analytics.js` — `fetchSeries` rescues a null final close from the
  same-session quote or drops it; never copies the prior close. New
  `completedOnly` option drops the bar of a session still open at run time and
  never lets a carried print end the series. Zero final volume → `null`.
- `lib/build-snapshot.js` — positions, the EWY proxy and the factor series use
  completed closes; `price` is the last close (`livePrice` kept separately);
  each position records `lastBar` and `sessionOpen`. The validator rejects a
  snapshot with ≥4 positions exactly flat and warns when a position's last
  close trails the book by more than 5 days.
- `scripts/refresh.mjs` — the log records `indexHedged` and `ytdHedged`.
- `page/template.html` — dates in UTC; log level follows the hedged/unhedged
  toggle, column renamed "Largest move since previous run" with a note that it
  spans more than one session after weekends and holidays; allocation sentence
  computed from the weights; `<meta charset="utf-8">`.
- `app.py` — warning when the snapshot is more than 80 hours old.
- `.github/workflows/daily_refresh.yml` — cron moved to an off-peak minute
  (22:17 UTC); unit tests run before the refresh.
- `tests/analytics.test.mjs` — 10 tests (`npm test`), no network.

**Numbers** — same code path, run on 14 Oct 2026 at 14:21 UTC (US session open,
so US lines end on the 13 Oct close; Asian lines on the 14 Oct close), against
the committed 00:44 UTC snapshot:

| | Before | After |
|---|---|---|
| Positions with day-change exactly 0 | 16 / 20 | 1 / 20 (SGOV, a genuine flat close: 100.52 both days) |
| 2σ alerts | RARA11.SA (genuine: −4.9%, 9→13 Oct) | none — an artefact of this mid-session run, see the known limitation below |
| Hedged index / YTD / 1y | 133.43 / +41.8% / +34.2% | 134.08 / +41.7% / +34.1% |
| Unhedged index / YTD / 1y | 135.39 / +44.1% / +36.3% | 136.10 / +43.9% / +36.1% |
| Volatility / max drawdown (hedged) | 21.2% / −14.5% | 21.2% / −14.5% |
| ^KS11 price | 6,135.36 (intraday) | 6,008.81 (14 Oct close) |
| CRWV day-change | 0.00% | −3.05% |
| AMD day-change | 0.00% | +1.90% |

The local snapshot used for this table was not committed; the next scheduled
run publishes the corrected data.

**Known limitation** — Yahoo replaces a B3 bar after a holiday gap with the live
bar once the next session opens (RARA11.SA lost its 13 Oct bar during the 14 Oct
session). Scheduled runs start after the B3 close and are unaffected; a manual
run during B3 hours can end RARA11.SA one session early.
