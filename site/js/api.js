// ClinicalTrials.gov API v2 client. The API allows cross-origin GET requests, so the
// browser calls it directly and no server is needed. Requests stay "simple" (plain GET,
// no custom headers) because the API rejects CORS preflight requests.

import { SITE } from "./config.js";
import { normalizeStudy } from "./normalize.js";

const BASE = "https://clinicaltrials.gov/api/v2";

const LIST_FIELDS = [
  "NCTId", "Acronym", "BriefTitle", "OverallStatus", "Phase", "StudyType", "LeadSponsorName",
  "Condition", "EnrollmentCount", "StartDate", "PrimaryCompletionDate", "LastUpdatePostDate", "HasResults",
  "StudyFirstPostDate", "ResultsFirstPostDate",
].join(",");

// "live" once a request succeeds, "offline" after a network failure.
export const live = { state: SITE.preview ? "offline" : "checking", lastOk: 0 };
const listeners = new Set();
export const onLiveChange = (fn) => listeners.add(fn);
function setState(state) {
  if (state === "live") live.lastOk = Date.now();
  if (live.state === state) return;
  live.state = state;
  listeners.forEach((fn) => fn(live));
}

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}

const cache = new Map();

async function get(path, params = {}, { ttl = 120_000, fresh = false, timeout = 15_000 } = {}) {
  if (SITE.preview) throw new ApiError("Live data is off in this preview.", { offline: true });
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const key = url.toString();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(key, { signal: ctrl.signal });
    if (res.status === 404) throw new ApiError("ClinicalTrials.gov has no study with that number.", { status: 404 });
    if (!res.ok) throw new ApiError(`ClinicalTrials.gov answered with an error (${res.status}). Try again in a minute.`, { status: res.status });
    const data = await res.json();
    cache.set(key, { at: Date.now(), data });
    setState("live");
    return data;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status !== 404) setState("live"); // the service answered, so the connection works
      throw e;
    }
    setState("offline");
    throw new ApiError("Couldn’t reach ClinicalTrials.gov. Check your connection and try again.", { offline: true });
  } finally {
    clearTimeout(timer);
  }
}

export async function getStudy(id, opts) {
  const raw = await get(`/studies/${id}`, { fields: "protocolSection,hasResults" }, opts);
  return normalizeStudy(raw);
}

// Several studies in one request, used to re-check followed trials.
export async function getStudies(ids, opts) {
  if (!ids.length) return {};
  const data = await get("/studies", { "filter.ids": ids.join(","), fields: LIST_FIELDS, pageSize: Math.min(ids.length, 1000) }, opts);
  const out = {};
  for (const raw of data.studies || []) {
    const m = normalizeStudy(raw);
    out[m.id] = m;
  }
  return out;
}

export async function searchStudies({ q, status = "", sort = "", pageToken = "", pageSize = 20 }) {
  const data = await get("/studies", {
    "query.term": q,
    "filter.overallStatus": status,
    sort: sort === "recent" ? "LastUpdatePostDate:desc" : "",
    countTotal: pageToken ? "" : "true",
    pageToken,
    pageSize,
    fields: LIST_FIELDS,
  });
  return { studies: (data.studies || []).map(normalizeStudy), total: data.totalCount ?? null, next: data.nextPageToken || "" };
}

const isoDaysAgo = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

// Phase 2 and 3 trials for a condition whose registry record changed recently.
export async function recentChanges({ cond, days = 30, size = 8 }) {
  const data = await get("/studies", {
    "query.cond": cond,
    "filter.advanced": `AREA[LastUpdatePostDate]RANGE[${isoDaysAgo(days)},MAX] AND (AREA[Phase]PHASE2 OR AREA[Phase]PHASE3)`,
    sort: "LastUpdatePostDate:desc",
    countTotal: "true",
    pageSize: size,
    fields: LIST_FIELDS,
  });
  return { studies: (data.studies || []).map(normalizeStudy), total: data.totalCount ?? null };
}

// Number of interventional trials recruiting right now.
export async function recruitingCount() {
  const data = await get(
    "/studies",
    { "filter.overallStatus": "RECRUITING", "filter.advanced": "AREA[StudyType]INTERVENTIONAL", countTotal: "true", pageSize: 1, fields: "NCTId" },
    { ttl: 600_000 },
  );
  return data.totalCount ?? null;
}

// ── live pulse ───────────────────────────────────────────────────────
// When the registry last refreshed its data (it publishes once a day, Monday to Friday).
export async function registryStatus(opts) {
  const data = await get("/version", {}, { ttl: 60_000, ...opts });
  return { dataTimestamp: data.dataTimestamp || "", apiVersion: data.apiVersion || "" };
}

// Number of studies matching an Essie expression, e.g. AREA[OverallStatus]RECRUITING.
export async function countWhere(expr, opts) {
  const data = await get("/studies", { "filter.advanced": expr, countTotal: "true", pageSize: 1, fields: "NCTId" }, { ttl: 60_000, ...opts });
  return data.totalCount ?? null;
}

const FEEDS = {
  updated: { date: "LastUpdatePostDate", sort: "LastUpdatePostDate:desc" },
  new: { date: "StudyFirstPostDate", sort: "StudyFirstPostDate:desc" },
  results: { date: "ResultsFirstPostDate", sort: "ResultsFirstPostDate:desc" },
};

// Newest registry activity of one kind, optionally narrowed to a condition and phases.
export async function feed({ kind = "updated", since, cond = "", phases = [], interventional = true, size = 8 }, opts) {
  const f = FEEDS[kind];
  const parts = [`AREA[${f.date}]RANGE[${since},MAX]`];
  if (interventional) parts.push("AREA[StudyType]INTERVENTIONAL");
  if (phases.length) parts.push(`(${phases.map((p) => `AREA[Phase]${p}`).join(" OR ")})`);
  const data = await get("/studies", {
    "query.cond": cond,
    "filter.advanced": parts.join(" AND "),
    sort: f.sort,
    countTotal: "true",
    pageSize: size,
    fields: LIST_FIELDS,
  }, { ttl: 30_000, ...opts });
  return { studies: (data.studies || []).map(normalizeStudy), total: data.totalCount ?? null };
}
