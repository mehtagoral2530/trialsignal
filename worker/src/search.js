// Hybrid search: BM25 (local index) + ClinicalTrials.gov relevance + optional dense embeddings,
// fused with Reciprocal Rank Fusion, then reranked (Workers AI cross-encoder, or a heuristic fallback).
import { normalizeQuery, sha256Hex, buildIndex, bm25Search, rrf, heuristicRerank, cosine, summarize, isNct, TRACKED_FIELDS } from "../../shared/core.js";
import { SEED_DOCS } from "../../shared/index-seed.js";
import { CURATED } from "../../shared/curated.js";
import { K, ttl24h, QUERY_FRESH_MS } from "./keys.js";
import { ctGet } from "./ctgov.js";

const AI_DAILY_CAP = 300;
const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
const RERANK_MODEL = "@cf/baai/bge-reranker-base";
const CURATED_SET = new Set(CURATED);

let INDEX = null, INDEX_AT = 0;
/** Load the BM25 corpus once per isolate: snapshot index from Pages, falling back to the bundled seed. */
export async function loadIndex(env, fetchImpl, now = Date.now()) {
  if (INDEX && now - INDEX_AT < 3600_000) return INDEX;
  let docs = SEED_DOCS;
  if (env.PAGES_ORIGIN) {
    try {
      const r = await fetchImpl(`${env.PAGES_ORIGIN.replace(/\/$/, "")}/data/index.json`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.docs) && j.docs.length) docs = mergeDocs(SEED_DOCS, j.docs); }
    } catch { /* keep seed */ }
  }
  INDEX = buildIndex(docs); INDEX_AT = now;
  return INDEX;
}
export const resetIndex = () => { INDEX = null; };
function mergeDocs(a, b) { const m = new Map(); for (const d of [...a, ...b]) if (d && d.nct) m.set(d.nct, { ...m.get(d.nct), ...d }); return [...m.values()]; }

async function aiAllowed(redis, now) {
  if (!redis) return true;
  const day = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  try { const [n] = await redis.pipeline([["INCR", K.ai(day)], ["EXPIRE", K.ai(day), 172800]]); return Number(n) <= AI_DAILY_CAP; } catch { return false; }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const docText = (d) => `${d.title}. ${(d.conditions || []).join(", ")}. ${(d.summary || "").slice(0, 400)}`;

/** Compute results (no caching). Returns {results, degraded}. */
export async function computeSearch({ q, filters, env, redis, fetchImpl, now }) {
  const degraded = [];
  const index = await loadIndex(env, fetchImpl, now);
  const docs = new Map(index.docs.map((d) => [d.nct, d]));

  const lexical = bm25Search(index, q, { limit: 50 }).map((r) => r.id);

  let registry = [];
  try {
    const params = { "query.term": q, pageSize: 25, format: "json", fields: TRACKED_FIELDS + ",BriefSummary", countTotal: "false" };
    const adv = [];
    if (filters.status) adv.push(`AREA[OverallStatus]${filters.status.toUpperCase()}`);
    if (filters.phase) adv.push(`AREA[Phase]${filters.phase.toUpperCase()}`);
    if (adv.length) params["filter.advanced"] = adv.join(" AND ");
    const j = await ctGet("studies", params, { redis, fetchImpl, now });
    for (const s of j.studies || []) { const d = summarize(s); if (d.nct) { docs.set(d.nct, { ...docs.get(d.nct), ...d }); registry.push(d.nct); } }
  } catch (e) { degraded.push(`registry:${e.code || "error"}`); }

  let dense = [];
  const pool = [...new Set([...lexical.slice(0, 30), ...registry])].slice(0, 50);
  if (env.AI && pool.length > 1 && (await aiAllowed(redis, now))) {
    try {
      const out = await withTimeout(env.AI.run(EMBED_MODEL, { text: [q, ...pool.map((id) => docText(docs.get(id)))] }), 1500);
      const [qv, ...dv] = out.data;
      dense = pool.map((id, i) => ({ id, s: cosine(qv, dv[i]) })).sort((a, b) => b.s - a.s).map((x) => x.id);
    } catch { degraded.push("dense"); }
  } else if (env.AI) degraded.push("dense:budget");

  let fused = rrf([lexical, registry, dense].filter((l) => l.length));
  const exact = q.toUpperCase().match(/NCT\d{8}/);
  if (exact) fused = [{ id: exact[0], score: Infinity }, ...fused.filter((f) => f.id !== exact[0])];

  const head = fused.slice(0, 30), tail = fused.slice(30);
  let ranked = null;
  if (env.AI && head.length > 1 && (await aiAllowed(redis, now))) {
    try {
      const out = await withTimeout(env.AI.run(RERANK_MODEL, { query: q, contexts: head.map((f) => ({ text: docText(docs.get(f.id) || { title: f.id }) })) }), 800);
      const scores = new Map((out.response || []).map((r) => [r.id, r.score]));
      ranked = head.map((f, i) => ({ id: f.id, score: f.score === Infinity ? Infinity : (scores.get(i) ?? -1) })).sort((a, b) => b.score - a.score);
    } catch { degraded.push("rerank"); }
  }
  if (!ranked) ranked = heuristicRerank(q, head, docs, { curated: CURATED_SET, now });
  const results = [...ranked, ...tail].slice(0, 25).map((r) => docs.get(r.id) || { nct: r.id }).filter((d) => isNct(d.nct))
    .map((d) => ({ nct: d.nct, title: d.title, acronym: d.acronym || null, status: d.status || null, phase: d.phase || null, conditions: d.conditions || [], interventions: d.interventions || [], lastUpdate: d.lastUpdate || null, curated: CURATED_SET.has(d.nct) }));
  return { results, degraded };
}

/** Cached search: 24h Redis TTL, fresh for 1h, stale-while-revalidate behind a single-flight lock. */
export async function search({ q, filters = {}, env, redis, fetchImpl, now = Date.now(), waitUntil = () => {} }) {
  const canon = normalizeQuery(q, filters);
  const h = await sha256Hex(canon);
  if (redis) {
    try {
      const hit = await redis.cmd("GET", K.query(h));
      if (hit) {
        const entry = JSON.parse(hit);
        const age = now - entry.at;
        if (age > QUERY_FRESH_MS) waitUntil(refresh({ q, filters, env, redis, fetchImpl, h }));
        return { ...entry, cache: age > QUERY_FRESH_MS ? "stale" : "hit" };
      }
    } catch { /* fall through: compute without cache */ }
  }
  const { results, degraded } = await computeSearch({ q, filters, env, redis, fetchImpl, now });
  const entry = { at: now, q, results, degraded };
  if (redis && !degraded.some((d) => d.startsWith("registry"))) {
    try { await redis.cmd("SET", K.query(h), JSON.stringify(entry), "EX", ttl24h()); } catch { /* cache is best-effort */ }
  }
  return { ...entry, cache: "miss" };
}

async function refresh({ q, filters, env, redis, fetchImpl, h }) {
  try {
    const got = await redis.cmd("SET", K.lockQuery(h), "1", "NX", "EX", 30);
    if (got !== "OK") return; // someone else is refreshing
    const now = Date.now();
    const { results, degraded } = await computeSearch({ q, filters, env, redis, fetchImpl, now });
    if (!degraded.some((d) => d.startsWith("registry"))) await redis.cmd("SET", K.query(h), JSON.stringify({ at: now, q, results, degraded }), "EX", ttl24h());
  } catch { /* stale entry keeps serving */ }
}
