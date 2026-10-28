/**
 * A second source for prices (review item P2).
 *
 * Yahoo's chart endpoint is free and unofficial. Each refresh compares its
 * unadjusted close for five US-listed lines against Nasdaq's published
 * historical closes, session by session, and records the largest gap. The
 * comparison uses the unadjusted close because Nasdaq publishes prices, not
 * total-return series; the adjustment itself is checked by the dividend
 * reading (adjusted vs unadjusted on ex-dates).
 *
 * Non-USD lines are compared in their listing currency against Alpha Vantage's
 * raw daily series, where it lists them and ALPHAVANTAGE_API_KEY is set.
 *
 * Never fatal: an unreachable second source is recorded, not a reason to
 * reject the refresh.
 */
import { dayKey } from "./analytics.js";

export const CROSS_CHECK = [
  { ticker: "AMD", assetclass: "stocks" },
  { ticker: "TSM", assetclass: "stocks" },
  { ticker: "JPM", assetclass: "stocks" },
  { ticker: "GLD", assetclass: "etf" },
  { ticker: "VGT", assetclass: "etf" },
];

// Alpha Vantage symbols that matched Yahoo's unadjusted closes (probe, 28 Oct 2026).
export const AV_CROSS_CHECK = [
  { ticker: "PETR4.SA", symbol: "PETR4.SAO" },
  { ticker: "AINF.L", symbol: "AINF.LON" },
];
// Non-USD lines Alpha Vantage does not list: Yahoo is their only price source.
export const SINGLE_SOURCE = ["2222.SR", "2357.TW", "RARA11.SA"];

// The free key allows 25 calls a day and one a second.
export const AV_MAX_CALLS = 6;
const AV_SPACING_MS = 1100;

const NASDAQ = "Nasdaq historical quotes (api.nasdaq.com)";
const ALPHA_VANTAGE = "Alpha Vantage daily series (alphavantage.co)";

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json",
};

/** Session-by-session gap between Yahoo points and a Map day -> second-source close. */
export function compareCloses(ticker, yahoo, other) {
  const diffs = [];
  for (const p of yahoo) {
    const k = dayKey(p.t);
    const n = other.get(k);
    const y = p.p ?? p.c;
    if (n > 0 && y > 0) diffs.push({ day: k, yahoo: y, nasdaq: n, diffPct: ((y - n) / n) * 100 });
  }
  if (!diffs.length) throw new Error("no overlapping sessions");
  const worst = diffs.reduce((a, b) => (Math.abs(b.diffPct) > Math.abs(a.diffPct) ? b : a));
  return {
    ticker,
    sessions: diffs.length,
    maxAbsDiffPct: Math.abs(worst.diffPct),
    worst,
    from: diffs[0].day,
    to: diffs.at(-1).day,
  };
}

/** Map day -> close from an Alpha Vantage TIME_SERIES_DAILY reply; throws on a refusal. */
export function parseAlphaVantage(j) {
  const series = j?.["Time Series (Daily)"];
  if (!series) throw new Error(String(j?.Note ?? j?.Information ?? j?.["Error Message"] ?? "no daily series"));
  return new Map(Object.entries(series).map(([d, v]) => [d, Number(v["4. close"])]));
}

/** @param localByTicker Map ticker -> Yahoo points carrying the unadjusted close `p` */
export async function crossCheck(
  localByTicker,
  { log = () => {}, env = process.env, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}
) {
  const to = new Date();
  const from = new Date(to.getTime() - 35 * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  const rows = [];
  for (const c of CROSS_CHECK) {
    const yahoo = localByTicker.get(c.ticker);
    if (!yahoo?.length) continue;
    try {
      const url =
        `https://api.nasdaq.com/api/quote/${c.ticker}/historical?assetclass=${c.assetclass}` +
        `&fromdate=${iso(from)}&todate=${iso(to)}&limit=40`;
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const nas = new Map(
        (j?.data?.tradesTable?.rows ?? []).map((r) => {
          const [m, d, y] = r.date.split("/");
          return [`${y}-${m}-${d}`, Number(String(r.close).replace(/[$,]/g, ""))];
        })
      );
      rows.push({ ...compareCloses(c.ticker, yahoo, nas), source: "Nasdaq" });
    } catch (err) {
      rows.push({ ticker: c.ticker, source: "Nasdaq", error: String(err.message) });
    }
  }

  const key = env.ALPHAVANTAGE_API_KEY;
  let avCalls = 0;
  if (!key) {
    log("skip crosscheck Alpha Vantage: ALPHAVANTAGE_API_KEY not set");
  } else {
    for (const c of AV_CROSS_CHECK) {
      const yahoo = localByTicker.get(c.ticker);
      if (!yahoo?.length || avCalls >= AV_MAX_CALLS) continue;
      try {
        if (avCalls > 0) await sleep(AV_SPACING_MS);
        avCalls++;
        const url =
          `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=compact` +
          `&symbol=${encodeURIComponent(c.symbol)}&apikey=${encodeURIComponent(key)}`;
        const res = await fetch(url, { headers: UA });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rows.push({ ...compareCloses(c.ticker, yahoo, parseAlphaVantage(await res.json())), source: "Alpha Vantage" });
      } catch (err) {
        rows.push({ ticker: c.ticker, source: "Alpha Vantage", error: String(err.message) });
      }
    }
  }

  const ok = rows.filter((r) => !r.error);
  const avOk = ok.some((r) => r.source === "Alpha Vantage");
  // Lines whose only price this run is Yahoo's: never listed, or the check did not complete.
  const singleSource = [
    ...AV_CROSS_CHECK.filter((c) => localByTicker.get(c.ticker)?.length && !ok.some((r) => r.ticker === c.ticker)).map((c) => c.ticker),
    ...SINGLE_SOURCE.filter((t) => localByTicker.get(t)?.length),
  ];
  log(
    `ok  crosscheck ${ok.length}/${rows.length} lines vs Nasdaq${avOk ? " and Alpha Vantage" : ""}, ` +
      `${ok.reduce((a, r) => a + r.sessions, 0)} sessions, max gap ` +
      `${Math.max(0, ...ok.map((r) => r.maxAbsDiffPct)).toFixed(3)}%` +
      (singleSource.length ? `; single source: ${singleSource.join(", ")}` : "")
  );
  return {
    source: avOk ? `${NASDAQ} and ${ALPHA_VANTAGE}` : NASDAQ,
    asOf: iso(to),
    rows,
    singleSource,
  };
}
