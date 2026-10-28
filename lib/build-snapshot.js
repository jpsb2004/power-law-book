/**
 * Builds a snapshot object from live public market data.
 *
 * Kept separate from the CLI so the unattended refresh can build a candidate,
 * inspect it, and decide whether it is good enough to replace what is already
 * published.
 */
import {
  HOLDINGS,
  SLEEVES,
  FX_PAIRS,
  BASE_CURRENCY,
  HEDGE,
  FACTORS,
  BENCHMARKS,
  MARKET,
  RISK_FREE,
  BASE_REBALANCE,
  COSTS,
  THESIS,
  CONCENTRATION_GROUPS,
} from "./holdings.js";
import {
  fetchSeriesWithRetry,
  describe,
  deviations,
  toUsdSeries,
  logReturns,
  correlation,
  hedgedSeries,
  weeklyReturns,
  alignWeekly,
  ols,
  olsMin,
  trackingStats,
  dayKey,
  windowed,
  riskStats,
  relativeStats,
  riskContributions,
  rebalancedIndex,
  dividendYields,
} from "./analytics.js";
import { buildLongRun } from "./longrun.js";
import { buildFundamentals } from "./fundamentals.js";
import { buildStructure } from "./structure.js";
import { crossCheck } from "./crosscheck.js";

const noop = () => {};

/**
 * The book's index under the base-case rebalancing rule. Every curve that
 * stands for "the book" -- the headline, the book re-run with an index, the
 * bucket curves, the 60/40 blend -- goes through here, so they all share one
 * method and differ only in their legs.
 */
const bookIndex = (legs) => rebalancedIndex(legs, { rebalance: BASE_REBALANCE }).points;

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

/**
 * Dated short rates for the hedge carry (review item P1-5), where a free daily
 * source exists: USD from the 13-week T-bill yield (^IRX), BRL from the
 * Central Bank's daily CDI (SGS series 4389, annualised). Other currencies
 * keep the dated policy-rate table in positions.json. Never fatal: a missing
 * series falls back to the table and the page says which was used.
 */
async function loadRateSeries(log) {
  const out = {};
  const sources = {};
  try {
    const { points } = await fetchSeriesWithRetry("^IRX", "2y");
    out.USD = new Map(points.map((p) => [dayKey(p.t), p.c]));
    sources.USD = "13-week US T-bill yield (Yahoo ^IRX), daily";
  } catch (err) {
    log(`WARN rates     USD series unavailable (${err.message}) — flat table used`);
  }
  try {
    const d = new Date(Date.now() - 2 * 365 * 864e5);
    const from = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados?formato=json&dataInicial=${from}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    const m = new Map();
    for (const r of rows) {
      const [dd, mm, yy] = r.data.split("/");
      const v = Number(r.valor);
      if (Number.isFinite(v)) m.set(`${yy}-${mm}-${dd}`, v);
    }
    if (m.size < 100) throw new Error(`only ${m.size} observations`);
    out.BRL = m;
    sources.BRL = "CDI, annualised (Banco Central do Brasil, SGS 4389), daily";
  } catch (err) {
    log(`WARN rates     BRL series unavailable (${err.message}) — flat table used`);
  }
  const latest = Object.fromEntries(
    Object.entries(out).map(([c, m]) => [c, m.get([...m.keys()].sort().at(-1))])
  );
  log(`ok  rates      ${Object.entries(latest).map(([c, v]) => `${c} ${v.toFixed(2)}%`).join(", ")} (dated)`);
  return { series: out, sources, latest };
}

export async function buildSnapshot({ log = noop } = {}) {
  const fx = await loadFx(log);
  const rates = await loadRateSeries(log);
  const positions = [];
  // Hedged series are needed for the hedged curve but not carried in the
  // snapshot: only their stats are, which keeps the committed file small.
  const hedgedByTicker = new Map();
  // Distribution yields by ex-date, for the withholding drag; not stored.
  const dividendsByTicker = new Map();
  const hedgedShiftByTicker = new Map();
  // Local series with the unadjusted close, for the second-source check.
  const localByTicker = new Map();

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
      // Daily closes only: a session still open at run time is dropped rather
      // than published as if it had closed (see fetchSeries).
      const { meta, points, sessionOpen, lastBar } = await fetchSeriesWithRetry(h.ticker, "1y", {
        completedOnly: true,
      });
      if (!points.length) throw new Error(`${h.ticker}: no completed daily bar`);
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

      dividendsByTicker.set(h.ticker, dividendYields(points));
      localByTicker.set(h.ticker, points.slice(-30));
      const hedged = hedgedSeries(points, ccy, HEDGE.ratesPct, BASE_CURRENCY, { rateSeries: rates.series });
      // The same hedge one point a year dearer: the sensitivity to the
      // offshore basis the policy-rate model ignores.
      if (ccy !== BASE_CURRENCY) {
        hedgedShiftByTicker.set(h.ticker, hedgedSeries(points, ccy, HEDGE.ratesPct, BASE_CURRENCY, { rateSeries: rates.series, shiftPct: -1 }));
      }
      if (hedged.length) hedgedByTicker.set(h.ticker, hedged);
      else log(`WARN ${h.ticker.padEnd(10)} no ${ccy} hedge rate — excluded from hedged figures`);

      positions.push({
        ...h,
        currencyMismatch: Boolean(meta.currency && meta.currency !== h.currency),
        fxMissing: !convertible,
        currency: ccy,
        exchange: meta.fullExchangeName,
        // The last completed close, so price, previousClose and the deviation
        // block all describe the same session. `meta.regularMarketPrice` can be
        // a mid-session print for a market that is still open.
        price: points.at(-1).c,
        lastBar,
        sessionOpen,
        livePrice: meta.regularMarketPrice,
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
      log(
        `ok  ${h.ticker.padEnd(10)} ${points.at(-1).c} ${ccy}  close ${lastBar}` +
          (sessionOpen ? " (session open, live bar dropped)" : "")
      );
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

  // One leg per line and view, carrying its cost parameters and distributions
  // so the same legs serve the gross headline and the net-of-cost variants.
  const legsFor = (view) =>
    priced
      .filter((p) => view === "usd" || hedgedByTicker.has(p.ticker))
      .map((p) => ({
        key: p.ticker,
        weight: p.weight,
        points: view === "usd" ? p.usdPoints : hedgedByTicker.get(p.ticker),
        dividends: dividendsByTicker.get(p.ticker),
        ...COSTS.forLine(p.currency, BASE_CURRENCY),
      }));
  const usdLegs = legsFor("usd");
  const hedgedLegs = legsFor("hedged");
  const curve = bookIndex(usdLegs);

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

  const curveHedged = bookIndex(hedgedLegs);
  // Hedged book with every non-USD hedge 1pp a year dearer (NDF basis).
  const curveHedgedShift = bookIndex(
    hedgedLegs.map((l) => ({ ...l, points: hedgedShiftByTicker.get(l.key) ?? l.points }))
  );
  // The book seen from Brazil: the unhedged USD curve converted to BRL at each
  // day's rate. USD stays the base because most lines and every benchmark are
  // dollar assets; this is what a real-denominated investor would have seen.
  const brl = fx.BRL;
  const curveBrl = brl?.points?.length ? toUsdSeries(curve, brl.points, false) : [];
  const rebalancing = buildRebalancing({ usd: usdLegs, hedged: hedgedLegs }, log);

  const proxies = [
    ...(await buildProxies(positions, priced, curve, log)),
    ...(await buildReferences(positions, priced, curve, fx, log)),
  ];
  // Three-year, three-factor exposure (P1-2), tail risk and stress (P1-1).
  // Falls back to the one-year regression if the long history is unavailable.
  const longRun = await buildLongRun({ priced, curve, log });
  const factors = longRun.factors ?? (await buildFactors(priced, curve, log));
  const benchmarks = await buildBenchmarks(priced, curve, curveHedged, log);

  // Share of portfolio variance per line and per bucket, for both views. Equal
  // capital is not equal risk; this is the table that shows by how much.
  const riskFor = (legs, book) => {
    const rc = riskContributions(legs, book);
    if (!rc) return null;
    const bySleeve = {};
    for (const r of rc.rows) {
      const p = priced.find((q) => q.ticker === r.key);
      const b = (bySleeve[p.sleeve] ??= { sleeve: p.sleeve, weightPct: 0, riskSharePct: 0 });
      b.weightPct += r.weightPct;
      b.riskSharePct += r.riskSharePct ?? 0;
    }
    return { ...rc, buckets: Object.values(bySleeve) };
  };
  const risk = {
    method: "Euler decomposition on weekly log returns: weight × cov(line, book) ÷ var(book)",
    usd: riskFor(priced.map((p) => ({ key: p.ticker, weight: p.weight, points: p.usdPoints })), curve),
    hedged: riskFor(
      priced
        .filter((p) => hedgedByTicker.has(p.ticker))
        .map((p) => ({ key: p.ticker, weight: p.weight, points: hedgedByTicker.get(p.ticker) })),
      curveHedged
    ),
  };
  log(
    `ok  risk       ${risk.hedged?.rows.length ?? 0} lines, shares sum to ${risk.hedged?.sumPct.toFixed(1)}% (hedged)`
  );

  // How many bets the twenty lines are (P1-3), and what each is priced at (P1-4).
  const structure = buildStructure(
    priced.map((p) => ({ ticker: p.ticker, weight: p.weight, sleeve: p.sleeve, points: p.usdPoints })),
    CONCENTRATION_GROUPS,
    risk.usd?.rows ?? []
  );
  if (structure) {
    log(`ok  structure  ${structure.lines} lines, effective bets ${structure.enb.toFixed(1)}, first component ${structure.firstPcSharePct.toFixed(0)}% of book variance`);
  }
  const fundamentals = await buildFundamentals(
    priced.map((p) => ({ ticker: p.ticker, kind: p.kind, weight: p.weight })),
    { log }
  );
  const thesis = await buildThesisChecks(priced, log);
  const sourceCheck = await crossCheck(localByTicker, { log });

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
    hedge: (() => {
      // Latest rate per currency: the dated series where there is one,
      // otherwise the table. Carry is what a USD investor earns (+) or pays
      // (-) a year to hedge each currency at today's rates.
      const now = { ...HEDGE.ratesPct, ...rates.latest };
      const hs = describe(curveHedged);
      const ss = describe(curveHedgedShift);
      return {
        asOf: HEDGE.asOf,
        ratesPct: now,
        tableRatesPct: HEDGE.ratesPct,
        sources: { ...HEDGE.sources, ...rates.sources },
        dated: Object.keys(rates.series),
        carryPct: Object.fromEntries(
          Object.entries(now)
            .filter(([c]) => c !== BASE_CURRENCY)
            .map(([c, r]) => [c, Number((now[BASE_CURRENCY] - r).toFixed(3))])
        ),
        basisSensitivity: {
          shiftPct: -1,
          ytd: ss.ytd,
          ret1y: ss.ret1y,
          deltaYtd: ss.ytd != null && hs.ytd != null ? ss.ytd - hs.ytd : null,
          delta1y: ss.ret1y != null && hs.ret1y != null ? ss.ret1y - hs.ret1y : null,
        },
      };
    })(),
    // The same unhedged book measured in reais (review item P1-5).
    baseViews: curveBrl.length > 1
      ? { BRL: { stats: describe(curveBrl), fxRate: brl.quoted, usdStats: describe(curve) } }
      : {},
    proxies,
    factors,
    benchmarks,
    tail: longRun.tail ?? null,
    structure,
    fundamentals,
    thesis,
    sourceCheck,
    stress: longRun.stress ?? null,
    risk,
    rebalancing,
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

  // Stale-bar signature. A real close almost never equals the previous close to
  // the fourth decimal; several doing so at once means the final bar was copied
  // from the day before and every day-change and sigma built on it is a
  // fabricated zero. Rejecting keeps yesterday's correct page up instead.
  const quoted = next.positions.filter((p) => p.dev && !p.manual);
  const flat = quoted.filter((p) => p.dev.dayReturnPct === 0).map((p) => p.ticker);
  if (flat.length >= 4) {
    problems.push(
      `${flat.length} positions have a day-change of exactly 0 (${flat.join(", ")}) — ` +
        "final bar looks copied from the prior session"
    );
  } else if (flat.length) {
    warnings.push(`${flat.join(", ")} closed exactly flat — check the final bar`);
  }

  // Each venue has its own last close, but none should trail the freshest by
  // more than a long weekend plus a holiday: that is a stalled or broken symbol.
  const bars = quoted.filter((p) => p.lastBar).map((p) => [p.ticker, p.lastBar]);
  if (bars.length) {
    const newest = bars.map(([, d]) => d).sort().at(-1);
    for (const [ticker, d] of bars) {
      const gap = (Date.parse(newest) - Date.parse(d)) / 864e5;
      if (gap > 5) warnings.push(`${ticker} last close is ${d}, ${gap.toFixed(0)} days behind the book (${newest})`);
    }
  }

  // Second source: a Yahoo close more than 0.5% from Nasdaq's is a data fault
  // worth a look, though not grounds to reject (Nasdaq may lag a correction).
  for (const r of next.sourceCheck?.rows ?? []) {
    if (r.maxAbsDiffPct > 0.5) {
      warnings.push(`${r.ticker} differs from Nasdaq by ${r.maxAbsDiffPct.toFixed(2)}% on ${r.worst.day}`);
    }
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
      const { meta, points } = await fetchSeriesWithRetry(px.ticker, "1y", { completedOnly: true });
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
        bookIndex(
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
        price: points.at(-1)?.c ?? null,
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
 * A held fund against the index it stands in for.
 *
 * Since 14 Oct 2026 the book holds EWY rather than ^KS11: every line must be
 * buyable. The index is still the cleanest statement of the Korea view, so it
 * is kept as a reference and the gap is measured, not assumed. The gap is a
 * *difference in exposure* -- MSCI's 25/50 caps, New York trading hours, the
 * fund's fee -- not a cost: it can run well ahead of the index as easily as
 * behind it.
 *
 * Output mirrors buildProxies so one renderer serves both: `for` is the index,
 * `ticker` the held fund, `held: true` says which side is in the book.
 * Never fatal: a failed reference fetch leaves the book untouched.
 */
async function buildReferences(positions, priced, curve, fx, log) {
  const out = [];
  for (const p of positions.filter((x) => x.reference && x.usdPoints?.length > 1)) {
    const ref = p.reference;
    try {
      const { points } = await fetchSeriesWithRetry(ref.ticker, "1y", { completedOnly: true });
      const rate = fx[ref.currency];
      if (ref.currency !== BASE_CURRENCY && !rate?.points?.length) {
        throw new Error(`no ${ref.currency} rate to convert the index`);
      }
      const indexUsd =
        ref.currency === BASE_CURRENCY ? points : toUsdSeries(points, rate.points, rate.invert);
      const indexStats = describe(indexUsd);
      // Same orientation as before the swap: the Seoul close is the target,
      // the New York fund is paired with the session before it.
      const tracking = trackingStats(indexUsd, p.usdPoints, {
        horizon: 5,
        lagSessions: ref.clock_lag_sessions ?? 0,
      });

      // The same book with the index held in place of the fund.
      const indexBookStats = describe(
        bookIndex(
          priced.map((q) => ({ weight: q.weight, points: q.ticker === p.ticker ? indexUsd : q.usdPoints }))
        )
      );
      const headline = describe(curve);
      const gap = (a, b) => (a == null || b == null ? null : a - b);

      out.push({
        held: true,
        for: ref.ticker,
        forName: ref.name,
        ticker: p.ticker,
        name: p.name,
        venue: p.venue,
        expenseRatioPct: p.expenseRatioPct,
        notes: p.trackingNotes ?? null,
        price: p.price,
        usd: p.usd,
        indexUsd: indexStats,
        tracking,
        // Fund minus index, as before the swap.
        trackingDiff: { ytd: gap(p.usd?.ytd, indexStats.ytd), ret1y: gap(p.usd?.ret1y, indexStats.ret1y) },
        avgDollarVolume: avgDollarVolume(p.usdPoints),
        indexBookStats,
        // Book as held (fund) minus the book holding the index instead.
        bookImpact: {
          ytd: gap(headline.ytd, indexBookStats.ytd),
          ret1y: gap(headline.ret1y, indexBookStats.ret1y),
          vol: gap(headline.vol, indexBookStats.vol),
        },
      });
      log(
        `ok  ${ref.ticker.padEnd(10)} reference for ${p.ticker}` +
          (tracking ? ` — TE ${tracking.trackingErrorPct.toFixed(1)}%, rho ${tracking.correlation?.toFixed(2)}` : "")
      );
    } catch (err) {
      log(`WARN ${ref.ticker.padEnd(10)} reference for ${p.ticker} unavailable: ${err.message}`);
      out.push({ held: true, for: ref.ticker, ticker: p.ticker, name: p.name, error: String(err.message) });
    }
  }
  return out;
}

/**
 * The thesis's own falsifiers, read against live data (review item P1-4).
 * Each test is stated in data/positions.json; this only fetches the reading
 * and says whether the stated condition is met. Never fatal.
 */
async function buildThesisChecks(priced, log) {
  if (!THESIS) return null;
  const checks = [];
  for (const f of THESIS.falsifiers ?? []) {
    const c = { key: f.key, name: f.name, test: f.test, kind: f.kind, reading: null, unit: null, triggered: null };
    try {
      if (f.kind === "buckets") {
        const one = (id) =>
          describe(bookIndex(priced.filter((p) => p.sleeve === id).map((p) => ({ weight: p.weight, points: p.usdPoints })))).ret1y;
        const gap = one("compute") - one("energy");
        Object.assign(c, { reading: gap, unit: "pp", detail: "Compute minus Substrate, twelve months, USD", triggered: gap > f.threshold });
      } else if (f.ticker) {
        const { points } = await fetchSeriesWithRetry(f.ticker, "1y", { completedOnly: true });
        const last = points.at(-1).c;
        if (f.kind === "drawdown12m") {
          const r = (last / points[0].c - 1) * 100;
          Object.assign(c, { reading: r, unit: "%", detail: `${f.ticker}, twelve-month change`, triggered: r < f.threshold });
        } else if (f.kind === "fromHigh") {
          const r = (last / Math.max(...points.map((p) => p.c)) - 1) * 100;
          Object.assign(c, { reading: r, unit: "%", detail: `${f.ticker}, below twelve-month high`, triggered: r < f.threshold });
        } else if (f.kind === "level") {
          Object.assign(c, { reading: last, unit: "$", detail: `${f.ticker}, last close`, triggered: last < f.threshold });
        }
      }
    } catch (err) {
      c.error = String(err.message);
    }
    checks.push(c);
  }
  log(`ok  thesis     ${checks.filter((c) => c.triggered).length}/${checks.length} falsifiers triggered`);
  return { variantView: THESIS.variant_view, horizon: THESIS.horizon, reviewRules: THESIS.review_rules, checks };
}

/**
 * The same book under different rebalancing rules, gross and net of costs,
 * plus a reconciliation of the headline against the positions it is built
 * from (review item P0-5).
 *
 * Every variant runs over the same legs and dates, so the differences between
 * rows are the rebalancing rule and the costs, nothing else. Returns are over
 * the whole window (first to last close), the same span as the reconciliation.
 */
function buildRebalancing(legsByView, log) {
  const out = {
    base: BASE_REBALANCE,
    costs: {
      asOf: COSTS.asOf,
      note: COSTS.note,
      tradeBps: COSTS.tradeBps,
      fxSpreadBps: COSTS.fxSpreadBps,
      withholdingPct: COSTS.withholdingPct,
    },
  };
  for (const [view, legs] of Object.entries(legsByView)) {
    if (!legs.length) continue;
    const run = (key, label, rebalance, costs) => {
      const r = rebalancedIndex(legs, { rebalance, costs });
      const pts = r.points;
      return {
        key,
        label,
        rebalance,
        costs,
        windowRetPct: pts.length > 1 ? (pts.at(-1).c / pts[0].c - 1) * 100 : null,
        stats: describe(pts),
        rebalances: r.rebalances,
        turnoverPctPerYear: r.turnoverPctPerYear,
        tradingCostPct: r.tradingCostPct,
        withholdingPct: r.withholdingPct,
        _pts: pts,
      };
    };
    const rows = [
      run("base", `Rebalanced ${BASE_REBALANCE} (base case), gross`, BASE_REBALANCE, false),
      run("daily", "Rebalanced daily, gross", "daily", false),
      run("hold", "Buy and hold, gross", "never", false),
      run("base-net", `Rebalanced ${BASE_REBALANCE}, net of costs`, BASE_REBALANCE, true),
      run("hold-net", "Buy and hold, net of costs", "never", true),
    ];

    // Reconciliation: what each line returned over the same window, weighted.
    // Equal to buy-and-hold when every line trades from the first day; the
    // gap is lines that listed later and were bought by trimming the others.
    const base = rows[0]._pts;
    const startDay = dayKey(base[0].t);
    const endDay = dayKey(base.at(-1).t);
    let wsum = 0;
    let wtot = 0;
    const late = [];
    for (const l of legs) {
      const w = windowed(l.points, startDay, endDay);
      if (w.length < 2) continue;
      if (dayKey(w[0].t) > startDay) late.push(l.key);
      wsum += l.weight * (w.at(-1).c / w[0].c - 1);
      wtot += l.weight;
    }
    for (const r of rows) delete r._pts;
    const pick = (k) => rows.find((r) => r.key === k)?.windowRetPct ?? null;
    out[view] = {
      window: { start: startDay, end: endDay },
      rows,
      reconciliation: {
        weightedSumPct: wtot ? (wsum / wtot) * 100 : null,
        holdPct: pick("hold"),
        basePct: pick("base"),
        dailyPct: pick("daily"),
        lateListings: late,
      },
    };
  }
  const h = out.hedged ?? out.usd;
  if (h) {
    log(
      "ok  rebalance " +
        h.rows.map((r) => `${r.key} ${r.windowRetPct?.toFixed(1)}%`).join(" | ") +
        ` | weighted sum ${h.reconciliation.weightedSumPct?.toFixed(1)}%`
    );
  }
  return out;
}

/**
 * The book beside what a reader could have held instead (review item P0-1).
 *
 * Every series is cut to one shared window -- from the latest first print to
 * the earliest last print, by calendar date -- and rebased to 100 there, so no
 * line gets a head start. Benchmarks already in the book reuse its series.
 *
 * Never fatal, like the proxies and factors: the book is unaffected.
 */
async function buildBenchmarks(priced, curve, curveHedged, log) {
  try {
    const cache = new Map();
    const usdSeries = async (ticker) => {
      if (cache.has(ticker)) return cache.get(ticker);
      const inBook = priced.find((p) => p.ticker === ticker);
      let pts;
      if (inBook) {
        pts = inBook.usdPoints;
      } else {
        const { meta, points } = await fetchSeriesWithRetry(ticker, "1y", { completedOnly: true });
        if ((meta.currency ?? BASE_CURRENCY) !== BASE_CURRENCY) {
          throw new Error(`${ticker} is quoted in ${meta.currency}; benchmarks must be ${BASE_CURRENCY}`);
        }
        pts = points.map((q) => ({ t: q.t, c: q.c }));
      }
      cache.set(ticker, pts);
      return pts;
    };

    const benches = [];
    for (const b of BENCHMARKS) {
      const legs = [];
      for (const l of b.legs) legs.push({ weight: l.weight, points: await usdSeries(l.ticker) });
      benches.push({ ...b, points: legs.length === 1 ? legs[0].points : bookIndex(legs) });
    }
    const market = await usdSeries(MARKET);
    const rf = await usdSeries(RISK_FREE);

    const books = [
      { key: "book-hedged", label: "Book, FX-hedged USD", kind: "book", points: curveHedged },
      { key: "book-usd", label: "Book, unhedged USD", kind: "book", points: curve },
    ].filter((s) => s.points?.length > 1);
    const all = [...books, ...benches.map((b) => ({ key: b.id, label: b.label, kind: "benchmark", points: b.points }))];
    const startDay = all.map((s) => dayKey(s.points[0].t)).sort().at(-1);
    const endDay = all.map((s) => dayKey(s.points.at(-1).t)).sort()[0];

    const rfW = windowed(rf, startDay, endDay);
    const mktW = windowed(market, startDay, endDay);
    const rows = all.map((s) => {
      const w = windowed(s.points, startDay, endDay);
      return {
        key: s.key,
        label: s.label,
        kind: s.kind,
        stats: riskStats(w, { rfPoints: rfW, market: mktW }),
        points: w.map((p) => ({ t: p.t, c: Number(p.c.toFixed(3)) })),
        _w: w,
      };
    });

    const relative = [];
    for (const bk of rows.filter((r) => r.kind === "book")) {
      for (const bm of rows.filter((r) => r.kind === "benchmark")) {
        const rel = relativeStats(bk._w, bm._w);
        if (rel) relative.push({ book: bk.key, bench: bm.key, label: bm.label, ...rel });
      }
    }
    for (const r of rows) delete r._w;

    log(
      `ok  benchmarks ${BENCHMARKS.map((b) => b.id).join(", ")} over ${startDay} → ${endDay}` +
        rows.map((r) => ` | ${r.key} Sharpe ${r.stats?.sharpe?.toFixed(2)}`).join("")
    );
    return {
      window: { start: startDay, end: endDay },
      market: MARKET,
      riskFree: { ticker: RISK_FREE, annRetPct: rows[0]?.stats?.rfAnnPct ?? null },
      rows,
      relative,
    };
  } catch (err) {
    log(`WARN benchmarks unavailable: ${err.message}`);
    return { error: String(err.message), rows: [], relative: [] };
  }
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
        : (await fetchSeriesWithRetry(f.ticker, "1y", { completedOnly: true })).points.map((q) => ({
            t: q.t,
            c: q.c,
          }));
      factorSeries.push({ ...f, weekly: weeklyReturns(pts) });
    }

    const bucketCurve = (ids) =>
      bookIndex(
        priced.filter((p) => ids.includes(p.sleeve)).map((p) => ({ weight: p.weight, points: p.usdPoints }))
      );
    const ids = Object.keys(SLEEVES);
    // Every bucket but Ballast: the thesis, as one series.
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
      const fit = olsMin(cols[0], cols.slice(1));
      if (!fit) {
        // Kept as a row rather than dropped: a line too young to regress is a
        // fact the reader should see, not a gap they have to notice.
        rows.push({ key: s.key, label: s.label, kind: s.kind, n: cols[0].length, insufficient: true });
        continue;
      }

      // Correlation with the thesis: the direct test of "what survives if the
      // rest of the book is the same bet". Only meaningful for Ballast and its
      // lines; the other buckets are part of the series themselves.
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
