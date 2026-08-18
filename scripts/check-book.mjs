/**
 * Book invariants. Fails the build if the roster, the pipeline and the memo
 * can disagree about what is held.
 *
 *     node scripts/check-book.mjs
 *
 * This exists because they did disagree. The PDF carried its own hardcoded
 * copy of all 18 positions and printed idealised equal-weights (~5.4% / ~4.6%
 * / ~7.5%) while the book held integers (6/5/6/6/5/5/5 ...). Every position
 * was wrong, in a document sent to recruiters alongside the app that showed
 * the real numbers. Nothing caught it because nothing compared them.
 */

import { readFileSync, existsSync } from "node:fs";
import { HOLDINGS } from "../lib/holdings.js";

const root = new URL("../", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

const book = read("data/positions.json");
const active = book.positions.filter((p) => (p.status ?? "active") === "active");

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

console.log("book invariants");

// --- counts agree across every consumer of the roster
check("holdings.js count == positions.json active",
  HOLDINGS.length === active.length,
  `${HOLDINGS.length} vs ${active.length}`);

if (existsSync(new URL("data/snapshot.json", root))) {
  const snap = read("data/snapshot.json");
  check("snapshot.json count == positions.json active",
    snap.positions.length === active.length,
    `${snap.positions.length} vs ${active.length}`);

  const snapTickers = new Set(snap.positions.map((p) => p.ticker));
  const missing = active.filter((p) => !snapTickers.has(p.ticker)).map((p) => p.ticker);
  check("every active position present in snapshot", missing.length === 0, missing.join(", "));
}

// --- weights
const sums = {};
for (const p of active) sums[p.bucket] = (sums[p.bucket] ?? 0) + p.weight;
const total = Object.values(sums).reduce((a, b) => a + b, 0);
check("bucket weights sum to 100%", Math.abs(total - 100) < 1e-9, `got ${total}`);

for (const [bucket, target] of Object.entries(book.bucket_targets)) {
  check(`bucket ${bucket} == target ${target}%`,
    Math.abs((sums[bucket] ?? 0) - target) < 1e-9,
    `got ${sums[bucket] ?? 0}`);
}

// --- documentation. A position with no rationale or no falsification metric
// is exactly the kind of undocumented holding the change log is meant to stop.
for (const field of ["factor_role", "falsification_metric"]) {
  const bare = active.filter((p) => !p[field] || !String(p[field]).trim()).map((p) => p.ticker);
  check(`every position has ${field}`, bare.length === 0, bare.join(", "));
}
const noMemo = active.filter((p) => !p.memo?.rationale?.trim()).map((p) => p.ticker);
check("every position has memo.rationale (PDF prose)", noMemo.length === 0, noMemo.join(", "));

// --- the SSOT holds data, not markup: the app prints these strings raw
const markup = active
  .filter((p) => /&(amp|lt|gt);|<\/?[a-z]+>/i.test(`${p.memo?.name ?? ""}${p.memo?.rationale ?? ""}${p.factor_role}`))
  .map((p) => p.ticker);
check("no HTML markup stored in the SSOT", markup.length === 0, markup.join(", "));

console.log();
if (failures.length) {
  console.error(`${failures.length} invariant(s) failed`);
  process.exit(1);
}
console.log(`all invariants hold — ${active.length} active positions, buckets ${
  Object.entries(sums).map(([k, v]) => `${k} ${v}`).join(" / ")}`);
