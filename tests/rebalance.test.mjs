/**
 * Rebalancing rules and costs (review item P0-5).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebalancedIndex, portfolioIndex, dividendYields } from "../lib/analytics.js";

const DAY = 864e5;
const T0 = Date.UTC(2025, 9, 14);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const series = (returns, start = 100, from = 0) => {
  const out = [{ t: T0 + from * DAY, c: start }];
  returns.forEach((r, i) => out.push({ t: T0 + (from + i + 1) * DAY, c: out.at(-1).c * (1 + r) }));
  return out;
};
const wave = (n, f, a) => Array.from({ length: n }, (_, i) => Math.sin(i * f) * a);

test("rule 'daily' without costs reproduces portfolioIndex", () => {
  const legs = [
    { key: "A", weight: 60, points: series(wave(200, 0.4, 0.02)) },
    { key: "B", weight: 40, points: series(wave(200, 1.1, 0.03)) },
    // A late listing, to exercise renormalisation.
    { key: "C", weight: 10, points: series(wave(100, 0.7, 0.02), 50, 100) },
  ];
  const a = rebalancedIndex(legs, { rebalance: "daily" }).points;
  const b = portfolioIndex(legs);
  assert.equal(a.length, b.length);
  a.forEach((p, i) => close(p.c, b[i].c, 1e-3));
});

test("buy and hold equals the weighted sum of line returns when all start on day one", () => {
  const A = series(wave(300, 0.3, 0.02)), B = series(wave(300, 0.9, 0.025));
  const r = rebalancedIndex([{ key: "A", weight: 70, points: A }, { key: "B", weight: 30, points: B }], { rebalance: "never" });
  const expected = 0.7 * (A.at(-1).c / A[0].c - 1) + 0.3 * (B.at(-1).c / B[0].c - 1);
  close(r.points.at(-1).c / 100 - 1, expected, 1e-6);
  assert.equal(r.rebalances, 0);
});

test("monthly rebalances once per new month", () => {
  const legs = [{ key: "A", weight: 50, points: series(wave(120, 0.5, 0.01)) }, { key: "B", weight: 50, points: series(wave(120, 0.2, 0.01)) }];
  // 14 Oct 2025 + 120 days runs into February: Nov, Dec, Jan, Feb.
  assert.equal(rebalancedIndex(legs, { rebalance: "monthly" }).rebalances, 4);
  assert.equal(rebalancedIndex(legs, { rebalance: "quarterly" }).rebalances, 1); // only Q4 → Q1, in January
});

test("costs: the initial purchase pays each leg's bps on its slice", () => {
  const flat = series(Array(10).fill(0));
  const legs = [
    { key: "US", weight: 50, points: flat, tradeBps: 5 },
    { key: "BR", weight: 50, points: flat, tradeBps: 15, fxBps: 10 },
  ];
  const r = rebalancedIndex(legs, { rebalance: "never", costs: true });
  // 50 x 5bps + 50 x 25bps = 0.025 + 0.125 = 0.15 of 100
  close(r.tradingCostPct, 0.15, 1e-9);
  close(r.points.at(-1).c, 100 - 0.15, 1e-6);
});

test("withholding takes its share of the distribution on the ex-date", () => {
  // Adjusted close jumps 2% on day 3 while the unadjusted price is flat: a 2% distribution.
  const pts = [100, 100, 100, 102, 102].map((c, i) => ({ t: T0 + i * DAY, c, p: 100 }));
  const div = dividendYields(pts);
  assert.equal(div.size, 1);
  close([...div.values()][0], 0.02, 1e-9);
  const r = rebalancedIndex([{ key: "X", weight: 100, points: pts, withholdingPct: 30, dividends: div }], { rebalance: "never", costs: true });
  // Value after the ex-date is 102; tax = 102 x 0.3 x 0.02 / 1.02 = 0.6
  close(r.withholdingPct, 0.6, 1e-9);
  close(r.points.at(-1).c, 101.4, 1e-6);
});
