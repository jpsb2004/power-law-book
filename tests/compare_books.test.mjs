/**
 * Book construction for scripts/compare_books.mjs (Phase 6 research stage).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBook, bucketSplit, scenarioImpact, parsePrices, mergeCached, groupCorrelation, PROPOSED, MOVE_ONLY,
} from "../scripts/compare_books.mjs";

// The book at BASE_COMMIT (before Phase 6), inline: tests never read git and
// positions.json now carries the Phase 6 book.
const positions = (
  "URA:energy:6 NLR:energy:5 PETR4.SA:energy:6 2222.SR:energy:6 LB:energy:5 NBIS:energy:5 CRWV:energy:5 " +
  "ETN:energy:2 HUBB:energy:2 TSM:compute:5 AMD:compute:5 PLTR:compute:5 VGT:compute:5 2357.TW:compute:4 " +
  "^KS11:compute:4:substituted EWY:compute:4 AINF.L:compute:4 ASML:compute:2 GLD:ballast:5 AVDV:ballast:4 " +
  "JPM:ballast:4 RARA11.SA:materials:2 SGOV:ballast:5 IEUR:ballast:4 XLP:ballast:5:removed"
).split(" ").map((x) => {
  const [ticker, bucket, weight, status = "active"] = x.split(":");
  return { ticker, bucket, weight: Number(weight), status };
});
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
  assert.equal(b.find((l) => l.key === "VST").series, "VST");
  assert.equal(b.length, 23);
});

test("moving NBIS and CRWV keeps their weights", () => {
  const b = buildBook(positions, MOVE_ONLY);
  assert.equal(total(b), 100);
  assert.deepEqual(bucketSplit(b), { energy: 32, compute: 44, materials: 2, ballast: 22 });
});

test("scenario impact weights the shocks; a line takes its series' shock, cash takes 0", () => {
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

test("a cached series is clipped to the prices.csv dates", () => {
  const p = mergeCached(parsePrices("date,X\n2026-01-01,1\n2026-01-02,2\n"), "V", [
    { date: "2025-12-31", c: 9 },
    { date: "2026-01-02", c: 5 },
    { date: "2026-01-05", c: 6 },
  ]);
  assert.deepEqual(p.V, [{ t: Date.UTC(2026, 0, 2), c: 5 }]);
});

test("group correlation: a series moving with the basket reads 1, against it -1", () => {
  // Mondays across twelve weeks, alternating up and down so weekly returns vary.
  const days = Array.from({ length: 12 }, (_, i) => Date.UTC(2026, 0, 5 + 7 * i));
  const path = days.map((t, i) => ({ t, c: 100 * (1 + 0.05 * Math.sin(i * 1.3)) }));
  const prices = {
    A: path,
    B: path.map((p) => ({ ...p })),
    U: path.map((p) => ({ ...p })),
    D: path.map((p) => ({ t: p.t, c: 10000 / p.c })),
  };
  const up = groupCorrelation(prices, "U", [{ series: "A", weight: 1 }, { series: "B", weight: 1 }], "never");
  assert.ok(Math.abs(up.basket.r - 1) < 1e-9);
  assert.ok(Math.abs(up.lines.A - 1) < 1e-9);
  assert.equal(up.basket.weeks, 11);
  const down = groupCorrelation(prices, "D", [{ series: "A", weight: 1 }], "never");
  assert.ok(Math.abs(down.basket.r + 1) < 1e-9);
});
