/**
 * Tail risk and stress helpers (review item P1-1).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tailRisk, levelOn, SCENARIO_FILE } from "../lib/longrun.js";

test("historical VaR and CVaR at 95% on 100 returns", () => {
  const r = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000); // -5.0% ... +4.9%
  const t = tailRisk(r, 0.95);
  assert.equal(t.n, 100);
  assert.ok(Math.abs(t.varPct - 4.6) < 1e-9); // 5th worst: -4.6%
  assert.ok(Math.abs(t.cvarPct - 4.8) < 1e-9); // mean of -5.0 .. -4.6
});

test("levelOn reads the last print on or before a date", () => {
  const pts = [
    { t: Date.UTC(2025, 0, 2), c: 10 },
    { t: Date.UTC(2025, 0, 6), c: 12 },
  ];
  assert.equal(levelOn(pts, "2025-01-01"), null);
  assert.equal(levelOn(pts, "2025-01-03"), 10);
  assert.equal(levelOn(pts, "2025-01-06"), 12);
});

test("every stated scenario prices every active line, and every proxy names a ticker", () => {
  for (const s of SCENARIO_FILE.scenarios) assert.equal(Object.keys(s.shocks).length, 20, s.key);
  for (const [k, v] of Object.entries(SCENARIO_FILE.proxies)) assert.ok(v.ticker && v.why, k);
  for (const w of SCENARIO_FILE.historical) assert.ok(w.start < w.end, w.key);
});
