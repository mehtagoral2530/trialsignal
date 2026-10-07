// What the pages show: live data from ClinicalTrials.gov when it can be reached,
// otherwise the saved copy in data/snapshot.js. Views read from D and re-render when
// onData() fires.

import * as api from "./api.js";
import { L } from "./live.js";
import { createFollowStore } from "./tracking.js";
import { SNAPSHOT, SNAPSHOT_DATE, PULSE } from "../data/snapshot.js";
import { LIBRARY } from "../data/library.js";

export { SNAPSHOT, SNAPSHOT_DATE, PULSE };

export const D = {
  counts: {}, // today, new7, results7, recruiting, total
  areaCounts: {}, // area → { today, new7, results7 }
  days: {}, // metric → { "YYYY-MM-DD": n }
  feeds: {}, // key → rows
  next: {}, // key → page token
  lib: {}, // id → status model for library and followed trials
  libAt: 0,
  records: {}, // id → full live record
  recordAt: {},
  saved: false, // true while showing the saved copy
};

export const follow = createFollowStore({ snapshot: SNAPSHOT });

const subs = new Set();
export const onData = (fn) => subs.add(fn);
const emit = (what) => subs.forEach((fn) => fn(what));

const swallow = () => {};

// ── saved copy ───────────────────────────────────────────────────────
export function useSaved() {
  D.saved = true;
  D.counts = { ...PULSE.counts };
  D.areaCounts = {};
  D.days = { ...PULSE.days };
  D.feeds = {};
  for (const m of ["updated", "new", "results"]) {
    D.feeds[`home:${m}`] = PULSE.feeds[m].slice(0, 4);
    D.feeds[`updates:${m}:all`] = PULSE.feeds[m].slice(0, 8);
  }
  D.next = {};
  D.lib = { ...SNAPSHOT };
  emit("saved");
}

// ── live loaders ─────────────────────────────────────────────────────
export async function loadCounts() {
  const [c, recruiting] = await Promise.all([api.counts(L.day), api.recruitingCount()]);
  Object.assign(D.counts, c, { recruiting });
  D.saved = false;
  emit("counts");
}

export async function loadTotal() {
  if (D.totalStamp === L.stamp && D.counts.total != null) return;
  D.counts.total = await api.totalCount();
  D.totalStamp = L.stamp;
  emit("total");
}

export async function loadAreaCounts(area) {
  if (area === "all") return;
  D.areaCounts[area] = await api.counts(L.day, { cond: api.AREA_COND[area] });
  emit("areaCounts");
}

export async function loadDays(metric) {
  D.days[metric] = await api.days(metric, L.day, L.stamp);
  emit("days");
}

export const feedKey = (scope, metric, area = "all") => (scope === "home" ? `home:${metric}` : `updates:${metric}:${area}`);

// Returns the ids that were not in the previous version of this feed (new arrivals).
export async function loadFeed(scope, metric, area = "all", { append = false } = {}) {
  const key = feedKey(scope, metric, area);
  const prev = D.feeds[key];
  const r = await api.feed(metric, { area: area === "all" ? "" : area, size: scope === "home" ? 4 : 8, pageToken: append ? D.next[key] : "" });
  D.feeds[key] = append && prev ? [...prev, ...r.rows] : r.rows;
  D.next[key] = r.next;
  const fresh = !append && prev ? r.rows.filter((x) => !prev.some((p) => p.id === x.id)).map((x) => x.id) : [];
  emit("feed");
  return fresh;
}

export async function loadStatuses() {
  const ids = [...new Set([...LIBRARY.map((t) => t.id), ...follow.ids()])];
  const map = await api.statuses(ids);
  D.lib = map;
  D.libAt = Date.now();
  for (const id of follow.ids()) {
    if (map[id]) follow.update(id, map[id], D.libAt);
    else follow.fail(id, "ClinicalTrials.gov didn’t return this trial.");
  }
  emit("lib");
}

// Everything a registry refresh can change. Each part fails on its own.
export async function refreshAll(metric = "updated") {
  D.saved = false;
  await Promise.allSettled([loadCounts(), loadStatuses(), loadDays(metric)]);
}

// ── single trials ────────────────────────────────────────────────────
export function record(id) {
  if (D.records[id]) return { model: D.records[id], live: true, at: D.recordAt[id] };
  if (SNAPSHOT[id]) return { model: SNAPSHOT[id], live: false, at: 0 };
  return { model: null, live: false, at: 0 };
}

export async function loadRecord(id) {
  const m = await api.study(id);
  D.records[id] = m;
  D.recordAt[id] = Date.now();
  emit("record");
  return m;
}

// Status for a library or followed trial: live if fetched, else from the saved copy.
export const statusOf = (id) => D.lib[id] || SNAPSHOT[id] || null;

export { swallow };
