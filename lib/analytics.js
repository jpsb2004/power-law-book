/**
 * Quote fetching and return maths.
 *
 * Shared deliberately: the live app and the frozen snapshot must compute
 * returns the same way, or the published page and the running app will quietly
 * disagree about the same position.
 */

const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; power-law-book/0.1)" };

const MS_PER_DAY = 864e5;
const TRADING_DAYS = 252;

/**
 * Calendar-date key for a timestamp.
 *
 * Exchanges stamp their daily bars at their own local open, so the same
 * trading day arrives as a different epoch for Seoul, São Paulo and New York.
 * Joining on the raw timestamp multiplies one year into thousands of distinct
 * "dates"; every cross-market join here keys on this instead.
 */
export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Fetch one symbol's daily series, retrying transient upstream failures.
 *
 * The quote endpoint is free and unofficial: it rate-limits, and occasionally
 * returns a 5xx for a symbol that works on the next call. An unattended refresh
 * must not drop a position over one bad response, so retryable statuses back
 * off and try again. A 404 is not retried -- that is a wrong ticker, and
 * hammering it will not fix it.
 */
export async function fetchSeriesWithRetry(
  symbol,
  range = "1y",
  { attempts = 3, baseDelay = 800, completedOnly = false } = {}
) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchSeries(symbol, range, {}, { completedOnly });
    } catch (err) {
      lastError = err;
      const status = Number(String(err.message).match(/HTTP (\d+)/)?.[1]);
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** i));
    }
  }
  throw lastError;
}

/** Calendar date of a timestamp (seconds) in the exchange's own timezone. */
const exchangeDay = (tSeconds, gmtoffset = 0) =>
  new Date((tSeconds + gmtoffset) * 1000).toISOString().slice(0, 10);

/**
 * Fetch one symbol's daily series.
 *
 * `completedOnly` is for the unattended snapshot, which publishes daily closes.
 * Yahoo appends a bar for the session in progress, and the scheduled job often
 * starts hours late -- after midnight UTC, while Seoul and Taipei are trading.
 * Without the flag a half-finished Asian bar is published next to finished US
 * ones, and the refresh log reports an intraday print as a day's move (the
 * "^KS11 -9.7%" of 13 Oct 2026 was two sessions plus a mid-session price). With
 * it, a bar whose session is still open is dropped and the series ends at the
 * last completed close. The live app leaves it off and keeps the live print.
 *
 * @returns {Promise<{meta: object, points: {t:number,c:number}[], sessionOpen: boolean, lastBar: string|null}>}
 */
export async function fetchSeries(symbol, range = "1y", init = {}, { completedOnly = false } = {}) {
  const url = `${CHART}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: UA, ...init });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(`${symbol}: ${json?.chart?.error?.description ?? "no result"}`);
  }

  const { meta, timestamp = [], indicators } = result;
  // Total return, not price return: the dividend-adjusted close where the
  // endpoint supplies one. Price-only closes drop every distribution, which
  // reads a T-bill fund paying ~4% a year as flat and understates high-payout
  // lines like PETR4 and 2222.SR by their whole yield. Indices carry no
  // adjclose and fall back to the plain close, which is correct for them.
  const adjusted = indicators?.adjclose?.[0]?.adjclose;
  const closes = adjusted?.length ? adjusted : indicators?.quote?.[0]?.close ?? [];
  const volumes = indicators?.quote?.[0]?.volume ?? [];
  // The unadjusted close rides along as `p` when the series is adjusted: the
  // gap between the two on an ex-date is the distribution, which the
  // net-of-cost series needs to charge withholding tax on (see dividendYields).
  const raw = adjusted?.length ? indicators?.quote?.[0]?.close ?? [] : null;

  const gmtoffset = meta.gmtoffset ?? 0;
  const nowS = Date.now() / 1000;
  const regular = meta.currentTradingPeriod?.regular;
  const sessionOpen = Boolean(regular && nowS >= regular.start && nowS < regular.end);
  const lastIdx = timestamp.length - 1;

  // Yahoo emits nulls for halted or holiday sessions. Carry the last real
  // print forward so no percentage calculation divides across a gap.
  //
  // The exception is the FINAL bar. For a while after a close Yahoo serves that
  // bar with a null close (and a partial volume). Forward-filling it copies the
  // previous day's close, which makes the day-change and sigma exactly 0: the
  // 14 Oct 2026 snapshot published 16 of 20 positions as unchanged that way,
  // while `meta.regularMarketPrice` held the real print. So the last bar is
  // rescued from the quote when the quote is from the same session, or
  // dropped -- never copied from the day before. Adjustments for distributions
  // only rescale earlier bars, so the latest adjusted close equals the price.
  const points = [];
  // Points that are carried prints rather than closes. One may sit mid-series,
  // but never at the end: dropping an open session can leave a filled bar last
  // (AINF.L on 14 Oct 2026: 13 Oct null, carried from 12 Oct, then 14 Oct
  // dropped as live), which would again read as a flat day.
  const filled = new Set();
  let last = null;
  let lastRaw = null;
  timestamp.forEach((t, i) => {
    let c = closes[i];
    let p = raw ? raw[i] : null;
    if (c == null && i !== lastIdx && last != null) filled.add(points.length);
    if (c == null && i === lastIdx) {
      const quoteSameDay =
        meta.regularMarketPrice != null &&
        meta.regularMarketTime != null &&
        exchangeDay(meta.regularMarketTime, gmtoffset) === exchangeDay(t, gmtoffset);
      if (!quoteSameDay) return;
      c = meta.regularMarketPrice;
      p = meta.regularMarketPrice;
    }
    c = c ?? last;
    if (c == null) return;
    last = c;
    if (raw) {
      p = p ?? lastRaw ?? c;
      lastRaw = p;
    }
    // Volume is carried as-is rather than forward-filled: a null volume means
    // the session did not trade, and inventing one would corrupt any
    // volume-versus-average comparison. Indices report none at all.
    const v = volumes[i];
    points.push({
      // Stamped at the exchange's local wall-clock time, so dayKey() returns
      // the trading date as the venue knows it. Yahoo stamps FX daily bars at
      // 23:00 UTC of the previous day (London midnight); keyed by UTC date,
      // every non-USD close was converted with the next day's rate. Equity bars
      // open in daylight hours and keep their date either way.
      t: (t + gmtoffset) * 1000,
      c: Number(c.toFixed(4)),
      ...(v == null ? {} : { v }),
      ...(raw ? { p: Number(p.toFixed(4)) } : {}),
    });
  });

  // The bar for a session that has not finished is a live print, not a close.
  if (completedOnly && sessionOpen && points.length) {
    if (dayKey(points.at(-1).t) === exchangeDay(nowS, gmtoffset)) points.pop();
  }
  while (points.length && filled.has(points.length - 1)) points.pop();

  const lastBar = points.length ? dayKey(points.at(-1).t) : null;
  return { meta, points, sessionOpen, lastBar };
}

/** Simple return over the trailing `days`, in percent. */
export function pctFrom(points, days) {
  if (points.length < 2) return null;
  const last = points.at(-1);
  const base = points.find((p) => p.t >= last.t - days * MS_PER_DAY) ?? points[0];
  if (!base?.c) return null;
  return ((last.c - base.c) / base.c) * 100;
}

/** Return since 1 Jan of the series' final year, in percent. */
export function ytdPct(points) {
  if (!points.length) return null;
  const last = points.at(-1);
  const jan1 = Date.UTC(new Date(last.t).getUTCFullYear(), 0, 1);
  const base = points.find((p) => p.t >= jan1);
  if (!base?.c) return null;
  return ((last.c - base.c) / base.c) * 100;
}

/**
 * Observations per year in a series, from its own span.
 *
 * A single venue prints ~250 sessions a year. The book curve is built on the
 * union of seven venues' calendars -- Riyadh trades Sundays, Seoul and Sao
 * Paulo keep different holidays -- so it carries ~309. Annualising its
 * per-observation variance with sqrt(252) understated the book's volatility by
 * about a tenth (22.2% against 24.6% measured on a single New York calendar,
 * 14 Oct 2026; lag-1 autocorrelation ~0, so the extra observations are real
 * variance, not noise). Falls back to 252 for spans too short to measure.
 */
export function periodsPerYear(points) {
  if (points.length < 2) return TRADING_DAYS;
  const years = (points.at(-1).t - points[0].t) / (365.25 * MS_PER_DAY);
  return years > 0.25 ? (points.length - 1) / years : TRADING_DAYS;
}

/** Annualised standard deviation of daily log returns, in percent. */
export function annualisedVol(points) {
  if (points.length < 30) return null;
  const rets = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].c > 0) rets.push(Math.log(points[i].c / points[i - 1].c));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear(points)) * 100;
}

/** Worst peak-to-trough decline across the window, in percent (<= 0). */
export function maxDrawdown(points) {
  let peak = -Infinity;
  let worst = 0;
  for (const p of points) {
    if (p.c > peak) peak = p.c;
    if (peak > 0) worst = Math.min(worst, ((p.c - peak) / peak) * 100);
  }
  return worst;
}

/** Daily log returns, aligned to their timestamps. */
export function logReturns(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].c > 0) out.push({ t: points[i].t, r: Math.log(points[i].c / points[i - 1].c) });
  }
  return out;
}

/**
 * Pearson correlation of two return series, matched on timestamp.
 * Different exchanges keep different holidays, so an index join is required --
 * zipping by position would silently correlate a Tuesday against a Thursday.
 */
export function correlation(a, b) {
  const byTime = new Map(a.map((p) => [dayKey(p.t), p.r]));
  const xs = [];
  const ys = [];
  for (const p of b) {
    const match = byTime.get(dayKey(p.t));
    if (match != null) {
      xs.push(match);
      ys.push(p.r);
    }
  }
  if (xs.length < 30) return null;

  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a1 = xs[i] - mx;
    const b1 = ys[i] - my;
    num += a1 * b1;
    dx += a1 * a1;
    dy += b1 * b1;
  }
  if (dx === 0 || dy === 0) return null;
  return { rho: num / Math.sqrt(dx * dy), n: xs.length };
}

/**
 * Convert a local-currency series into USD using a dated FX series.
 *
 * This matters more than it looks. Converting a whole year of Korean prices at
 * *today's* KRW rate would book a year of won moves as if they happened on the
 * last day, so local performance and FX have to be applied date by date.
 *
 * @param invert true when the pair quotes USD->CCY (e.g. `BRL=X`) and must be
 *               divided rather than multiplied.
 */
export function toUsdSeries(points, fxPoints, invert) {
  // The unadjusted close (`p`) is a local-currency fact used for dividends;
  // it is not carried into the USD series the snapshot stores.
  if (!fxPoints?.length) return points.map(({ t, c, v }) => (v == null ? { t, c } : { t, c, v }));

  const fx = [...fxPoints].sort((a, b) => a.t - b.t);
  const out = [];
  let i = 0;
  let rate = fx[0].c;
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    // Advance to the most recent rate on or before this calendar date, so a
    // Seoul close is converted at that day's rate rather than the next one's.
    const key = dayKey(p.t);
    while (i < fx.length && dayKey(fx[i].t) <= key) rate = fx[i++].c;
    if (!rate) continue;
    out.push({ t: p.t, c: invert ? p.c / rate : p.c * rate });
  }
  return out;
}

/**
 * Weighted portfolio index, rebased to 100 at the first common date.
 *
 * Positions are rebalanced back to target weight every day. That is a modelling
 * choice, not a description of a real book -- a buy-and-hold sleeve would drift
 * and is not what this curve shows. Since 14 Oct 2026 the headline uses
 * rebalancedIndex() with a monthly rule instead; this function remains the
 * daily reference, which rebalancedIndex reproduces with rule "daily".
 *
 * Each day's move is the weight-averaged *return* of the legs, not the ratio of
 * weight-averaged *prices*. The earlier version summed weight x price, which is
 * a price-weighted index: a $400 GLD share outvoted a $5 (USD) KOSPI point
 * eighty to one regardless of target weight, and a leg entering the book
 * part-way through the window moved the level by its price alone. Changing it
 * moved the 1y figure by several points; `INDEX_METHOD` is folded into the
 * refresh log's book fingerprint so the log reports the switch as a rebase,
 * not as a day's return.
 *
 * A leg that does not trade on a date (a holiday on its venue) is held at its
 * last price, so it contributes a zero return at full weight. A leg with no
 * price yet is left out and the weights renormalise over the legs present.
 */
export const INDEX_METHOD = "monthly-rebalanced-total-returns-v4";

export function portfolioIndex(legs) {
  const dates = [...new Set(legs.flatMap((l) => l.points.map((p) => dayKey(p.t))))].sort();
  if (!dates.length) return [];

  const cursors = legs.map((leg) => ({
    weight: leg.weight,
    byTime: new Map(leg.points.map((p) => [dayKey(p.t), p.c])),
    last: null,
  }));

  const series = [];
  let level = 100;

  for (const t of dates) {
    let weighted = 0;
    let covered = 0;
    let present = false;
    for (const c of cursors) {
      const v = c.byTime.get(t);
      if (c.last != null && c.last > 0) {
        covered += c.weight;
        if (v != null) weighted += c.weight * (v / c.last - 1);
      }
      if (v != null) {
        c.last = v;
        present = true;
      }
    }
    if (!present && !covered) continue;
    if (covered > 0) level *= 1 + weighted / covered; // renormalise over legs with data
    series.push({ t: Date.parse(t), c: Number(level.toFixed(4)) });
  }
  return series;
}

/**
 * Distribution yield on each ex-date, from the adjusted (`c`) and unadjusted
 * (`p`) closes: the day the two diverge is the day a holder was paid. Returns
 * a Map of date key -> yield as a fraction of the previous close. Series with
 * no unadjusted close (indices, FX) have no distributions.
 */
export function dividendYields(points) {
  const out = new Map();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.p == null || b.p == null || !(a.c > 0) || !(a.p > 0) || !(b.p > 0)) continue;
    const y = b.c / a.c / (b.p / a.p) - 1;
    // Four-decimal rounding leaves ~1e-5 of noise on ordinary days.
    if (y > 1e-4) out.set(dayKey(b.t), y);
  }
  return out;
}

const periodKey = {
  daily: (k) => k,
  monthly: (k) => k.slice(0, 7),
  quarterly: (k) => k.slice(0, 4) + "Q" + Math.floor((Number(k.slice(5, 7)) - 1) / 3),
  never: () => "",
};

/**
 * Portfolio index under a stated rebalancing rule, gross or net of costs
 * (review item P0-5).
 *
 * Holdings are tracked in value: each leg grows with its own return, and on a
 * rebalance date -- the first session of each new period -- every leg is set
 * back to target weight among the legs that have a price. "never" is buy and
 * hold: weights drift with performance, and a leg that lists part-way through
 * (RARA11) is bought once, at its first close, by trimming the others pro rata.
 * With rebalance "daily" and no costs this reproduces portfolioIndex exactly.
 *
 * With `costs`, three drags are charged, all stated assumptions:
 *   - trading: every dollar traded pays the leg's `tradeBps` (commission plus
 *     half-spread), including the initial purchase;
 *   - FX: a non-USD leg also pays `fxBps` on every dollar traded;
 *   - withholding: on each ex-date the leg loses `withholdingPct` of the
 *     distribution (`dividends`, from dividendYields).
 * Fund fees are already inside fund prices, so they are not charged again.
 *
 * @param legs [{key, weight, points, tradeBps?, fxBps?, withholdingPct?, dividends?}]
 * @returns {{points, rebalances, turnoverPctPerYear, tradingCostPct, withholdingPct}}
 */
export function rebalancedIndex(legs, { rebalance = "monthly", costs = false } = {}) {
  const dates = [...new Set(legs.flatMap((l) => l.points.map((p) => dayKey(p.t))))].sort();
  if (!dates.length) return { points: [], rebalances: 0, turnoverPctPerYear: 0, tradingCostPct: 0, withholdingPct: 0 };
  const total = legs.reduce((a, l) => a + l.weight, 0) || 1;
  const cur = legs.map((l) => ({
    ...l,
    w: l.weight / total,
    byDay: new Map(l.points.map((p) => [dayKey(p.t), p.c])),
    last: null,
    value: 0,
    held: false,
    bps: costs ? (l.tradeBps ?? 0) + (l.fxBps ?? 0) : 0,
    wh: costs ? (l.withholdingPct ?? 0) / 100 : 0,
  }));
  const key = periodKey[rebalance] ?? periodKey.monthly;

  let level = 100;
  let started = false;
  let prevPeriod = null;
  let rebalances = 0;
  let traded = 0; // one-way, as a fraction of portfolio value, summed
  let tradeCost = 0; // currency units lost to trading, summed
  let taxCost = 0; // currency units lost to withholding, summed
  const out = [];

  const setTargets = (V, eligible) => {
    const wsum = eligible.reduce((a, c) => a + c.w, 0);
    let gross = 0, cost = 0;
    for (const c of cur) {
      const target = eligible.includes(c) ? (c.w / wsum) * V : 0;
      const delta = Math.abs(target - c.value);
      gross += delta;
      cost += delta * (c.bps / 1e4);
      c.value = target;
      c.held = target > 0;
    }
    if (cost > 0) for (const c of cur) c.value *= 1 - cost / V;
    return { gross, cost };
  };

  for (const d of dates) {
    // 1. Mark to market.
    for (const c of cur) {
      const v = c.byDay.get(d);
      if (v == null) continue;
      if (c.held && c.last > 0) c.value *= v / c.last;
      c.last = v;
      // 2. Withholding on today's distribution.
      if (c.held && c.wh > 0 && c.dividends?.has(d)) {
        const y = c.dividends.get(d);
        const tax = c.value * (c.wh * y) / (1 + y);
        c.value -= tax;
        taxCost += tax;
      }
    }
    const eligible = cur.filter((c) => c.last > 0);
    if (!eligible.length) continue;

    // 3. Rebalance on the first session of a new period, at the start, or --
    //    buy and hold only -- when a leg lists and has to be bought.
    const V = started ? cur.reduce((a, c) => a + c.value, 0) : level;
    const period = key(d);
    const joiner = eligible.some((c) => !c.held);
    const scheduled = !started || (rebalance !== "never" && period !== prevPeriod);
    const due = scheduled || (rebalance === "never" && joiner);
    if (due) {
      const { gross, cost } = setTargets(V, eligible);
      if (started) {
        rebalances += 1;
        traded += gross / 2 / V;
      }
      tradeCost += cost;
      started = true;
    }
    prevPeriod = period;
    level = cur.reduce((a, c) => a + c.value, 0);
    out.push({ t: Date.parse(d), c: Number(level.toFixed(4)) });
  }

  const years = out.length > 1 ? (out.at(-1).t - out[0].t) / (365.25 * MS_PER_DAY) : 1;
  return {
    points: out,
    rebalances,
    turnoverPctPerYear: (traded / (years || 1)) * 100,
    // Costs as a share of the starting 100, i.e. percentage points of return.
    tradingCostPct: tradeCost,
    withholdingPct: taxCost,
  };
}

/**
 * Deviation metrics: how far today's print sits from its own recent history.
 *
 * Added alongside the return stats rather than inside them -- `describe()` is
 * relied on by the validator and the published page, and its output shape is
 * deliberately left alone.
 *
 * `sigma` is the move in standard deviations of the trailing daily return
 * distribution: the honest way to compare a 3% day in GLD against a 3% day in
 * CRWV, which are not remotely the same event.
 */
export function deviations(points, { lookback = 50 } = {}) {
  if (points.length < 5) return null;

  const last = points.at(-1).c;
  const prev = points.at(-2).c;
  const window = points.slice(-Math.min(lookback, points.length));
  const mean = window.reduce((a, p) => a + p.c, 0) / window.length;

  const rets = logReturns(points).map((r) => r.r);
  const rMean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const rSd = Math.sqrt(
    rets.reduce((a, r) => a + (r - rMean) ** 2, 0) / Math.max(rets.length - 1, 1)
  );
  const dayReturn = prev > 0 ? (last - prev) / prev : null;

  const high = Math.max(...points.map((p) => p.c));
  const low = Math.min(...points.map((p) => p.c));

  // Volume relative to its own trailing average. Absent for indices, which
  // report no volume at all -- null rather than 1, so the dashboard can say
  // "not reported" instead of implying an average day.
  const vols = window.map((p) => p.v).filter((v) => typeof v === "number" && v > 0);
  // A zero volume on the final bar is a feed gap (B3 listings routinely arrive
  // that way), not a session in which nothing traded -- report it as missing
  // instead of "0.00x average".
  const rawVol = points.at(-1).v;
  const lastVol = typeof rawVol === "number" && rawVol > 0 ? rawVol : null;
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;

  return {
    lookback: window.length,
    volume: lastVol,
    avgVolume: avgVol,
    volumeRatio: avgVol && lastVol != null ? lastVol / avgVol : null,
    dayReturnPct: dayReturn == null ? null : dayReturn * 100,
    // Standard deviations of today's move against its own trailing distribution.
    sigma: dayReturn == null || rSd === 0 ? null : Math.log(last / prev) / rSd,
    // Distance from the trailing mean, in percent.
    fromMeanPct: mean > 0 ? ((last - mean) / mean) * 100 : null,
    fromHighPct: high > 0 ? ((last - high) / high) * 100 : null,
    fromLowPct: low > 0 ? ((last - low) / low) * 100 : null,
  };
}

/** Every derived stat for one position's series. */
export function describe(points) {
  return {
    ytd: ytdPct(points),
    ret1m: pctFrom(points, 30),
    ret3m: pctFrom(points, 90),
    ret1y: pctFrom(points, 365),
    vol: annualisedVol(points),
    maxDrawdown: maxDrawdown(points),
  };
}

/**
 * A USD-hedged series for a foreign position, built from its local series.
 *
 * A hedged return is NOT the local return. Rolling a short forward on the
 * currency earns (or pays) the interest-rate differential, so the hedged
 * return is approximately local + (r_USD - r_CCY), accrued day by day. For
 * a real (13.75%) against a dollar (~3.9%), that carry costs roughly ten
 * points a year, which is most of the FX gain the unhedged view shows.
 *
 * Approximations, stated rather than hidden: the rates are a dated table held
 * flat across the window, policy rates stand in for forward points (no
 * cross-currency basis, no onshore/offshore NDF gap for KRW, TWD and BRL),
 * and the hedge covers the full marked value every day rather than a monthly
 * notional, so the cross term on gains is ignored.
 *
 * @param ratesPct annual rates in percent, keyed by currency
 */
export function hedgedSeries(points, currency, ratesPct, base = "USD", { rateSeries = null, shiftPct = 0 } = {}) {
  if (!points?.length) return [];
  if (currency === base) return points.map((p) => ({ t: p.t, c: p.c }));
  // A dated series where one exists (USD: 13-week T-bills; BRL: CDI), else the
  // flat table. `shiftPct` moves the carry for a sensitivity -- offshore NDF
  // basis typically makes hedging TWD or BRL dearer than the onshore rate.
  const at = (ccy) => {
    const series = rateSeries?.[ccy];
    if (!series?.size) return () => ratesPct?.[ccy] ?? null;
    const keys = [...series.keys()].sort();
    return (t) => {
      const k = dayKey(t);
      let lo = 0, hi = keys.length - 1, hit = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] <= k) { hit = keys[mid]; lo = mid + 1; } else hi = mid - 1;
      }
      return series.get(hit ?? keys[0]);
    };
  };
  const rBase = at(base);
  const rLocal = at(currency);
  if (rBase(points[0].t) == null || rLocal(points[0].t) == null) return [];
  let g = 1;
  return points.map((p, i) => {
    if (i > 0) {
      const prev = points[i - 1].t;
      const carry = (rBase(prev) - rLocal(prev) + shiftPct) / 100;
      g *= Math.pow(1 + carry, (p.t - prev) / (365 * MS_PER_DAY));
    }
    return { t: p.t, c: p.c * g };
  });
}

/** Monday of the UTC week containing `t`, as a date key. */
const weekKey = (t) => {
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
};

/**
 * Weekly log returns keyed by week, from the last close of each week.
 *
 * Seoul and Taipei close before New York opens, so a daily regression across
 * venues pairs returns measured on different information sets and biases
 * every beta toward zero. Weekly sampling leaves at most one session of
 * misalignment in five.
 *
 * `simple: true` gives simple returns instead, for risk decomposition: a
 * book's simple return is the weighted sum of its lines' simple returns, which
 * is what makes an Euler decomposition of its variance exact.
 */
export function weeklyReturns(points, { simple = false } = {}) {
  const lastByWeek = new Map();
  for (const p of [...points].sort((a, b) => a.t - b.t)) lastByWeek.set(weekKey(p.t), p.c);
  const weeks = [...lastByWeek.keys()].sort();
  const out = new Map();
  for (let i = 1; i < weeks.length; i++) {
    const a = lastByWeek.get(weeks[i - 1]);
    const b = lastByWeek.get(weeks[i]);
    if (a > 0 && b > 0) out.set(weeks[i], simple ? b / a - 1 : Math.log(b / a));
  }
  return out;
}

/** Inverse of a small square matrix by Gauss-Jordan; null if singular. */
function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-14) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * Ordinary least squares with an intercept.
 *
 * @param y  dependent observations
 * @param xs one array per regressor, each aligned with y
 * @returns coefficients (intercept first), standard errors, t-stats, R², n
 */
export function ols(y, xs) {
  const n = y.length;
  const k = xs.length + 1;
  if (n < k + 10) return null;
  const X = y.map((_, i) => [1, ...xs.map((col) => col[i])]);
  const xtx = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => X.reduce((s, row) => s + row[a] * row[b], 0))
  );
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: k }, (_, a) => X.reduce((s, row, i) => s + row[a] * y[i], 0));
  const coef = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));

  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * coef[j], 0));
  const sse = y.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0);
  const my = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const s2 = sse / (n - k);
  const se = inv.map((row, j) => Math.sqrt(Math.max(row[j] * s2, 0)));
  return {
    n,
    coef,
    se,
    t: coef.map((c, j) => (se[j] > 0 ? c / se[j] : null)),
    r2: sst > 0 ? 1 - sse / sst : null,
  };
}

/**
 * Fewest weekly observations a line needs before any statistic is published
 * for it: risk share, correlation structure or factor regression. Below this,
 * a line is listed as insufficient with its weeks and capital, never with
 * numbers that a few months of data cannot pin down.
 */
export const MIN_WEEKS = 40;

/** `ols` on weekly data, or null when there are fewer than MIN_WEEKS observations. */
export function olsMin(y, xs) {
  return y.length < MIN_WEEKS ? null : ols(y, xs);
}

/** Align several weekly-return maps on the weeks they all share. */
export function alignWeekly(...maps) {
  const keys = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k))).sort();
  return { weeks: keys, cols: maps.map((m) => keys.map((k) => m.get(k))) };
}

/**
 * How well a tradable instrument follows the thing it stands in for.
 *
 * Tracking error is the annualised standard deviation of the gap between
 * non-overlapping `horizon`-session returns; beta and correlation come from the
 * same windows. Both series should be in the same currency, or the "error" is
 * mostly FX.
 *
 * `lagSessions` handles the clock. Seoul closes at 15:30 KST, about ten hours
 * after the previous New York close and fourteen before the next one, so a
 * Seoul close on day d is paired with the proxy's close on the session before.
 * Measured on EWY vs ^KS11, that is the alignment with the higher correlation;
 * without it the daily "tracking error" is mostly the time-zone gap.
 */
export function trackingStats(target, proxy, { horizon = 5, lagSessions = 0 } = {}) {
  const t = new Map(target.map((p) => [dayKey(p.t), p.c]));
  const q = new Map(proxy.map((p) => [dayKey(p.t), p.c]));
  const days = [...t.keys()].filter((d) => q.has(d)).sort();
  const a = [];
  const b = [];
  for (let i = lagSessions; i + horizon < days.length; i += horizon) {
    a.push(Math.log(t.get(days[i + horizon]) / t.get(days[i])));
    b.push(Math.log(q.get(days[i + horizon - lagSessions]) / q.get(days[i - lagSessions])));
  }
  if (a.length < 20) return null;
  const diff = a.map((v, i) => b[i] - v);
  const md = diff.reduce((s, v) => s + v, 0) / diff.length;
  const sd = Math.sqrt(diff.reduce((s, v) => s + (v - md) ** 2, 0) / (diff.length - 1));
  const fit = ols(b, [a]);
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return {
    windows: a.length,
    horizon,
    lagSessions,
    trackingErrorPct: sd * Math.sqrt(TRADING_DAYS / horizon) * 100,
    correlation: da && db ? num / Math.sqrt(da * db) : null,
    beta: fit?.coef[1] ?? null,
  };
}

/**
 * Points whose calendar date lies in [startDay, endDay] (inclusive "YYYY-MM-DD"
 * keys), rebased so the first is 100. Compared by date, not timestamp: a New
 * York bar is stamped 13:30 UTC and the book curve at midnight, so a timestamp
 * window would drop one series' first day.
 */
export function windowed(points, startDay, endDay) {
  const w = points.filter((p) => {
    const k = dayKey(p.t);
    return k >= startDay && k <= endDay;
  });
  if (!w.length || !(w[0].c > 0)) return [];
  const base = w[0].c;
  return w.map((p) => ({ t: p.t, c: (p.c / base) * 100 }));
}

/**
 * Level of a series on each of `dates` (ms), carrying the last print forward
 * across dates it did not trade. Used to read the risk-free fund on another
 * series' calendar, so a Riyadh Sunday earns no interest it did not accrue.
 */
function levelsOn(points, dates) {
  const byDay = new Map(points.map((p) => [dayKey(p.t), p.c]));
  const sorted = [...points].sort((a, b) => a.t - b.t);
  let i = 0;
  let last = sorted[0]?.c ?? null;
  return dates.map((t) => {
    const key = dayKey(t);
    while (i < sorted.length && dayKey(sorted[i].t) <= key) last = sorted[i++].c;
    return byDay.get(key) ?? last;
  });
}

/**
 * Risk-adjusted statistics for one series over its own (already windowed) span.
 *
 * Sharpe and Sortino use the series' own daily returns in excess of a T-bill
 * fund's return over the same interval (`rfPoints`, a total-return series),
 * annualised at the series' own observation frequency. Sortino's downside
 * deviation counts only returns below the risk-free rate.
 *
 * Beta to the market and everything relative to a benchmark is computed on
 * weekly returns instead: Seoul, Taipei and Riyadh close before New York opens,
 * which biases daily cross-market betas toward zero (see weeklyReturns).
 *
 * @returns {{retPct, annRetPct, volPct, sharpe, sortino, maxDrawdownPct, betaMkt, weeksMkt, rfAnnPct}}
 */
export function riskStats(points, { rfPoints = [], market = null } = {}) {
  if (points.length < 30) return null;
  const ppy = periodsPerYear(points);
  const years = (points.at(-1).t - points[0].t) / (365.25 * MS_PER_DAY);
  const rf = rfPoints.length ? levelsOn(rfPoints, points.map((p) => p.t)) : null;

  const excess = [];
  for (let i = 1; i < points.length; i++) {
    const r = points[i].c / points[i - 1].c - 1;
    const f = rf && rf[i - 1] > 0 && rf[i] > 0 ? rf[i] / rf[i - 1] - 1 : 0;
    excess.push(r - f);
  }
  const n = excess.length;
  const mean = excess.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(excess.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1));
  const down = Math.sqrt(excess.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / n);

  const ret = points.at(-1).c / points[0].c - 1;
  const rfRet = rf && rf[0] > 0 ? rf.at(-1) / rf[0] - 1 : 0;

  let betaMkt = null;
  let weeksMkt = null;
  if (market?.length) {
    const { cols } = alignWeekly(weeklyReturns(points), weeklyReturns(market));
    const fit = ols(cols[0], [cols[1]]);
    betaMkt = fit?.coef[1] ?? null;
    weeksMkt = fit?.n ?? null;
  }

  return {
    retPct: ret * 100,
    annRetPct: years > 0 ? (Math.pow(1 + ret, 1 / years) - 1) * 100 : null,
    volPct: annualisedVol(points),
    sharpe: sd > 0 ? (mean * ppy) / (sd * Math.sqrt(ppy)) : null,
    sortino: down > 0 ? (mean * ppy) / (down * Math.sqrt(ppy)) : null,
    maxDrawdownPct: maxDrawdown(points),
    betaMkt,
    weeksMkt,
    rfAnnPct: years > 0 ? (Math.pow(1 + rfRet, 1 / years) - 1) * 100 : null,
  };
}

/**
 * One covariance matrix for the book: weekly simple returns of every line with
 * at least MIN_WEEKS weeks, on the weeks they all share. The risk table and the
 * effective-bets measure both read this, so they describe the same matrix.
 *
 * Lines below the threshold are left out and listed with their weeks and
 * share of capital; `w` renormalises the remaining weights to one.
 *
 * @param legs [{key, weight, points}] weights in percent of notional
 * @returns {keys, capitalPct, w, weeks, weekKeys, cols, cov, insufficient,
 *           includedCapitalPct, excludedCapitalPct}
 */
export function weeklyCovariance(legs) {
  const total = legs.reduce((a, l) => a + l.weight, 0) || 1;
  const all = legs.map((l) => ({ ...l, r: weeklyReturns(l.points, { simple: true }) }));
  const inc = all.filter((l) => l.r.size >= MIN_WEEKS);
  const insufficient = all
    .filter((l) => l.r.size < MIN_WEEKS)
    .map((l) => ({ key: l.key, weeks: l.r.size, capitalPct: (l.weight / total) * 100 }));
  const { weeks, cols } = inc.length ? alignWeekly(...inc.map((l) => l.r)) : { weeks: [], cols: [] };
  const T = weeks.length;
  const means = cols.map((c) => c.reduce((a, b) => a + b, 0) / T);
  const cov = cols.map((ci, i) =>
    cols.map((cj, j) => (T > 1 ? ci.reduce((a, x, t) => a + (x - means[i]) * (cj[t] - means[j]), 0) / (T - 1) : 0))
  );
  const incW = inc.reduce((a, l) => a + l.weight, 0);
  return {
    keys: inc.map((l) => l.key),
    capitalPct: inc.map((l) => (l.weight / total) * 100),
    w: inc.map((l) => (incW > 0 ? l.weight / incW : 0)),
    weeks: T,
    weekKeys: weeks,
    cols,
    cov,
    insufficient,
    includedCapitalPct: (incW / total) * 100,
    excludedCapitalPct: 100 - (incW / total) * 100,
  };
}

/**
 * Where the book's risk comes from (review item P0-4).
 *
 * Euler decomposition on one covariance matrix Σ (weeklyCovariance): a line's
 * share of the book's variance is w_i (Σw)_i / w'Σw. Weekly sampling avoids
 * the cross-time-zone bias; simple returns make the book's return linear in the
 * weights, so the shares sum to exactly 100%. Lines with fewer than MIN_WEEKS
 * weeks are not given a share: they are listed in `insufficient`, and the
 * shares cover the remaining lines (`includedCapitalPct` of the capital).
 *
 * `weightPct` is each line's actual capital weight; `riskPerWeight` compares
 * the risk share with the line's share of the included capital, so 1 still
 * means a line carries exactly its weight.
 *
 * @param legs [{key, weight, points}] weights in percent of notional
 */
export function riskContributions(legs) {
  const S = weeklyCovariance(legs);
  if (S.weeks < 20) return null;
  const { cov, w } = S;
  const Sw = cov.map((row) => row.reduce((a, x, j) => a + x * w[j], 0));
  const varP = w.reduce((a, x, i) => a + x * Sw[i], 0);

  const rows = S.keys.map((key, i) => {
    const share = varP > 0 ? (w[i] * Sw[i]) / varP : null;
    const sd = Math.sqrt(cov[i][i]);
    return {
      key,
      weightPct: S.capitalPct[i],
      riskSharePct: share == null ? null : share * 100,
      // Risk share over share of the included capital: 1 means the line carries
      // exactly its weight in risk; 3 means three times its weight.
      riskPerWeight: share == null || w[i] === 0 ? null : share / w[i],
      volPct: sd * Math.sqrt(52) * 100,
      corrToBook: sd > 0 && varP > 0 ? Sw[i] / (sd * Math.sqrt(varP)) : null,
      weeks: S.weeks,
      // Kept for older readers; every included line has at least MIN_WEEKS.
      short: S.weeks < 26,
    };
  });
  const sum = rows.reduce((a, r) => a + (r.riskSharePct ?? 0), 0);
  return {
    bookVolPct: Math.sqrt(varP) * Math.sqrt(52) * 100,
    weeks: S.weeks,
    sumPct: sum,
    rows,
    insufficient: S.insufficient,
    includedCapitalPct: S.includedCapitalPct,
    excludedCapitalPct: S.excludedCapitalPct,
  };
}

/**
 * The book against one benchmark, on weekly returns over a shared window.
 *
 * Tracking error is the annualised standard deviation of weekly active returns
 * (book minus benchmark, log); the information ratio is their annualised mean
 * over that tracking error. An IR's t-statistic is roughly IR x sqrt(years), so
 * over one year it needs to clear about 2 to be distinguishable from zero -- the
 * page says so.
 */
export function relativeStats(book, bench) {
  const { cols } = alignWeekly(weeklyReturns(book), weeklyReturns(bench));
  const [a, b] = cols;
  if (a.length < 20) return null;
  const active = a.map((v, i) => v - b[i]);
  const m = active.reduce((s, v) => s + v, 0) / active.length;
  const sd = Math.sqrt(active.reduce((s, v) => s + (v - m) ** 2, 0) / (active.length - 1));
  const fit = ols(a, [b]);
  const te = sd * Math.sqrt(52);
  return {
    weeks: active.length,
    excessRetPct: (book.at(-1).c / book[0].c - bench.at(-1).c / bench[0].c) * 100,
    tePct: te * 100,
    ir: te > 0 ? (m * 52) / te : null,
    beta: fit?.coef[1] ?? null,
    betaT: fit?.t[1] ?? null,
  };
}

/**
 * The live track record (review item P0-2): a chain-linked series that only
 * ever grows forward from its inception date.
 *
 * The headline curve is a backtest -- the current weights replayed over a past
 * year, rewritten whenever the book changes. This is the other thing: each
 * refresh appends the days it has not seen, linked to the last recorded level
 * by that day's move in the curve as it stands, and never revises a day
 * already written. A later change to the book therefore changes only what
 * comes after it. The first refresh with no track starts one at the curve's
 * last completed date, at 100.
 *
 * Only days every venue has finished are recorded (`upTo`): a run made while
 * New York is still trading has a last curve date that holds Asian closes only,
 * and recording it would lose that day's US moves for good.
 *
 * @param track       existing track ({inception, points}) or null
 * @param curves      {usd, hedged} curve points, as in the snapshot
 * @param fingerprint the book fingerprint, recorded on every point
 * @param upTo        last date key safe to record (all venues closed), or null
 */
export function extendTrack(track, curves, fingerprint, { upTo = null } = {}) {
  const maps = Object.fromEntries(
    Object.entries(curves)
      .filter(([, pts]) => pts?.length)
      .map(([k, pts]) => [k, new Map(pts.map((p) => [dayKey(p.t), p.c]))])
  );
  const views = Object.keys(maps);
  if (!views.length) return track;
  const days = [...maps[views[0]].keys()].sort().filter((d) => !upTo || d <= upTo);
  if (!days.length) return track;

  if (!track?.points?.length) {
    const d = days.at(-1);
    return {
      inception: d,
      method: "chain-linked from the headline curve; days are appended, never revised",
      points: [{ date: d, ...Object.fromEntries(views.map((v) => [v, 100])), book: fingerprint }],
    };
  }

  const out = { ...track, points: [...track.points] };
  let prev = out.points.at(-1);
  for (const d of days.filter((x) => x > prev.date)) {
    // The curve's last level on or before the previously recorded date.
    const base = days.filter((x) => x <= prev.date).at(-1);
    if (!base) continue;
    const point = { date: d, book: fingerprint };
    for (const v of views) {
      const a = maps[v].get(base);
      const b = maps[v].get(d);
      point[v] = a > 0 && b != null && prev[v] != null ? Number((prev[v] * (b / a)).toFixed(4)) : prev[v] ?? null;
    }
    out.points.push(point);
    prev = point;
  }
  return out;
}
