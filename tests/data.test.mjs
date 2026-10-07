import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY, AREAS, PRESETS, PICKS, lib } from "../site/data/library.js";
import { NEWS, NEWS_TYPES } from "../site/data/news.js";
import { SNAPSHOT, PULSE } from "../site/data/snapshot.js";
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

test("every library trial has its plain-language extras", () => {
  for (const t of LIBRARY) {
    assert.ok(t.hook && t.hook.length <= 90, `${t.id} hook`);
    assert.ok(t.measurePlain, `${t.id} measurePlain`);
    for (const chip of [...t.yes, ...t.no]) assert.doesNotMatch(chip, /<(?!\/?b>)/, `${t.id} chip markup`);
    if (t.series) {
      assert.ok(["loss", "pct"].includes(t.seriesFmt), `${t.id} seriesFmt`);
      assert.ok(t.seriesCap, `${t.id} seriesCap`);
      assert.equal(t.series[0][2], 0, `${t.id} comparison first`);
    }
  }
  assert.equal(lib("NCT04184622").five.length, 5);
});

test("the saved pulse has counts, 14 days per metric and three feeds", () => {
  for (const k of ["today", "new7", "results7", "recruiting", "total"]) assert.equal(typeof PULSE.counts[k], "number", k);
  for (const m of ["updated", "new", "results"]) {
    assert.equal(Object.keys(PULSE.days[m]).length, 14, m);
    assert.ok(PULSE.feeds[m].length > 0, m);
  }
  assert.match(PULSE.dataTimestamp, /^\d{4}-\d{2}-\d{2}T/);
});
