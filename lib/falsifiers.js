/**
 * What happens when a portfolio falsifier fires (review item: falsifier
 * governance).
 *
 * Each `thesis.falsifiers[]` entry in data/positions.json states, besides its
 * test, a pre-committed `consequence` and a dated log of `responses[]`
 * ({date, decision, text}). This module only validates those fields and reads
 * them; the wording belongs to the owner and lives in the SSOT.
 */

export const DECISIONS = ["hold", "trim", "exit", "revise-thesis"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every schema problem in the falsifier list, as readable strings (empty = valid). */
export function falsifierProblems(falsifiers) {
  const out = [];
  if (!Array.isArray(falsifiers)) return ["thesis.falsifiers is not an array"];
  for (const f of falsifiers) {
    const at = `falsifier ${f?.key ?? "?"}`;
    if (typeof f?.consequence !== "string" || !f.consequence.trim()) out.push(`${at}: consequence missing`);
    if (f?.responses === undefined) continue;
    if (!Array.isArray(f.responses)) {
      out.push(`${at}: responses is not an array`);
      continue;
    }
    f.responses.forEach((r, i) => {
      if (!ISO_DATE.test(r?.date ?? "") || Number.isNaN(Date.parse(r.date))) out.push(`${at}: responses[${i}].date not YYYY-MM-DD`);
      if (!DECISIONS.includes(r?.decision)) out.push(`${at}: responses[${i}].decision not one of ${DECISIONS.join("|")}`);
      if (typeof r?.text !== "string" || !r.text.trim()) out.push(`${at}: responses[${i}].text missing`);
    });
  }
  return out;
}

/** The most recent response by date, or null when none is recorded. */
export function latestResponse(f) {
  const rs = Array.isArray(f?.responses) ? f.responses : [];
  if (!rs.length) return null;
  const r = rs.reduce((a, b) => (b.date > a.date ? b : a));
  return { date: r.date, decision: r.decision, text: r.text };
}

/** Keys of falsifiers a set of checks reads as triggered that have no recorded response. */
export function unanswered(falsifiers, checks) {
  const byKey = new Map((falsifiers ?? []).map((f) => [f.key, f]));
  return (checks ?? []).filter((c) => c.triggered === true && !latestResponse(byKey.get(c.key))).map((c) => c.key);
}
