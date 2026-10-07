import { test } from "node:test";
import assert from "node:assert/strict";
import { easternToMs, agoLive, isoMinusDays, markNew } from "../site/js/live.js";

test("registry timestamps are read as US Eastern time", () => {
  assert.equal(new Date(easternToMs("2026-10-07T09:00:06")).toISOString(), "2026-10-07T13:00:06.000Z");
  assert.equal(new Date(easternToMs("2026-01-07T09:00:00")).toISOString(), "2026-01-07T14:00:00.000Z");
  assert.equal(easternToMs(""), 0);
});

test("ticking relative times", () => {
  const now = Date.parse("2026-10-07T17:00:00Z");
  assert.equal(agoLive(now - 2000, now), "just now");
  assert.equal(agoLive(now - 12_000, now), "12s ago");
  assert.equal(agoLive(now - 4 * 60_000, now), "4 min ago");
  assert.equal(agoLive(now - (3 * 60 + 5) * 60_000, now), "3h 5m ago");
  assert.equal(agoLive(now - 2 * 3600_000, now), "2h ago");
  assert.equal(agoLive(now - 26 * 3600_000, now), "yesterday");
});

test("date arithmetic for weekly windows", () => {
  assert.equal(isoMinusDays("2026-10-07", 7), "2026-09-30");
  assert.equal(isoMinusDays("2026-03-02", 2), "2026-02-28");
});

test("feeds highlight only rows that arrived since the last check", () => {
  assert.equal(markNew("t", ["A", "B"]).size, 0);
  assert.deepEqual([...markNew("t", ["C", "A", "B"])], ["C"]);
  assert.equal(markNew("t", ["C", "A", "B"]).size, 0);
});
