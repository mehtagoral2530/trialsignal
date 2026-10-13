// TrialSignal API — Cloudflare Worker (zero runtime dependencies).
// Routes:
//   GET  /v1/health
//   GET  /v1/search?q=&status=&phase=
//   GET  /v1/studies/{NCT}          (ETag = content hash; 304 on If-None-Match)
//   GET  /v1/changes?since=<epoch>.<seq>   (ETag W/"epoch.seq"; 410 when the cursor's epoch is gone)
//   GET  /v1/state?ids=NCT..,NCT..   (≤50 ids, current tracked state)
//   POST /v1/watch {ids:[...]}       (requires Idempotency-Key header)
import { Upstash } from "./redis.js";
import { K, ttl24h } from "./keys.js";
import { ctGet } from "./ctgov.js";
import { search } from "./search.js";
import { poll, daily, ensureEpoch, rowsFromStudies } from "./poll.js";
import { isNct, trackedState, stateHash } from "../../shared/core.js";

export const VERSION = "2.0.0";

function cors(env, extra = {}) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match, Idempotency-Key",
    "Access-Control-Expose-Headers": "ETag",
    Vary: "Origin",
    ...extra,
  };
}
const json = (env, body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: cors(env, { "Content-Type": "application/json; charset=utf-8", ...headers }) });
const err = (env, status, code, message) => json(env, { error: { code, message } }, status, { "Cache-Control": "no-store" });

export function makeRedis(env, fetchImpl) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  try { return new Upstash(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN, { fetchImpl }); } catch { return null; }
}

/** Core request handler; dependencies injectable for tests. */
export async function handle(request, env, ctx = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const redis = deps.redis !== undefined ? deps.redis : makeRedis(env, fetchImpl);
  const now = deps.now ? deps.now() : Date.now();
  const waitUntil = (p) => (ctx.waitUntil ? ctx.waitUntil(p) : p);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, { "Access-Control-Max-Age": "86400" }) });

  try {
    if (request.method === "GET" && path === "/v1/health") {
      let redisOk = false;
      if (redis) { try { redisOk = (await redis.cmd("PING")) === "PONG"; } catch {} }
      return json(env, { ok: true, version: VERSION, redis: redisOk, ai: !!env.AI }, 200, { "Cache-Control": "no-store" });
    }

    if (request.method === "GET" && path === "/v1/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
      if (q.length < 2) return err(env, 400, "bad_query", "Type at least two characters.");
      const filters = { status: url.searchParams.get("status") || "", phase: url.searchParams.get("phase") || "" };
      for (const v of Object.values(filters)) if (v && !/^[A-Z0-9_]{1,30}$/i.test(v)) return err(env, 400, "bad_filter", "Unknown filter value.");
      const out = await search({ q, filters, env, redis, fetchImpl, now, waitUntil });
      return json(env, { query: q, asOf: new Date(out.at).toISOString(), cache: out.cache, degraded: out.degraded, results: out.results }, 200, { "Cache-Control": "public, max-age=60, s-maxage=600" });
    }

    let m;
    if (request.method === "GET" && (m = path.match(/^\/v1\/studies\/(NCT\d{8})$/i))) {
      const nct = m[1].toUpperCase();
      let rec = null, raw = null;
      if (redis) {
        try { const s = await redis.cmd("GET", K.study(nct)); rec = s ? JSON.parse(s) : null; } catch {}
        if (rec?.hash) { try { const r = await redis.cmd("GET", K.raw(nct, rec.hash)); raw = r ? JSON.parse(r) : null; } catch {} }
      }
      let source = "cache";
      if (!raw) {
        raw = await ctGet(`studies/${nct}`, { format: "json" }, { redis, fetchImpl, now });
        source = "registry";
        const state = trackedState(raw), hash = await stateHash(state);
        rec = { ...(rec || {}), ...state, hash };
        if (redis) { try { await redis.cmd("SET", K.raw(nct, hash), JSON.stringify(raw), "EX", ttl24h()); } catch {} }
      }
      const etag = `"${rec.hash}"`;
      if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: cors(env, { ETag: etag }) });
      return json(env, { nct, hash: rec.hash, state: rec, raw, asOf: new Date(now).toISOString(), source }, 200, { ETag: etag, "Cache-Control": "public, max-age=300, s-maxage=900" });
    }

    if (request.method === "GET" && path === "/v1/changes") {
      if (!redis) return err(env, 503, "redis_unavailable", "Live changes are unavailable; use the static snapshot.");
      const epoch = await ensureEpoch(redis);
      const since = url.searchParams.get("since") || "";
      let after = 0;
      if (since) {
        const [e, s] = since.split(".");
        if (e !== epoch) return json(env, { error: { code: "resync", message: "The change history was rebuilt. Re-check saved studies with /v1/state." }, epoch, next: `${epoch}.0` }, 410, { "Cache-Control": "no-store" });
        after = Number(s) || 0;
      }
      const rows = await redis.cmd("ZRANGEBYSCORE", K.feed, `(${after}`, "+inf", "LIMIT", 0, 200);
      const entries = (rows || []).map((r) => JSON.parse(r)).map((e) => ({ ...e, fields: Array.isArray(e.fields) ? e.fields : [] }));
      const next = entries.length ? Math.max(...entries.map((e) => e.seq)) : after;
      const etag = `W/"${epoch}.${next}"`;
      if (!entries.length && request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: cors(env, { ETag: etag }) });
      return json(env, { epoch, next: `${epoch}.${next}`, more: entries.length === 200, entries }, 200, { ETag: etag, "Cache-Control": "public, max-age=30, s-maxage=60" });
    }

    if (request.method === "GET" && path === "/v1/state") {
      const ids = [...new Set((url.searchParams.get("ids") || "").toUpperCase().split(",").filter(Boolean))].sort();
      if (!ids.length || ids.length > 50 || !ids.every(isNct)) return err(env, 400, "bad_ids", "Send 1 to 50 study numbers like NCT04184622.");
      if (!redis) return err(env, 503, "redis_unavailable", "Live state is unavailable.");
      const vals = await redis.cmd("MGET", ...ids.map(K.study));
      const state = Object.fromEntries(ids.map((id, i) => [id, vals[i] ? JSON.parse(vals[i]) : null]));
      return json(env, { state }, 200, { "Cache-Control": "public, max-age=60" });
    }

    if (request.method === "POST" && path === "/v1/watch") {
      if (!redis) return err(env, 503, "redis_unavailable", "Saving for live updates is unavailable right now.");
      const key = request.headers.get("Idempotency-Key") || "";
      if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return err(env, 400, "missing_idempotency_key", "Send an Idempotency-Key header (a UUID).");
      const text = await request.text();
      if (text.length > 4096) return err(env, 413, "too_large", "Request is too large.");
      let body; try { body = JSON.parse(text); } catch { return err(env, 400, "bad_json", "Body must be JSON."); }
      const ids = [...new Set((body.ids || []).map((x) => String(x).toUpperCase()))];
      if (!ids.length || ids.length > 50 || !ids.every(isNct)) return err(env, 400, "bad_ids", "Send 1 to 50 study numbers like NCT04184622.");
      const claimed = await redis.cmd("SET", K.idem(key), "pending", "NX", "EX", 60); // short lease: a crash mid-request frees the key quickly
      if (claimed !== "OK") {
        const prev = await redis.cmd("GET", K.idem(key));
        if (prev === "pending") return err(env, 409, "in_progress", "The same request is still being processed.");
        return json(env, JSON.parse(prev), 200, { "Idempotent-Replayed": "true" });
      }
      const res = { watched: ids, at: new Date(now).toISOString() };
      // Atomic: the watch update and the stored response commit together.
      await redis.multi([["ZADD", K.watch, ...ids.flatMap((id) => [now, id])], ["SET", K.idem(key), JSON.stringify(res), "EX", 86400]]);
      return json(env, res, 200);
    }

    return err(env, 404, "not_found", "Unknown endpoint.");
  } catch (e) {
    if (e.code === "not_found") return err(env, 404, "not_found", e.message);
    if (e.code === "rate" || e.code === "breaker") return err(env, 503, e.code, e.message);
    return err(env, 502, e.code || "error", e.message || "Something went wrong.");
  }
}

/** Edge-cache GETs that are safe to share (search, studies, changes). */
async function withEdgeCache(request, env, ctx, fn) {
  const cacheable = request.method === "GET" && /^\/v1\/(search|studies|changes)/.test(new URL(request.url).pathname) && !request.headers.get("If-None-Match");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cacheable && cache) { const hit = await cache.match(request); if (hit) return hit; }
  const res = await fn();
  if (cacheable && cache && res.status === 200) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

export default {
  fetch(request, env, ctx) { return withEdgeCache(request, env, ctx, () => handle(request, env, ctx)); },
  async scheduled(event, env, ctx) {
    const redis = makeRedis(env);
    if (!redis) return;
    if (event.cron === "7 3 * * *") ctx.waitUntil(daily({ redis, env, fetchImpl: (...a) => fetch(...a) }));
    else ctx.waitUntil(poll({ redis, fetchImpl: (...a) => fetch(...a), scheduledTime: event.scheduledTime }));
  },
};
export { poll, daily, rowsFromStudies };
