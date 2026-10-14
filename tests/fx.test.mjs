/**
 * FX conversion, hedge carry and regression (review items P1-5 and P2).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toUsdSeries, hedgedSeries, ols, dayKey } from "../lib/analytics.js";

const DAY = 864e5;
const T0 = Date.UTC(2026, 0, 5);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("toUsdSeries divides by a USDxxx rate and uses each day's rate, not today's", () => {
  const local = [{ t: T0, c: 50 }, { t: T0 + DAY, c: 50 }];
  const usdbrl = [{ t: T0, c: 5 }, { t: T0 + DAY, c: 4 }];
  const usd = toUsdSeries(local, usdbrl, true);
  close(usd[0].c, 10);
  close(usd[1].c, 12.5); // flat in reais, +25% in dollars: the real strengthened
});

test("toUsdSeries carries the last rate across a day with no FX print", () => {
  const local = [{ t: T0, c: 10 }, { t: T0 + DAY, c: 10 }, { t: T0 + 2 * DAY, c: 10 }];
  const fx = [{ t: T0, c: 2 }, { t: T0 + 2 * DAY, c: 4 }];
  assert.deepEqual(toUsdSeries(local, fx, true).map((p) => p.c), [5, 5, 2.5]);
});

test("currency move vs percentage-point gap: (1+USD)/(1+local)-1", () => {
  // PETR4-like: local +96.9%, USD +117.9% -> gap 21.0pp, currency +10.7%.
  const move = (1 + 1.179) / (1 + 0.969) - 1;
  close(move * 100, 10.665, 1e-3);
});

test("flat-rate hedge accrues the rate differential for a year", () => {
  const pts = [{ t: T0, c: 100 }, { t: T0 + 365 * DAY, c: 100 }];
  const h = hedgedSeries(pts, "BRL", { USD: 4, BRL: 14 }, "USD");
  close(h[1].c, 90); // pays 10 points of carry
});

test("dated rates: the carry follows the rate path", () => {
  const pts = Array.from({ length: 366 }, (_, i) => ({ t: T0 + i * DAY, c: 100 }));
  const brl = new Map(pts.map((p, i) => [dayKey(p.t), i < 183 ? 14 : 12]));
  const usd = new Map(pts.map((p) => [dayKey(p.t), 4]));
  const h = hedgedSeries(pts, "BRL", {}, "USD", { rateSeries: { USD: usd, BRL: brl } });
  const expected = 100 * Math.pow(0.9, 183 / 365) * Math.pow(0.92, 182 / 365);
  close(h.at(-1).c, expected, 1e-6);
});

test("basis shift makes the hedge dearer by the shift", () => {
  const pts = [{ t: T0, c: 100 }, { t: T0 + 365 * DAY, c: 100 }];
  const h = hedgedSeries(pts, "TWD", { USD: 4, TWD: 2 }, "USD", { shiftPct: -1 });
  close(h[1].c, 101);
});

test("ols recovers known coefficients and reports R² = 1 on an exact fit", () => {
  const x1 = Array.from({ length: 60 }, (_, i) => Math.sin(i));
  const x2 = Array.from({ length: 60 }, (_, i) => Math.cos(i * 0.7));
  const y = x1.map((v, i) => 0.5 + 2 * v - 3 * x2[i]);
  const fit = ols(y, [x1, x2]);
  close(fit.coef[0], 0.5, 1e-9);
  close(fit.coef[1], 2, 1e-9);
  close(fit.coef[2], -3, 1e-9);
  close(fit.r2, 1, 1e-12);
});

test("FX bars stamped 23:00 UTC the day before are keyed to their London trading date", async () => {
  const { fetchSeries } = await import("../lib/analytics.js");
  const D = Date.UTC(2026, 9, 8, 23, 0) / 1000; // the bar for 9 Oct, as Yahoo stamps it
  const body = {
    chart: { result: [{
      meta: { currency: "BRL", gmtoffset: 3600, regularMarketPrice: 5.0, regularMarketTime: D + 86400 },
      timestamp: [D - 86400, D],
      indicators: { quote: [{ close: [5.02, 5.01] }] },
    }] },
  };
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => body });
  try {
    const { points } = await fetchSeries("USDBRL=X", "1y");
    assert.deepEqual(points.map((p) => dayKey(p.t)), ["2026-10-08", "2026-10-09"]);
  } finally {
    globalThis.fetch = real;
  }
});
