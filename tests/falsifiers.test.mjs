/**
 * Falsifier governance: every falsifier states a consequence, responses are
 * dated and use one of the stated decisions, and a triggered falsifier with
 * no response is reported. Offline: reads data/positions.json only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DECISIONS, falsifierProblems, latestResponse, unanswered } from "../lib/falsifiers.js";

const ok = (over = {}) => ({ key: "k", consequence: "Do this.", responses: [], ...over });

test("a falsifier with a consequence and no responses is valid", () => {
  assert.deepEqual(falsifierProblems([ok()]), []);
  assert.deepEqual(falsifierProblems([ok({ responses: undefined })]), []);
});

test("missing consequence and malformed responses are each reported", () => {
  assert.equal(falsifierProblems([ok({ consequence: "  " })]).length, 1);
  assert.equal(falsifierProblems([ok({ responses: "hold" })]).length, 1);
  const bad = falsifierProblems([ok({ responses: [{ date: "28/10/2026", decision: "sell", text: "" }] })]);
  assert.equal(bad.length, 3);
  assert.match(bad.join(" "), /date/);
  assert.match(bad.join(" "), /decision/);
  assert.match(bad.join(" "), /text/);
});

test("every stated decision is accepted", () => {
  for (const decision of DECISIONS)
    assert.deepEqual(falsifierProblems([ok({ responses: [{ date: "2026-10-28", decision, text: "t" }] })]), []);
});

test("latestResponse picks the most recent date, regardless of order", () => {
  const f = ok({
    responses: [
      { date: "2026-10-28", decision: "hold", text: "b" },
      { date: "2026-07-01", decision: "trim", text: "a" },
    ],
  });
  assert.deepEqual(latestResponse(f), { date: "2026-10-28", decision: "hold", text: "b" });
  assert.equal(latestResponse(ok()), null);
  assert.equal(latestResponse(undefined), null);
});

test("unanswered lists triggered falsifiers with no response only", () => {
  const fs = [ok({ key: "a" }), ok({ key: "b", responses: [{ date: "2026-10-28", decision: "hold", text: "t" }] }), ok({ key: "c" })];
  const checks = [
    { key: "a", triggered: true },
    { key: "b", triggered: true },
    { key: "c", triggered: null },
    { key: "d", triggered: false },
  ];
  assert.deepEqual(unanswered(fs, checks), ["a"]);
});

test("basis_changed is optional and, when present, needs an ISO date and a note", () => {
  assert.deepEqual(falsifierProblems([ok({ basis_changed: { date: "2026-10-28", note: "Reclassified." } })]), []);
  const bad = falsifierProblems([ok({ basis_changed: { date: "28 Oct 2026", note: " " } })]);
  assert.equal(bad.length, 2);
  assert.match(bad.join(" "), /basis_changed.date/);
  assert.match(bad.join(" "), /basis_changed.note/);
});

test("the rotation falsifier records its change of basis on 2026-10-28", () => {
  const book = JSON.parse(readFileSync(new URL("../data/positions.json", import.meta.url), "utf8"));
  const rot = book.thesis.falsifiers.find((f) => f.key === "rotation");
  assert.equal(rot.basis_changed.date, "2026-10-28");
  assert.match(rot.basis_changed.note, /^NBIS and CRWV moved from Substrate to Compute/);
});

test("the live book's falsifiers pass the schema", () => {
  const book = JSON.parse(readFileSync(new URL("../data/positions.json", import.meta.url), "utf8"));
  assert.deepEqual(falsifierProblems(book.thesis.falsifiers), []);
  assert.equal(book.thesis.falsifiers.length, 5);
});
