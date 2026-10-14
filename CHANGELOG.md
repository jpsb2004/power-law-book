# Changelog

Every change to the pipeline, the analytics or the book, with the numbers it
moved. Item IDs refer to the external review (`Power_Law_Book_Review_and_Fix_List.md`).
Before/after figures are recomputed from data, never copied from the review.

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
