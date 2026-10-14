/**
 * The live track record (review item P0-2): forward-only, never revised.
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extendTrack } from "../lib/analytics.js";

const day = (d) => Date.UTC(2026, 9, d);
const curve = (levels, from = 10) => levels.map((c, i) => ({ t: day(from + i), c }));

test("the first run starts the record at the curve's last date, at 100", () => {
  const t = extendTrack(null, { usd: curve([100, 104, 110]), hedged: curve([100, 103, 105]) }, "fp1");
  assert.equal(t.inception, "2026-10-12");
  assert.deepEqual(t.points, [{ date: "2026-10-12", usd: 100, hedged: 100, book: "fp1" }]);
});

test("later runs append only new days, chain-linked to the last recorded level", () => {
  let t = extendTrack(null, { usd: curve([100, 110]) }, "fp1"); // inception 11 Oct at 100
  t = extendTrack(t, { usd: curve([100, 110, 121, 108.9]) }, "fp1");
  assert.deepEqual(t.points.map((p) => [p.date, p.usd]), [
    ["2026-10-11", 100],
    ["2026-10-12", 110],
    ["2026-10-13", 99],
  ]);
});

test("a rewritten backtest does not revise days already recorded", () => {
  let t = extendTrack(null, { usd: curve([100, 110]) }, "fp1");
  t = extendTrack(t, { usd: curve([100, 110, 121]) }, "fp1");
  // The book changes: the replayed curve's whole history moves.
  t = extendTrack(t, { usd: curve([90, 95, 97, 97 * 1.02]) }, "fp2");
  assert.equal(t.points[1].usd, 110); // untouched
  assert.equal(t.points[1].book, "fp1");
  assert.equal(t.points[2].usd, 112.2); // 110 x 1.02, the new book's move that day
  assert.equal(t.points[2].book, "fp2");
});

test("a run with nothing new leaves the record as it was", () => {
  const a = extendTrack(null, { usd: curve([100, 110]) }, "fp1");
  const b = extendTrack(a, { usd: curve([100, 110]) }, "fp1");
  assert.deepEqual(b.points, a.points);
});

test("days after the last all-venues close are not recorded yet", () => {
  // 13 Oct is complete everywhere; 14 Oct so far holds Asian closes only.
  let t = extendTrack(null, { usd: curve([100, 101, 102, 103, 104]) }, "fp1", { upTo: "2026-10-13" });
  assert.equal(t.inception, "2026-10-13");
  t = extendTrack(t, { usd: curve([100, 101, 102, 103, 105]) }, "fp1", { upTo: "2026-10-13" });
  assert.equal(t.points.length, 1);
  // Next run, 14 Oct complete: recorded with its full move.
  t = extendTrack(t, { usd: curve([100, 101, 102, 103, 106.09]) }, "fp1", { upTo: "2026-10-14" });
  assert.equal(t.points.at(-1).usd, 103);
});
