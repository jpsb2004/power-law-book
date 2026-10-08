/**
 * Builds a snapshot object from live public market data.
 *
 * Kept separate from the CLI so the unattended refresh can build a candidate,
 * inspect it, and decide whether it is good enough to replace what is already
 * published.
 */
import { HOLDINGS, SLEEVES, FX_PAIRS, BASE_CURRENCY, HEDGE, FACTORS } from "./holdings.js";
import {
  fetchSeriesWithRetry,
  describe,
  deviations,
  toUsdSeries,
  portfolioIndex,
  logReturns,
  correlation,
  hedgedSeries,
  weeklyReturns,
  alignWeekly,
  ols,
  trackingStats,
} from "./analytics.js";

const noop = () => {};

async function loadFx(log) {
  const fx = {};
  for (const [ccy, pair] of Object.entries(FX_PAIRS)) {
    if (pair === null) {
      fx[ccy] = { rate: 1, pair: "—", invert: false, points: [], quoted: 1 };
      continue;
    }
    // Derived, not assumed: `USDBRL=X` and `USDGBP=X` quote USD -> CCY and
    // must be divided; a `GBPUSD=X`-style pair already quotes CCY -> USD.
    // Getting this backwards silently inflates a position by the square of the
    // rate, which is why it is computed from the symbol rather than hardcoded.
    const invert = !pair.endsWith("USD=X");
    try {
      const { meta, points } = await fetchSeriesWithRetry(pair, "1y");
      const quoted = meta.regularMarketPrice;
      fx[ccy] = { pair, invert, quoted, rate: invert ? 1 / quoted : quoted, points };
      log(`fx  ${ccy.padEnd(4)} ${pair.padEnd(10)} ${quoted}`);
    } catch (err) {
      // Recorded rather than thrown: the validator decides whether a missing
      // rate is fatal, since one broken pair only affects its own positions.
      fx[ccy] = { pair, invert, quoted: null, rate: null, points: [], error: String(err.message) };
      log(`ERR ${ccy.padEnd(4)} ${pair.padEnd(10)} ${err.message}`);
    }
  }
  return fx;
}

export async function buildSnapshot({ log = noop } = {}) {
  const fx = await loadFx(log);
  const positions = [];
  // Hedged series are needed for the hedged curve but not carried in the
  // snapshot: only their stats are, which keeps the committed file small.
  const hedgedByTicker = new Map();

  for (const h of HOLDINGS) {
    if (h.priced === "manual") {
      // No public quote exists. Carried flat at the last primary round.
      positions.push({
        ...h,
        price: h.manualMark.price,
        currency: h.currency,
        usdPoints: [],
        manual: true,
      });
      log(`--  ${h.ticker.padEnd(10)} manual mark ${h.manualMark.price}`);
      continue;
    }

    try {
      const { meta, points } = await fetchSeriesWithRetry(h.ticker, "1y");
      const ccy = meta.currency ?? h.currency;
      const rate = fx[ccy];

      // Trust the exchange's answer over the declared currency, but say so.
      // A ticker that silently changes denomination -- a relisting, a wrong
      // suffix -- would otherwise be converted with the wrong rate and look
      // merely surprising rather than broken.
      if (meta.currency && meta.currency !== h.currency) {
        log(`WARN ${h.ticker.padEnd(10)} quoted in ${meta.currency}, holdings.js declares ${h.currency}`);
      }

      // A non-USD position with no FX series cannot be converted. Falling back
      // to the local series would silently label won or reais as dollars, so
      // the USD side is left empty and the position is flagged instead.
      const convertible = ccy === "USD" || rate?.points?.length > 0;
      const usdPoints = convertible
        ? toUsdSeries(points, rate?.points ?? [], rate?.invert ?? false)
        : [];
      if (!convertible) {
        log(`WARN ${h.ticker.padEnd(10)} no ${ccy} rate — excluded from USD figures`);
      }

      const hedged = hedgedSeries(points, ccy, HEDGE.ratesPct, BASE_CURRENCY);
      if (hedged.length) hedgedByTicker.set(h.ticker, hedged);
      else log(`WARN ${h.ticker.padEnd(10)} no ${ccy} hedge rate — excluded from hedged figures`);

      positions.push({
        ...h,
        currencyMismatch: Boolean(meta.currency && meta.currency !== h.currency),
        fxMissing: !convertible,
        currency: ccy,
        exchange: meta.fullExchangeName,
        price: meta.regularMarketPrice,
        // Derived from the series, NOT from `meta.chartPreviousClose`, which is
        // relative to the requested range: on a 1y fetch it returns the close
        // from a year ago, so using it makes a day-change column report an
        // annual move. Verified: NBIS reports 75.33 on range=1y and 148.22 on
        // range=10d for the same session.
        previousClose: points.at(-2)?.c ?? null,
        rangePreviousClose: meta.chartPreviousClose,
        quoteTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
        priceUsd: usdPoints.at(-1)?.c ?? null,
        local: describe(points),
        usd: describe(usdPoints),
        hedged: describe(hedged),
        // Deviation block: how far today sits from this position own history.
        dev: deviations(points),
        usdPoints,
      });
      log(`ok  ${h.ticker.padEnd(10)} ${meta.regularMarketPrice} ${ccy}`);
    } catch (err) {
      log(`ERR ${h.ticker.padEnd(10)} ${err.message}`);
      positions.push({ ...h, price: null, error: String(err.message), usdPoints: [] });
    }
  }

  // How much of the measured window each position actually covers. A fund
  // launched three weeks ago is not missing data by accident -- it did not
  // exist. The curve renormalises over whatever is present on each date, so
  // without this the headline return silently describes a different book than
  // the one listed.
  const starts = positions.filter((p) => p.usdPoints.length > 1).map((p) => p.usdPoints[0].t);
  const ends = positions.filter((p) => p.usdPoints.length > 1).map((p) => p.usdPoints.at(-1).t);
  if (starts.length) {
    const windowStart = Math.min(...starts);
    const windowEnd = Math.max(...ends);
    const span = windowEnd - windowStart || 1;
    for (const p of positions) {
      if (p.usdPoints.length < 2) {
        p.coverage = 0;
        continue;
      }
      p.coverage = Math.min(1, (windowEnd - p.usdPoints[0].t) / span);
      p.partial = p.coverage < 0.95;
      if (p.partial) {
        log(
          `WARN ${p.ticker.padEnd(10)} only ${(p.coverage * 100).toFixed(0)}% of the window ` +
            `(from ${new Date(p.usdPoints[0].t).toISOString().slice(0, 10)})`
        );
      }
    }
  }

  // Positions without a series are dropped from the curve rather than held
  // flat -- a constant would damp measured volatility and flatter the book.
  const priced = positions.filter((p) => p.usdPoints.length > 1);
  const curve = portfolioIndex(priced.map((p) => ({ weight: p.weight, points: p.usdPoints })));

  const returnsByTicker = Object.fromEntries(priced.map((p) => [p.ticker, logReturns(p.usdPoints)]));
  const correlations = {};
  for (const anchor of ["PLTR", "GC=F"]) {
    if (!returnsByTicker[anchor]) continue;
    correlations[anchor] = {};
    for (const p of priced) {
      const c = correlation(returnsByTicker[anchor], returnsByTicker[p.ticker]);
      if (c) correlations[anchor][p.ticker] = Number(c.rho.toFixed(3));
    }
  }

  const curveHedged = portfolioIndex(
    priced
      .filter((p) => hedgedByTicker.has(p.ticker))
      .map((p) => ({ weight: p.weight, points: hedgedByTicker.get(p.ticker) }))
  );

  const proxies = await buildProxies(positions, priced, curve, log);
  const factors = await buildFactors(priced, curve, log);

  return {
    asOf: Date.now(),
    base: BASE_CURRENCY,
    source: "Yahoo Finance chart API (v8), daily closes",
    fx: Object.fromEntries(
      Object.entries(fx).map(([k, v]) => [k, { pair: v.pair, rate: v.rate, quoted: v.quoted }])
    ),
    positions,
    curve,
    curveStats: describe(curve),
    curveHedged,
    curveHedgedStats: describe(curveHedged),
    hedge: {
      asOf: HEDGE.asOf,
      ratesPct: HEDGE.ratesPct,
      sources: HEDGE.sources,
      // Annual carry a USD investor earns (+) or pays (-) to hedge each currency.
      carryPct: Object.fromEntries(
        Object.entries(HEDGE.ratesPct)
          .filter(([c]) => c !== BASE_CURRENCY)
          .map(([c, r]) => [c, Number((HEDGE.ratesPct[BASE_CURRENCY] - r).toFixed(3))])
      ),
    },
    proxies,
    factors,
    correlations,
    excludedFromCurve: positions.filter((p) => !p.usdPoints?.length).map((p) => p.ticker),
    failures: positions.filter((p) => p.error).map((p) => ({ ticker: p.ticker, error: p.error })),
  };
}

/**
 * Decide whether a freshly built snapshot is fit to publish.
 *
 * The failure mode this exists to prevent is silent corruption: an unattended
 * job replacing a good page with one where half the book reads "—", or where a
 * broken FX rate has moved every foreign position by 40% overnight. Refusing to
 * publish and leaving yesterday's page up is always the better outcome.
 *
 * @returns {{ok: boolean, problems: string[], warnings: string[], moves: object[]}}
 */
export function validateSnapshot(next, previous) {
  const problems = [];
  const warnings = [];

  const resolved = next.positions.filter((p) => p.price != null).length;
  const expected = next.positions.length;
  if (resolved < expected - 2) {
    problems.push(`only ${resolved}/${expected} positions resolved a price`);
  } else if (resolved < expected) {
    warnings.push(`${expected - resolved} position(s) failed: ${next.failures.map((f) => f.ticker).join(", ")}`);
  }

  if (next.curve.length < 200) {
    problems.push(`curve has ${next.curve.length} points, expected >= 200`);
  }

  for (const [ccy, f] of Object.entries(next.fx)) {
    if (f.rate == null) problems.push(`FX rate missing for ${ccy}`);
  }

  // A position that could not be converted is missing from every USD figure,
  // including the curve -- which would quietly change what the headline return
  // even describes.
  const unconvertible = next.positions.filter((p) => p.fxMissing).map((p) => p.ticker);
  if (unconvertible.length) {
    problems.push(`no FX conversion for ${unconvertible.join(", ")} — USD figures would be incomplete`);
  }

  const mismatched = next.positions.filter((p) => p.currencyMismatch);
  for (const p of mismatched) {
    warnings.push(`${p.ticker} is quoted in ${p.currency}, which is not what holdings.js declares`);
  }

  // A warning, not a rejection: short history is a true fact about a newly
  // listed fund, not a data fault. It has to be visible, because it changes
  // what the headline return means.
  for (const p of next.positions.filter((x) => x.partial)) {
    warnings.push(
      `${p.ticker} covers only ${(p.coverage * 100).toFixed(0)}% of the window — headline returns exclude it for the rest`
    );
  }

  // Compare against the last good snapshot to catch data faults that look
  // plausible in isolation.
  const moves = [];
  if (previous?.positions?.length) {
    const before = new Map(previous.positions.map((p) => [p.ticker, p.price]));
    for (const p of next.positions) {
      const was = before.get(p.ticker);
      if (was == null || p.price == null || !was) continue;
      const move = ((p.price - was) / was) * 100;
      moves.push({ ticker: p.ticker, was, now: p.price, move });
    }
    // The threshold has to widen with the gap between snapshots. A 25% move
    // overnight is suspicious; the same move after the job has been idle for a
    // fortnight is just what markets did. Volatility scales with the square
    // root of time, so the tolerance does too -- capped, because past a point
    // a "move" that large is a split or a bad print regardless of the gap.
    const ageDays = Math.max((next.asOf - previous.asOf) / 864e5, 1);
    const threshold = Math.min(80, 25 * Math.sqrt(ageDays));

    const violent = moves.filter((m) => Math.abs(m.move) > threshold);
    // One position can genuinely move that far on earnings. Several at once, on
    // a book this diversified, means the data is wrong -- not the market.
    if (violent.length >= 3) {
      problems.push(
        `${violent.length} positions moved >${threshold.toFixed(0)}% in ${ageDays.toFixed(1)} days ` +
          `(${violent.map((m) => `${m.ticker} ${m.move.toFixed(0)}%`).join(", ")}) — suspect data, not market`
      );
    } else if (violent.length) {
      warnings.push(violent.map((m) => `${m.ticker} moved ${m.move.toFixed(1)}%`).join("; "));
    }

    // A split reprices one line by a clean multiple without any economics. The
    // cluster check above would clear a lone 50% move, so flag it separately --
    // the series needs adjusting before the number means anything.
    for (const m of moves) {
      for (const ratio of [2, 3, 4, 0.5, 1 / 3, 0.25]) {
        if (Math.abs(m.now / m.was - ratio) < 0.02) {
          warnings.push(`${m.ticker} moved by almost exactly ${ratio}x — possible split or bad print`);
        }
      }
    }

    if (next.asOf <= previous.asOf) problems.push("new snapshot is not newer than the previous one");
  }

  return { ok: problems.length === 0, problems, warnings, moves };
}

/** Average daily traded value in USD over the trailing `n` sessions. */
function avgDollarVolume(points, n = 50) {
  const tail = points.slice(-n).filter((p) => typeof p.v === "number" && p.v > 0);
  return tail.length ? tail.reduce((a, p) => a + p.v * p.c, 0) / tail.length : null;
}

/**
 * Tradable stand-ins for lines that cannot be bought directly.
 *
 * The headline book holds ^KS11 because the index is the cleanest statement of
 * the view. A real portfolio has to hold something with a ticker, and pays for
 * it in tracking error, fees and a different trading clock. This measures that
 * gap rather than asserting it, and re-runs the curve with the proxy swapped in
 * so the cost shows up at book level, not just line level.
 *
 * Never fatal: a failed proxy fetch is recorded and the refresh continues,
 * because the book itself is unaffected.
 */
async function buildProxies(positions, priced, curve, log) {
  const out = [];
  for (const p of positions.filter((x) => x.proxy)) {
    const px = p.proxy;
    try {
      const { meta, points } = await fetchSeriesWithRetry(px.ticker, "1y");
      if ((meta.currency ?? BASE_CURRENCY) !== BASE_CURRENCY) {
        throw new Error(`quoted in ${meta.currency}, expected ${BASE_CURRENCY}`);
      }
      const proxyUsd = points.map((q) => ({ t: q.t, c: q.c }));
      const usd = describe(proxyUsd);
      const tracking =
        p.usdPoints?.length > 1
          ? trackingStats(p.usdPoints, proxyUsd, { horizon: 5, lagSessions: px.clock_lag_sessions ?? 0 })
          : null;

      // The same book, with the proxy held in place of the index.
      const investableStats = describe(
        portfolioIndex(
          priced.map((q) => ({
            weight: q.weight,
            points: q.ticker === p.ticker ? proxyUsd : q.usdPoints,
          }))
        )
      );
      const headline = describe(curve);
      const gap = (a, b) => (a == null || b == null ? null : a - b);

      out.push({
        for: p.ticker,
        ticker: px.ticker,
        name: px.name,
        venue: px.venue,
        expenseRatioPct: px.expense_ratio_pct,
        notes: p.trackingNotes ?? null,
        price: meta.regularMarketPrice,
        usd,
        tracking,
        // Tracking difference: what the proxy returned minus what the index did.
        trackingDiff: { ytd: gap(usd.ytd, p.usd?.ytd), ret1y: gap(usd.ret1y, p.usd?.ret1y) },
        avgDollarVolume: avgDollarVolume(points),
        investableStats,
        bookImpact: {
          ytd: gap(investableStats.ytd, headline.ytd),
          ret1y: gap(investableStats.ret1y, headline.ret1y),
          vol: gap(investableStats.vol, headline.vol),
        },
      });
      log(
        `ok  ${px.ticker.padEnd(10)} proxy for ${p.ticker}` +
          (tracking ? ` — TE ${tracking.trackingErrorPct.toFixed(1)}%, rho ${tracking.correlation?.toFixed(2)}` : "")
      );
    } catch (err) {
      log(`WARN ${px.ticker.padEnd(10)} proxy for ${p.ticker} unavailable: ${err.message}`);
      out.push({ for: p.ticker, ticker: px.ticker, name: px.name, error: String(err.message) });
    }
  }
  return out;
}

/**
 * Factor exposure: does the Ballast bucket actually behave differently from
 * the thesis it is meant to hedge?
 *
 * Weekly USD returns of the book, each bucket and each Ballast line, regressed
 * on a tech factor and an energy factor. Reported as descriptive statistics
 * with t-stats, not as proof: a year is ~50 weekly observations, and an
 * annualised intercept estimated on that is almost never distinguishable from
 * zero. R² and the betas are the informative part.
 *
 * Never fatal, for the same reason as the proxies.
 */
async function buildFactors(priced, curve, log) {
  try {
    const factorSeries = [];
    for (const f of FACTORS) {
      const inBook = priced.find((p) => p.ticker === f.ticker);
      const pts = inBook
        ? inBook.usdPoints
        : (await fetchSeriesWithRetry(f.ticker, "1y")).points.map((q) => ({ t: q.t, c: q.c }));
      factorSeries.push({ ...f, weekly: weeklyReturns(pts) });
    }

    const bucketCurve = (ids) =>
      portfolioIndex(
        priced.filter((p) => ids.includes(p.sleeve)).map((p) => ({ weight: p.weight, points: p.usdPoints }))
      );
    const ids = Object.keys(SLEEVES);
    // Energy + Compute combined: the thesis, as one series.
    const thesis = weeklyReturns(bucketCurve(ids.filter((id) => id !== "ballast")));

    const subjects = [
      { key: "book", label: "Whole book", kind: "book", points: curve },
      ...ids.map((id) => ({ key: id, label: SLEEVES[id].name, kind: "bucket", points: bucketCurve([id]) })),
      ...priced
        .filter((p) => p.sleeve === "ballast")
        .map((p) => ({ key: p.ticker, label: p.ticker, kind: "position", points: p.usdPoints })),
    ];

    const rows = [];
    for (const s of subjects) {
      const y = weeklyReturns(s.points);
      const { cols } = alignWeekly(y, ...factorSeries.map((f) => f.weekly));
      const fit = ols(cols[0], cols.slice(1));
      if (!fit) {
        // Kept as a row rather than dropped: a line too young to regress is a
        // fact the reader should see, not a gap they have to notice.
        rows.push({ key: s.key, label: s.label, kind: s.kind, n: cols[0].length, insufficient: true });
        continue;
      }

      // Correlation with the thesis: the direct test of "what survives if the
      // first two buckets are the same bet". Only meaningful for Ballast and
      // its lines; Energy and Compute are part of the series themselves.
      let rhoThesis = null;
      if (s.key === "ballast" || s.kind === "position") {
        const [a, b] = alignWeekly(y, thesis).cols;
        const one = ols(a, [b]);
        if (one?.r2 != null) rhoThesis = Math.sign(one.coef[1]) * Math.sqrt(Math.max(one.r2, 0));
      }

      rows.push({
        key: s.key,
        label: s.label,
        kind: s.kind,
        n: fit.n,
        alphaAnnPct: fit.coef[0] * 52 * 100,
        alphaT: fit.t[0],
        betas: Object.fromEntries(factorSeries.map((f, i) => [f.id, fit.coef[i + 1]])),
        tStats: Object.fromEntries(factorSeries.map((f, i) => [f.id, fit.t[i + 1]])),
        r2: fit.r2,
        rhoThesis,
      });
    }
    log(`ok  factors    ${rows.length} regressions on ${FACTORS.map((f) => f.ticker).join(" + ")}`);
    return {
      frequency: "weekly",
      factors: FACTORS.map(({ id, ticker, name }) => ({ id, ticker, name })),
      rows,
    };
  } catch (err) {
    log(`WARN factors unavailable: ${err.message}`);
    return { error: String(err.message), factors: FACTORS, rows: [] };
  }
}
