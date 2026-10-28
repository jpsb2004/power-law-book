/**
 * Smoke test for the built page.
 *
 * The page is a single self-contained file whose entire body is drawn by
 * script, so "it built" says nothing about whether it renders. This executes
 * it in a DOM and asserts the sections actually populated.
 *
 *   npm run check
 */
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: new (await import("jsdom")).VirtualConsole().on("jsdomError", (e) =>
    errors.push(e.message)
  ),
});

const { document } = dom.window;
const fail = [];

const nonEmpty = (id, min = 1) => {
  const node = document.getElementById(id);
  if (!node) return fail.push(`#${id} missing from the document`);
  if (node.children.length < min) fail.push(`#${id} rendered ${node.children.length} children, expected >= ${min}`);
};

// Every section the page promises.
nonEmpty("stamp", 3);
nonEmpty("stats", 5);
nonEmpty("chain", 4);
nonEmpty("alloc-legend", 2);
nonEmpty("fx-legend", 2);

const svgCount = (id) => document.querySelectorAll(`#${id} svg`).length;
for (const id of ["curve", "alloc", "ytd", "fx"]) {
  if (svgCount(id) !== 1) fail.push(`#${id} drew ${svgCount(id)} svg elements, expected 1`);
}

// Counts come from the book itself, so adding or dropping a position updates
// the expectation instead of breaking the test.
const { HOLDINGS, SLEEVES } = await import("../lib/holdings.js");
const nPositions = HOLDINGS.length;
const nBuckets = Object.keys(SLEEVES).length;

// The table carries a row per position plus a header row per bucket.
const rows = document.querySelectorAll("#tbl tbody tr").length;
const expectedRows = nPositions + nBuckets;
if (rows !== expectedRows) {
  fail.push(`table rendered ${rows} rows, expected ${expectedRows} (${nPositions} positions + ${nBuckets} buckets)`);
}

const cards = document.querySelectorAll("#dossier .card").length;
if (cards !== nPositions) fail.push(`dossier rendered ${cards} cards, expected ${nPositions}`);

// Same count is not the same book: every roster ticker must be on the page.
// This is the check that catches a snapshot left behind a roster change,
// which check-book deliberately only reports (it runs before the refresh).
const shown = new Set([...document.querySelectorAll("#dossier .card .tk")].map((n) => n.textContent));
const absent = HOLDINGS.map((h) => h.ticker).filter((t) => !shown.has(t));
if (absent.length) fail.push(`roster positions missing from the page: ${absent.join(", ")}`);

// Each dossier card must carry its falsification line -- the whole point.
const breaks = document.querySelectorAll("#dossier .breaks").length;
if (breaks !== nPositions) {
  fail.push(`dossier rendered ${breaks} "what breaks it" blocks, expected ${nPositions}`);
}

// Bucket weights must total 100, or the allocation chart is drawing a book
// that does not exist.
const total = HOLDINGS.reduce((a, h) => a + h.weight, 0);
if (total !== 100) fail.push(`weights total ${total}%, expected 100%`);

const legendItems = document.querySelectorAll("#alloc-legend li").length;
if (legendItems !== nBuckets) fail.push(`allocation legend has ${legendItems} entries, expected ${nBuckets}`);

// The refresh log is the page's evidence that it self-updates, so if the data
// carries two or more runs the section must actually be visible.
// Read the log from source rather than scraping it back out of the bundled
// JSON -- regexing a JSON blob out of a script tag is a fragile way to learn
// something the file next door states plainly. Capped to match build-page.mjs.
const historyRuns = await readFile(new URL("../data/history.json", import.meta.url), "utf8")
  .then((s) => Math.min(JSON.parse(s).length, 12))
  .catch(() => 0);
const refreshSection = document.getElementById("refresh-section");
if (historyRuns >= 2) {
  if (refreshSection?.hidden) fail.push(`history has ${historyRuns} runs but the refresh section is still hidden`);
  const logRows = document.querySelectorAll("#refresh-tbl tbody tr").length;
  if (logRows !== historyRuns) fail.push(`refresh log rendered ${logRows} rows for ${historyRuns} runs`);
} else if (refreshSection && !refreshSection.hidden) {
  fail.push("refresh section is visible with fewer than 2 logged runs");
}

// Guard against the classic bug: a chart drawn with empty colour strings
// because a CSS token was read before it resolved.
const blankFills = [...document.querySelectorAll("svg [fill]")].filter(
  (n) => n.getAttribute("fill").trim() === ""
).length;
if (blankFills) fail.push(`${blankFills} svg nodes have an empty fill (unresolved CSS token)`);

// No literal hex colours outside the token block -- they would break one theme.
const inlineHex = [...document.querySelectorAll("svg [fill], svg [stroke]")].filter((n) =>
  /^#[0-9a-f]{3,8}$/i.test(n.getAttribute("fill") ?? n.getAttribute("stroke") ?? "")
).length;
if (inlineHex) fail.push(`${inlineHex} svg nodes use a hard-coded hex instead of a token`);

// The analysis sections are optional per snapshot, so each is checked against
// what the bundled snapshot actually carries.
const snap = JSON.parse(await readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"));

const goodProxy = (snap.proxies ?? []).some((p) => !p.error);
const proxySection = document.getElementById("proxy-section");
if (goodProxy) {
  if (proxySection.hidden) fail.push("snapshot carries a proxy but the proxy section is hidden");
  if (document.querySelectorAll("#proxy-kv > div").length !== 5) fail.push("proxy key figures did not render 5 tiles");
  if (document.querySelectorAll("#proxy-tbl tbody tr").length !== 6) fail.push("proxy table did not render 6 rows");
} else if (!proxySection.hidden) {
  fail.push("proxy section is visible without proxy data");
}

// Benchmarks: one table row per series (both book views plus each benchmark),
// one relative row per benchmark for the view on screen, and a chart line each.
const benchRows = (snap.benchmarks?.rows ?? []).filter((r) => r.stats);
const benchSection = document.getElementById("bench-section");
if (benchRows.length) {
  if (benchSection.hidden) fail.push("snapshot carries benchmarks but the benchmark section is hidden");
  const got = document.querySelectorAll("#bench-tbl tbody tr").length;
  if (got !== benchRows.length) fail.push(`benchmark table rendered ${got} rows for ${benchRows.length} series`);
  const benches = benchRows.filter((r) => r.kind === "benchmark").length;
  const rel = document.querySelectorAll("#bench-rel-tbl tbody tr").length;
  if (rel !== benches) fail.push(`relative table rendered ${rel} rows for ${benches} benchmarks`);
  const paths = document.querySelectorAll("#bench-chart svg path").length;
  if (paths !== benches + 1) fail.push(`benchmark chart drew ${paths} lines, expected ${benches + 1}`);
} else if (!benchSection.hidden) {
  fail.push("benchmark section is visible without benchmark data");
}

// Backtest vs record: the flag sits on the KPI row, the live tile closes it.
if (!document.querySelector("#stats .flag")?.textContent.includes("not a track record")) {
  fail.push("KPI row is missing the hindsight-backtest flag");
}
if (!document.querySelector("#stats .stat.live")) fail.push("KPI row is missing the live-record tile");

// Change log: one row per entry in positions.json.
const changes = (await import("../lib/holdings.js")).BOOK_CHANGES.length;
const changesSection = document.getElementById("changes-section");
if (changes) {
  if (changesSection.hidden) fail.push("positions.json carries book changes but the change log is hidden");
  const got = document.querySelectorAll("#changes-tbl tbody tr").length;
  if (got !== changes) fail.push(`change log rendered ${got} rows for ${changes} entries`);
}

// Structure (P1-3) and valuation/thesis (P1-4).
if (snap.structure) {
  if (document.getElementById("bets-section").hidden) fail.push("snapshot carries structure but the bets section is hidden");
  const cells = document.querySelectorAll("#heatmap svg rect").length;
  if (cells !== snap.structure.lines ** 2) fail.push(`heatmap drew ${cells} cells for ${snap.structure.lines} lines`);
  const g = document.querySelectorAll("#pof-tbl tbody tr").length;
  if (g !== snap.structure.pointsOfFailure.length) fail.push(`points-of-failure table rendered ${g} rows`);
}
if (snap.thesis) {
  if (document.getElementById("value-section").hidden) fail.push("snapshot carries the thesis but the valuation section is hidden");
  const f = document.querySelectorAll("#falsifier-tbl tbody tr").length;
  if (f !== snap.thesis.checks.length) fail.push(`falsifier table rendered ${f} rows for ${snap.thesis.checks.length}`);
  const owed = snap.thesis.checks.filter((c) => c.triggered === true && "latestResponse" in c && !c.latestResponse).length;
  const badges = document.querySelectorAll("#falsifier-tbl .falsifier-unanswered").length;
  if (badges !== owed) fail.push(`falsifier table shows ${badges} UNANSWERED badge(s) for ${owed} unanswered trigger(s)`);
}
if (snap.fundamentals?.valuation?.length) {
  const v = document.querySelectorAll("#val-tbl tbody tr").length;
  if (v !== snap.fundamentals.valuation.length) fail.push(`valuation table rendered ${v} rows`);
}

// Tail risk and stress: one row per historical, factor and stated scenario.
if (snap.stress && snap.tail) {
  const sec = document.getElementById("stress-section");
  if (sec.hidden) fail.push("snapshot carries stress tests but the section is hidden");
  const want = snap.stress.historical.length + snap.stress.hypothetical.length + snap.stress.stated.length;
  const got = document.querySelectorAll("#stress-tbl tbody tr").length;
  if (got !== want) fail.push(`stress table rendered ${got} rows for ${want} scenarios`);
  if (document.querySelectorAll("#tail-kv > div").length !== 4) fail.push("tail risk did not render 4 tiles");
}
if ((snap.factors?.rolling ?? []).length >= 10 && document.getElementById("rolling-fig").hidden) {
  fail.push("snapshot carries a rolling beta but the chart is hidden");
}

// Rebalancing variants and the reconciliation that ties them together.
const rebalRows = snap.rebalancing?.usd?.rows?.length ?? 0;
const rebalBlock = document.getElementById("rebal-block");
if (rebalRows) {
  if (rebalBlock.hidden) fail.push("snapshot carries rebalancing variants but the block is hidden");
  const got = document.querySelectorAll("#rebal-tbl tbody tr").length;
  if (got !== rebalRows) fail.push(`rebalancing table rendered ${got} rows for ${rebalRows} variants`);
  if (document.querySelectorAll("#recon-tbl tbody tr").length !== 4) fail.push("reconciliation did not render 4 steps");
} else if (!rebalBlock.hidden) {
  fail.push("rebalancing block is visible without data");
}

// Risk contribution: one row per line with enough history, one per bucket.
const riskRows = (snap.risk?.usd?.rows ?? []).filter((r) => !r.insufficient).length;
const riskBlock = document.getElementById("risk-block");
if (riskRows) {
  if (riskBlock.hidden) fail.push("snapshot carries risk contributions but the risk block is hidden");
  const got = document.querySelectorAll("#risk-tbl tbody tr").length;
  if (got !== riskRows) fail.push(`risk table rendered ${got} rows for ${riskRows} lines`);
  const buckets = snap.risk.usd.buckets.length;
  const gotB = document.querySelectorAll("#risk-bucket-tbl tbody tr").length;
  if (gotB !== buckets) fail.push(`risk bucket table rendered ${gotB} rows for ${buckets} buckets`);
} else if (!riskBlock.hidden) {
  fail.push("risk block is visible without risk data");
}

const factorRows = snap.factors?.rows?.length ?? 0;
const factorSection = document.getElementById("factor-section");
if (factorRows) {
  if (factorSection.hidden) fail.push("snapshot carries factor rows but the factor section is hidden");
  const got = document.querySelectorAll("#factor-tbl tbody tr").length;
  if (got !== factorRows) fail.push(`factor table rendered ${got} rows for ${factorRows} regressions`);
} else if (!factorSection.hidden) {
  fail.push("factor section is visible without factor data");
}

// Section numbers are assigned at render time; visible ones must run 01..n.
const nums = [...document.querySelectorAll("section:not([hidden]) .secnum")].map((n) => n.textContent);
const expectedNums = nums.map((_, i) => String(i + 1).padStart(2, "0"));
if (nums.join() !== expectedNums.join()) fail.push(`section numbers ${nums.join(",")} are not sequential`);

// The currency toggle must actually switch the figures it claims to.
let toggled = "not exercised";
if (snap.curveHedged?.length > 1) {
  const toggles = document.querySelectorAll(".fxview:not([hidden])");
  if (toggles.length < 1) fail.push("snapshot carries a hedged curve but no currency toggle is visible");
  const statText = () => document.querySelector("#stats .stat .v")?.textContent;
  const before = statText();
  const ytdHead = () => document.querySelector("#tbl thead th:nth-child(6)")?.textContent;
  document.querySelector('.fxview button[data-view="hedged"]')?.click();
  const after = statText();
  if (snap.curveStats.ret1y?.toFixed(1) !== snap.curveHedgedStats.ret1y?.toFixed(1) && before === after) {
    fail.push("currency toggle did not change the 1-year stat");
  }
  if (!/hedged/i.test(ytdHead() ?? "")) fail.push(`table header did not follow the toggle (got "${ytdHead()}")`);
  if (svgCount("curve") !== 1) fail.push(`curve drew ${svgCount("curve")} svg elements after toggling, expected 1`);
  const pressed = [...document.querySelectorAll('.fxview button[aria-pressed="true"]')].map((b) => b.dataset.view);
  if (!pressed.length || pressed.some((v) => v !== "hedged")) fail.push("toggle buttons did not all switch to hedged");
  document.querySelector('.fxview button[data-view="usd"]')?.click();
  if (statText() !== before) fail.push("toggling back did not restore the unhedged stat");
  toggled = `${before} ⇄ ${after}`;
}

if (errors.length) fail.push(...errors.map((e) => `script error: ${e}`));

if (fail.length) {
  console.error("FAIL\n" + fail.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}

console.error(
  `ok — ${rows} table rows, ${cards} dossier cards, 4 charts, ` +
    `${document.querySelectorAll("#stats .stat").length} stat tiles, ${factorRows} factor rows, ` +
    `proxy ${goodProxy ? "on" : "off"}, toggle ${toggled}, no script errors`
);
