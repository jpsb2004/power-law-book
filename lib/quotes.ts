import { cacheLife } from "next/cache";
import { HOLDINGS, FX_PAIRS, SLEEVES, type Holding, type SleeveId } from "./holdings";
import {
  fetchSeries,
  describe,
  toUsdSeries,
  portfolioIndex,
  type Point,
  type Stats,
} from "./analytics";

export interface LivePosition extends Holding {
  price: number | null;
  previousClose?: number;
  dayChangePct: number | null;
  exchange?: string;
  quoteTime?: number;
  usdPoints: Point[];
  local?: Stats;
  usd?: Stats;
  manual?: boolean;
  fxMissing?: boolean;
  error?: string;
}

export interface Book {
  asOf: number;
  positions: LivePosition[];
  curve: Point[];
  curveStats: Stats;
  fx: Record<string, { pair: string; rate: number; quoted: number }>;
  excludedFromCurve: string[];
  degraded: boolean;
}

/**
 * FX series for every non-base currency in the book.
 *
 * Rates move slowly relative to the page's refresh, so they get their own,
 * longer-lived cache entry than the quotes do.
 */
async function loadFx() {
  "use cache";
  cacheLife("minutes");

  const fx: Record<string, { pair: string; rate: number; quoted: number; invert: boolean; points: Point[] }> = {};

  await Promise.all(
    Object.entries(FX_PAIRS).map(async ([ccy, pair]) => {
      if (pair === null) {
        fx[ccy] = { pair: "—", rate: 1, quoted: 1, invert: false, points: [] };
        return;
      }
      // Derived, not assumed: `USDBRL=X` quotes USD->CCY and must be divided;
      // a `GBPUSD=X`-style pair already quotes CCY->USD.
      const invert = !pair.endsWith("USD=X");
      try {
        const { meta, points } = await fetchSeries(pair, "1y");
        const quoted = meta.regularMarketPrice ?? 1;
        fx[ccy] = { pair, quoted, rate: invert ? 1 / quoted : quoted, invert, points };
      } catch {
        // A missing rate must not take the page down, but it must not be
        // papered over either: a rate of 1 would label won and reais as
        // dollars. The empty series marks the currency unconvertible, and
        // affected positions drop out of the USD figures instead.
        fx[ccy] = { pair, quoted: NaN, rate: NaN, invert, points: [] };
      }
    })
  );

  return fx;
}

/**
 * The whole book, priced.
 *
 * Cached for seconds rather than per-request: a page refresh should show a
 * fresh mark, but ten readers arriving at once should not each hit the
 * upstream endpoint twelve times.
 */
export async function getBook(): Promise<Book> {
  "use cache";
  cacheLife("seconds");

  const fx = await loadFx();

  const positions = await Promise.all(
    HOLDINGS.map(async (h): Promise<LivePosition> => {
      if (h.priced === "manual" && h.manualMark) {
        // No public quote exists. Carried flat at the last primary round.
        return {
          ...h,
          price: h.manualMark.price,
          dayChangePct: null,
          usdPoints: [],
          manual: true,
        };
      }

      try {
        const { meta, points } = await fetchSeries(h.ticker, "1y");
        const ccy = meta.currency ?? h.currency;
        const rate = fx[ccy];
        // Without a rate series a non-USD line cannot be converted; leaving the
        // USD side empty is honest, whereas passing the local series through
        // would report reais as dollars.
        const convertible = ccy === "USD" || (rate?.points?.length ?? 0) > 0;
        const usdPoints = convertible
          ? toUsdSeries(points, rate?.points ?? [], rate?.invert ?? false)
          : [];
        const price = meta.regularMarketPrice ?? null;
        // The previous close comes from the series, NOT from
        // `meta.chartPreviousClose`, which is relative to the requested range --
        // on a 1y fetch it is the close from a year ago, which would turn this
        // "Day" column into an annual change.
        const prev = points.at(-2)?.c;

        return {
          ...h,
          fxMissing: !convertible,
          currency: ccy,
          price,
          previousClose: prev,
          dayChangePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
          exchange: meta.fullExchangeName,
          quoteTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : undefined,
          usdPoints,
          local: describe(points),
          usd: describe(usdPoints),
        };
      } catch (err) {
        return {
          ...h,
          price: null,
          dayChangePct: null,
          usdPoints: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  // Positions without a series are dropped from the curve rather than held
  // flat -- a constant would damp measured volatility and flatter the book.
  const priced = positions.filter((p) => p.usdPoints.length > 1);
  const curve = portfolioIndex(priced.map((p) => ({ weight: p.weight, points: p.usdPoints })));

  return {
    asOf: Date.now(),
    positions,
    curve,
    curveStats: describe(curve),
    fx: Object.fromEntries(
      Object.entries(fx).map(([k, v]) => [k, { pair: v.pair, rate: v.rate, quoted: v.quoted }])
    ),
    excludedFromCurve: positions.filter((p) => p.usdPoints.length <= 1).map((p) => p.ticker),
    degraded: positions.some((p) => p.error),
  };
}

export const sleeveOrder: SleeveId[] = ["energy", "compute", "ballast"];

export const sleeveWeightOf = (id: SleeveId) =>
  HOLDINGS.filter((h) => h.sleeve === id).reduce((a, h) => a + h.weight, 0);

export { SLEEVES };
