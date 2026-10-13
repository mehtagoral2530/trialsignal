// Integration tests against real Redis: Lua CAS (atomicity, idempotency, monotonicity),
// cron de-duplication, the Worker's HTTP endpoints, caching with 24h TTL, and POST idempotency.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startRedis } from "./helpers/redis.mjs";
import { study, fakeRegistry } from "./helpers/fixtures.mjs";
import { applyStates, rowsFromStudies, poll, SLOT_MS } from "../worker/src/poll.js";
import { handle } from "../worker/src/index.js";
import { resetIndex } from "../worker/src/search.js";
import { K, DAY } from "../worker/src/keys.js";
import { CURATED } from "../shared/curated.js";

const R = await startRedis();
after(async () => { await R?.close(); });
beforeEach(async () => { if (R) await R.flush(); resetIndex(); });
const skip = () => !R && "no Redis available (set REDIS_URL or install redis-server)";
const feed = async () => (await R.client.cmd("ZRANGE", K.feed, 0, -1)).map((x) => JSON.parse(x));

test("first sighting sets a baseline without emitting a change", { skip: skip() }, async () => {
  const rows = await rowsFromStudies([study({ id: "NCT10000001" })]);
  const r = await applyStates(R.client, rows, 1000);
  assert.deepEqual(r, { applied: 0, skipped: 0, initialized: 1 });
  assert.equal((await feed()).length, 0);
});

test("a real change emits exactly one feed entry; replaying it emits none (idempotent)", { skip: skip() }, async () => {
  await applyStates(R.client, await rowsFromStudies([study({ id: "NCT10000001", status: "RECRUITING", lup: "2026-09-01" })]), 1000);
  const changed = await rowsFromStudies([study({ id: "NCT10000001", status: "ACTIVE_NOT_RECRUITING", lup: "2026-09-05" })]);
  assert.equal((await applyStates(R.client, changed, 2000)).applied, 1);
  assert.equal((await applyStates(R.client, changed, 3000)).applied, 0, "replay is a no-op");
  const f = await feed();
  assert.equal(f.length, 1);
  assert.equal(f[0].seq, 1);
  assert.deepEqual(f[0].fields, ["status"]);
  assert.equal(f[0].state.status, "ACTIVE_NOT_RECRUITING");
});

test("an older registry response can never roll state back (monotonic lastUpdate)", { skip: skip() }, async () => {
  await applyStates(R.client, await rowsFromStudies([study({ id: "NCT10000001", status: "RECRUITING", lup: "2026-09-10" })]), 1);
  const stale = await rowsFromStudies([study({ id: "NCT10000001", status: "COMPLETED", lup: "2026-08-01" })]);
  assert.equal((await applyStates(R.client, stale, 2)).applied, 0);
  assert.equal(JSON.parse(await R.client.cmd("GET", K.study("NCT10000001"))).status, "RECRUITING");
});

test("invalid input aborts the whole batch before any write (validate-before-write)", { skip: skip() }, async () => {
  const good = await rowsFromStudies([study({ id: "NCT10000001" })]);
  const bad = [...good, { nct: "NCT10000002", hash: "not-a-hash", lup: "", state: {} }];
  await assert.rejects(() => applyStates(R.client, bad, 1), /bad hash/);
  assert.equal(await R.client.cmd("GET", K.study("NCT10000001")), null, "nothing was written");
});

test("cron runs are de-duplicated per 15-minute slot and leave the lease free", { skip: skip() }, async () => {
  const reg = fakeRegistry(CURATED.map((id) => study({ id })));
  const t = 1_800_000_000_000;
  const first = await poll({ redis: R.client, fetchImpl: reg.fetchImpl, scheduledTime: t, now: t });
  assert.equal(first.initialized, CURATED.length);
  const dup = await poll({ redis: R.client, fetchImpl: reg.fetchImpl, scheduledTime: t + 1000, now: t });
  assert.equal(dup.skipped, "duplicate-slot");
  assert.equal(await R.client.cmd("GET", K.lockPoll), null, "lease released");
  reg.set(study({ id: CURATED[0], status: "COMPLETED", lup: "2026-10-01" }));
  const next = await poll({ redis: R.client, fetchImpl: reg.fetchImpl, scheduledTime: t + SLOT_MS, now: t + SLOT_MS });
  assert.equal(next.applied, 1);
});

const req = (path, init) => new Request("https://api.test" + path, init);
const env = { ALLOWED_ORIGIN: "*" };

test("GET /v1/changes: cursor paging, ETag 304, and 410 on a foreign epoch", { skip: skip() }, async () => {
  const deps = { redis: R.client, fetchImpl: fakeRegistry().fetchImpl };
  await applyStates(R.client, await rowsFromStudies([study({ id: "NCT10000001", status: "RECRUITING" })]), 1);
  await applyStates(R.client, await rowsFromStudies([study({ id: "NCT10000001", status: "COMPLETED", lup: "2026-10-01" })]), 2);
  const r1 = await handle(req("/v1/changes"), env, {}, deps);
  const j1 = await r1.json();
  assert.equal(j1.entries.length, 1);
  const r2 = await handle(req(`/v1/changes?since=${j1.next}`, { headers: { "If-None-Match": r1.headers.get("ETag") } }), env, {}, deps);
  assert.equal(r2.status, 304);
  const r3 = await handle(req("/v1/changes?since=deadbeef.1"), env, {}, deps);
  assert.equal(r3.status, 410);
});

test("GET /v1/search caches results in Redis with a 24h TTL (second call skips the registry)", { skip: skip() }, async () => {
  const reg = fakeRegistry([study({ id: "NCT20000001", title: "Weekly shot for obesity", conditions: ["Obesity"] })]);
  const deps = { redis: R.client, fetchImpl: reg.fetchImpl };
  const a = await (await handle(req("/v1/search?q=obesity"), env, {}, deps)).json();
  assert.equal(a.cache, "miss");
  assert.ok(a.results.some((r) => r.nct === "NCT20000001"), "registry result fused in");
  assert.ok(a.results.some((r) => r.curated), "curated BM25 results fused in");
  const before = reg.calls.length;
  const b = await (await handle(req("/v1/search?q=Obesity"), env, {}, deps)).json();
  assert.equal(b.cache, "hit");
  assert.equal(reg.calls.length, before, "served from Redis");
  const keys = await R.client.cmd("KEYS", "ts:v1:q:*");
  const ttl = await R.client.cmd("TTL", keys[0]);
  assert.ok(ttl > DAY - 1900 && ttl <= DAY, `TTL ≈ 24h (got ${ttl})`);
});

test("GET /v1/studies/{id} returns an ETag and 304 when unchanged; raw cached for 24h", { skip: skip() }, async () => {
  const reg = fakeRegistry([study({ id: "NCT30000001" })]);
  const deps = { redis: R.client, fetchImpl: reg.fetchImpl };
  const r = await handle(req("/v1/studies/NCT30000001"), env, {}, deps);
  assert.equal(r.status, 200);
  const etag = r.headers.get("ETag");
  const r2 = await handle(req("/v1/studies/NCT30000001", { headers: { "If-None-Match": etag } }), env, {}, deps);
  assert.equal(r2.status, 304);
  const [rawKey] = await R.client.cmd("KEYS", "ts:v1:raw:*");
  assert.ok((await R.client.cmd("TTL", rawKey)) > DAY - 1900);
  assert.equal((await handle(req("/v1/studies/NCT99999999"), env, {}, deps)).status, 404);
});

test("POST /v1/watch is idempotent per Idempotency-Key and atomic with its stored response", { skip: skip() }, async () => {
  const deps = { redis: R.client, fetchImpl: fakeRegistry().fetchImpl };
  const post = (key, ids) => handle(req("/v1/watch", { method: "POST", headers: { "Idempotency-Key": key, "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }), env, {}, deps);
  assert.equal((await post("", ["NCT04184622"])).status, 400, "key required");
  const k = "11111111-2222-3333-4444-555555555555";
  const a = await post(k, ["NCT04184622"]);
  const b = await post(k, ["NCT04184622"]);
  assert.equal(a.status, 200);
  assert.equal(b.headers.get("Idempotent-Replayed"), "true");
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(Number(await R.client.cmd("ZCARD", K.watch)), 1);
  await R.client.cmd("SET", K.idem("22222222-aaaa"), "pending", "EX", 60);
  assert.equal((await post("22222222-aaaa", ["NCT04184622"])).status, 409, "concurrent duplicate is rejected");
  assert.equal((await post("33333333-bbbb", ["DROP TABLE"])).status, 400);
});

test("GET /v1/state returns tracked state for up to 50 ids", { skip: skip() }, async () => {
  await applyStates(R.client, await rowsFromStudies([study({ id: "NCT10000001", status: "RECRUITING" })]), 1);
  const j = await (await handle(req("/v1/state?ids=NCT10000001,NCT10000002"), env, {}, { redis: R.client })).json();
  assert.equal(j.state.NCT10000001.status, "RECRUITING");
  assert.equal(j.state.NCT10000002, null);
});

test("Redis down: search still works (degrades to registry + BM25), live endpoints return 503", async () => {
  const reg = fakeRegistry([study({ id: "NCT20000001", title: "Obesity study" })]);
  const deps = { redis: null, fetchImpl: reg.fetchImpl };
  const s = await handle(req("/v1/search?q=obesity"), env, {}, deps);
  assert.equal(s.status, 200);
  assert.equal((await handle(req("/v1/changes"), env, {}, deps)).status, 503);
});

test("Registry down: search degrades to the local index and is flagged, not cached", { skip: skip() }, async () => {
  const reg = fakeRegistry(); reg.fetchImpl.fail = 503;
  const j = await (await handle(req("/v1/search?q=lung cancer"), env, {}, { redis: R.client, fetchImpl: reg.fetchImpl })).json();
  assert.ok(j.degraded.some((d) => d.startsWith("registry")));
  assert.ok(j.results.length > 0, "BM25 over curated studies still answers");
  assert.equal((await R.client.cmd("KEYS", "ts:v1:q:*")).length, 0, "degraded results are not cached for 24h");
});

test("concurrent pollers applying the same change produce exactly one feed entry (isolation)", { skip: skip() }, async () => {
  await applyStates(R.client, await rowsFromStudies([study({ id: "NCT10000009", status: "RECRUITING" })]), 1);
  const changed = await rowsFromStudies([study({ id: "NCT10000009", status: "TERMINATED", lup: "2026-10-03" })]);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => applyStates(R.client, changed, 10 + i)));
  assert.equal(results.reduce((n, r) => n + r.applied, 0), 1);
  assert.equal((await feed()).length, 1);
});
