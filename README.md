# The Power Law Book

**Live: https://jpsb2004.github.io/power-law-book/** — rebuilt from public market
data every weekday after the US close, by the pipeline in this repo.

An 18-position global macro portfolio and the engine that keeps it priced. The
thesis is one sentence: **the demand curve for computation is growing faster
than the physical systems that feed it — fuel, molecules, land and grid — can be
rebuilt.**

Two things share one data layer: a live Next.js app that prices the book per
request, and a static research page that is deployed to Pages on a schedule.

---

## Macro allocation

Three buckets, ordered because they depend on each other. Within a bucket the
split is equal weight, with the integer remainder going to the most liquid
names.

| Bucket | Target | Claim | Positions |
|---|---|---|---|
| **I · Energy** | 38% | The buildout is constrained by fuel, molecules and the ground it stands on | URA, NLR, PETR4.SA, 2222.SR, LB, NBIS, CRWV |
| **II · Compute** | 32% | The demand side — silicon, fabs, and the firms selling the output | TSM, AMD, PLTR, VGT, 2357.TW, ^KS11, AINF.L |
| **III · Ballast** | 30% | What survives if the first two are one trade wearing two hats | GLD, AVDV, JPM, RARA11.SA |

Every position carries a thesis **and the condition that would prove it wrong**,
stated in `lib/holdings.js` and rendered on the page. Three worth reading before
the rest:

- **CRWV overlaps NBIS.** Both are neoclouds. This is one position expressed twice.
- **VGT overlaps half its own bucket.** It already holds the megacaps and AMD's
  peers, so it dilutes single-name risk without adding a new bet.
- **RARA11.SA is not ballast.** It is a rare-earth and strategic-metals basket —
  concentrated, policy-driven and high-beta. It will likely fall *with* the book
  rather than against it.

Those are in the repo because a portfolio note that only argues its own case is
marketing. `lib/holdings.js` is the single source of truth: edit the weights and
allocation, contribution, bucket totals and the curve all follow.

---

## Pipeline architecture

```
lib/holdings.js       the book: tickers, weights, buckets, thesis, falsification
lib/analytics.js      fetching + return maths        <-- shared, deliberately
lib/build-snapshot.js candidate builder + validator
      |
      +--> lib/quotes.ts ------> app/       live Next.js app, priced per request
      +--> scripts/refresh.mjs -> data/snapshot.json
                                     -> scripts/build-page.mjs -> out/index.html
```

The published page runs under a CSP that blocks every outbound request, so it
cannot fetch quotes at view time. Rather than let the two drift, the live app and
the frozen page compute returns through the **same** `lib/analytics.js`. The page
is a dated snapshot of exactly what the app would have shown.

```bash
npm run dev       # live app on :3000 — quotes fetched per request
npm run refresh   # the unattended pipeline: fetch, validate, rebuild, smoke-test
npm run page      # build out/index.html from the current snapshot
npm run check     # execute the built page in a DOM and assert it rendered
```

---

## Multi-exchange data engine

18 instruments across 7 venues and 6 currencies, from a free endpoint that needs
no API key.

**FX auto-conversion.** Every non-USD line is converted with a dated rate series,
not today's spot — converting a year of Korean prices at the current KRW rate
would book twelve months of currency moves onto the last session. The pairs are
written explicitly as `USDBRL=X`, `USDSAR=X`, `USDKRW=X`, `USDTWD=X`, `USDGBP=X`,
and the direction is *derived per pair* rather than hardcoded, so a
`GBPUSD=X`-style pair added later still converts correctly. Getting that backwards
inflates a position by the square of the rate.

The result is visible: Petrobras is **+36% in reais and +46% in dollars**;
ASUSTeK is **+51% locally and +47% in dollars**. That gap is FX — return that has
nothing to do with whether the thesis was right — and the page charts it
separately.

**Failure handling.** International tickers fail in ways US ones do not, so each
is fetched independently and degrades on its own:

| Condition | Behaviour |
|---|---|
| Transient upstream error (429, 5xx) | Retry with exponential backoff; a 404 is not retried — that is a wrong ticker |
| One ticker fails outright | Recorded, other 17 proceed; the validator decides if it is fatal |
| A currency has no FX rate | Position drops out of USD figures — it is **not** passed through as if it were dollars |
| Quote currency ≠ declared currency | Exchange wins, warning raised — catches relistings and wrong suffixes |
| Position younger than the window | Coverage recorded and flagged; RARA11.SA covers 6% of the year |
| Non-overlapping trading calendars | Cross-market joins key on calendar date, not timestamp |

That last one is not theoretical: exchanges stamp daily bars at their own local
open, so a naive join turned one year into 1,633 distinct "dates".

---

## Stress-test gate

The pipeline exists to *refuse* to publish. An unattended job that blindly
overwrites a good page is worse than no job at all.

| Check | Rejects |
|---|---|
| ≥ N−2 positions priced | upstream down or rate-limiting |
| Every FX rate present and convertible | a broken pair silently rescaling foreign lines |
| Curve ≥ 200 points | truncated or malformed series |
| `asOf` strictly newer | a stale rebuild republishing itself |
| < 3 positions beyond the move threshold | a data fault dressed up as a market move |

The move threshold **scales with the gap between snapshots**. A 25% move
overnight is suspicious; the same move after the job has been idle a fortnight is
just what markets did. Volatility scales with √time, so the tolerance does too,
capped at 80% — past that it is a split or a bad print regardless of the gap.
Moves landing on a clean multiple (2×, ½×) are flagged separately as probable
unadjusted splits.

Verified against simulated failure modes: a 90% overnight move on four lines
blocks; 40% drift over 21 idle days publishes; a 3× rescale blocks at any gap; a
genuine 31% single-name earnings move publishes with a warning.

Exit codes are the contract:

| Exit | Meaning | CI | Deploys? |
|---|---|---|---|
| 0 | validated and rebuilt | green | yes |
| 2 | **rejected**, nothing changed | green | no |
| 1 | crashed | red | no |

A rejection is a successful defence, so the build stays green and the deploy is
skipped. `data/history.json` logs every run and the page renders it as a
**Refresh log**, so a stalled job is visible on the page rather than buried in a
terminal.

---

## CI/CD

`.github/workflows/daily_refresh.yml` runs weekdays at **22:00 UTC**:

1. `node scripts/refresh.mjs` — fetch, validate, rebuild, smoke-test in a DOM
2. commit the refreshed `data/snapshot.json` and `data/history.json` via
   `stefanzweifel/git-auto-commit-action@v5`, so the next run has a baseline
3. upload `out/` and deploy to Pages

See [DEPLOY.md](DEPLOY.md) for setup and operational caveats.

---

## Stack

Next.js 16.2 with Cache Components, React 19, TypeScript, no CSS framework.
Quotes come from the Yahoo Finance chart endpoint, which needs no API key.

Charts are hand-built SVG. Colours are `var(--token)` references rather than
resolved hex, so light and dark work without a repaint. The categorical palette
was validated for colourblind separation and contrast across all pairs rather
than eyeballed.

---

## Disclaimer

**This is not investment advice.** It is not a recommendation, an offer or a
solicitation to buy or sell any security, and it is not a statement that any
position described here is suitable for anyone. It is a personal research
exercise built to practise market analysis.

The performance figures are a **backward-looking simulation of the current
weights**, not a track record. The positions were selected with the benefit of
hindsight over a window ending on the day of writing, which is the most
flattering possible framing. Figures are gross of commission, spread, ETF
expense, withholding tax and FX costs; the lived return would be lower.

Prices are delayed, sourced from a free public endpoint, and have not been
reconciled against a paid vendor. They may be wrong. Past performance says
nothing about future returns. Do your own research and speak to a licensed
adviser before making any investment decision.
