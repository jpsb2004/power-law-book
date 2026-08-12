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
  init?: RequestInit
): Promise<{ meta: QuoteMeta; points: Point[] }>;
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
export declare function describe(points: Point[]): Stats;
