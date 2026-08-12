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

if (errors.length) fail.push(...errors.map((e) => `script error: ${e}`));

if (fail.length) {
  console.error("FAIL\n" + fail.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}

console.error(
  `ok — ${rows} table rows, ${cards} dossier cards, 4 charts, ` +
    `${document.querySelectorAll("#stats .stat").length} stat tiles, no script errors`
);
