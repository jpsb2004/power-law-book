/**
 * The book. Single source of truth for both the live app and the frozen
 * snapshot the published page is built from.
 *
 * `weight` is percent of notional. Edit those numbers and everything
 * downstream -- allocation, contribution, bucket totals -- follows.
 *
 * Bucket targets are Energy 38 / Compute 32 / Ballast 30. Within a bucket the
 * split is equal weight, with the integer remainder going to the most liquid
 * names, so the totals land exactly on target without implying a precision the
 * sizing does not have.
 */

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

export const HOLDINGS = [
  // -------------------------------------------------------------- I. ENERGY
  {
    ticker: "URA",
    name: "Global X Uranium ETF",
    sleeve: "energy",
    currency: "USD",
    weight: 6,
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
    sleeve: "energy",
    currency: "USD",
    weight: 5,
    kind: "ETF",
    venue: "NYSE Arca",
    thesis:
      "Deliberately the boring half of the fuel pair. Weighted toward utilities and reactor builders rather than juniors, it earns cash while URA takes the risk.",
    breaks:
      "It is not really a uranium proxy — the utility weighting means it can drift with rates while the actual fuel thesis plays out.",
  },
  {
    ticker: "PETR4.SA",
    name: "Petrobras PN",
    sleeve: "energy",
    currency: "BRL",
    weight: 6,
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
    sleeve: "energy",
    currency: "SAR",
    weight: 6,
    kind: "Equity",
    venue: "Tadawul",
    thesis:
      "The lowest-cost barrel on earth and the swing producer that sets the floor. Owned as the stabiliser of the bucket, not for its growth.",
    breaks:
      "Free float is thin and the payout leans on the state budget. A sustained sub-$60 Brent forces a choice between the dividend and Vision 2030.",
  },
  {
    ticker: "LB",
    name: "LandBridge Company",
    sleeve: "energy",
    currency: "USD",
    weight: 5,
    kind: "Equity",
    venue: "NYSE",
    thesis:
      "The hinge of the whole book. Owns Permian surface acreage and collects royalties on whatever sits on it — water handling, pipelines, and now data-centre leases. Sells energy and compute demand without drilling or buying a GPU.",
    breaks:
      "Small float, and the data-centre revenue is a handful of contracts. Concentration cuts both ways: it fell 9.5% in a single session on 12 Aug 2026.",
  },
  {
    ticker: "NBIS",
    name: "Nebius Group",
    sleeve: "energy",
    currency: "USD",
    weight: 5,
    kind: "Equity",
    venue: "NASDAQ",
    thesis:
      "A neocloud: rents GPU capacity by the hour to firms that will not build their own. Sits in this bucket because the binding constraint on the business is contracted power and shell space, not chips.",
    breaks:
      "Classified here as a power consumer, which is a stretch — it is really a compute landlord. Capex-funded, customer-concentrated, and competing with hyperscalers who own their own silicon.",
  },
  {
    ticker: "CRWV",
    name: "CoreWeave",
    sleeve: "energy",
    currency: "USD",
    weight: 5,
    kind: "Equity",
    venue: "NASDAQ",
    thesis:
      "The scaled version of the same trade as NBIS, with a contracted backlog rather than a spot book. The clearest listed read on whether AI capacity is genuinely pre-sold.",
    breaks:
      "Debt-funded purchases of an asset that depreciates on a chip cycle. One anchor customer renegotiating resets the whole model, and it overlaps heavily with NBIS — this is one position expressed twice.",
  },

  // ------------------------------------------------------------- II. COMPUTE
  {
    ticker: "TSM",
    name: "Taiwan Semiconductor",
    sleeve: "compute",
    currency: "USD",
    weight: 5,
    kind: "Equity",
    venue: "NYSE (ADR)",
    thesis:
      "The actual bottleneck. Nearly every accelerator in this book is fabricated by one company, so this is the least substitutable position in the portfolio.",
    breaks:
      "A Taiwan Strait event is not a drawdown, it is a permanent impairment — and the same event takes ^KS11 and 2357.TW with it. The single largest correlated risk here.",
  },
  {
    ticker: "AMD",
    name: "Advanced Micro Devices",
    sleeve: "compute",
    currency: "USD",
    weight: 5,
    kind: "Equity",
    venue: "NASDAQ",
    thesis:
      "The only credible second source of accelerators. Owned as the option on buyers refusing to accept a single supplier, not as a bet on it winning outright.",
    breaks:
      "The moat is software, not silicon. If CUDA holds, competitive hardware still does not convert into share, and the share gains are already in the multiple.",
  },
  {
    ticker: "PLTR",
    name: "Palantir Technologies",
    sleeve: "compute",
    currency: "USD",
    weight: 5,
    kind: "Equity",
    venue: "NASDAQ",
    thesis:
      "The application layer. Sells the deployment of models into government and commercial workflows, which is where the margin sits once inference is a commodity.",
    breaks:
      "The multiple is the position. Growth is real and accelerating, but at this valuation a single decelerating quarter costs more than the growth adds.",
  },
  {
    ticker: "VGT",
    name: "Vanguard Information Technology ETF",
    sleeve: "compute",
    currency: "USD",
    weight: 5,
    kind: "ETF",
    venue: "NYSE Arca",
    thesis:
      "Broad exposure to the complex, so the bucket survives being wrong about any single name.",
    breaks:
      "It already holds AMD, TSM's peers and the megacaps, so it overlaps with half this bucket. It dilutes single-name risk without adding a new bet — closer to a cash proxy with tech beta than genuine diversification.",
  },
  {
    ticker: "2357.TW",
    name: "ASUSTeK Computer",
    sleeve: "compute",
    currency: "TWD",
    weight: 4,
    kind: "Equity",
    venue: "TWSE",
    thesis:
      "AI server exposure at a hardware multiple rather than a semiconductor one. The AI server business is repricing the whole company while it is still classified as a PC maker.",
    breaks:
      "Server assembly is margin-thin with real customer concentration, and the legacy PC cycle still swamps the AI line in reported revenue.",
  },
  {
    ticker: "^KS11",
    name: "KOSPI Composite",
    sleeve: "compute",
    currency: "KRW",
    weight: 4,
    kind: "Index",
    venue: "KRX",
    tradability: "index",
    thesis:
      "Country-level exposure to memory. HBM pricing runs through Korean national accounts, and the index carries a persistent governance discount that is finally being addressed.",
    breaks:
      "Not directly investable — it is an index, so a real book expresses it through a fund or futures and eats tracking error and FX.",
  },
  {
    ticker: "AINF.L",
    name: "iShares AI Infrastructure UCITS ETF",
    sleeve: "compute",
    currency: "GBP",
    weight: 4,
    kind: "ETF",
    venue: "LSE",
    thesis:
      "Spreads the infrastructure bet across semis, cloud and networking, including names the single-name lines here miss.",
    breaks:
      "Overlaps with VGT and with the megacap complex most portfolios already own, and the LSE line quotes GBP against a USD NAV — an FX layer sitting on top of the actual exposure.",
  },

  // ------------------------------------------------------------ III. BALLAST
  {
    ticker: "GLD",
    name: "SPDR Gold Shares",
    sleeve: "ballast",
    currency: "USD",
    weight: 8,
    kind: "ETF",
    venue: "NYSE Arca",
    thesis:
      "The hedge against the financing of everything above. If the buildout is funded by deficits and suppressed real rates, gold is the direct expression of that — and as spot-backed shares it carries no expiry and no roll.",
    breaks:
      "Pays nothing to hold. A genuine real-rate spike is its enemy, and it can fall alongside risk assets in a liquidity event precisely when the hedge is needed.",
  },
  {
    ticker: "AVDV",
    name: "Avantis International Small Cap Value ETF",
    sleeve: "ballast",
    currency: "USD",
    weight: 8,
    kind: "ETF",
    venue: "NYSE Arca",
    thesis:
      "The deliberate opposite of the rest of the book: ex-US, small, cheap, profitable, and largely unowned by the AI trade. Here to be uncorrelated, not to be exciting.",
    breaks:
      "Value has underperformed growth for most of a decade. If the buildout simply keeps compounding, this is a permanent drag.",
  },
  {
    ticker: "JPM",
    name: "JPMorgan Chase",
    sleeve: "ballast",
    currency: "USD",
    weight: 7,
    kind: "Equity",
    venue: "NYSE",
    thesis:
      "The lender to the buildout. Captures capital-markets activity and a steeper curve without taking a view on which operator wins.",
    breaks:
      "Imperfect ballast: it is levered to the same economy the rest of the book needs, so it fails in the scenario the hedge exists for. A credit cycle hits it and the neoclouds together.",
  },
  {
    ticker: "RARA11.SA",
    name: "Investo MVIS Global Rare Earth & Strategic Metals",
    sleeve: "ballast",
    currency: "BRL",
    weight: 7,
    kind: "ETF",
    venue: "B3 São Paulo",
    thesis:
      "The materials upstream of everything else here: magnets, motors, turbines. Exposure to export controls on rare earths, which is the supply chokepoint the compute bucket cannot design around.",
    breaks:
      "This is not ballast. It is a concentrated, policy-driven, high-beta commodity-equity basket that will likely fall with the rest of the book rather than against it — and it is a thin BRL listing carrying currency risk on top.",
  },
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
