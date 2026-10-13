import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSnapshot } from "../scripts/snapshot.mjs";
import { study, fakeRegistry } from "./helpers/fixtures.mjs";
import { CURATED } from "../shared/curated.js";

test("snapshot job is idempotent and records only real changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-snap-"));
  const reg = fakeRegistry(CURATED.map((id) => study({ id, conditions: ["Obesity"] })));
  const a = await runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 0, now: new Date("2026-10-01T00:00:00Z") });
  assert.equal(a.changed, true);
  const mtime = statSync(join(dir, "snapshot.json")).mtimeMs;

  const b = await runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 0, now: new Date("2026-10-01T03:00:00Z") });
  assert.equal(b.changed, false, "no tracked change => no write, no deploy");
  assert.equal(statSync(join(dir, "snapshot.json")).mtimeMs, mtime);

  reg.set(study({ id: CURATED[3], status: "COMPLETED", lup: "2026-10-02", conditions: ["Obesity"] }));
  const c = await runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 0, now: new Date("2026-10-02T03:00:00Z") });
  assert.equal(c.changed, true);
  assert.equal(c.newChanges, 1);
  const changes = JSON.parse(readFileSync(join(dir, "changes.json"), "utf8"));
  assert.equal(changes.entries.at(-1).nct, CURATED[3]);
  assert.deepEqual(changes.entries.at(-1).fields, ["status"]);
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  assert.ok(index.docs.length >= CURATED.length);
});

test("snapshot job retries 5xx with backoff and then fails loudly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-snap-"));
  const reg = fakeRegistry(); reg.fetchImpl.fail = 503;
  await assert.rejects(() => runSnapshot({ dataDir: dir, fetchImpl: reg.fetchImpl, pauseMs: 1 }), /503/);
  assert.equal(reg.calls.length, 4, "1 try + 3 retries");
});
