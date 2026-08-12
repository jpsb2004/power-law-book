/**
 * Builds the standalone snapshot page from data/snapshot.json.
 *
 * The published page runs under a CSP that blocks every external request, so
 * the data has to be inlined at build time rather than fetched. Everything the
 * page shows comes from the same snapshot the app reads.
 *
 *   npm run page
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { SLEEVES, HOLDINGS } from "../lib/holdings.js";

const root = new URL("../", import.meta.url);

/** Set false once the real target weights are in lib/holdings.js. */
const WEIGHTS_PROVISIONAL = true;

const sleeveWeights = Object.fromEntries(
  Object.keys(SLEEVES).map((id) => [
    id,
    HOLDINGS.filter((h) => h.sleeve === id).reduce((a, h) => a + h.weight, 0),
  ])
);

const snapshot = JSON.parse(await readFile(new URL("data/snapshot.json", root), "utf8"));

// The refresh log is what makes the page's self-updating visible. Absent on a
// first build, or when the page was made with `npm run snapshot` directly.
let history = [];
try {
  history = JSON.parse(await readFile(new URL("data/history.json", root), "utf8"));
} catch {
  history = [];
}

// Downsample each series to roughly weekly. The page draws one full-resolution
// curve; per-position daily arrays would quadruple the payload for detail no
// chart on the page actually renders.
for (const p of snapshot.positions) {
  if (p.usdPoints?.length > 60) p.usdPoints = p.usdPoints.filter((_, i, a) => i % 5 === 0 || i === a.length - 1);
}

const payload = {
  ...snapshot,
  sleeves: SLEEVES,
  sleeveWeights,
  weightsProvisional: WEIGHTS_PROVISIONAL,
  history: history.slice(-12),
};

const template = await readFile(new URL("page/template.html", root), "utf8");
if (!template.includes("__SNAPSHOT__")) throw new Error("template is missing the __SNAPSHOT__ placeholder");

// `</script>` inside a JSON string would close the host <script> element early.
const json = JSON.stringify(payload).replace(/<\//g, "<\\/");
const html = template.replace("__SNAPSHOT__", json);

await mkdir(new URL("out/", root), { recursive: true });
await writeFile(new URL("out/index.html", root), html);

const kb = (html.length / 1024).toFixed(0);
process.stderr.write(
  `wrote out/index.html — ${kb} KB, ${snapshot.positions.length} positions, ` +
    `as of ${new Date(snapshot.asOf).toISOString()}\n` +
    (WEIGHTS_PROVISIONAL ? "note: weights flagged provisional on the page\n" : "")
);
