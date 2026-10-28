/**
 * Book construction for scripts/compare_books.mjs (Phase 6 research stage).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBook, bucketSplit, scenarioImpact, parsePrices, PROPOSED, PROPOSED_CASH, MOVE_ONLY } from "../scripts/compare_books.mjs";

const positions = JSON.parse(readFileSync(new URL("../data/positions.json", import.meta.url), "utf8")).positions;
const total = (b) => b.reduce((a, l) => a + l.weight, 0);

test("current book is the active lines and sums to 100", () => {
  const b = buildBook(positions);
  assert.equal(total(b), 100);
  assert.ok(!b.some((l) => l.key === "XLP" || l.key === "^KS11"));
});

test("proposed book sums to 100 with Substrate 43 / Compute 33 / Materials 2 / Ballast 22", () => {
  const b = buildBook(positions, PROPOSED);
  assert.equal(total(b), 100);
  assert.deepEqual(bucketSplit(b), { energy: 43, compute: 33, materials: 2, ballast: 22 });
  assert.ok(!b.some((l) => l.key === "VGT"));
  assert.deepEqual(b.find((l) => l.key === "NBIS"), { key: "NBIS", label: "NBIS", bucket: "compute", weight: 3, series: "NBIS" });
  assert.equal(b.find((l) => l.key === "POWER").series, "NLR");
});

test("cash variant keeps the proposed weights and puts the 5% in cash", () => {
  const b = buildBook(positions, PROPOSED_CASH);
  assert.equal(total(b), 100);
  assert.deepEqual(bucketSplit(b), { energy: 38, compute: 33, materials: 2, ballast: 22, cash: 5 });
});

test("moving NBIS and CRWV keeps their weights", () => {
  const b = buildBook(positions, MOVE_ONLY);
  assert.equal(total(b), 100);
  assert.deepEqual(bucketSplit(b), { energy: 32, compute: 44, materials: 2, ballast: 22 });
});

test("scenario impact weights the shocks; stand-in takes its series' shock, cash takes 0", () => {
  const b = [
    { key: "A", series: "A", weight: 50 },
    { key: "P", series: "A", weight: 25 },
    { key: "C", series: "CASH", weight: 25 },
  ];
  assert.equal(scenarioImpact(b, { A: -10 }), -7.5);
});

test("prices parse skips blanks and adds a flat cash series", () => {
  const p = parsePrices("date,X,Y\n2026-01-01,,2\n2026-01-02,1.5,2.2\n");
  assert.equal(p.X.length, 1);
  assert.equal(p.Y.length, 2);
  assert.deepEqual(p.CASH.map((x) => x.c), [1, 1]);
});
