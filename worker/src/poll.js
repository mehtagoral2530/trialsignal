// Scheduled polling: detect real changes in watched studies and append them to the change feed.
// Three layers make it safe under at-least-once cron delivery and overlapping runs:
//   1) run marker per 15-minute slot (SET NX), 2) lease lock with token, 3) per-study hash CAS in Lua.
import { trackedState, stateHash, lastUpdate, isNct, TRACKED_FIELDS } from "../../shared/core.js";
import { CURATED } from "../../shared/curated.js";
import { K, FEED_CAP } from "./keys.js";
import { APPLY, RELEASE } from "./lua.js";
import { ctGet } from "./ctgov.js";

export const SLOT_MS = 15 * 60_000;
const BATCH = 100;      // IDs per registry request (filter.ids)
const APPLY_CHUNK = 25; // studies per EVAL

export async function ensureEpoch(redis) {
  await redis.cmd("SET", K.epoch, crypto.randomUUID().slice(0, 8), "NX");
  return redis.cmd("GET", K.epoch);
}

/** Apply a list of {nct, hash, lup, state} atomically per chunk. Returns totals. */
export async function applyStates(redis, rows, now) {
  const tot = { applied: 0, skipped: 0, initialized: 0 };
  for (let i = 0; i < rows.length; i += APPLY_CHUNK) {
    const chunk = rows.slice(i, i + APPLY_CHUNK);
    const keys = [K.seq, K.feed, ...chunk.map((r) => K.study(r.nct))];
    const args = [String(now), String(FEED_CAP), ...chunk.flatMap((r) => [r.nct, r.hash, r.lup || "", JSON.stringify(r.state)])];
    const [a, s, n] = await redis.eval(APPLY, keys, args);
    tot.applied += Number(a); tot.skipped += Number(s); tot.initialized += Number(n);
  }
  return tot;
}

export async function rowsFromStudies(studies) {
  const rows = [];
  for (const s of studies) {
    const nct = s?.protocolSection?.identificationModule?.nctId;
    if (!isNct(nct)) continue;
    const state = trackedState(s);
    rows.push({ nct, hash: await stateHash(state), lup: lastUpdate(s), state });
  }
  return rows;
}

export async function poll({ redis, fetchImpl, scheduledTime = Date.now(), now = Date.now() }) {
  const slot = Math.floor(scheduledTime / SLOT_MS);
  if ((await redis.cmd("SET", K.run(slot), "1", "NX", "EX", 3600)) !== "OK") return { skipped: "duplicate-slot", slot };
  const token = crypto.randomUUID();
  if ((await redis.cmd("SET", K.lockPoll, token, "NX", "PX", 240000)) !== "OK") return { skipped: "locked", slot };
  try {
    await ensureEpoch(redis);
    const watched = (await redis.cmd("ZRANGE", K.watch, 0, 999)) || [];
    const ids = [...new Set([...CURATED, ...watched])].filter(isNct).sort();
    const tot = { applied: 0, skipped: 0, initialized: 0, requests: 0, errors: 0 };
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      let j;
      try {
        j = await ctGet("studies", { "filter.ids": batch.join(","), fields: TRACKED_FIELDS, pageSize: BATCH, format: "json" }, { redis, fetchImpl, now });
        tot.requests++;
      } catch (e) { tot.errors++; if (e.code === "breaker" || e.code === "rate") break; continue; }
      const r = await applyStates(redis, await rowsFromStudies(j.studies || []), now);
      tot.applied += r.applied; tot.skipped += r.skipped; tot.initialized += r.initialized;
    }
    return { slot, ...tot, watched: ids.length };
  } finally {
    await redis.eval(RELEASE, [K.lockPoll], [token]).catch(() => {});
  }
}

/** Daily housekeeping: prune stale watches, and ask GitHub Actions for a fresh snapshot if Pages data is old. */
export async function daily({ redis, env, fetchImpl, now = Date.now() }) {
  const pruned = await redis.cmd("ZREMRANGEBYSCORE", K.watch, "-inf", String(now - 30 * 864e5));
  let dispatched = false;
  if (env.PAGES_ORIGIN && env.GH_DISPATCH_TOKEN && env.GH_REPO) {
    try {
      const r = await fetchImpl(`${env.PAGES_ORIGIN.replace(/\/$/, "")}/data/snapshot.json`, { signal: AbortSignal.timeout(3000) });
      const snap = r.ok ? await r.json() : null;
      const age = snap?.generatedAt ? now - Date.parse(snap.generatedAt) : Infinity;
      if (age > 8 * 3600_000) {
        const d = await fetchImpl(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "trialsignal-worker" },
          body: JSON.stringify({ event_type: "snapshot" }),
        });
        dispatched = d.status === 204;
      }
    } catch { /* best effort */ }
  }
  return { pruned: Number(pruned), dispatched };
}
