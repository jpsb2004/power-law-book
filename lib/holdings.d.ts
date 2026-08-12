export type SleeveId = "fuel" | "ground" | "compute" | "ballast";

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
}

export declare const SLEEVES: Record<SleeveId, Sleeve>;
export declare const HOLDINGS: Holding[];
export declare const FX_PAIRS: Record<string, string | null>;
export declare const BASE_CURRENCY: string;
export declare function totalWeight(): number;
export declare function bySleeve(id: SleeveId): Holding[];
export declare function sleeveWeight(id: SleeveId): number;
