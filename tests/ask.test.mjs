import { test } from "node:test";
import assert from "node:assert/strict";
import { intentOf, answer, SUGGESTIONS } from "../site/js/ask.js";
import { lib } from "../site/data/library.js";
import { SNAPSHOT } from "../site/data/snapshot.js";

test("every suggested question has an intent", () => {
  assert.deepEqual(SUGGESTIONS.map(intentOf), ["exclusion", "duration", "blinding", "where", "safety"]);
});

test("everyday wording maps to the right part of the record", () => {
  assert.equal(intentOf("Is it safe?"), "safety");
  assert.equal(intentOf("What are the side effects?"), "safety");
  assert.equal(intentOf("Where is it running?"), "where");
  assert.equal(intentOf("How many people are in it?"), "size");
  assert.equal(intentOf("Who is funding this?"), "sponsor");
  assert.equal(intentOf("Who can take part?"), "who");
  assert.equal(intentOf("What is this study trying to find out?"), "purpose");
  assert.equal(intentOf("Is it still recruiting?"), "status");
  assert.equal(intentOf("What has been found so far?"), "found");
  assert.equal(intentOf("What's the weather?"), null);
});

test("answers name their source", () => {
  const id = "NCT04184622";
  const ctx = { model: SNAPSHOT[id], curated: lib(id) };
  const who = answer("Who can take part?", ctx);
  assert.equal(who.from, "registry");
  assert.equal(who.part, "eligibility section");
  assert.ok(who.items.some((x) => x.startsWith("Ages:")));
  assert.ok(!who.items.some((x) => /;;/.test(x)));
  const found = answer("What has been found?", ctx);
  assert.match(found.note, /peer-reviewed/);
  assert.equal(found.from, "summary");
  const unknown = answer("Tell me a joke", ctx);
  assert.equal(unknown.from, null);
  const blind = answer("Was it blinded?", ctx);
  assert.match(blind.text, /^Yes\. It was quadruple-blind|^Yes\. It was double-blind/);
  const notJoin = answer("Who could not join?", ctx);
  assert.ok(notJoin.items.length >= 3);
  assert.match(answer("How long did it run?", ctx).text, /started on 4 Dec 2019/i);
});

test("company-only results are flagged as preliminary", () => {
  const id = "NCT05929066";
  const a = answer("What were the results?", { model: SNAPSHOT[id], curated: lib(id) });
  assert.match(a.note, /preliminary/);
});

test("without a record the answer says so instead of guessing", () => {
  const a = answer("Where is it running?", { model: null, curated: null });
  assert.equal(a.from, null);
  assert.match(a.text, /official record/);
});
