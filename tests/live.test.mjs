import { test } from "node:test";
import assert from "node:assert/strict";
import { easternToMs, agoShort, hm, whenWord, nextRefresh, easternDay } from "../site/js/live.js";

test("registry timestamps are read as US Eastern time", () => {
  assert.equal(new Date(easternToMs("2026-10-07T09:00:06")).toISOString(), "2026-10-07T13:00:06.000Z");
  assert.equal(new Date(easternToMs("2026-01-07T09:00:00")).toISOString(), "2026-01-07T14:00:00.000Z");
  assert.equal(easternToMs(""), 0);
});

test("ticking clocks", () => {
  assert.equal(agoShort(2_000), "just now");
  assert.equal(agoShort(12_000), "12s ago");
  assert.equal(agoShort(4 * 60_000), "4m ago");
  assert.equal(agoShort(3 * 3600_000), "3h ago");
  assert.equal(hm(38 * 60_000), "38m");
  assert.equal(hm((5 * 60 + 46) * 60_000), "5h 46m");
  assert.equal(hm(27 * 3600_000), "1d 3h");
});

test("the headline says today, yesterday or the weekday, using Eastern time", () => {
  const wedAfternoonET = Date.parse("2026-10-07T18:00:00Z");
  assert.equal(whenWord("2026-10-07", wedAfternoonET), "today");
  assert.equal(whenWord("2026-10-06", wedAfternoonET), "yesterday");
  const sunday = Date.parse("2026-10-11T18:00:00Z");
  assert.equal(whenWord("2026-10-09", sunday), "on Friday");
  // 02:00 UTC on Thursday is still Wednesday evening in New York.
  assert.equal(whenWord("2026-10-07", Date.parse("2026-10-08T02:00:00Z")), "today");
  assert.equal(easternDay(Date.parse("2026-10-08T02:00:00Z")), "2026-10-07");
});

test("next refresh skips weekends and follows daylight saving", () => {
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(iso(nextRefresh(Date.parse("2026-10-07T12:00:00Z"))), "2026-10-07T13:00:00.000Z"); // Wed 8:00 ET → 9:00 today
  assert.equal(iso(nextRefresh(Date.parse("2026-10-09T15:00:00Z"))), "2026-10-12T13:00:00.000Z"); // Fri 11:00 ET → Mon
  assert.equal(iso(nextRefresh(Date.parse("2026-10-30T14:00:00Z"))), "2026-11-02T14:00:00.000Z"); // DST ends Sun 1 Nov
});
