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
 * Bucket targets are Substrate 43 / Compute 33 / Materials 2 / Ballast 22
 * (`bucket_targets` in positions.json; check-book enforces them). Bucket targets
 * are set first; weights within each bucket are set line by line, and the
 * change log records why. Equal capital is not equal risk: see the risk table.
 */

import { readFileSync } from "node:fs";

/** Buckets are the argument. Each one is a distinct link in the same chain. */
export const SLEEVES = {
  energy: {
    id: "energy",
    numeral: "I",
    name: "Substrate",
    claim: "The buildout is constrained by fuel, molecules, the ground it stands on and the grid equipment that connects it.",
  },
  compute: {
    id: "compute",
    numeral: "II",
    name: "Compute",
    claim: "The demand side — the silicon, the fabs, and the firms selling the output.",
  },
  // Split out of Ballast (2026-10-14): a rare-earth basket rises and falls with
  // the technology-materials cycle, so it was never a counterweight. Its own
  // link in the chain: the inputs the compute bucket cannot design around.
  materials: {
    id: "materials",
    numeral: "III",
    name: "Materials",
    claim: "The minerals the buildout cannot design around, and whose supply is set by export policy.",
  },
  ballast: {
    id: "ballast",
    numeral: "IV",
    name: "Diversifiers",
    claim: "Cushions drawdowns; measured as diversification, not a hedge.",
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
    // Classification calls worth arguing with, shown as tags wherever the line is.
    ...(p.classification_flags?.length ? { flags: p.classification_flags } : {}),
    ...(p.investable?.proxy ? { proxy: p.investable.proxy, trackingNotes: p.investable.tracking_notes } : {}),
    // A held fund measured against the index it stands in for (EWY vs ^KS11).
    ...(p.investable?.reference
      ? {
          reference: p.investable.reference,
          expenseRatioPct: p.investable.expense_ratio_pct ?? null,
          trackingNotes: p.investable.tracking_notes,
        }
      : {}),
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
 * VGT was a Compute holding until 2026-10-28, so until then the Compute
 * bucket's tech beta was partly mechanical. The test that matters is Ballast's,
 * which never held it.
 */
export const FACTORS = [
  { id: "tech", ticker: "VGT", name: "Vanguard Information Technology ETF" },
  { id: "energy", ticker: "XLE", name: "Energy Select Sector SPDR" },
];

/**
 * What the book's return is judged against. A return with nothing beside it
 * says nothing: VGT is the obvious "just buy tech" alternative (it was a Compute
 * holding until 2026-10-28), ACWI is the global equity market, and 60/40 is the
 * default balanced portfolio a reader would hold instead. All USD total
 * returns over the book's own window; legs of a blend are rebalanced daily,
 * like the book.
 *
 * `market` is the series every beta in the comparison table is measured
 * against. `riskFree` is the T-bill fund Sharpe and Sortino are measured in
 * excess of -- SGOV, already a Ballast holding, so its total return is the
 * policy rate actually earned rather than an assumed one.
 */
export const BENCHMARKS = [
  { id: "vgt", label: "VGT (US tech)", legs: [{ ticker: "VGT", weight: 100 }] },
  { id: "acwi", label: "ACWI (global equity)", legs: [{ ticker: "ACWI", weight: 100 }] },
  { id: "6040", label: "60/40 (ACWI / AGG)", legs: [{ ticker: "ACWI", weight: 60 }, { ticker: "AGG", weight: 40 }] },
];
export const MARKET = "ACWI";
export const RISK_FREE = "SGOV";

/** The thesis as testable statements: variant view, horizon, review rules, falsifiers (P1-4). */
export const THESIS = BOOK.thesis ?? null;

/** Groups of lines that share one failure (P1-3). */
export const CONCENTRATION_GROUPS = BOOK.concentration_groups ?? [];

/** Dated log of every change to the book or its method (review item P0-2). */
export const BOOK_CHANGES = BOOK.book_changes ?? [];

/** Rebalancing rule for the headline curve (review item P0-5). */
export const BASE_REBALANCE = BOOK.rebalance?.base_case ?? "monthly";

/**
 * Cost assumptions for the net-of-cost series, resolved per line. Stated in
 * `data/positions.json` (`cost_assumptions`) with their caveats; see
 * rebalancedIndex() in analytics.js for how each is charged.
 */
const COST = BOOK.cost_assumptions ?? {};
export const COSTS = {
  asOf: COST.as_of ?? null,
  note: COST.note ?? "",
  tradeBps: COST.trade_bps ?? {},
  fxSpreadBps: COST.fx_spread_bps ?? 0,
  withholdingPct: COST.withholding_pct ?? {},
  /** Per-line parameters, keyed by listing currency. */
  forLine(currency, base = "USD") {
    return {
      tradeBps: this.tradeBps[currency] ?? this.tradeBps.default ?? 0,
      fxBps: currency === base ? 0 : this.fxSpreadBps,
      withholdingPct: this.withholdingPct[currency] ?? 0,
    };
  },
};

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
