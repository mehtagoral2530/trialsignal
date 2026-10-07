import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY, AREAS, PRESETS, PICKS, lib } from "../site/data/library.js";
import { NEWS, NEWS_TYPES } from "../site/data/news.js";
import { SNAPSHOT } from "../site/data/snapshot.js";
import { TERMS, AUTO_TERMS } from "../site/data/glossary.js";

test("library entries are complete and unique", () => {
  const ids = LIBRARY.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  const areas = new Set(AREAS.map((a) => a.key));
  for (const t of LIBRARY) {
    assert.match(t.id, /^NCT\d{8}$/, t.id);
    assert.ok(areas.has(t.area), `${t.id} area`);
    for (const k of ["short", "condition", "question", "plainPop", "plainTx", "intervention", "comparator", "result", "safety", "next"]) {
      assert.ok(t[k] && t[k].length > 3, `${t.id} is missing ${k}`);
    }
    if (t.evidence === "published") assert.match(t.pub.doi, /^10\.\d{4,}\//, `${t.id} DOI`);
    else assert.equal(t.evidence, "topline", `${t.id} evidence`);
    if (t.evidence === "topline") assert.match(t.topline.url, /^https:\/\//);
    if (t.decision) assert.match(t.decision.date, /^\d{4}-\d{2}$/, `${t.id} decision date`);
  }
});

test("every area has trials", () => {
  for (const a of AREAS) assert.ok(LIBRARY.some((t) => t.area === a.key), a.key);
});

test("the saved snapshot covers the whole library", () => {
  for (const t of LIBRARY) {
    const s = SNAPSHOT[t.id];
    assert.ok(s, `${t.id} missing from snapshot`);
    assert.equal(s.id, t.id);
    assert.ok(s.status, `${t.id} status`);
  }
});

test("presets, picks and headlines point at library trials", () => {
  for (const p of PRESETS) for (const id of p.ids) assert.ok(lib(id), `${p.key}: ${id}`);
  for (const [id] of PICKS) assert.ok(lib(id), id);
  for (const n of NEWS) {
    assert.ok(NEWS_TYPES[n.type], n.title);
    if (n.trial) assert.ok(lib(n.trial), n.trial);
  }
});

test("auto-linked glossary terms all have definitions", () => {
  for (const t of AUTO_TERMS) assert.ok(TERMS[t.toLowerCase()], t);
});
