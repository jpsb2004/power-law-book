/**
 * Builds a snapshot object from live public market data.
 *
 * Kept separate from the CLI so the unattended refresh can build a candidate,
 * inspect it, and decide whether it is good enough to replace what is already
 * published.
 */
import { HOLDINGS, FX_PAIRS, BASE_CURRENCY } from "./holdings.js";
import {
  fetchSeriesWithRetry,
  describe,
  toUsdSeries,
  portfolioIndex,
  logReturns,
  correlation,
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

      positions.push({
        ...h,
        currencyMismatch: Boolean(meta.currency && meta.currency !== h.currency),
        fxMissing: !convertible,
        currency: ccy,
        exchange: meta.fullExchangeName,
        price: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose,
        quoteTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
        priceUsd: usdPoints.at(-1)?.c ?? null,
        local: describe(points),
        usd: describe(usdPoints),
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
