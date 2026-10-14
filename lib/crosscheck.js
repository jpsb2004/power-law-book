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

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json",
};

/** @param localByTicker Map ticker -> Yahoo points carrying the unadjusted close `p` */
export async function crossCheck(localByTicker, { log = () => {} } = {}) {
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
      const diffs = [];
      for (const p of yahoo) {
        const k = dayKey(p.t);
        const n = nas.get(k);
        const y = p.p ?? p.c;
        if (n > 0 && y > 0) diffs.push({ day: k, yahoo: y, nasdaq: n, diffPct: ((y - n) / n) * 100 });
      }
      if (!diffs.length) throw new Error("no overlapping sessions");
      const worst = diffs.reduce((a, b) => (Math.abs(b.diffPct) > Math.abs(a.diffPct) ? b : a));
      rows.push({
        ticker: c.ticker,
        sessions: diffs.length,
        maxAbsDiffPct: Math.abs(worst.diffPct),
        worst,
        from: diffs[0].day,
        to: diffs.at(-1).day,
      });
    } catch (err) {
      rows.push({ ticker: c.ticker, error: String(err.message) });
    }
  }
  const ok = rows.filter((r) => !r.error);
  log(
    `ok  crosscheck ${ok.length}/${rows.length} lines vs Nasdaq, ` +
      `${ok.reduce((a, r) => a + r.sessions, 0)} sessions, max gap ` +
      `${Math.max(0, ...ok.map((r) => r.maxAbsDiffPct)).toFixed(3)}%`
  );
  return { source: "Nasdaq historical quotes (api.nasdaq.com)", asOf: iso(to), rows };
}
