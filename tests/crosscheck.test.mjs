/**
 * Second price source: Nasdaq for US lines, Alpha Vantage for non-USD lines.
 * Every fetch is stubbed; nothing touches the network.
 *
 *     npm test
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { crossCheck, compareCloses, parseAlphaVantage, AV_CROSS_CHECK, AV_MAX_CALLS } from "../lib/crosscheck.js";

const T0 = Date.UTC(2026, 9, 26);
const DAY = 864e5;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const pts = (...ps) => ps.map((p, i) => ({ t: T0 + i * DAY, p, c: p * 0.9 }));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const avReply = (closes) => ({
  "Meta Data": { "2. Symbol": "X" },
  "Time Series (Daily)": Object.fromEntries(
    closes.map((c, i) => [new Date(T0 + i * DAY).toISOString().slice(0, 10), { "4. close": String(c) }])
  ),
});
const nasdaqReply = (closes) => ({
  data: {
    tradesTable: {
      rows: closes.map((c, i) => {
        const [y, m, d] = new Date(T0 + i * DAY).toISOString().slice(0, 10).split("-");
        return { date: `${m}/${d}/${y}`, close: `$${c}` };
      }),
    },
  },
});

/** Stub fetch by host; records each URL. */
function stub(byHost) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    const body = url.includes("alphavantage") ? byHost.av(url) : byHost.nasdaq(url);
    return { ok: true, json: async () => body };
  };
  return urls;
}

test("compareCloses uses the unadjusted close and keeps the largest gap", () => {
  const r = compareCloses("X", pts(100, 101), new Map([["2026-10-26", 100], ["2026-10-27", 100]]));
  assert.equal(r.sessions, 2);
  close(r.maxAbsDiffPct, 1);
  assert.equal(r.worst.day, "2026-10-27");
  assert.throws(() => compareCloses("X", pts(100), new Map()), /no overlapping sessions/);
});

test("parseAlphaVantage reads closes and turns a rate-limit reply into an error", () => {
  const m = parseAlphaVantage(avReply([52.79, 53.88]));
  assert.equal(m.get("2026-10-27"), 53.88);
  assert.throws(() => parseAlphaVantage({ Information: "rate limit reached" }), /rate limit/);
  assert.throws(() => parseAlphaVantage({ Note: "1 request per second" }), /per second/);
});

test("without a key Alpha Vantage is skipped: no call, lines listed as single-source", async () => {
  const urls = stub({ nasdaq: () => nasdaqReply([100, 100]), av: () => assert.fail("AV called") });
  const local = new Map([["AMD", pts(100, 100)], ["PETR4.SA", pts(50, 50)], ["AINF.L", pts(8, 8)], ["2222.SR", pts(25)]]);
  const xc = await crossCheck(local, { env: {} });
  assert.equal(urls.length, 1);
  assert.deepEqual(xc.rows.map((r) => [r.ticker, r.source]), [["AMD", "Nasdaq"]]);
  assert.equal(xc.source, "Nasdaq historical quotes (api.nasdaq.com)");
  assert.deepEqual(xc.singleSource, ["PETR4.SA", "AINF.L", "2222.SR"]);
});

test("with a key each listed non-USD line is compared, calls spaced and capped", async () => {
  const sleeps = [];
  const urls = stub({
    nasdaq: () => nasdaqReply([]),
    av: (u) => (u.includes("PETR4.SAO") ? avReply([50, 49.5]) : avReply([8, 8])),
  });
  const local = new Map([["PETR4.SA", pts(50, 50)], ["AINF.L", pts(8, 8)]]);
  const xc = await crossCheck(local, { env: { ALPHAVANTAGE_API_KEY: "k" }, sleep: async (ms) => sleeps.push(ms) });
  const av = urls.filter((u) => u.includes("alphavantage"));
  assert.equal(av.length, AV_CROSS_CHECK.length);
  assert.ok(av.length <= AV_MAX_CALLS);
  assert.ok(av.every((u) => u.includes("function=TIME_SERIES_DAILY") && u.includes("apikey=k")));
  assert.deepEqual(sleeps, [1100]);
  const petr = xc.rows.find((r) => r.ticker === "PETR4.SA");
  assert.equal(petr.source, "Alpha Vantage");
  close(petr.maxAbsDiffPct, (0.5 / 49.5) * 100); // above the 0.5% flag rule
  assert.equal(xc.rows.find((r) => r.ticker === "AINF.L").maxAbsDiffPct, 0);
  assert.match(xc.source, /Alpha Vantage/);
  assert.deepEqual(xc.singleSource, []);
});

test("an Alpha Vantage refusal is a row error, not fatal, and the line stays single-source", async () => {
  stub({ nasdaq: () => nasdaqReply([]), av: () => ({ Information: "25 requests per day" }) });
  const local = new Map([["PETR4.SA", pts(50)], ["RARA11.SA", pts(100)]]);
  const xc = await crossCheck(local, { env: { ALPHAVANTAGE_API_KEY: "k" }, sleep: async () => {} });
  assert.deepEqual(xc.rows, [{ ticker: "PETR4.SA", source: "Alpha Vantage", error: "25 requests per day" }]);
  assert.equal(xc.source, "Nasdaq historical quotes (api.nasdaq.com)");
  assert.deepEqual(xc.singleSource, ["PETR4.SA", "RARA11.SA"]);
});
