# Changelog

Every change to the pipeline, the analytics or the book, with the numbers it
moved. Item IDs refer to the external review (`Power_Law_Book_Review_and_Fix_List.md`).
Before/after figures are recomputed from data, never copied from the review.

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
