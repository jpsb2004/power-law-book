/**
 * Multi-year analysis: factor exposure over three years, rolling beta, tail
 * risk and stress tests (review items P1-1 and P1-2).
 *
 * The headline is a one-year replay. One year of a bull market says little
 * about what the book does in a bad one, so everything here reaches back up to
 * five years. Lines that did not exist that far back are handled the way each
 * question needs: the long-run book curve lets them join when they list (the
 * curve renormalises, as the headline does), and the historical stress windows
 * substitute a stated proxy (data/scenarios.json) so a 2022 window is not
 * silently measured on fifteen lines instead of twenty.
 *
 * Never fatal to the refresh: any failure returns an `error` and the page
 * hides the sections.
 */
import { readFileSync } from "node:fs";
import {
  fetchSeriesWithRetry,
  toUsdSeries,
  weeklyReturns,
  alignWeekly,
  ols,
  olsMin,
  dayKey,
  rebalancedIndex,
} from "./analytics.js";
import { FX_PAIRS, BASE_CURRENCY, SLEEVES, BASE_REBALANCE } from "./holdings.js";

export const SCENARIO_FILE = JSON.parse(
  readFileSync(new URL("../data/scenarios.json", import.meta.url), "utf8")
);

/**
 * Three factors, none of them a holding: the old pair (VGT, XLE) regressed the
 * Compute bucket partly on itself, since VGT is a line in it.
 */
export const LONG_FACTORS = [
  { id: "market", ticker: "ACWI", name: "iShares MSCI ACWI (global equity)" },
  { id: "semis", ticker: "SMH", name: "VanEck Semiconductor ETF" },
  { id: "energy", ticker: "XLE", name: "Energy Select Sector SPDR" },
];

const REGRESSION_YEARS = 3;
const ROLLING_WEEKS = 52;

/** Level of a series on `day` (YYYY-MM-DD): the last print on or before it. */
export function levelOn(points, day) {
  let v = null;
  for (const p of points) {
    if (dayKey(p.t) > day) break;
    v = p.c;
  }
  return v;
}

/** Historical VaR and CVaR, as positive losses in percent. */
export function tailRisk(returns, level) {
  const xs = [...returns].sort((a, b) => a - b);
  if (xs.length < 20) return null;
  const k = Math.max(1, Math.floor(xs.length * (1 - level)));
  const tail = xs.slice(0, k);
  return {
    level,
    n: xs.length,
    varPct: -xs[k - 1] * 100,
    cvarPct: (-tail.reduce((a, b) => a + b, 0) / tail.length) * 100,
  };
}

function simpleReturns(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) if (points[i - 1].c > 0) out.push(points[i].c / points[i - 1].c - 1);
  return out;
}

const sinceDay = (points, day) => points.filter((p) => dayKey(p.t) >= day);

export async function buildLongRun({ priced, curve, log = () => {} }) {
  try {
    const range = "5y";
    const fx = {};
    const fetchFx = async (ccy) => {
      if (ccy === BASE_CURRENCY || fx[ccy]) return fx[ccy];
      const pair = FX_PAIRS[ccy];
      if (!pair) throw new Error(`no FX pair for ${ccy}`);
      const { points } = await fetchSeriesWithRetry(pair, range);
      fx[ccy] = { points, invert: !pair.endsWith("USD=X") };
      return fx[ccy];
    };
    const hist = new Map();
    const usdHistory = async (ticker) => {
      if (hist.has(ticker)) return hist.get(ticker);
      const { meta, points } = await fetchSeriesWithRetry(ticker, range, { completedOnly: true });
      const ccy = meta.currency ?? BASE_CURRENCY;
      const r = ccy === BASE_CURRENCY ? null : await fetchFx(ccy);
      const usd = r ? toUsdSeries(points, r.points, r.invert) : points.map(({ t, c }) => ({ t, c }));
      hist.set(ticker, usd);
      return usd;
    };

    for (const p of priced) await usdHistory(p.ticker);
    for (const f of LONG_FACTORS) await usdHistory(f.ticker);
    for (const pr of Object.values(SCENARIO_FILE.proxies ?? {})) await usdHistory(pr.ticker);
    for (const t of ["VGT", "ACWI", "AGG"]) await usdHistory(t);

    const legsOf = (lines) => lines.map((p) => ({ key: p.ticker, weight: p.weight, points: hist.get(p.ticker) }));
    const bookIndex = (lines) => rebalancedIndex(legsOf(lines), { rebalance: BASE_REBALANCE }).points;
    const book = bookIndex(priced);
    const end = dayKey(book.at(-1).t);
    const start = dayKey(Date.parse(end) - REGRESSION_YEARS * 365.25 * 864e5);

    // ---- factor regression, weekly, three years, in excess of T-bills
    // Raw returns put the risk-free rate into the intercept (SGOV showed 4.4%
    // "alpha" at t = 57); excess returns leave alpha meaning what it says.
    const rfWeekly = weeklyReturns(sinceDay(hist.get("SGOV") ?? (await usdHistory("SGOV")), start));
    const excess = (m) => new Map([...m].filter(([k]) => rfWeekly.has(k)).map(([k, v]) => [k, v - rfWeekly.get(k)]));
    const factorWeekly = LONG_FACTORS.map((f) => ({ ...f, weekly: excess(weeklyReturns(sinceDay(hist.get(f.ticker), start))) }));
    const ids = Object.keys(SLEEVES);
    const bucketCurve = (id) => bookIndex(priced.filter((p) => p.sleeve === id));
    const thesis = excess(weeklyReturns(sinceDay(bookIndex(priced.filter((p) => p.sleeve !== "ballast")), start)));
    const subjects = [
      { key: "book", label: "Whole book", kind: "book", points: book },
      ...ids.map((id) => ({ key: id, label: SLEEVES[id].name, kind: "bucket", points: bucketCurve(id) })),
      ...priced
        .filter((p) => p.sleeve === "ballast")
        .map((p) => ({ key: p.ticker, label: p.ticker, kind: "position", points: hist.get(p.ticker) })),
    ];
    const rows = subjects.map((s) => {
      const y = excess(weeklyReturns(sinceDay(s.points, start)));
      const { cols } = alignWeekly(y, ...factorWeekly.map((f) => f.weekly));
      const fit = olsMin(cols[0], cols.slice(1));
      if (!fit) return { key: s.key, label: s.label, kind: s.kind, n: cols[0].length, insufficient: true };
      let rhoThesis = null;
      if (s.key === "ballast" || s.kind === "position") {
        const [a, b] = alignWeekly(y, thesis).cols;
        const one = ols(a, [b]);
        if (one?.r2 != null) rhoThesis = Math.sign(one.coef[1]) * Math.sqrt(Math.max(one.r2, 0));
      }
      return {
        key: s.key,
        label: s.label,
        kind: s.kind,
        n: fit.n,
        alphaAnnPct: fit.coef[0] * 52 * 100,
        alphaT: fit.t[0],
        betas: Object.fromEntries(factorWeekly.map((f, i) => [f.id, fit.coef[i + 1]])),
        tStats: Object.fromEntries(factorWeekly.map((f, i) => [f.id, fit.t[i + 1]])),
        r2: fit.r2,
        rhoThesis,
      };
    });

    // ---- rolling 52-week beta of the book to market and semis
    const bw = weeklyReturns(sinceDay(book, start));
    const [yb, xm, xs] = alignWeekly(bw, factorWeekly[0].weekly, factorWeekly[1].weekly).cols;
    const weeks = alignWeekly(bw, factorWeekly[0].weekly, factorWeekly[1].weekly).weeks;
    const rolling = [];
    for (let i = ROLLING_WEEKS; i <= yb.length; i++) {
      const y = yb.slice(i - ROLLING_WEEKS, i);
      const m = ols(y, [xm.slice(i - ROLLING_WEEKS, i)]);
      const s = ols(y, [xs.slice(i - ROLLING_WEEKS, i)]);
      rolling.push({ t: Date.parse(weeks[i - 1]), market: m?.coef[1] ?? null, semis: s?.coef[1] ?? null });
    }

    // ---- tail risk: one-day from the headline year, one-week from three years
    const daily = simpleReturns(curve);
    const weekly = [...weeklyReturns(sinceDay(book, start)).values()].map((r) => Math.exp(r) - 1);
    const tail = {
      daily: [tailRisk(daily, 0.95), tailRisk(daily, 0.99)],
      weekly: [tailRisk(weekly, 0.95), tailRisk(weekly, 0.99)],
      dailyWindow: { start: dayKey(curve[0].t), end: dayKey(curve.at(-1).t) },
      weeklyWindow: { start, end },
    };

    // ---- stress: historical windows, hypothetical factor shock, stated shocks
    const totalW = priced.reduce((a, p) => a + p.weight, 0);
    const historical = (SCENARIO_FILE.historical ?? []).map((w) => {
      let sum = 0, wsum = 0;
      const proxied = [];
      const missing = [];
      for (const p of priced) {
        let series = hist.get(p.ticker);
        if (!series?.length || dayKey(series[0].t) > w.start) {
          const pr = SCENARIO_FILE.proxies?.[p.ticker];
          series = pr ? hist.get(pr.ticker) : null;
          if (series?.length && dayKey(series[0].t) <= w.start) proxied.push(`${p.ticker}→${pr.ticker}`);
          else { missing.push(p.ticker); continue; }
        }
        const a = levelOn(series, w.start), b = levelOn(series, w.end);
        if (!(a > 0) || b == null) { missing.push(p.ticker); continue; }
        sum += p.weight * (b / a - 1);
        wsum += p.weight;
      }
      const ret = (t) => {
        const s = hist.get(t);
        const a = levelOn(s, w.start), b = levelOn(s, w.end);
        return a > 0 && b != null ? (b / a - 1) * 100 : null;
      };
      const acwi = ret("ACWI"), agg = ret("AGG");
      return {
        ...w,
        bookPct: wsum ? (sum / wsum) * 100 : null,
        coveragePct: (wsum / totalW) * 100,
        proxied,
        missing,
        benchmarks: {
          VGT: ret("VGT"),
          ACWI: acwi,
          "60/40": acwi != null && agg != null ? 0.6 * acwi + 0.4 * agg : null,
        },
      };
    });

    const hypothetical = (SCENARIO_FILE.hypothetical ?? []).map((h) => {
      const [a, b] = alignWeekly(bw, weeklyReturns(sinceDay(hist.get(h.factor), start))).cols;
      const fit = ols(a, [b]);
      const beta = fit?.coef[1] ?? null;
      return { ...h, beta, betaT: fit?.t[1] ?? null, bookPct: beta == null ? null : beta * h.shockPct };
    });

    const stated = SCENARIO_FILE.scenarios.map((s) => ({
      key: s.key,
      name: s.name,
      premise: s.premise,
      bookPct: priced.reduce((a, p) => a + (s.shocks[p.ticker] ?? 0) * p.weight, 0) / totalW,
    }));

    log(
      `ok  long-run   ${REGRESSION_YEARS}y factors on ${LONG_FACTORS.map((f) => f.ticker).join(" + ")}; ` +
        `1-day VaR95 ${tail.daily[0]?.varPct.toFixed(2)}%; ` +
        historical.map((h) => `${h.key} ${h.bookPct?.toFixed(1)}%`).join(", ")
    );

    return {
      factors: {
        frequency: "weekly",
        excessOf: "SGOV",
        window: { start, end },
        factors: LONG_FACTORS.map(({ id, ticker, name }) => ({ id, ticker, name })),
        rows,
        rolling,
      },
      tail,
      stress: { note: SCENARIO_FILE.historical_note, historical, hypothetical, stated, proxies: SCENARIO_FILE.proxies },
    };
  } catch (err) {
    log(`WARN long-run analysis unavailable: ${err.message}`);
    return { error: String(err.message) };
  }
}
