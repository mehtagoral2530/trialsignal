// Shared, zero-dependency logic used by the Cloudflare Worker, the snapshot job and the tests.
// Everything here is pure and deterministic so every component computes identical hashes.

export const NCT_RE = /^NCT\d{8}$/;
export const isNct = (s) => typeof s === "string" && NCT_RE.test(s);

/* ---------- canonical JSON + hashing ---------- */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** 128-bit content hash of the tracked fields only (cosmetic registry edits never count as changes). */
export async function stateHash(tracked) {
  return (await sha256Hex(canonical(tracked))).slice(0, 32);
}

/* ---------- ClinicalTrials.gov v2 → tracked state ---------- */
export const TRACKED_FIELDS = "NCTId,BriefTitle,Acronym,OverallStatus,Phase,LeadSponsorName,LastUpdatePostDate,StartDate,PrimaryCompletionDate,CompletionDate,EnrollmentCount,EnrollmentType,Condition,InterventionName";
const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

/** Fields whose change matters to a reader. Order-independent; values normalised. */
export function trackedState(study) {
  const p = study?.protocolSection || {};
  return {
    status: get(p, "statusModule.overallStatus") || null,
    start: get(p, "statusModule.startDateStruct.date") || null,
    pcd: get(p, "statusModule.primaryCompletionDateStruct.date") || null,
    cd: get(p, "statusModule.completionDateStruct.date") || null,
    enroll: get(p, "designModule.enrollmentInfo.count") ?? null,
    enrollType: get(p, "designModule.enrollmentInfo.type") || null,
  };
}
/** Compact, display-ready summary of a v2 study (used in search results and the BM25 index). */
export function summarize(study) {
  const p = study?.protocolSection || {};
  return {
    nct: get(p, "identificationModule.nctId"),
    title: get(p, "identificationModule.briefTitle") || "",
    acronym: get(p, "identificationModule.acronym") || null,
    status: get(p, "statusModule.overallStatus") || null,
    phase: (get(p, "designModule.phases") || []).join(", ") || null,
    sponsor: get(p, "sponsorCollaboratorsModule.leadSponsor.name") || null,
    conditions: get(p, "conditionsModule.conditions") || [],
    interventions: (get(p, "armsInterventionsModule.interventions") || []).map((i) => i.name).filter(Boolean),
    summary: (get(p, "descriptionModule.briefSummary") || "").slice(0, 600),
    lastUpdate: get(p, "statusModule.lastUpdatePostDateStruct.date") || null,
    enrollment: get(p, "designModule.enrollmentInfo.count") ?? null,
  };
}
export const lastUpdate = (study) => get(study, "protocolSection.statusModule.lastUpdatePostDateStruct.date") || "";

/* ---------- query normalisation (cache keys) ---------- */
export function normalizeQuery(q, filters = {}) {
  let s = String(q || "").normalize("NFKC").toLowerCase().replace(/[’']/g, "").trim();
  const phrases = [];
  s = s.replace(/"([^"]+)"/g, (_, ph) => { phrases.push('"' + ph.trim().replace(/\s+/g, " ") + '"'); return " "; });
  const words = s.replace(/\b([a-z]{1,4})-(\d{2,6})\b/g, "$1$2").split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = [...new Set([...phrases, ...words])].sort();
  const f = Object.keys(filters).filter((k) => filters[k] != null && filters[k] !== "").sort().map((k) => `${k}=${String(filters[k]).toLowerCase()}`);
  return ["v1", tokens.join(" "), f.join("&"), "ps=25"].join("|");
}

/* ---------- BM25 ---------- */
const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the to was were will with who what how does do can study trial trials".split(" "));
export function tokenize(text) {
  return String(text || "").normalize("NFKC").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)).map(stem);
}
function stem(t) { // light stemmer: enough to match plurals and -ing/-ed forms
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 3 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}
export const FIELD_WEIGHTS = { title: 3, conditions: 2, interventions: 2, summary: 1 };
export function buildIndex(docs) {
  const N = docs.length, df = new Map(), lens = [], tfs = [];
  for (const d of docs) {
    const tf = new Map(); let len = 0;
    for (const [field, w] of Object.entries(FIELD_WEIGHTS)) {
      const v = Array.isArray(d[field]) ? d[field].join(" ") : d[field];
      for (const t of tokenize(v)) { tf.set(t, (tf.get(t) || 0) + w); len += w; }
    }
    tfs.push(tf); lens.push(len);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const avgdl = lens.reduce((a, b) => a + b, 0) / (N || 1);
  return { docs, df, lens, tfs, avgdl, N };
}
export function bm25Search(index, query, { k1 = 1.2, b = 0.75, limit = 50 } = {}) {
  const q = [...new Set(tokenize(query))];
  const out = [];
  index.tfs.forEach((tf, i) => {
    let s = 0;
    for (const t of q) {
      const f = tf.get(t); if (!f) continue;
      const n = index.df.get(t);
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * index.lens[i] / index.avgdl));
    }
    if (s > 0) out.push({ id: index.docs[i].nct, score: s });
  });
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, limit);
}

/* ---------- Reciprocal Rank Fusion ---------- */
export function rrf(lists, { k = 60 } = {}) {
  const score = new Map();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) || 0) + 1 / (k + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id, s]) => ({ id, score: s }));
}

/* ---------- heuristic reranker (fallback when no AI reranker) ---------- */
export function heuristicRerank(query, fused, docsById, { curated = new Set(), now = Date.now() } = {}) {
  const qTokens = new Set(tokenize(query));
  const phrase = String(query || "").toLowerCase().trim();
  return fused.map(({ id, score }) => {
    const d = docsById.get(id) || {};
    const title = String(d.title || "").toLowerCase();
    let s = score;
    if (phrase && title.includes(phrase)) s += 0.02;
    if (tokenize((d.conditions || []).join(" ")).some((t) => qTokens.has(t))) s += 0.01;
    if (curated.has(id)) s += 0.01;
    if (d.status === "RECRUITING") s += 0.005;
    if (d.lastUpdate && now - Date.parse(d.lastUpdate) < 90 * 864e5) s += 0.003;
    return { id, score: s };
  }).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

export const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };
