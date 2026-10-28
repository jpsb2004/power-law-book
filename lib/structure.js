/**
 * How many bets the book really is (review item P1-3).
 *
 * Twenty lines are not twenty independent bets. Three measures, all on weekly
 * simple USD returns over the headline year (the risk table's matrix):
 *   - the correlation matrix itself (the page draws it as a heatmap);
 *   - the effective number of bets (Meucci, 2009): the book's variance split
 *     across principal components, and exp(entropy) of those shares -- 1 if
 *     everything rides one factor, N if risk is spread evenly over N;
 *   - single points of failure: stated groups of lines that share one
 *     failure (data/positions.json, concentration_groups), with their share of
 *     capital and of risk.
 */
import { weeklyCovariance } from "./analytics.js";

/** Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations. */
export function eigenSymmetric(A, { tol = 1e-12, maxSweeps = 100 } = {}) {
  const n = A.length;
  const a = A.map((r) => [...r]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < tol) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = a.map((r, i) => r[i]);
  const order = values.map((_, i) => i).sort((i, j) => values[j] - values[i]);
  return { values: order.map((i) => values[i]), vectors: order.map((i) => v.map((r) => r[i])) };
}

/** Meucci's effective number of bets for weights w and covariance S. */
export function effectiveBets(w, S) {
  const { values, vectors } = eigenSymmetric(S);
  const contrib = values.map((lam, k) => {
    const e = vectors[k].reduce((a, x, i) => a + x * w[i], 0);
    return Math.max(lam, 0) * e * e;
  });
  const tot = contrib.reduce((a, b) => a + b, 0);
  const p = contrib.map((c) => (tot > 0 ? c / tot : 0));
  const enb = Math.exp(-p.reduce((a, x) => a + (x > 0 ? x * Math.log(x) : 0), 0));
  return { enb, shares: p, firstPcSharePct: p[0] * 100 };
}

/**
 * @param lines  [{ticker, weight, sleeve, points}] USD series
 * @param groups [{name, tickers, why}]
 * @param riskRows risk-contribution rows (snapshot.risk.usd.rows), for group risk shares
 */
export function buildStructure(lines, groups = [], riskRows = []) {
  // The same matrix as the risk table (weeklyCovariance): lines with at least
  // MIN_WEEKS weeks, so it is not built on a few months.
  const S = weeklyCovariance(lines.map((l) => ({ key: l.ticker, weight: l.weight, points: l.points })));
  const { cov, w } = S;
  const n = S.keys.length, T = S.weeks;
  if (n < 3 || T < 30) return null;
  const sd = cov.map((r, i) => Math.sqrt(r[i]));
  const corr = cov.map((r, i) => r.map((x, j) => (sd[i] > 0 && sd[j] > 0 ? x / (sd[i] * sd[j]) : 0)));
  const enb = effectiveBets(w, cov);
  const { values } = eigenSymmetric(corr);
  const sumL = values.reduce((a, b) => a + b, 0);

  const capOf = (t) => lines.find((l) => l.ticker === t)?.weight ?? 0;
  const riskOf = (t) => riskRows.find((r) => r.key === t)?.riskSharePct ?? 0;
  const book = lines.reduce((a, l) => a + l.weight, 0);
  const pof = groups.map((g) => ({
    ...g,
    capitalPct: (g.tickers.reduce((a, t) => a + capOf(t), 0) / book) * 100,
    riskSharePct: g.tickers.reduce((a, t) => a + riskOf(t), 0),
  }));

  return {
    weeks: T,
    tickers: S.keys,
    sleeves: S.keys.map((t) => lines.find((l) => l.ticker === t).sleeve),
    corr: corr.map((r) => r.map((x) => Number(x.toFixed(3)))),
    lines: n,
    enb: enb.enb,
    firstPcSharePct: enb.firstPcSharePct,
    // Share of the correlation matrix's total variance on its first component.
    firstCorrPcPct: (values[0] / sumL) * 100,
    excluded: S.insufficient.map((x) => x.key),
    // Lines under MIN_WEEKS weeks, with their weeks and share of capital.
    insufficient: S.insufficient,
    pointsOfFailure: pof,
  };
}
