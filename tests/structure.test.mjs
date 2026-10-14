/**
 * Effective number of bets and eigen-decomposition (review item P1-3).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eigenSymmetric, effectiveBets } from "../lib/structure.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("eigen-decomposition of a known symmetric matrix", () => {
  const { values, vectors } = eigenSymmetric([[2, 1], [1, 2]]);
  close(values[0], 3);
  close(values[1], 1);
  close(Math.abs(vectors[0][0]), Math.SQRT1_2, 1e-9);
});

test("uncorrelated, equal-risk, equal-weight lines are N independent bets", () => {
  const n = 5;
  const S = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0.04 : 0)));
  close(effectiveBets(Array(n).fill(1 / n), S).enb, n, 1e-9);
});

test("perfectly correlated lines are one bet", () => {
  const n = 4;
  const S = Array.from({ length: n }, () => Array(n).fill(0.04));
  const r = effectiveBets(Array(n).fill(1 / n), S);
  close(r.enb, 1, 1e-6);
  close(r.firstPcSharePct, 100, 1e-6);
});
