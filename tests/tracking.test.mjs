import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, createFollowStore, DEFAULT_FOLLOW, trackFields } from "../site/js/tracking.js";

const base = { status: "RECRUITING", lastUpdate: "2026-01-01", primaryCompletion: "2027-01", enrollment: 100, hasResults: false };

test("no change means no flags", () => {
  assert.deepEqual(diff(base, { ...base }), []);
  assert.deepEqual(diff(null, base), []);
});

test("meaningful changes are described in plain words", () => {
  const d = diff(base, { ...base, status: "ACTIVE_NOT_RECRUITING", hasResults: true, primaryCompletion: "2027-06", enrollment: 120, lastUpdate: "2026-02-01" });
  assert.deepEqual(d.map((x) => x.kind), ["status", "results", "date", "enrollment"]);
  assert.match(d[0].text, /Recruiting → Active, not recruiting/);
  assert.match(d[2].text, /Jan 2027 → Jun 2027/);
});

test("a bare record update is flagged only when nothing else changed", () => {
  const d = diff(base, { ...base, lastUpdate: "2026-02-01" });
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, "update");
});

function memoryStorage() {
  const m = new Map();
  return { get: (k, f) => (m.has(k) ? structuredClone(m.get(k)) : f), set: (k, v) => m.set(k, structuredClone(v)) };
}

const model = (over = {}) => ({ id: "NCT1", status: "RECRUITING", title: "T", acronym: "", phase: "Phase 3", hasResults: false, enrollment: { count: 100 }, dates: { lastUpdate: "2026-01-01", primaryCompletion: "2027-01" }, ...over });

test("first visit follows the default trials", () => {
  const f = createFollowStore({ storage: memoryStorage() });
  assert.deepEqual(f.ids(), DEFAULT_FOLLOW);
});

test("first check sets the baseline, later checks flag changes until marked seen", () => {
  const storage = memoryStorage();
  storage.set("ts.follow.v1", {});
  const f = createFollowStore({ storage });
  f.add("NCT1", null);
  f.update("NCT1", model());
  assert.equal(f.changedCount(), 0);
  f.update("NCT1", model({ status: "COMPLETED" }));
  assert.equal(f.changedCount(), 1);
  assert.equal(f.changes("NCT1")[0].kind, "status");
  f.markSeen("NCT1");
  assert.equal(f.changedCount(), 0);
  assert.deepEqual(f.get("NCT1").seen, trackFields(model({ status: "COMPLETED" })));
});

test("follows survive a reload", () => {
  const storage = memoryStorage();
  storage.set("ts.follow.v1", {});
  createFollowStore({ storage }).add("NCT9", null);
  assert.ok(createFollowStore({ storage }).has("NCT9"));
});
