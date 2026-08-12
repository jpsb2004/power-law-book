/**
 * The refresh pipeline. One command, safe to run unattended.
 *
 *   npm run refresh
 *
 *   1. build a candidate snapshot from live public data
 *   2. validate it against the last good one
 *   3. archive the previous snapshot, then commit the new one
 *   4. rebuild the page and smoke-test it
 *   5. append to the refresh log the page renders
 *
 * Exit codes:
 *   0  refreshed, page rebuilt, safe to republish
 *   2  rejected — validation failed, previous snapshot and page left untouched
 *   1  crashed
 *
 * A non-zero exit means DO NOT republish. Leaving a correct, slightly stale
 * page up beats replacing it with a broken one.
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildSnapshot, validateSnapshot } from "../lib/build-snapshot.js";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);
const path = (rel) => new URL(rel, root);
// `URL.pathname` yields "/C:/..." on Windows, which is not a usable cwd.
const rootDir = fileURLToPath(root);
const log = (s) => process.stderr.write(s + "\n");

const HISTORY_LIMIT = 60;

/** Short, stable digest of the book's tickers and weights. */
function bookFingerprint(positions) {
  const spec = positions
    .map((p) => `${p.ticker}:${p.weight}`)
    .sort()
    .join("|");
  return createHash("sha1").update(spec).digest("hex").slice(0, 10);
}

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const startedAt = Date.now();
  log(`\n=== refresh ${new Date(startedAt).toISOString()} ===`);

  const previous = await readJson(path("data/snapshot.json"));

  log("\n-- fetching public market data");
  const next = await buildSnapshot({ log });

  log("\n-- validating");
  const { ok, problems, warnings, moves } = validateSnapshot(next, previous);
  for (const w of warnings) log(`warn  ${w}`);

  if (!ok) {
    for (const p of problems) log(`FAIL  ${p}`);
    log("\nrejected — previous snapshot and published page left untouched");
    process.exit(2);
  }
  log(`ok    ${next.positions.filter((p) => p.price != null).length}/${next.positions.length} priced, ` +
      `${next.curve.length} curve points`);

  // Keep the last good snapshot so a bad publish can be rolled back by hand.
  await mkdir(path("data/"), { recursive: true });
  if (existsSync(path("data/snapshot.json"))) {
    await copyFile(path("data/snapshot.json"), path("data/snapshot.previous.json"));
  }
  await writeFile(path("data/snapshot.json"), JSON.stringify(next, null, 2));

  // The refresh log is rendered on the page: it is the visible evidence that
  // the thing updates itself, and it makes a stalled job obvious.
  const history = (await readJson(path("data/history.json"))) ?? [];
  history.push({
    at: next.asOf,
    index: next.curve.at(-1)?.c ?? null,
    ytd: next.curveStats.ytd,
    priced: next.positions.filter((p) => p.price != null).length,
    // Fingerprint of the book itself. The index is rebased whenever the
    // constituents change, so a level measured against a different set of
    // positions is not comparable with the previous one -- the page uses this
    // to refuse to show a "return" across a reallocation.
    book: bookFingerprint(next.positions),
    positions: next.positions.length,
    failures: next.failures.map((f) => f.ticker),
    biggestMove: moves.length
      ? moves.reduce((a, b) => (Math.abs(b.move) > Math.abs(a.move) ? b : a))
      : null,
  });
  await writeFile(
    path("data/history.json"),
    JSON.stringify(history.slice(-HISTORY_LIMIT), null, 2)
  );

  const step = async (label, script) => {
    log(`\n-- ${label}`);
    try {
      const r = await run(process.execPath, [script], { cwd: rootDir });
      log(r.stderr.trim());
    } catch (e) {
      throw new Error(`${label} failed: ${(e.stderr || e.message).trim()}`);
    }
  };

  await step("rebuilding page", "scripts/build-page.mjs");
  await step("smoke-testing page", "scripts/check-page.mjs");

  const prevIndex = history.length > 1 ? history.at(-2).index : null;
  const idx = next.curve.at(-1)?.c;
  const delta = prevIndex && idx ? (((idx - prevIndex) / prevIndex) * 100).toFixed(2) : null;

  log(
    `\n=== done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
      `index ${idx?.toFixed(2)}${delta ? ` (${delta > 0 ? "+" : ""}${delta}% since last refresh)` : ""} ===`
  );
  log("out/index.html is ready to republish\n");
}

main().catch((e) => {
  log(`\nCRASH  ${e.message}`);
  process.exit(1);
});
