import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, cpSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSnapshot } from "../scripts/snapshot.mjs";
import { study, fakeRegistry } from "./helpers/fixtures.mjs";
import { CURATED } from "../shared/curated.js";

const T1 = "2026-10-09T09:00:05";
const T2 = "2026-10-12T09:00:03";
const tmp = () => mkdtempSync(join(tmpdir(), "ts-snap-"));
const read = (dir, name) => readFileSync(join(dir, name), "utf8");
const readJson = (dir, name) => JSON.parse(read(dir, name));
const mtime = (dir, name) => statSync(join(dir, name)).mtimeMs;
const studyCalls = (reg) => reg.calls.filter((u) => /\/studies(\/|$)/.test(u.pathname));
const versionCalls = (reg) => reg.calls.filter((u) => u.pathname.endsWith("/version"));

/**
 * The shared fake registry plus GET /api/v2/version. `reg.version` controls what /version does:
 * { ts } answers with that dataTimestamp, { status } answers with an HTTP error, { throws } fails the
 * network, { body } answers 200 with that raw body, { hang } never answers unless the request is aborted.
 */
function registry(initial = CURATED.map((id) => study({ id, conditions: ["Obesity"] })), ts = T1) {
  const reg = fakeRegistry(initial);
  reg.version = { ts };
  const inner = reg.fetchImpl;
  reg.fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (!u.pathname.endsWith("/version")) return inner(url, init);
    reg.calls.push(u);
    const v = reg.version;
    if (v.throws) throw new TypeError("fetch failed");
    if (v.hang) return new Promise((_, rej) => {
      const socket = setTimeout(() => {}, 30_000);   // a real hung socket keeps the event loop alive; AbortSignal.timeout's own timer does not
      init.signal.addEventListener("abort", () => { clearTimeout(socket); rej(init.signal.reason); });
    });
    if (v.status) return new Response(JSON.stringify({ error: "down" }), { status: v.status });
    if (v.body !== undefined) return new Response(v.body, { status: 200 });
    return new Response(JSON.stringify({ apiVersion: "2.0.5", dataTimestamp: v.ts }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return reg;
}
const run = (dir, reg, extra = {}) => runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 0, now: new Date("2026-10-10T00:00:00Z"), ...extra });

test("snapshot job is idempotent and records only real changes", async () => {
  const dir = tmp();
  const reg = fakeRegistry(CURATED.map((id) => study({ id, conditions: ["Obesity"] })));
  const a = await runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 0, now: new Date("2026-10-01T00:00:00Z") });
  assert.equal(a.changed, true);
  const mtimeA = mtime(dir, "snapshot.json");

  const b = await runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 0, now: new Date("2026-10-01T03:00:00Z") });
  assert.equal(b.changed, false, "no tracked change => no write, no deploy");
  assert.equal(mtime(dir, "snapshot.json"), mtimeA);

  reg.set(study({ id: CURATED[3], status: "COMPLETED", lup: "2026-10-02", conditions: ["Obesity"] }));
  const c = await runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 0, now: new Date("2026-10-02T03:00:00Z") });
  assert.equal(c.changed, true);
  assert.equal(c.newChanges, 1);
  const changes = readJson(dir, "changes.json");
  assert.equal(changes.entries.at(-1).nct, CURATED[3]);
  assert.deepEqual(changes.entries.at(-1).fields, ["status"]);
  const index = readJson(dir, "index.json");
  assert.ok(index.docs.length >= CURATED.length);
});

test("snapshot job retries 5xx with backoff and then fails loudly", async () => {
  const dir = tmp();
  const reg = fakeRegistry(); reg.fetchImpl.fail = 503;
  await assert.rejects(() => runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 1 }), /503/);
  assert.equal(versionCalls(reg).length, 1, "/version is tried once, never retried");
  assert.equal(studyCalls(reg).length, 4, "1 try + 3 retries for the studies request");
});

test("gate: unchanged dataTimestamp skips the run without a single /studies request", async () => {
  const dir = tmp();
  const reg = registry();
  const a = await run(dir, reg);
  assert.equal(a.changed, true);
  const snap = readJson(dir, "snapshot.json");
  assert.equal(snap.dataTimestamp, T1, "the registry timestamp is stored with the snapshot");
  const files = ["snapshot.json", "changes.json", "index.json"];
  const before = files.map((f) => read(dir, f));
  const mt = files.map((f) => mtime(dir, f));

  reg.calls.length = 0;
  const b = await run(dir, reg);
  assert.deepEqual(b, { changed: false, reason: "registry-unchanged" });
  assert.equal(reg.calls.length, 1, "exactly one request");
  assert.ok(reg.calls[0].pathname.endsWith("/api/v2/version"));
  assert.equal(studyCalls(reg).length, 0);
  assert.deepEqual(files.map((f) => read(dir, f)), before, "nothing rewritten");
  assert.deepEqual(files.map((f) => mtime(dir, f)), mt);
});

test("gate: a new dataTimestamp runs the full job and stores the new timestamp", async () => {
  const dir = tmp();
  const reg = registry();
  await run(dir, reg);

  reg.version = { ts: T2 };
  reg.set(study({ id: CURATED[3], status: "COMPLETED", lup: "2026-10-12", conditions: ["Obesity"] }));
  reg.calls.length = 0;
  const c = await run(dir, reg);
  assert.equal(c.changed, true);
  assert.equal(c.newChanges, 1);
  assert.ok(studyCalls(reg).length > 0, "studies were fetched");
  assert.equal(readJson(dir, "snapshot.json").dataTimestamp, T2);
  assert.equal(readJson(dir, "changes.json").entries.at(-1).nct, CURATED[3]);

  reg.calls.length = 0;
  assert.deepEqual(await run(dir, reg), { changed: false, reason: "registry-unchanged" }, "and the next run is gated again");
  assert.equal(studyCalls(reg).length, 0);
});

test("gate: falls through to the full run whenever /version cannot be read", async () => {
  for (const [label, version] of [
    ["HTTP 500", { status: 500 }],
    ["HTTP 404", { status: 404 }],
    ["network error", { throws: true }],
    ["not JSON", { body: "<html>maintenance</html>" }],
    ["no dataTimestamp", { body: JSON.stringify({ apiVersion: "2.0.5" }) }],
    ["empty dataTimestamp", { body: JSON.stringify({ dataTimestamp: "" }) }],
  ]) {
    const dir = tmp();
    const reg = registry();
    await run(dir, reg);
    reg.set(study({ id: CURATED[5], status: "TERMINATED", lup: "2026-10-12", conditions: ["Obesity"] }));

    reg.version = version; reg.calls.length = 0;
    const r = await run(dir, reg);
    assert.equal(r.changed, true, `${label}: the job still ran and picked up the change`);
    assert.equal(r.newChanges, 1, label);
    assert.ok(studyCalls(reg).length > 0, `${label}: studies fetched`);
    assert.equal(readJson(dir, "snapshot.json").dataTimestamp ?? null, null, `${label}: no timestamp is invented`);

    // Once /version is back, the unknown timestamp is recorded without rewriting the data or counting as a change.
    reg.version = { ts: T1 };
    const gen = readJson(dir, "snapshot.json").generatedAt;
    const s = await run(dir, reg);
    assert.equal(s.changed, false, label);
    assert.equal(s.stamped, true, label);
    assert.equal(readJson(dir, "snapshot.json").dataTimestamp, T1, label);
    assert.equal(readJson(dir, "snapshot.json").generatedAt, gen, label);
  }
});

test("gate: a /version that hangs is abandoned after the timeout and the job still runs", async () => {
  const dir = tmp();
  const reg = registry();
  reg.version = { hang: true };
  const t0 = Date.now();
  const r = await run(dir, reg, { versionTimeoutMs: 50 });
  assert.equal(r.changed, true);
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(studyCalls(reg).length > 0);
});

test("content hash stays a second guard: a new timestamp with identical tracked data writes no data and deploys nothing", async () => {
  const dir = tmp();
  const reg = registry();
  await run(dir, reg);
  const before = readJson(dir, "snapshot.json");
  const mtChanges = mtime(dir, "changes.json"), mtIndex = mtime(dir, "index.json");

  reg.version = { ts: T2 };   // the registry refreshed, but nothing we track moved
  reg.calls.length = 0;
  const b = await run(dir, reg, { now: new Date("2026-10-12T12:00:00Z") });
  assert.equal(b.changed, false, "nothing to deploy");
  assert.equal(b.reason, "content-unchanged");
  assert.equal(b.stamped, true, "but the new timestamp must be committed so the gate works next time");
  assert.ok(studyCalls(reg).length > 0, "the full fetch ran to prove the content is identical");
  const after = readJson(dir, "snapshot.json");
  assert.equal(after.dataTimestamp, T2);
  assert.deepEqual({ ...after, dataTimestamp: null }, { ...before, dataTimestamp: null }, "only dataTimestamp differs (same generatedAt, contentHash, studies)");
  assert.equal(mtime(dir, "changes.json"), mtChanges);
  assert.equal(mtime(dir, "index.json"), mtIndex);

  reg.calls.length = 0;
  assert.deepEqual(await run(dir, reg), { changed: false, reason: "registry-unchanged" });
  assert.equal(studyCalls(reg).length, 0, "and now it is gated");
});

test("content hash still applies with the same /version when the gate is bypassed (force)", async () => {
  const dir = tmp();
  const reg = registry();
  await run(dir, reg);
  const raw = read(dir, "snapshot.json");
  const mt = mtime(dir, "snapshot.json");

  reg.calls.length = 0;
  const f = await run(dir, reg, { force: true });
  assert.ok(studyCalls(reg).length > 0, "force ignores the registry gate");
  assert.equal(f.changed, false, "identical content => still no write, no deploy");
  assert.equal(f.stamped, undefined);
  assert.equal(read(dir, "snapshot.json"), raw);
  assert.equal(mtime(dir, "snapshot.json"), mt);
});

test("gate: does not skip when what we ask the registry for has changed (e.g. a new curated study)", async () => {
  const dir = tmp();
  const reg = registry();
  await run(dir, reg);
  const snap = readJson(dir, "snapshot.json");
  assert.match(snap.queryHash, /^[0-9a-f]{32}$/);
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify({ ...snap, queryHash: "0".repeat(32) }));   // as if CURATED/TOPICS were edited since

  reg.calls.length = 0;
  const r = await run(dir, reg);
  assert.ok(studyCalls(reg).length > 0, "same dataTimestamp, but the gate stays open");
  assert.equal(r.stamped, true);
  assert.equal(readJson(dir, "snapshot.json").queryHash, snap.queryHash);
});

test("the very first run (committed empty baseline, no dataTimestamp) is never gated", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify({ version: 1, generatedAt: null, contentHash: null, topics: {}, studies: {} }));
  const reg = registry();
  const r = await run(dir, reg);
  assert.equal(r.changed, true);
  assert.equal(readJson(dir, "snapshot.json").dataTimestamp, T1);
});

test("CLI contract: the gated path still writes changed=false to GITHUB_OUTPUT and never touches the studies API", async () => {
  // Run a copy of the script so the repo's real site/data is never written.
  const root = tmp();
  cpSync(new URL("../scripts/snapshot.mjs", import.meta.url), join(root, "scripts/snapshot.mjs"));
  cpSync(new URL("../shared", import.meta.url), join(root, "shared"), { recursive: true });
  cpSync(new URL("../package.json", import.meta.url), join(root, "package.json"));
  const dataDir = join(root, "site/data");
  await run(dataDir, registry());          // previous snapshot, stamped with T1

  // Preload: only /version exists; any other request would throw and fail the process.
  writeFileSync(join(root, "preload.mjs"), `globalThis.fetch = async (url) => {
    if (String(url).endsWith("/version")) return Response.json({ apiVersion: "2.0.5", dataTimestamp: process.env.FAKE_TS });
    throw new Error("unexpected request " + url);
  };`);
  const out = join(root, "github_output");
  const cli = (env) => spawnSync(process.execPath, ["--import", join(root, "preload.mjs"), join(root, "scripts/snapshot.mjs")],
    { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out, FAKE_TS: T1, ...env } });

  const r = cli({});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { changed: false, reason: "registry-unchanged" });
  assert.equal(readFileSync(out, "utf8"), "changed=false\nstamped=false\n");

  // Sanity check that the preload really would have failed the job had the gate let the run through.
  const g = cli({ FAKE_TS: T2 });
  assert.equal(g.status, 1);
  assert.match(g.stderr, /unexpected request .*\/studies/);
});
