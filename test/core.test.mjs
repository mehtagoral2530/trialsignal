import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, stateHash, trackedState, summarize, normalizeQuery, buildIndex, bm25Search, rrf, heuristicRerank, isNct } from "../shared/core.js";
import { study } from "./helpers/fixtures.mjs";

test("canonical JSON is key-order independent", () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: null }] }), canonical({ a: [2, { c: null, d: 1 }], b: 1 }));
});

test("state hash is deterministic, 32 hex chars, and ignores cosmetic fields", async () => {
  const s1 = study({ id: "NCT00000001", status: "RECRUITING", lup: "2026-01-01", title: "A" });
  const s2 = study({ id: "NCT00000001", status: "RECRUITING", lup: "2026-02-01", title: "Changed title" });
  const h1 = await stateHash(trackedState(s1)), h2 = await stateHash(trackedState(s2));
  assert.match(h1, /^[0-9a-f]{32}$/);
  assert.equal(h1, h2, "title / lastUpdate edits are not tracked changes");
  const s3 = study({ id: "NCT00000001", status: "COMPLETED" });
  assert.notEqual(h1, await stateHash(trackedState(s3)));
});

test("summarize extracts display fields from a v2 study", () => {
  const d = summarize(study({ id: "NCT00000002", title: "Weekly shot for obesity", conditions: ["Obesity"], interventions: ["Drug X"] }));
  assert.equal(d.nct, "NCT00000002");
  assert.deepEqual(d.conditions, ["Obesity"]);
  assert.deepEqual(d.interventions, ["Drug X"]);
});

test("query normalisation makes equivalent queries share one cache key", () => {
  assert.equal(normalizeQuery("Heart  Failure"), normalizeQuery("failure heart"));
  assert.equal(normalizeQuery("MK-3475"), normalizeQuery("mk3475"));
  assert.equal(normalizeQuery("Alzheimer’s"), normalizeQuery("alzheimers"));
  assert.notEqual(normalizeQuery("heart", { status: "RECRUITING" }), normalizeQuery("heart"));
});

test("BM25 ranks title matches above summary-only matches", () => {
  const idx = buildIndex([
    { nct: "NCT1", title: "Semaglutide for obesity", conditions: ["Obesity"], interventions: [], summary: "" },
    { nct: "NCT2", title: "Heart failure pill", conditions: ["Heart failure"], interventions: [], summary: "Some patients had obesity." },
    { nct: "NCT3", title: "Kidney study", conditions: ["CKD"], interventions: [], summary: "" },
  ]);
  const r = bm25Search(idx, "obesity");
  assert.deepEqual(r.map((x) => x.id), ["NCT1", "NCT2"]);
});

test("RRF rewards documents ranked well by several retrievers", () => {
  const fused = rrf([["A", "B", "C"], ["B", "D"], ["B", "A"]]);
  assert.equal(fused[0].id, "B");
  assert.deepEqual(new Set(fused.map((f) => f.id)), new Set(["A", "B", "C", "D"]));
});

test("heuristic reranker boosts exact title phrase and curated studies", () => {
  const docs = new Map([["NCT1", { title: "Something else" }], ["NCT2", { title: "Lung cancer immunotherapy" }]]);
  const out = heuristicRerank("lung cancer", [{ id: "NCT1", score: 0.03 }, { id: "NCT2", score: 0.025 }], docs, { curated: new Set() });
  assert.equal(out[0].id, "NCT2");
});

test("NCT validation", () => {
  assert.ok(isNct("NCT04184622"));
  assert.ok(!isNct("NCT0418462"));
  assert.ok(!isNct("nct04184622 OR 1=1"));
});
