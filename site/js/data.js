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
  countsStamp: "", // registry dataTimestamp the counts were fetched under
  totalStamp: "",
  areaCounts: {}, // area → { today, new7, results7 }
  days: {}, // metric → { "YYYY-MM-DD": n }
  feeds: {}, // key → rows
  next: {}, // key → page token
  feedStamp: {}, // key → registry dataTimestamp the feed was fetched under
  lib: {}, // id → status model for library and followed trials
  libAt: 0,
  libStamp: "",
  records: {}, // id → full live record
  recordAt: {},
  recordStamp: {}, // id → registry dataTimestamp the record was fetched under
  savedKeys: new Set(), // feed keys whose rows came from the saved copy
  saved: false, // true while showing the saved copy
};

export const follow = createFollowStore({ snapshot: SNAPSHOT, snapshotDate: SNAPSHOT_DATE });

const subs = new Set();
export const onData = (fn) => subs.add(fn);
const emit = (what) => subs.forEach((fn) => fn(what));

const swallow = () => {};

// ── saved copy ───────────────────────────────────────────────────────
export function useSaved() {
  D.saved = true;
  D.counts = { ...PULSE.counts };
  D.countsStamp = "";
  D.totalStamp = "";
  D.areaCounts = {};
  D.days = { ...PULSE.days };
  D.feeds = {};
  D.savedKeys = new Set();
  for (const m of ["updated", "new", "results"]) {
    D.feeds[`home:${m}`] = PULSE.feeds[m].slice(0, 4);
    D.feeds[`updates:${m}:all`] = PULSE.feeds[m].slice(0, 8);
    D.savedKeys.add(`home:${m}`).add(`updates:${m}:all`);
  }
  D.next = {};
  D.feedStamp = {};
  D.lib = { ...SNAPSHOT };
  D.libAt = 0;
  D.libStamp = "";
  emit("saved");
}

// Before live data replaces the saved copy (first load, or the connection is back),
// or after a registry refresh: drop cached live data so nothing old shows as live.
// keep: feed keys to hold on to, so rows that really arrived can be marked NEW.
// Counts from the saved copy are dropped too; counts from an earlier live refresh stay
// on screen (so new numbers can count up from them) and are refetched because their
// stamp is out of date.
export function clearLive({ keep = [] } = {}) {
  for (const k of Object.keys(D.feeds)) {
    if (!keep.includes(k) || D.savedKeys.has(k)) { delete D.feeds[k]; delete D.next[k]; delete D.feedStamp[k]; }
  }
  if (D.saved) { D.counts = {}; D.countsStamp = ""; D.totalStamp = ""; }
  D.saved = false;
  D.savedKeys = new Set();
  D.days = {};
  D.areaCounts = {};
}

// True when this piece of live data was fetched under an earlier registry refresh.
export const isStale = (stamp) => stamp !== L.stamp;
export const feedStale = (key) => !D.feeds[key] || isStale(D.feedStamp[key]);

// ── live loaders ─────────────────────────────────────────────────────
export async function loadCounts() {
  const stamp = L.stamp;
  const [c, recruiting] = await Promise.all([api.counts(L.day), api.recruitingCount()]);
  Object.assign(D.counts, c, { recruiting });
  D.countsStamp = stamp;
  emit("counts");
}

export async function loadTotal() {
  if (D.totalStamp === L.stamp && D.counts.total != null) return;
  const stamp = L.stamp;
  D.counts.total = await api.totalCount();
  D.totalStamp = stamp;
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
  // Rows from the saved copy are never compared with live rows: that would mark rows
  // the reader has already seen as NEW.
  const prev = D.savedKeys.has(key) ? null : D.feeds[key];
  const stamp = L.stamp;
  const r = await api.feed(metric, { area: area === "all" ? "" : area, size: scope === "home" ? 4 : 8, pageToken: append ? D.next[key] : "" });
  D.feeds[key] = append && prev ? [...prev, ...r.rows] : r.rows;
  D.next[key] = r.next;
  if (!append) D.feedStamp[key] = stamp;
  D.savedKeys.delete(key);
  const fresh = !append && prev ? r.rows.filter((x) => !prev.some((p) => p.id === x.id)).map((x) => x.id) : [];
  emit("feed");
  return fresh;
}

export async function loadStatuses() {
  const ids = [...new Set([...LIBRARY.map((t) => t.id), ...follow.ids()])];
  const stamp = L.stamp;
  const map = await api.statuses(ids);
  D.lib = map;
  D.libAt = Date.now();
  D.libStamp = stamp;
  for (const id of follow.ids()) {
    if (map[id]) follow.update(id, map[id], D.libAt);
    else follow.fail(id, "ClinicalTrials.gov didn’t return this trial.");
  }
  emit("lib");
}

// Everything a registry refresh can change. Each part fails on its own.
export async function refreshAll(metric = "updated") {
  await Promise.allSettled([loadCounts(), loadStatuses(), loadDays(metric)]);
}

// ── single trials ────────────────────────────────────────────────────
// stale: fetched before the registry's latest refresh, so it should be fetched again.
export function record(id) {
  if (D.records[id]) return { model: D.records[id], live: true, at: D.recordAt[id], stale: D.recordStamp[id] !== L.stamp };
  if (SNAPSHOT[id]) return { model: SNAPSHOT[id], live: false, at: 0, stale: false };
  return { model: null, live: false, at: 0, stale: false };
}

export async function loadRecord(id) {
  const stamp = L.stamp;
  const m = await api.study(id);
  D.records[id] = m;
  D.recordAt[id] = Date.now();
  D.recordStamp[id] = stamp;
  emit("record");
  return m;
}

// A trial known only from a feed row (newest registry activity), for a reduced page
// when the full record can't be fetched.
export function feedRowFor(id) {
  for (const rows of [...Object.values(D.feeds), ...Object.values(PULSE.feeds)]) {
    const r = (rows || []).find((x) => x.id === id);
    if (r) return r;
  }
  return null;
}

// Status for a library or followed trial: live if fetched, else from the saved copy.
export const statusOf = (id) => D.lib[id] || SNAPSHOT[id] || null;

export { swallow };
