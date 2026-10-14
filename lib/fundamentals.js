/**
 * Valuation and fund look-through (review items P1-4 and P1-3).
 *
 * Source: Yahoo Finance quoteSummary, which needs a session cookie and a
 * "crumb" token obtained the way a browser obtains them. Every figure is
 * stored with its source and retrieval date, and the whole block is optional:
 * a failure leaves the rest of the snapshot untouched and the page says the
 * figures are unavailable rather than showing stale ones as fresh.
 *
 * Only what the endpoint reports is used. A fund's look-through is its top
 * holdings as published (usually the top ten), so look-through exposures are a
 * floor, and the page states how much of each fund those holdings cover.
 */

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
};

async function session() {
  const first = await fetch("https://fc.yahoo.com", { headers: UA, redirect: "manual" }).catch(() => null);
  const raw = first?.headers?.getSetCookie?.() ?? [];
  const cookie = raw.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("no session cookie");
  const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...UA, cookie } });
  const crumb = (await res.text()).trim();
  if (!res.ok || !crumb || crumb.includes("<")) throw new Error(`no crumb (HTTP ${res.status})`);
  return { cookie, crumb };
}

const raw = (o, k) => (o?.[k] && typeof o[k] === "object" ? o[k].raw ?? null : o?.[k] ?? null);

async function summary(s, ticker, modules) {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=${modules.join(",")}&crumb=${encodeURIComponent(s.crumb)}`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { ...UA, cookie: s.cookie } });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
      continue;
    }
    if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);
    const j = await res.json();
    const r = j?.quoteSummary?.result?.[0];
    if (!r) throw new Error(`${ticker}: ${j?.quoteSummary?.error?.description ?? "no result"}`);
    return r;
  }
  throw new Error(`${ticker}: rate limited`);
}

/**
 * Valuation per line and top holdings per fund.
 * @param lines [{ticker, kind, weight}]
 */
export async function buildFundamentals(lines, { log = () => {} } = {}) {
  try {
    const s = await session();
    const asOf = new Date().toISOString().slice(0, 10);
    const valuation = [];
    const funds = [];
    for (const l of lines) {
      try {
        const isFund = /etf/i.test(l.kind ?? "");
        const r = await summary(s, l.ticker, [
          "summaryDetail",
          "defaultKeyStatistics",
          "financialData",
          "price",
          ...(isFund ? ["topHoldings"] : []),
        ]);
        const sd = r.summaryDetail ?? {}, ks = r.defaultKeyStatistics ?? {}, fd = r.financialData ?? {};
        const mcap = raw(sd, "marketCap");
        const fcf = raw(fd, "freeCashflow");
        // Statement-based ratios are only meaningful when the statements and
        // the quote share a currency. An ADR (TSM) reports in TWD and trades
        // in USD; mixing them printed a 32% FCF yield and a P/B of 89.
        const quoteCcy = r.price?.currency ?? sd.currency ?? null;
        const stmtCcy = fd.financialCurrency ?? null;
        const sameCcy = !stmtCcy || !quoteCcy || stmtCcy === quoteCcy;
        // Fund-level P/E and yield only; the holdings-level ratios the endpoint
        // reports for funds are inconsistent (reciprocals, zeros) and are not used.
        const pe = (v) => (v != null && v > 1 ? v : v != null && v < 0 ? v : null);
        const dy = raw(sd, "dividendYield") ?? raw(sd, "yield");
        valuation.push({
          ticker: l.ticker,
          fund: isFund,
          forwardPE: isFund ? null : pe(raw(sd, "forwardPE") ?? raw(ks, "forwardPE")),
          trailingPE: pe(raw(sd, "trailingPE")),
          evToEbitda: isFund || !sameCcy ? null : raw(ks, "enterpriseToEbitda"),
          fcfYieldPct: !isFund && sameCcy && fcf != null && mcap > 0 ? (fcf / mcap) * 100 : null,
          dividendYieldPct: dy != null ? dy * 100 : null,
          priceToBook: isFund || !sameCcy ? null : raw(ks, "priceToBook"),
          currencyNote: sameCcy ? null : `statements in ${stmtCcy}, quote in ${quoteCcy}: statement ratios omitted`,
        });
        if (isFund && r.topHoldings?.holdings?.length) {
          const h = r.topHoldings.holdings.map((x) => ({
            symbol: x.symbol,
            name: x.holdingName,
            pct: (raw(x, "holdingPercent") ?? 0) * 100,
          }));
          funds.push({ ticker: l.ticker, holdings: h, coveredPct: h.reduce((a, x) => a + x.pct, 0) });
        }
      } catch (err) {
        valuation.push({ ticker: l.ticker, error: String(err.message) });
      }
    }

    // Look-through: direct weight plus weight x share in each fund's top holdings.
    const total = lines.reduce((a, l) => a + l.weight, 0) || 1;
    const norm = (sym) => String(sym ?? "").toUpperCase().replace(/\.(TW|KS|L|SA|SR)$/, "");
    const alias = { "2330": "TSM", TSM: "TSM", "005930": "SAMSUNG", "000660": "SK HYNIX" };
    const key = (sym) => alias[norm(sym)] ?? norm(sym);
    const exp = new Map();
    const add = (k, name, w, via) => {
      const e = exp.get(k) ?? { key: k, name, weightPct: 0, via: [] };
      e.weightPct += w;
      e.via.push(via);
      exp.set(k, e);
    };
    for (const l of lines) {
      const f = funds.find((x) => x.ticker === l.ticker);
      if (!f) add(key(l.ticker), l.ticker, (l.weight / total) * 100, l.ticker);
      else for (const h of f.holdings) add(key(h.symbol), h.name, (l.weight / total) * h.pct, l.ticker);
    }
    const lookThrough = [...exp.values()]
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, 15)
      .map((e) => ({ ...e, via: [...new Set(e.via)] }));

    const ok = valuation.filter((v) => !v.error).length;
    log(`ok  fundamentals ${ok}/${lines.length} valued, ${funds.length} funds looked through (Yahoo quoteSummary, ${asOf})`);
    return { source: "Yahoo Finance quoteSummary", asOf, valuation, funds, lookThrough };
  } catch (err) {
    log(`WARN fundamentals unavailable: ${err.message}`);
    return { error: String(err.message) };
  }
}
