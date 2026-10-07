// ClinicalTrials.gov API v2 client. The API allows cross-origin GET requests, so the
// browser calls it directly and no server is needed. Requests stay "simple" (plain GET,
// no custom headers) because the API rejects CORS preflight requests.

import { SITE } from "./config.js";
import { normalizeStudy, feedRow } from "./normalize.js";
import { addDays, store } from "./util.js";

const BASE = "https://clinicaltrials.gov/api/v2";

export const FEED_FIELDS = "NCTId,Acronym,BriefTitle,OverallStatus,Phase,LeadSponsorName,Condition,LastUpdatePostDate,StudyFirstPostDate,ResultsFirstPostDate";
// Everything the library rows and change tracking need, in one request.
const STATUS_FIELDS = "NCTId,Acronym,BriefTitle,OverallStatus,Phase,EnrollmentCount,PrimaryCompletionDate,LastUpdatePostDate,ResultsFirstPostDate,HasResults,Condition,LeadSponsorName";

export const METRICS = {
  updated: { field: "LastUpdatePostDate", count: "today" },
  new: { field: "StudyFirstPostDate", count: "new7" },
  results: { field: "ResultsFirstPostDate", count: "results7" },
};

// Registry searches for the five library areas.
export const AREA_COND = {
  metabolic: "obesity OR diabetes",
  heart: "heart OR kidney OR cardiovascular",
  brain: "alzheimer OR parkinson OR sclerosis OR migraine OR dementia OR stroke",
  cancer: "cancer OR tumor OR lymphoma OR leukemia OR carcinoma",
  infection: "infection OR vaccine OR virus OR HIV",
};

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}

const cache = new Map();

export async function get(path, params = {}, { ttl = 0, timeout = 10_000 } = {}) {
  if (SITE.preview) throw new ApiError("Live data is off in this preview.", { offline: true });
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const key = url.toString();
  const hit = cache.get(key);
  if (ttl && hit && Date.now() - hit.at < ttl) return hit.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(key, { signal: ctrl.signal });
    if (res.status === 404) throw new ApiError("ClinicalTrials.gov has no study with that number.", { status: 404 });
    if (!res.ok) throw new ApiError(`ClinicalTrials.gov answered with an error (${res.status}).`, { status: res.status });
    const data = await res.json();
    if (ttl) cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Couldn’t reach ClinicalTrials.gov.", { offline: true });
  } finally {
    clearTimeout(timer);
  }
}

// When the registry last published its data (US Eastern time, no offset).
export const version = () => get("/version");

export const count = (expr, extra = {}) =>
  get("/studies", { countTotal: "true", pageSize: 1, fields: "NCTId", ...(expr ? { "filter.advanced": expr } : {}), ...extra }).then((j) => j.totalCount ?? null);

// The headline counts, measured against the registry's own refresh day.
export async function counts(day, { cond = "" } = {}) {
  const week = addDays(day, -6);
  const extra = cond ? { "query.cond": cond } : {};
  const [today, new7, results7] = await Promise.all([
    count(`AREA[LastUpdatePostDate]RANGE[${day},MAX]`, extra),
    count(`AREA[StudyFirstPostDate]RANGE[${week},MAX]`, extra),
    count(`AREA[ResultsFirstPostDate]RANGE[${week},MAX]`, extra),
  ]);
  return { today, new7, results7 };
}
export const recruitingCount = () => count("AREA[OverallStatus]RECRUITING AND AREA[StudyType]INTERVENTIONAL");
export const totalCount = () => count("");

// One count per day for the last 14 days, cached per registry refresh.
export async function days(metric, day, stamp) {
  const key = `ts.days.${metric}`;
  const hit = store.get(key, null);
  if (hit && hit.stamp === stamp) return hit.vals;
  const field = METRICS[metric].field;
  const list = Array.from({ length: 14 }, (_, i) => addDays(day, i - 13));
  const vals = {};
  await Promise.all(list.map(async (d) => { vals[d] = await count(`AREA[${field}]RANGE[${d},${d}]`); }));
  store.set(key, { stamp, vals });
  return vals;
}

// The newest registry activity of one kind.
export async function feed(metric, { area = "", size = 8, pageToken = "" } = {}) {
  const j = await get("/studies", {
    sort: `${METRICS[metric].field}:desc`,
    "query.cond": area ? AREA_COND[area] : "",
    pageSize: size,
    pageToken,
    fields: FEED_FIELDS,
  });
  return { rows: (j.studies || []).map((s) => feedRow(normalizeStudy(s))), next: j.nextPageToken || "" };
}

// Status, dates and enrollment for many trials in one request.
export async function statuses(ids) {
  if (!ids.length) return {};
  const j = await get("/studies", { "filter.ids": ids.join(","), pageSize: Math.min(ids.length, 1000), fields: STATUS_FIELDS });
  return Object.fromEntries((j.studies || []).map((s) => { const m = normalizeStudy(s); return [m.id, m]; }));
}

// Full-text search across the registry, plus how many of the matches are recruiting.
export async function search(q, { recruiting = false, newest = false, pageToken = "", size = 10 } = {}) {
  const isId = /^NCT\d{8}$/i.test(q);
  const base = isId ? { "filter.ids": q.toUpperCase() } : { "query.term": q };
  const [list, open] = await Promise.all([
    get("/studies", {
      ...base,
      "filter.overallStatus": recruiting ? "RECRUITING" : "",
      sort: newest ? "LastUpdatePostDate:desc" : "",
      countTotal: pageToken ? "" : "true",
      pageSize: size,
      pageToken,
      fields: FEED_FIELDS,
    }),
    isId || pageToken ? Promise.resolve(null) : count("", { ...base, "filter.overallStatus": "RECRUITING" }),
  ]);
  return { rows: (list.studies || []).map((s) => feedRow(normalizeStudy(s))), total: list.totalCount ?? null, recruiting: open, next: list.nextPageToken || "" };
}

// One full record, with group sizes when results are posted.
export async function study(id) {
  const raw = await get(`/studies/${id}`, {
    fields: "protocolSection,hasResults,resultsSection.baselineCharacteristicsModule.groups,resultsSection.baselineCharacteristicsModule.denoms",
  });
  return normalizeStudy(raw);
}
