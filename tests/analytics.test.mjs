/**
 * Unit tests for the data layer. No network: every Yahoo response is built here.
 *
 *     npm test
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchSeries, deviations } from "../lib/analytics.js";
import { validateSnapshot } from "../lib/build-snapshot.js";

// Three New York sessions, bars stamped at the 13:30 UTC open (EDT, UTC-4).
const DAY = 86400;
const T0 = Date.UTC(2026, 9, 12, 13, 30) / 1000; // Mon 12 Oct 2026
const OPEN3 = T0 + 2 * DAY;
const CLOSE3 = OPEN3 + 6.5 * 3600;

function yahoo({ closes, volumes = [100, 100, 100], price, quoteTime }) {
  return {
    chart: {
      result: [
        {
          meta: {
            currency: "USD",
            gmtoffset: -14400,
            regularMarketPrice: price,
            regularMarketTime: quoteTime,
            currentTradingPeriod: { regular: { start: OPEN3, end: CLOSE3 } },
          },
          timestamp: [T0, T0 + DAY, OPEN3],
          indicators: { quote: [{ close: closes, volume: volumes }], adjclose: [{ adjclose: closes }] },
        },
      ],
    },
  };
}

const realFetch = globalThis.fetch;
const realNow = Date.now;
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

function serve(body, nowSeconds) {
  globalThis.fetch = async () => ({ ok: true, json: async () => body });
  Date.now = () => nowSeconds * 1000;
}

test("a null final close is rescued from the same-session quote, not copied from the day before", async () => {
  serve(yahoo({ closes: [10, 11, null], price: 12, quoteTime: CLOSE3 }), CLOSE3 + 3600);
  const { points, sessionOpen } = await fetchSeries("X", "1y", {}, { completedOnly: true });
  assert.equal(points.length, 3);
  assert.equal(points.at(-1).c, 12);
  assert.equal(points.at(-2).c, 11);
  assert.equal(sessionOpen, false);
  assert.ok(Math.abs(deviations([...pad(points)]).dayReturnPct - (12 / 11 - 1) * 100) < 1e-9);
});

test("a null final close with a stale quote is dropped", async () => {
  serve(yahoo({ closes: [10, 11, null], price: 11, quoteTime: CLOSE3 - DAY }), CLOSE3 + 3600);
  const { points, lastBar } = await fetchSeries("X", "1y", {}, { completedOnly: true });
  assert.equal(points.length, 2);
  assert.equal(points.at(-1).c, 11);
  assert.equal(lastBar, "2026-10-13");
});

test("completedOnly drops the bar of a session that is still open", async () => {
  serve(yahoo({ closes: [10, 11, 11.5], price: 11.5, quoteTime: OPEN3 + 3600 }), OPEN3 + 2 * 3600);
  const { points, sessionOpen, lastBar } = await fetchSeries("X", "1y", {}, { completedOnly: true });
  assert.equal(sessionOpen, true);
  assert.equal(points.at(-1).c, 11);
  assert.equal(lastBar, "2026-10-13");
});

test("live mode keeps the in-progress bar", async () => {
  serve(yahoo({ closes: [10, 11, 11.5], price: 11.5, quoteTime: OPEN3 + 3600 }), OPEN3 + 2 * 3600);
  const { points } = await fetchSeries("X", "1y");
  assert.equal(points.at(-1).c, 11.5);
});

test("interior nulls (holidays) are still carried forward", async () => {
  serve(yahoo({ closes: [10, null, 12], price: 12, quoteTime: CLOSE3 }), CLOSE3 + 3600);
  const { points } = await fetchSeries("X", "1y", {}, { completedOnly: true });
  assert.deepEqual(points.map((p) => p.c), [10, 10, 12]);
});

test("a carried print never ends the series after the live bar is dropped", async () => {
  // AINF.L, 14 Oct 2026: the previous session null, today's still trading.
  serve(yahoo({ closes: [10, null, 11.5], price: 11.5, quoteTime: OPEN3 + 3600 }), OPEN3 + 2 * 3600);
  const { points, lastBar } = await fetchSeries("X", "1y", {}, { completedOnly: true });
  assert.deepEqual(points.map((p) => p.c), [10]);
  assert.equal(lastBar, "2026-10-12");
});

// deviations() needs at least five points; prefix flat history.
function pad(points) {
  const first = points[0];
  return [0, 1, 2].map((i) => ({ t: first.t - (3 - i) * DAY * 1000, c: first.c, v: 100 })).concat(points);
}

test("a zero final volume is reported as missing, not as 0x average", () => {
  const pts = [100, 101, 102, 103, 104, 105].map((c, i) => ({ t: i * DAY * 1000, c, v: i === 5 ? 0 : 1000 }));
  const d = deviations(pts);
  assert.equal(d.volume, null);
  assert.equal(d.volumeRatio, null);
});

function snapshot(dayReturns) {
  return {
    asOf: Date.now(),
    curve: Array.from({ length: 250 }, (_, i) => ({ t: i, c: 100 })),
    fx: { USD: { rate: 1 } },
    failures: [],
    positions: dayReturns.map((r, i) => ({
      ticker: `P${i}`,
      price: 10,
      lastBar: "2026-10-13",
      dev: { dayReturnPct: r },
    })),
  };
}

test("validator rejects a snapshot where several positions read exactly flat", () => {
  const { ok, problems } = validateSnapshot(snapshot([0, 0, 0, 0, 1.2, -0.4]), null);
  assert.equal(ok, false);
  assert.match(problems.join(" "), /exactly 0/);
});

test("validator only warns on one or two genuinely flat closes", () => {
  const { ok, warnings } = validateSnapshot(snapshot([0, 1.2, -0.4, 0.3, 2.1, -1]), null);
  assert.equal(ok, true);
  assert.match(warnings.join(" "), /closed exactly flat/);
});

test("validator warns when one position's last close trails the book", () => {
  const s = snapshot([1, -1, 0.5]);
  s.positions[2].lastBar = "2026-10-01";
  const { warnings } = validateSnapshot(s, null);
  assert.match(warnings.join(" "), /P2 last close is 2026-10-01/);
});
