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
export async function fetchSeriesWithRetry(symbol, range = "1y", { attempts = 3, baseDelay = 800 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchSeries(symbol, range);
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

/**
 * Fetch one symbol's daily series.
 * @returns {Promise<{meta: object, points: {t:number,c:number}[]}>}
 */
export async function fetchSeries(symbol, range = "1y", init = {}) {
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

  // Yahoo emits nulls for halted or holiday sessions. Carry the last real
  // print forward so no percentage calculation divides across a gap.
  const points = [];
  let last = null;
  timestamp.forEach((t, i) => {
    const c = closes[i] ?? last;
    if (c == null) return;
    last = c;
    // Volume is carried as-is rather than forward-filled: a null volume means
    // the session did not trade, and inventing one would corrupt any
    // volume-versus-average comparison. Indices report none at all.
    const v = volumes[i];
    points.push({ t: t * 1000, c: Number(c.toFixed(4)), ...(v == null ? {} : { v }) });
  });

  return { meta, points };
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
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100;
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
  if (!fxPoints?.length) return points.map((p) => ({ ...p }));

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
 * and is not what this curve shows.
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
export const INDEX_METHOD = "daily-rebalanced-total-returns-v3";

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
  const lastVol = points.at(-1).v;
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;

  return {
    lookback: window.length,
    volume: typeof lastVol === "number" ? lastVol : null,
    avgVolume: avgVol,
    volumeRatio: avgVol && typeof lastVol === "number" && avgVol > 0 ? lastVol / avgVol : null,
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
export function hedgedSeries(points, currency, ratesPct, base = "USD") {
  if (!points?.length) return [];
  if (currency === base) return points.map((p) => ({ t: p.t, c: p.c }));
  const rBase = ratesPct?.[base];
  const rLocal = ratesPct?.[currency];
  if (rBase == null || rLocal == null) return [];
  const carry = (rBase - rLocal) / 100;
  const t0 = points[0].t;
  return points.map((p) => ({ t: p.t, c: p.c * Math.pow(1 + carry, (p.t - t0) / (365 * MS_PER_DAY)) }));
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
 */
export function weeklyReturns(points) {
  const lastByWeek = new Map();
  for (const p of [...points].sort((a, b) => a.t - b.t)) lastByWeek.set(weekKey(p.t), p.c);
  const weeks = [...lastByWeek.keys()].sort();
  const out = new Map();
  for (let i = 1; i < weeks.length; i++) {
    const a = lastByWeek.get(weeks[i - 1]);
    const b = lastByWeek.get(weeks[i]);
    if (a > 0 && b > 0) out.set(weeks[i], Math.log(b / a));
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
