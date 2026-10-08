export type SleeveId = "energy" | "compute" | "ballast";

export interface Sleeve {
  id: SleeveId;
  numeral: string;
  name: string;
  claim: string;
}

export interface ManualMark {
  price: number;
  unit: string;
  asOf: string;
  basis: string;
  note: string;
}

export interface Holding {
  ticker: string;
  name: string;
  sleeve: SleeveId;
  currency: string;
  weight: number;
  kind: string;
  venue: string;
  thesis: string;
  breaks: string;
  priced?: "manual";
  tradability?: "index" | "future" | "private";
  expiry?: string;
  manualMark?: ManualMark;
  /** Share of the measured window this position actually traded in (0-1). */
  coverage?: number;
  /** True when coverage is below 95% -- a newer listing, not missing data. */
  partial?: boolean;
  fxMissing?: boolean;
  currencyMismatch?: boolean;
  /** A tradable instrument standing in for a non-investable line. */
  proxy?: Proxy;
  trackingNotes?: string | null;
}

export interface Proxy {
  ticker: string;
  name: string;
  venue: string;
  currency: string;
  expense_ratio_pct: number;
  /** Sessions the proxy's close is shifted back to meet the target's clock. */
  clock_lag_sessions?: number;
}

export interface Factor {
  id: string;
  ticker: string;
  name: string;
}

export declare const SLEEVES: Record<SleeveId, Sleeve>;
export declare const HOLDINGS: Holding[];
export declare const FX_PAIRS: Record<string, string | null>;
export declare const BASE_CURRENCY: string;
export declare const HEDGE: { asOf: string | null; ratesPct: Record<string, number>; sources: Record<string, string> };
export declare const FACTORS: Factor[];
export declare function totalWeight(): number;
export declare function bySleeve(id: SleeveId): Holding[];
export declare function sleeveWeight(id: SleeveId): number;
