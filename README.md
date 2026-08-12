# The Power Law Book

A twelve-position global macro book, priced live, with the analysis and the
limitations in the same document.

The thesis is one sentence: **the demand curve for computation is growing faster
than the physical systems that feed it — fuel, molecules, land and grid — can be
rebuilt.** The four sleeves are the links in that chain, and the fourth exists
because the first three might turn out to be one trade wearing three hats.

| Sleeve | Claim | Weight |
|---|---|---|
| I · Fuel Cycle | Reactors are restarting faster than fuel is being dug up | 15% |
| II · Molecules & Acres | Compute lands somewhere physical and pays rent | 20% |
| III · Compute | The demand side — silicon, boxes, and the firms selling the output | 35% |
| IV · Ballast | What survives if sleeves I–III are the same bet | 30% |

> Weights are provisional. They live in one place — `lib/holdings.js` — and
> everything downstream follows from them.

## Two deliverables, one data layer

```
lib/holdings.js     the book: tickers, weights, sleeves, thesis, falsification
lib/analytics.js    quote fetching + return maths      <-- shared, deliberately
     |
     +--> lib/quotes.ts ------> app/          live Next.js app, quotes per request
     +--> scripts/snapshot.mjs -> data/snapshot.json -> scripts/build-page.mjs
                                                          -> out/index.html
```

The published page runs under a CSP that blocks every outbound request, so it
cannot fetch quotes at view time. Rather than let the two drift, both the live
app and the frozen page compute returns through the **same** `lib/analytics.js`.
The page is a dated snapshot of exactly what the app would have shown.

## Commands

```bash
npm run dev       # live app on :3000 — quotes fetched per request
npm run refresh   # the unattended pipeline: fetch, validate, rebuild, smoke-test
npm run snapshot  # raw fetch, no validation (use refresh instead)
npm run page      # build out/index.html from the current snapshot
npm run check     # execute the built page in a DOM and assert it rendered
```

## The refresh agent

The page cannot fetch its own data — artifact pages run under a CSP that blocks
every outbound request. So it is fed on a schedule instead: a scheduled Claude
task runs `npm run refresh` on weekdays after the US close and republishes the
result to the same URL.

```
scheduled task (weekdays 17:42 local)
   └─ npm run refresh
        ├─ buildSnapshot()      12 positions + 5 FX pairs, retry with backoff
        ├─ validateSnapshot()   compare against the last good snapshot
        │     ok  ──> archive previous, write new, rebuild page, smoke-test
        │     bad ──> exit 2, change nothing
        └─ exit 0 ──> Claude republishes out/index.html to the same artifact URL
```

**Validation is the point of the pipeline.** An unattended job that blindly
overwrites a good page is worse than no job at all, so a candidate snapshot is
rejected unless it passes every check:

| Check | Rejects |
|---|---|
| ≥ 10 of 12 positions priced | upstream down or rate-limiting |
| every FX rate present | a broken pair silently rescaling foreign positions |
| curve ≥ 200 points | truncated or malformed series |
| `asOf` strictly newer | a stale rebuild republishing itself |
| < 3 positions moving > 25% | a data fault dressed up as a market move |

That last one is the interesting threshold. One position moving 25% is an
earnings day; four moving 25% together, on a book spread across six currencies,
is a bug. So a single violent move publishes with a warning, and a cluster is
blocked. Verified against seven simulated failure modes — five blocked, a
healthy run and a genuine 31% single-name move both allowed through.

On rejection the pipeline exits non-zero, leaves `data/snapshot.json` and the
live page untouched, and the agent is instructed not to publish. The previous
snapshot is archived to `data/snapshot.previous.json` on every successful run.

`data/history.json` records each run, and the page renders it as a **Refresh
log** — index level, change since the previous run, positions priced, largest
mover. A run that fails validation never appears there, so a stalled or
failing job is visible on the page rather than hidden in a terminal.

### Limitation

Scheduled tasks run **while the Claude app is open**; a missed run fires on next
launch. That is fine for a portfolio refreshed daily, but it is not a server. To
make it genuinely independent, move `npm run refresh` into a GitHub Action on a
cron and deploy the app to Vercel — the pipeline is already headless and
exit-code driven, so it would need no changes.

## Decisions worth defending

**Returns are computed in USD, converted at each day's rate.** Converting a year
of Korean prices at *today's* KRW rate would book twelve months of currency
moves as though they all happened on the last day. Petrobras is +36% in reais
and +46% in dollars; ASUSTeK is +51% locally and +47% in dollars. That gap is
the position's FX exposure, and the page shows it as its own chart because it is
return that has nothing to do with whether the thesis was right.

**Three of the twelve are not directly buyable.** `^KS11` is an index, `GC=F` is
a dated futures contract that expires 29 Dec 2026 and must be rolled, and
Anthropic is private. They are labelled as such everywhere they appear rather
than quietly presented as ordinary holdings.

**The private mark is excluded from the curve, not held flat.** Yahoo does serve
`ANTH.PVT`, but the instrument type is `PRIVATE_COMPANY` and the value has not
moved in ten sessions — it is a valuation marker, not a price. Carrying a
constant inside the index would have damped measured volatility and flattered
the book, so the position is marked at the last primary round ($965bn
post-money, Series H) and left out of the performance maths.

**Cross-market joins key on calendar date, not timestamp.** Exchanges stamp
daily bars at their own local open, so a naive join turned one year into 1,633
distinct "dates". Correlations are still biased toward zero because Taipei
closes before New York opens; that is stated on the page rather than presented
as a finding.

**Caching is `cacheLife("seconds")` for quotes and `"minutes"` for FX.** A
refresh should show a fresh mark; ten readers arriving at once should not each
hit the upstream endpoint twelve times. Rates move slower than quotes and get
their own entry.

## Stack

Next.js 16.2 with Cache Components enabled, React 19, TypeScript, no CSS
framework. Quotes come from the Yahoo Finance chart endpoint, which needs no API
key and resolves 11 of the 12 symbols natively.

Charts are hand-built SVG. Colours are `var(--token)` references rather than
resolved hex, so light and dark themes work without a repaint. The categorical
palette was validated for colourblind separation and contrast rather than
eyeballed.

---

*Not investment advice, not a recommendation, and not an offer to buy or sell
anything. A personal research exercise. Prices are delayed, sourced from a free
public endpoint, and unreconciled against a paid vendor.*
