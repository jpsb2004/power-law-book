/**
 * Return maths (review item P2).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ytdPct, pctFrom, maxDrawdown, portfolioIndex } from "../lib/analytics.js";

const D = 864e5;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("YTD measures from the first close of the final year", () => {
  const pts = [
    { t: Date.UTC(2025, 11, 30), c: 90 },
    { t: Date.UTC(2026, 0, 2), c: 100 },
    { t: Date.UTC(2026, 5, 1), c: 125 },
  ];
  close(ytdPct(pts), 25);
});

test("trailing return starts at the first close inside the window", () => {
  const pts = Array.from({ length: 400 }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * D, c: 100 + i }));
  // 365 days before the last point is index 34.
  close(pctFrom(pts, 365), (499 / 134 - 1) * 100);
});

test("max drawdown is peak to trough, as a negative percent", () => {
  const pts = [100, 120, 90, 130, 104].map((c, i) => ({ t: i * D, c }));
  close(maxDrawdown(pts), -25);
});

test("the daily-rebalanced index compounds weight-averaged returns, not prices", () => {
  // A $400 share and a $5 share at equal weight: the index must not be price-weighted.
  const a = [{ t: 0, c: 400 }, { t: D, c: 440 }]; // +10%
  const b = [{ t: 0, c: 5 }, { t: D, c: 4.5 }]; // -10%
  const idx = portfolioIndex([{ weight: 50, points: a }, { weight: 50, points: b }]);
  close(idx.at(-1).c, 100);
});
