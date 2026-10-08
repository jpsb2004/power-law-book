/**
 * The book. Single source of truth for both the live app and the frozen
 * snapshot the published page is built from.
 *
 * The roster itself now lives in `data/positions.json`, which this module
 * reads and reshapes into the `Holding` shape the Node pipeline already
 * expects. Python reads that same file, so the app and the PDF cannot
 * disagree about what the book holds -- they used to, on all 18 weights,
 * because the PDF carried its own hardcoded copy.
 *
 * Edit `data/positions.json`. Nothing here.
 *
 * `weight` is percent of notional. Edit those numbers and everything
 * downstream -- allocation, contribution, bucket totals -- follows.
 *
 * Bucket targets are Energy 38 / Compute 32 / Ballast 30. Within a bucket the
 * split is equal weight, with the integer remainder going to the most liquid
 * names, so the totals land exactly on target without implying a precision the
 * sizing does not have.
 */

import { readFileSync } from "node:fs";

/** Buckets are the argument. Each one is a distinct link in the same chain. */
export const SLEEVES = {
  energy: {
    id: "energy",
    numeral: "I",
    name: "Energy",
    claim: "The buildout is constrained by fuel, molecules and the ground it stands on.",
  },
  compute: {
    id: "compute",
    numeral: "II",
    name: "Compute",
    claim: "The demand side — the silicon, the fabs, and the firms selling the output.",
  },
  ballast: {
    id: "ballast",
    numeral: "III",
    name: "Ballast",
    claim: "What is left standing if the first two buckets are one trade wearing two hats.",
  },
};

const BOOK = JSON.parse(
  readFileSync(new URL("../data/positions.json", import.meta.url), "utf8"),
);

/**
 * Reshaped into the field names the pipeline already uses, so build-snapshot,
 * the analytics layer and the published page are untouched by the move. Only
 * `active` positions are carried; `substituted` and `removed` stay in the file
 * as history for the change log rather than being deleted out of it.
 */
export const HOLDINGS = BOOK.positions
  .filter((p) => p.status === "active")
  .map((p) => ({
    ticker: p.ticker,
    name: p.name,
    sleeve: p.bucket,
    currency: p.currency,
    weight: p.weight,
    kind: p.instrument_type,
    venue: p.exchange,
    thesis: p.factor_role,
    breaks: p.falsification_metric,
    ...(p.tradability ? { tradability: p.tradability } : {}),
    ...(p.investable?.proxy ? { proxy: p.investable.proxy, trackingNotes: p.investable.tracking_notes } : {}),
  }));

/**
 * Policy rates used to model a rolled FX hedge back to USD. A dated, stated
 * assumption in `data/positions.json`, not a market feed -- see
 * `hedgedSeries()` in analytics.js for what it does and does not capture.
 */
export const HEDGE = {
  asOf: BOOK.fx_hedge?.as_of ?? null,
  ratesPct: BOOK.fx_hedge?.rates_pct ?? {},
  sources: BOOK.fx_hedge?.sources ?? {},
};

/**
 * External factors the buckets are regressed on. Fetched alongside the book
 * but never part of it: they carry no weight and do not enter the curve.
 *
 * VGT is also a Compute holding, so the Compute bucket's tech beta is partly
 * mechanical. The test that matters is Ballast's, which does not hold it.
 */
export const FACTORS = [
  { id: "tech", ticker: "VGT", name: "Vanguard Information Technology ETF" },
  { id: "energy", ticker: "XLE", name: "Energy Select Sector SPDR" },
];

/**
 * Yahoo pairs used to convert every position back to the USD base.
 *
 * Written in the explicit `USDxxx=X` direction, which quotes USD -> CCY. A
 * local price is therefore divided by the rate to reach USD. The inversion is
 * derived per pair rather than assumed, so a `GBPUSD=X`-style pair added later
 * still converts correctly.
 */
export const FX_PAIRS = {
  USD: null,
  BRL: "USDBRL=X",
  SAR: "USDSAR=X",
  KRW: "USDKRW=X",
  TWD: "USDTWD=X",
  GBP: "USDGBP=X",
};

export const BASE_CURRENCY = "USD";

export const totalWeight = () => HOLDINGS.reduce((a, h) => a + h.weight, 0);

export const bySleeve = (id) => HOLDINGS.filter((h) => h.sleeve === id);

export const sleeveWeight = (id) =>
  bySleeve(id).reduce((a, h) => a + h.weight, 0);
