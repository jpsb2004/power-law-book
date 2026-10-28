/**
 * Risk-adjusted statistics (review item P0-1) and the annualisation fix.
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodsPerYear,
  annualisedVol,
  riskStats,
  relativeStats,
  windowed,
  riskContributions,
  portfolioIndex,
  MIN_WEEKS,
  olsMin,
  weeklyCovariance,
} from "../lib/analytics.js";

const DAY = 864e5;
const T0 = Date.UTC(2025, 9, 14);

/** A series from simple returns, one point per `stepDays`. */
function series(returns, stepDays = 1, start = 100) {
  const out = [{ t: T0, c: start }];
  returns.forEach((r, i) => out.push({ t: T0 + (i + 1) * stepDays * DAY, c: out.at(-1).c * (1 + r) }));
  return out;
}
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("periodsPerYear counts the series' own observations", () => {
  // 365 daily steps over 365 days.
  close(periodsPerYear(series(Array(365).fill(0.001))), 365.25, 1e-6);
  // Too short to measure: falls back to 252.
  assert.equal(periodsPerYear(series([0.01, 0.01])), 252);
});

test("annualised vol scales with sqrt of observations per year, not a fixed 252", () => {
  const rets = Array.from({ length: 400 }, (_, i) => (i % 2 ? 0.01 : -0.008));
  const daily = series(rets, 1);
  const twoDay = series(rets, 2); // same returns, half the observations per year
  // Same per-observation variance: the ratio is sqrt(2).
  close(annualisedVol(daily) / annualisedVol(twoDay), Math.SQRT2, 1e-6);
});

test("Sharpe and Sortino follow their definitions", () => {
  const rets = Array.from({ length: 260 }, (_, i) => (i % 2 ? 0.02 : -0.01));
  const pts = series(rets, 1);
  const s = riskStats(pts);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1));
  const down = Math.sqrt(rets.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / rets.length);
  const ppy = periodsPerYear(pts);
  close(s.sharpe, (mean * ppy) / (sd * Math.sqrt(ppy)), 1e-9);
  close(s.sortino, (mean * ppy) / (down * Math.sqrt(ppy)), 1e-9);
});

test("a risk-free fund earning exactly the series' return gives zero excess", () => {
  const rets = Array(100).fill(0.001);
  const s = riskStats(series(rets), { rfPoints: series(rets) });
  assert.equal(s.sortino, null); // no downside at all
  close(s.rfAnnPct, s.annRetPct, 1e-9);
});

test("risk-free accrual is read on the series' calendar, carrying across its gaps", () => {
  // The series trades every other day; the T-bill fund every day.
  const book = series(Array(120).fill(0.002), 2);
  const rf = series(Array(240).fill(0.0001), 1);
  const s = riskStats(book, { rfPoints: rf });
  close(s.rfAnnPct, (Math.pow(1.0001 ** 240, 365.25 / 240) - 1) * 100, 1e-6);
});

test("beta to the market comes from weekly returns", () => {
  const mkt = series(Array.from({ length: 400 }, (_, i) => Math.sin(i) * 0.01));
  const twice = mkt.map((p, i) => ({ t: p.t, c: 100 * (p.c / 100) ** 2 })); // log returns doubled
  const s = riskStats(twice, { market: mkt });
  close(s.betaMkt, 2, 1e-9);
});

test("relativeStats: a series against itself has no tracking error", () => {
  const pts = series(Array.from({ length: 400 }, (_, i) => Math.cos(i) * 0.01));
  const r = relativeStats(pts, pts);
  close(r.tePct, 0, 1e-9);
  assert.equal(r.ir, null);
  close(r.beta, 1, 1e-9);
  close(r.excessRetPct, 0, 1e-9);
});

test("windowed compares calendar dates, not timestamps", () => {
  const midnight = [{ t: Date.UTC(2025, 9, 14), c: 50 }, { t: Date.UTC(2025, 9, 15), c: 55 }];
  const ny = [{ t: Date.UTC(2025, 9, 14, 13, 30), c: 10 }, { t: Date.UTC(2025, 9, 15, 13, 30), c: 11 }];
  for (const s of [midnight, ny]) {
    const w = windowed(s, "2025-10-14", "2025-10-15");
    assert.equal(w.length, 2);
    close(w[0].c, 100);
    close(w[1].c, 110, 1e-9);
  }
});

test("risk shares follow the Euler decomposition and sum to the whole book", () => {
  // Two lines, 70/30, the second three times as volatile and uncorrelated-ish.
  const a = series(Array.from({ length: 400 }, (_, i) => Math.sin(i * 0.7) * 0.01));
  const b = series(Array.from({ length: 400 }, (_, i) => Math.cos(i * 1.3) * 0.03));
  const legs = [{ key: "A", weight: 70, points: a }, { key: "B", weight: 30, points: b }];
  const book = portfolioIndex(legs);
  // Phase 2: one Σ of weekly simple returns makes the decomposition exact, so
  // the old 1.5pp slack (per-line windows, log returns) is now 1e-9.
  const rc = riskContributions(legs, book);
  close(rc.sumPct, 100, 1e-9);
  const B = rc.rows.find((r) => r.key === "B");
  assert.ok(B.riskSharePct > 30, "the more volatile line carries more than its weight");
  close(B.riskPerWeight, B.riskSharePct / 100 / 0.3, 1e-9);
});

/** Deterministic uniform draws for fixtures. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("Euler shares sum to 100% on a random five-asset book, and match w'Σw", () => {
  const u = prng(7);
  // A common factor plus noise, so the lines are correlated as real ones are.
  const days = 420;
  const f = Array.from({ length: days }, () => (u() - 0.5) * 0.02);
  const legs = [12, 30, 8, 25, 25].map((weight, k) => ({
    key: "L" + k,
    weight,
    points: series(f.map((x) => x * (0.5 + k * 0.4) + (u() - 0.5) * 0.03 * (1 + k / 2))),
  }));
  const rc = riskContributions(legs);
  close(rc.sumPct, 100, 1e-9);
  assert.equal(rc.rows.length, 5);
  assert.deepEqual(rc.insufficient, []);
  close(rc.includedCapitalPct, 100, 1e-12);
  // Book vol from Σ equals the vol of the weighted sum of the lines' weekly
  // simple returns: the linearity that makes the decomposition exact.
  const S = weeklyCovariance(legs);
  const book = S.cols[0].map((_, t) => S.w.reduce((a, w, i) => a + w * S.cols[i][t], 0));
  const m = book.reduce((a, b) => a + b, 0) / book.length;
  const sd = Math.sqrt(book.reduce((a, r) => a + (r - m) ** 2, 0) / (book.length - 1));
  close(rc.bookVolPct, sd * Math.sqrt(52) * 100, 1e-9);
});

test("a 14-week line is excluded from the shares and listed with its capital", () => {
  // Phase 2: below MIN_WEEKS a line gets no share at all (it used to get an
  // indicative one, which is why the column summed to 104%).
  const a = series(Array.from({ length: 400 }, (_, i) => Math.sin(i) * 0.01));
  const b = series(Array.from({ length: 400 }, (_, i) => Math.cos(i * 1.7) * 0.02));
  const young = b.slice(-100); // ~14 weeks
  const rc = riskContributions([
    { key: "A", weight: 60, points: a },
    { key: "B", weight: 38, points: b },
    { key: "Y", weight: 2, points: young },
  ]);
  assert.equal(rc.rows.find((r) => r.key === "Y"), undefined);
  assert.equal(rc.insufficient.length, 1);
  const y = rc.insufficient[0];
  assert.equal(y.key, "Y");
  assert.ok(y.weeks < MIN_WEEKS && y.weeks >= 13, `weeks ${y.weeks}`);
  close(y.capitalPct, 2, 1e-12);
  close(rc.excludedCapitalPct, 2, 1e-12);
  close(rc.sumPct, 100, 1e-9);
  // Weights shown are actual capital; risk ÷ weight is against the included 98%.
  const A = rc.rows.find((r) => r.key === "A");
  close(A.weightPct, 60, 1e-12);
  close(A.riskPerWeight, A.riskSharePct / 100 / (60 / 98), 1e-9);
});

test("factor regressions need MIN_WEEKS observations: 14 weeks is not enough", () => {
  assert.equal(MIN_WEEKS, 40);
  const x = Array.from({ length: 60 }, (_, i) => Math.sin(i * 0.9) * 0.02);
  const y = x.map((v, i) => 1.5 * v + Math.cos(i * 2.1) * 0.005);
  // ols alone would fit 14 points with three regressors' worth of slack; olsMin refuses.
  assert.equal(olsMin(y.slice(-14), [x.slice(-14)]), null);
  assert.equal(olsMin(y.slice(-39), [x.slice(-39)]), null);
  const fit = olsMin(y.slice(-40), [x.slice(-40)]);
  assert.equal(fit.n, 40);
  close(fit.coef[1], 1.5, 0.1);
});
