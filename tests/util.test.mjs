import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNCT, fmtDate, ago, esc } from "../site/js/util.js";

test("finds a trial number in text or links", () => {
  assert.equal(parseNCT("nct04184622"), "NCT04184622");
  assert.equal(parseNCT("https://clinicaltrials.gov/study/NCT03887455?tab=results"), "NCT03887455");
  assert.equal(parseNCT("NCT1234"), null);
  assert.equal(parseNCT("obesity"), null);
});

test("dates read naturally", () => {
  assert.equal(fmtDate("2019-12-04"), "4 Dec 2019");
  assert.equal(fmtDate("2026-04"), "Apr 2026");
  assert.equal(fmtDate("2025-Q4"), "Q4 2025");
  assert.equal(fmtDate(""), "");
});

test("relative times", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
  assert.equal(ago(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(ago(now - 26 * 3600_000, now), "yesterday");
});

test("escapes HTML", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
