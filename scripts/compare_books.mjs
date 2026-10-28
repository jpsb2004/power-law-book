/**
 * One-off comparison of the current book with a proposed one (brief, Phase 6.3).
 *
 *     node scripts/compare_books.mjs
 *
 * Replays both books from data/prices.csv (USD, adjusted) with the same
 * functions the pipeline uses. No network. Reads positions.json and
 * scenarios.json; never writes them. Output: research/thesis_pure_comparison.md.
 *
 * The book before Phase 6 is read from git at BASE_COMMIT, so the comparison
 * still means the same thing after positions.json carries the new book.
 * Shocks merge the scenarios file at BASE_COMMIT with the current one: the
 * removed VGT keeps its old shock, the added VST takes its new one.
 *
 * VST is not in data/prices.csv. It is replayed from a one-off read-only fetch
 * (VST_CACHE, gitignored), clipped to the prices.csv dates.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rebalancedIndex, describe, riskContributions, weeklyReturns, alignWeekly } from "../lib/analytics.js";
import { buildStructure } from "../lib/structure.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const readAt = (commit, p) =>
  execFileSync("git", ["show", `${commit}:${p}`], { cwd: fileURLToPath(root), encoding: "utf8", maxBuffer: 1 << 26 });

/** The last commit before Phase 6 changed the book. */
export const BASE_COMMIT = "5d98608";
export const VST_CACHE = "research/cache/yahoo/2026-10-28_VST_1y.json";

/** The Phase 6 book as the owner approved it (chat, 28 Oct 2026), as overrides on the book at BASE_COMMIT. */
export const PROPOSED = {
  changes: {
    NBIS: { weight: 3, bucket: "compute" },
    CRWV: { weight: 2, bucket: "compute" },
    VGT: { weight: 0 },
    ETN: { weight: 5 },
    HUBB: { weight: 5 },
    "2357.TW": { weight: 3 },
  },
  add: [{ key: "VST", bucket: "energy", weight: 5, series: "VST" }],
};

/** The "US AI capex" concentration group in the Phase 6 book, at its Phase 6 weights. */
export const CAPEX_GROUP = [
  { series: "NBIS", weight: 3 },
  { series: "CRWV", weight: 2 },
  { series: "AMD", weight: 5 },
  { series: "PLTR", weight: 5 },
  { series: "AINF.L", weight: 4 },
];

/** NBIS and CRWV moved to Compute at their current weights; nothing else changes. */
export const MOVE_ONLY = {
  changes: { NBIS: { bucket: "compute" }, CRWV: { bucket: "compute" } },
  add: [],
};

/**
 * Active lines of the book after `overrides`, as [{key, label, bucket, weight, series}].
 * `series` is the prices.csv column the line is replayed from; weight 0 drops a line.
 */
export function buildBook(positions, { changes = {}, add = [] } = {}) {
  const lines = positions
    .filter((p) => (p.status ?? "active") === "active")
    .map((p) => ({ key: p.ticker, label: p.ticker, bucket: p.bucket, weight: p.weight, series: p.ticker, ...changes[p.ticker] }))
    .filter((l) => l.weight > 0);
  return [...lines, ...add.map((a) => ({ label: a.key, ...a }))];
}

/** Capital per bucket, in percent of the book. */
export function bucketSplit(book) {
  const out = {};
  for (const l of book) out[l.bucket] = (out[l.bucket] ?? 0) + l.weight;
  return out;
}

/** Weight-aggregated stated shock, as research/scenarios.py apply_scenario does. */
export function scenarioImpact(book, shocks) {
  return book.reduce((a, l) => a + ((shocks[l.series] ?? 0) * l.weight) / 100, 0);
}

/** prices.csv as {ticker: [{t, c}]}, plus a flat CASH series on every date. */
export function parsePrices(csv) {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const cols = head.split(",");
  const out = Object.fromEntries(cols.slice(1).map((c) => [c, []]));
  out.CASH = [];
  for (const row of rows) {
    const cells = row.split(",");
    const t = Date.parse(`${cells[0]}T00:00:00Z`);
    out.CASH.push({ t, c: 1 });
    cols.slice(1).forEach((c, i) => {
      const v = cells[i + 1];
      if (v !== "" && v != null && Number(v) > 0) out[c].push({ t, c: Number(v) });
    });
  }
  return out;
}

/** Adds a cached series as prices[ticker], clipped to the dates prices.csv covers. */
export function mergeCached(prices, ticker, points) {
  const days = new Set(prices.CASH.map((p) => p.t));
  prices[ticker] = points
    .map((p) => ({ t: Date.parse(`${p.date}T00:00:00Z`), c: p.c }))
    .filter((p) => days.has(p.t) && p.c > 0);
  return prices;
}

const pearson = (x, y) => {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};

/**
 * Weekly-return correlation of one series with a weighted basket of others
 * (rebalanced as the book is), and with each basket line on its own.
 */
export function groupCorrelation(prices, target, group, rebalance = "monthly") {
  const basket = rebalancedIndex(group.map((g) => ({ key: g.series, weight: g.weight, points: prices[g.series] })), { rebalance }).points;
  const t = weeklyReturns(prices[target]);
  const corr = (m) => {
    const { weeks, cols } = alignWeekly(t, m);
    return { weeks: weeks.length, r: pearson(cols[0], cols[1]) };
  };
  return {
    basket: corr(weeklyReturns(basket)),
    lines: Object.fromEntries(group.map((g) => [g.series, corr(weeklyReturns(prices[g.series])).r])),
  };
}

function evaluate(book, prices, scenarios, rebalance) {
  const legsOf = (lines) => lines.map((l) => ({ key: l.key, weight: l.weight, points: prices[l.series] }));
  const curve = rebalancedIndex(legsOf(book), { rebalance }).points;
  const d = describe(curve);
  const bucketRet = (id) => describe(rebalancedIndex(legsOf(book.filter((l) => l.bucket === id)), { rebalance }).points).ret1y;

  // Lines replayed from the same series are one position for covariance:
  // two identical columns would make the matrix singular.
  const merged = Object.values(
    book.reduce((m, l) => {
      const x = (m[l.series] ??= { key: l.series, ticker: l.series, bucket: l.bucket, sleeve: l.bucket, weight: 0, points: prices[l.series] });
      x.weight += l.weight;
      return m;
    }, {})
  );
  const rc = riskContributions(merged);
  const riskShare = (id) =>
    rc ? rc.rows.reduce((a, r) => a + (merged.find((m) => m.key === r.key).bucket === id ? r.riskSharePct ?? 0 : 0), 0) : null;
  const st = buildStructure(merged);

  return {
    from: curve[0]?.t,
    to: curve.at(-1)?.t,
    windowRet: curve.length ? (curve.at(-1).c / curve[0].c - 1) * 100 : null,
    ret1y: d.ret1y,
    vol: d.vol,
    maxDrawdown: d.maxDrawdown,
    scenarios: Object.fromEntries(scenarios.map((s) => [s.key, scenarioImpact(book, s.shocks)])),
    enb: st?.enb ?? null,
    enbRange: st?.enbRange ?? null,
    riskEnergy: riskShare("energy"),
    riskCompute: riskShare("compute"),
    riskExcluded: rc ? rc.insufficient.map((x) => x.key) : [],
    rotation: bucketRet("compute") - bucketRet("energy"),
    split: bucketSplit(book),
  };
}

const f1 = (x) => (x == null ? "n/a" : x.toFixed(1));
const sg = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}`);
const day = (t) => new Date(t).toISOString().slice(0, 10);

function render(rows, rotationRows, scenarios, live, extra) {
  const r0 = rows[0].r;
  const L = [];
  L.push("# Thesis-pure comparison: current book vs proposed book");
  L.push("");
  L.push(`Replayed from data/prices.csv (USD, adjusted), ${day(r0.from)} to ${day(r0.to)}, rebalanced as the pipeline does. Generated by scripts/compare_books.mjs.`);
  L.push("");
  L.push(`A is the book before Phase 6 (commit ${BASE_COMMIT}). B is the Phase 6 book approved on 28 Oct 2026: NBIS 3% and CRWV 2% moved to Compute; VGT removed; ETN 5%; HUBB 5%; 2357.TW 3%; VST 5% added in Substrate.`);
  L.push(`VST is not in data/prices.csv. It is replayed from its own adjusted USD closes (Yahoo, one read-only fetch on 2026-10-28, cached outside data/). Its history starts ${extra.vstFrom}, so until the first monthly rebalance after that date the other lines carry its weight.`);
  L.push("");
  const sc = scenarios.map((s) => s.name);
  L.push(`| Book | Substrate / Compute / Materials / Ballast % | Window return % | 12m return % | Volatility % | Max drawdown % | ${sc.join(" % | ")} % | ENB (5-95%) | Substrate risk share % | Compute risk share % |`);
  L.push(`|---|---|---|---|---|---|${sc.map(() => "---|").join("")}---|---|---|`);
  for (const { name, r } of rows) {
    const s = r.split;
    const split = [s.energy, s.compute, s.materials, s.ballast].map((x) => x ?? 0).join(" / ") + (s.cash ? ` + cash ${s.cash}` : "");
    const enb = r.enb == null ? "n/a" : `${r.enb.toFixed(2)} (${r.enbRange ? `${r.enbRange.p05.toFixed(2)}–${r.enbRange.p95.toFixed(2)}` : "n/a"})`;
    L.push(`| ${name} | ${split} | ${sg(r.windowRet)} | ${sg(r.ret1y)} | ${f1(r.vol)} | ${f1(r.maxDrawdown)} | ${scenarios.map((x) => sg(r.scenarios[x.key])).join(" | ")} | ${enb} | ${f1(r.riskEnergy)} | ${f1(r.riskCompute)} |`);
  }
  L.push("");
  const lower = rows.slice(1).filter((x) => x.r.windowRet < r0.windowRet).map((x) => x.name);
  L.push(lower.length
    ? `In this window the aligned book returned less than the current book: ${lower.join("; ")}.`
    : "In this window no proposed variant returned less than the current book.");
  L.push("");
  L.push("## Rotation falsifier (Compute minus Substrate, twelve months, pp; threshold 20)");
  L.push("");
  L.push("| Book | Reading pp | Triggered |");
  L.push("|---|---|---|");
  for (const { name, rotation } of rotationRows) L.push(`| ${name} | ${sg(rotation)} | ${rotation > 20 ? "yes" : "no"} |`);
  if (live) L.push(`| Live snapshot (${day(live.asOf)}), current book | ${sg(live.reading)} | ${live.triggered ? "yes" : "no"} |`);
  L.push("");
  L.push("## VST against the US AI capex group (weekly returns)");
  L.push("");
  L.push(`Correlation with the group basket (NBIS 3, CRWV 2, AMD 5, PLTR 5, AINF.L 4, rebalanced monthly): ${extra.corr.basket.r.toFixed(2)} over ${extra.corr.basket.weeks} weeks. By line: ${Object.entries(extra.corr.lines).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}.`);
  L.push("");
  L.push("## Caveats");
  L.push("");
  L.push("- One window of about a year. These are the realised paths of a book chosen with hindsight about which themes ran; they are not estimates of future return or risk.");
  L.push(`- Scenario impacts are the stated shocks in data/scenarios.json (judgements, not estimates). VST takes its own stated shocks; VGT, removed, keeps the shocks it had at ${BASE_COMMIT}.`);
  L.push("- ENB is a point estimate from a sample covariance on weekly returns; the range is a moving-block bootstrap (5th–95th percentile).");
  const ex = [...new Set(rows.flatMap((x) => x.r.riskExcluded))];
  if (ex.length) L.push(`- Risk shares and ENB leave out lines with fewer than 40 weeks of history: ${ex.join(", ")}.`);
  L.push("- No line here is a recommendation to buy or sell (CVM Res. 20).");
  return L.join("\n") + "\n";
}

function main() {
  const positions = JSON.parse(readAt(BASE_COMMIT, "data/positions.json"));
  const base = JSON.parse(readAt(BASE_COMMIT, "data/scenarios.json")).scenarios;
  const scenarios = JSON.parse(read("data/scenarios.json")).scenarios.map((s) => ({
    ...s,
    shocks: { ...base.find((b) => b.key === s.key)?.shocks, ...s.shocks },
  }));
  const prices = mergeCached(parsePrices(read("data/prices.csv")), "VST", JSON.parse(read(VST_CACHE)).points);
  const rebalance = positions.rebalance?.base_case ?? "monthly";
  const run = (o) => evaluate(buildBook(positions.positions, o), prices, scenarios, rebalance);

  const A = run({});
  const B = run(PROPOSED);
  const M = run(MOVE_ONLY);
  let live = null;
  try {
    const s = JSON.parse(read("data/snapshot.json"));
    const c = s.thesis?.checks?.find((x) => x.key === "rotation");
    if (c) live = { reading: c.reading, triggered: c.triggered, asOf: s.asOf };
  } catch {}

  const corr = groupCorrelation(prices, "VST", CAPEX_GROUP, rebalance);
  const extra = { vstFrom: day(prices.VST[0].t), corr };

  const rows = [
    { name: "A: before Phase 6", r: A },
    { name: "B: Phase 6 book", r: B },
  ];
  const rotationRows = [
    { name: "A: before Phase 6", rotation: A.rotation },
    { name: "A with NBIS and CRWV moved to Compute only", rotation: M.rotation },
    { name: "B: Phase 6 book", rotation: B.rotation },
  ];
  writeFileSync(new URL("research/thesis_pure_comparison.md", root), render(rows, rotationRows, scenarios, live, extra));
  console.log(JSON.stringify({ rows, rotationRows, live, extra }, (k, v) => (typeof v === "number" ? Number(v.toFixed(3)) : v), 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
