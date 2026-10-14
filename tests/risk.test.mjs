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
  const rc = riskContributions(legs, book);
  // Weekly log returns of a daily-rebalanced book are not exactly the weighted
  // sum of the legs' weekly log returns, so allow a little slack.
  close(rc.sumPct, 100, 1.5);
  const B = rc.rows.find((r) => r.key === "B");
  assert.ok(B.riskSharePct > 30, "the more volatile line carries more than its weight");
  close(B.riskPerWeight, B.riskSharePct / 100 / 0.3, 1e-9);
});

test("a line with a short history is computed but flagged", () => {
  const a = series(Array.from({ length: 400 }, (_, i) => Math.sin(i) * 0.01));
  const young = a.slice(-100); // ~14 weeks
  const rc = riskContributions([{ key: "A", weight: 90, points: a }, { key: "Y", weight: 10, points: young }], a);
  const y = rc.rows.find((r) => r.key === "Y");
  assert.equal(y.short, true);
  assert.ok(y.riskSharePct != null);
});
