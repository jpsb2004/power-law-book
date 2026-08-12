/**
 * The book. Single source of truth for both the live app and the frozen
 * snapshot the published page is built from.
 *
 * `weight` is percent of notional. Edit those numbers and everything
 * downstream -- allocation, contribution, sleeve totals -- follows.
 */

/** Sleeves are the argument. Each one is a distinct link in the same chain. */
export const SLEEVES = {
  fuel: {
    id: "fuel",
    numeral: "I",
    name: "Fuel Cycle",
    claim: "Reactors are being restarted and built faster than fuel is being dug up.",
  },
  ground: {
    id: "ground",
    numeral: "II",
    name: "Molecules & Acres",
    claim: "Compute lands somewhere physical, and pays rent to whoever owns the ground and the power.",
  },
  compute: {
    id: "compute",
    numeral: "III",
    name: "Compute",
    claim: "The demand side — silicon, the boxes it ships in, and the firms selling the output.",
  },
  ballast: {
    id: "ballast",
    numeral: "IV",
    name: "Ballast",
    claim: "What is left standing if the first three sleeves are one trade wearing four hats.",
  },
};

export const HOLDINGS = [
  // ---------------------------------------------------------------- I. FUEL
  {
    ticker: "URA",
    name: "Global X Uranium ETF",
    sleeve: "fuel",
    currency: "USD",
    weight: 9,
    kind: "ETF",
    venue: "NYSE Arca",
    thesis:
      "The purest listed claim on the fuel bottleneck. Holds miners and enrichers, so it captures the spot uranium move with equity beta stacked on top.",
    breaks:
      "A restart of idled Kazakh and Namibian supply, or one high-profile reactor incident, resets sentiment far faster than mine supply can respond.",
  },
  {
    ticker: "NLR",
    name: "VanEck Uranium & Nuclear ETF",
    sleeve: "fuel",
    currency: "USD",
    weight: 6,
    kind: "ETF",
    venue: "NYSE Arca",
    thesis:
      "Deliberately the boring half of the sleeve. Weighted toward utilities and reactor builders rather than juniors, it earns cash while URA takes the risk.",
    breaks:
      "It is not really a uranium proxy — the utility weighting means it can drift with rates while the actual fuel thesis plays out.",
  },

  // -------------------------------------------------------------- II. GROUND
  {
    ticker: "PETR4.SA",
    name: "Petrobras PN",
    sleeve: "ground",
    currency: "BRL",
    weight: 8,
    kind: "Equity",
    venue: "B3 São Paulo",
    thesis:
      "Pre-salt barrels at a single-digit multiple with a double-digit payout. Priced for permanent political risk, which is a real risk that is nonetheless already in the number.",
    breaks:
      "Dividend policy is set by the controlling shareholder, and the controlling shareholder is the state. Fuel-price intervention ahead of an election ends the thesis without warning.",
  },
  {
    ticker: "2222.SR",
    name: "Saudi Aramco",
    sleeve: "ground",
    currency: "SAR",
    weight: 7,
    kind: "Equity",
    venue: "Tadawul",
    thesis:
      "The lowest-cost barrel on earth and the swing producer that sets the floor. Owned here as the stabiliser of the sleeve, not for its growth.",
    breaks:
      "Free float is thin and the payout leans on the state budget. A sustained sub-$60 Brent forces a choice between the dividend and Vision 2030.",
  },
  {
    ticker: "LB",
    name: "LandBridge Company",
    sleeve: "ground",
    currency: "USD",
    weight: 5,
    kind: "Equity",
    venue: "NYSE",
    thesis:
      "The hinge of the whole book. Owns Permian surface acreage and collects royalties on whatever sits on it — water handling, pipelines, and now data-centre leases. Sells energy and compute demand without drilling or buying a GPU.",
    breaks:
      "Small float, and the data-centre revenue is a handful of contracts. Concentration cuts both ways, as a 9.5% single-session drop on 12 Aug demonstrated.",
  },

  // ------------------------------------------------------------- III. COMPUTE
  {
    ticker: "2357.TW",
    name: "ASUSTeK Computer",
    sleeve: "compute",
    currency: "TWD",
    weight: 7,
    kind: "Equity",
    venue: "TWSE",
    thesis:
      "AI server exposure at a hardware multiple rather than a semiconductor one. The AI server business is repricing the whole company while it is still classified as a PC maker.",
    breaks:
      "Server assembly is a margin-thin business with real customer concentration, and the legacy PC cycle still swamps the AI line in reported revenue.",
  },
  {
    ticker: "^KS11",
    name: "KOSPI Composite",
    sleeve: "compute",
    currency: "KRW",
    weight: 5,
    kind: "Index",
    venue: "KRX",
    tradability: "index",
    thesis:
      "Country-level exposure to memory. HBM pricing runs through Korean national accounts, and the index carries a persistent governance discount that is finally being addressed.",
    breaks:
      "Not directly investable — it is an index, so a real book expresses it through a fund or futures and eats tracking error and FX. Also a first-order casualty of any Taiwan Strait event.",
  },
  {
    ticker: "PLTR",
    name: "Palantir Technologies",
    sleeve: "compute",
    currency: "USD",
    weight: 8,
    kind: "Equity",
    venue: "NASDAQ",
    thesis:
      "The application layer. Sells the deployment of models into government and commercial workflows, which is where the margin sits once inference is a commodity.",
    breaks:
      "The multiple is the position. Growth is real and accelerating, but at this valuation a single decelerating quarter costs more than the growth adds.",
  },
  {
    ticker: "ANTH.PVT",
    name: "Anthropic",
    sleeve: "compute",
    currency: "USD",
    weight: 7,
    kind: "Private",
    venue: "Private",
    priced: "manual",
    tradability: "private",
    manualMark: {
      price: 965,
      unit: "USD bn post-money",
      asOf: "2026-05-28",
      basis: "Series H, $65bn raised, led by Altimeter / Dragoneer / Greenoaks / Sequoia",
      note: "Confidential IPO filing 1 Jun 2026. No public market; carried flat at the last primary round.",
    },
    thesis:
      "Direct exposure to the frontier lab whose demand curve the other three sleeves are ultimately serving. Held to make the book's central assumption explicit rather than implied.",
    breaks:
      "Illiquid and marked at a stale round, so the position understates its own volatility. A down round or a broken IPO would reprice it in one step, with no path to exit in between.",
  },
  {
    ticker: "AINF.L",
    name: "iShares AI Infrastructure UCITS ETF",
    sleeve: "compute",
    currency: "GBP",
    weight: 8,
    kind: "ETF",
    venue: "LSE",
    thesis:
      "Diversifies the single-name compute risk across semis, cloud and networking, so the sleeve survives being wrong about any one company.",
    breaks:
      "Heavy overlap with the megacap complex most portfolios already own, and the LSE line quotes GBP against a USD NAV — an FX layer sitting on top of the actual exposure.",
  },

  // ------------------------------------------------------------- IV. BALLAST
  {
    ticker: "GC=F",
    name: "Gold — COMEX Dec 2026",
    sleeve: "ballast",
    currency: "USD",
    weight: 18,
    kind: "Future",
    venue: "COMEX",
    tradability: "future",
    expiry: "2026-12-29",
    thesis:
      "The hedge against the financing of everything above. If the energy and compute build-out is funded by deficits and suppressed real rates, gold is the direct expression of that.",
    breaks:
      "A dated future, not bullion — it expires 29 Dec 2026 and must be rolled, so the position carries basis and roll cost that a spot holding does not.",
  },
  {
    ticker: "AVDV",
    name: "Avantis International Small Cap Value ETF",
    sleeve: "ballast",
    currency: "USD",
    weight: 12,
    kind: "ETF",
    venue: "NYSE Arca",
    thesis:
      "The deliberate opposite of the rest of the book: ex-US, small, cheap, profitable, and largely unowned by the AI trade. It is here to be uncorrelated, not to be exciting.",
    breaks:
      "Value has underperformed growth for most of a decade. If the AI build-out simply keeps compounding, this sleeve is a permanent drag on returns.",
  },
];

/** Yahoo pairs used to convert every position back to the USD base. */
export const FX_PAIRS = {
  USD: null,
  BRL: "BRL=X",
  SAR: "SAR=X",
  KRW: "KRW=X",
  TWD: "TWD=X",
  GBP: "GBPUSD=X",
};

export const BASE_CURRENCY = "USD";

export const totalWeight = () => HOLDINGS.reduce((a, h) => a + h.weight, 0);

export const bySleeve = (id) => HOLDINGS.filter((h) => h.sleeve === id);

export const sleeveWeight = (id) =>
  bySleeve(id).reduce((a, h) => a + h.weight, 0);
