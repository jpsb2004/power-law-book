export interface Point {
  t: number;
  c: number;
}

export interface Stats {
  ytd: number | null;
  ret1m: number | null;
  ret3m: number | null;
  ret1y: number | null;
  vol: number | null;
  maxDrawdown: number | null;
}

export interface QuoteMeta {
  currency?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

export declare const dayKey: (t: number) => string;
export declare function fetchSeries(
  symbol: string,
  range?: string,
  init?: RequestInit,
  opts?: { completedOnly?: boolean }
): Promise<{ meta: QuoteMeta; points: Point[]; sessionOpen: boolean; lastBar: string | null }>;
export declare function pctFrom(points: Point[], days: number): number | null;
export declare function ytdPct(points: Point[]): number | null;
export declare function annualisedVol(points: Point[]): number | null;
export declare function maxDrawdown(points: Point[]): number;
export declare function logReturns(points: Point[]): { t: number; r: number }[];
export declare function correlation(
  a: { t: number; r: number }[],
  b: { t: number; r: number }[]
): { rho: number; n: number } | null;
export declare function toUsdSeries(points: Point[], fxPoints: Point[], invert: boolean): Point[];
export declare function portfolioIndex(legs: { weight: number; points: Point[] }[]): Point[];
export declare function rebalancedIndex(
  legs: { key?: string; weight: number; points: Point[] }[],
  opts?: { rebalance?: string; costs?: boolean }
): { points: Point[]; rebalances: number; turnoverPctPerYear: number; tradingCostPct: number; withholdingPct: number };
export declare function describe(points: Point[]): Stats;
export declare function hedgedSeries(
  points: Point[],
  currency: string,
  ratesPct: Record<string, number>,
  base?: string
): Point[];
export declare function weeklyReturns(points: Point[], opts?: { simple?: boolean }): Map<string, number>;
export declare function alignWeekly(...maps: Map<string, number>[]): { weeks: string[]; cols: number[][] };
export declare function ols(
  y: number[],
  xs: number[][]
): { n: number; coef: number[]; se: number[]; t: (number | null)[]; r2: number | null } | null;
export declare const MIN_WEEKS: number;
export declare function olsMin(y: number[], xs: number[][]): ReturnType<typeof ols>;
export declare function weeklyCovariance(legs: { key: string; weight: number; points: Point[] }[]): {
  keys: string[];
  capitalPct: number[];
  w: number[];
  weeks: number;
  weekKeys: string[];
  cols: number[][];
  cov: number[][];
  insufficient: { key: string; weeks: number; capitalPct: number }[];
  includedCapitalPct: number;
  excludedCapitalPct: number;
};
export declare const INDEX_METHOD: string;
export declare function trackingStats(
  target: Point[],
  proxy: Point[],
  opts?: { horizon?: number; lagSessions?: number }
): {
  windows: number;
  horizon: number;
  lagSessions: number;
  trackingErrorPct: number;
  correlation: number | null;
  beta: number | null;
} | null;
