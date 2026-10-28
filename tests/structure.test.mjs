/**
 * Effective number of bets and eigen-decomposition (review item P1-3).
 *
 *     npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eigenSymmetric, effectiveBets, buildStructure } from "../lib/structure.js";
import { weeklyCovariance, riskContributions } from "../lib/analytics.js";

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

const DAY = 864e5;
const T0 = Date.UTC(2025, 9, 14);
function series(returns) {
  const out = [{ t: T0, c: 100 }];
  returns.forEach((r, i) => out.push({ t: T0 + (i + 1) * DAY, c: out.at(-1).c * (1 + r) }));
  return out;
}
const book = () => {
  const f = Array.from({ length: 400 }, (_, i) => Math.sin(i * 0.37) * 0.012);
  return [
    { ticker: "A", weight: 40, sleeve: "energy", points: series(f.map((x, i) => x + Math.sin(i * 1.1) * 0.01)) },
    { ticker: "B", weight: 30, sleeve: "compute", points: series(f.map((x, i) => 1.4 * x + Math.cos(i * 0.8) * 0.015)) },
    { ticker: "C", weight: 28, sleeve: "ballast", points: series(f.map((x, i) => 0.3 * x + Math.sin(i * 2.3) * 0.006)) },
    { ticker: "Y", weight: 2, sleeve: "materials", points: series(f.map((x, i) => x + Math.cos(i * 1.9) * 0.02)).slice(-100) },
  ];
};

test("structure uses the risk table's covariance matrix and lists a 14-week line as insufficient", () => {
  const lines = book();
  const legs = lines.map((l) => ({ key: l.ticker, weight: l.weight, points: l.points }));
  const S = weeklyCovariance(legs);
  const st = buildStructure(lines);
  assert.deepEqual(st.tickers, ["A", "B", "C"]);
  assert.deepEqual(st.excluded, ["Y"]);
  assert.equal(st.insufficient[0].key, "Y");
  close(st.insufficient[0].capitalPct, 2, 1e-12);
  close(st.enb, effectiveBets(S.w, S.cov).enb, 1e-12);
  assert.equal(st.weeks, riskContributions(legs).weeks);
});
