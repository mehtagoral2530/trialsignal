// Followed trials: kept in this browser, re-checked against the registry, and
// flagged when something meaningful changes.

import { store, fmtDate, num } from "./util.js";
import { statusLabel } from "./normalize.js";

const KEY = "ts.follow.v1";

// First-time visitors start out following three trials so the list shows how tracking works.
export const DEFAULT_FOLLOW = ["NCT03529110", "NCT05929066", "NCT03887455"];

// The fields we compare between checks.
export function trackFields(m) {
  return {
    status: m.status || "",
    lastUpdate: (m.dates && m.dates.lastUpdate) || "",
    primaryCompletion: (m.dates && m.dates.primaryCompletion) || "",
    enrollment: (m.enrollment && m.enrollment.count) ?? null,
    hasResults: !!m.hasResults,
    title: m.title || "",
    acronym: m.acronym || "",
    phase: m.phase || "",
  };
}

// What changed between the version the reader last saw and the latest check.
export function diff(seen, latest) {
  if (!seen || !latest) return [];
  const out = [];
  if (seen.status && latest.status && seen.status !== latest.status) {
    out.push({ kind: "status", text: `Status: ${statusLabel(seen.status)} → ${statusLabel(latest.status)}` });
  }
  if (!seen.hasResults && latest.hasResults) out.push({ kind: "results", text: "Results posted to the registry" });
  if (seen.primaryCompletion && latest.primaryCompletion && seen.primaryCompletion !== latest.primaryCompletion) {
    out.push({ kind: "date", text: `Main results date: ${fmtDate(seen.primaryCompletion)} → ${fmtDate(latest.primaryCompletion)}` });
  }
  if (seen.enrollment != null && latest.enrollment != null && seen.enrollment !== latest.enrollment) {
    out.push({ kind: "enrollment", text: `Enrollment: ${num(seen.enrollment)} → ${num(latest.enrollment)}` });
  }
  if (!out.length && seen.lastUpdate && latest.lastUpdate && seen.lastUpdate !== latest.lastUpdate) {
    out.push({ kind: "update", text: `Record updated ${fmtDate(latest.lastUpdate)}` });
  }
  return out;
}

// entries: { [nctId]: { added, seen, latest, checkedAt, error } }
export function createFollowStore({ snapshot = {}, storage = store } = {}) {
  let entries = storage.get(KEY, null);
  if (!entries) {
    entries = {};
    for (const id of DEFAULT_FOLLOW) {
      const s = snapshot[id];
      entries[id] = { added: Date.now(), seen: s ? trackFields(s) : null, latest: s ? trackFields(s) : null, checkedAt: 0 };
    }
  }
  const save = () => storage.set(KEY, entries);
  save();

  return {
    ids: () => Object.keys(entries),
    get: (id) => entries[id],
    has: (id) => !!entries[id],
    add(id, model) {
      const f = model ? trackFields(model) : null;
      entries[id] = { added: Date.now(), seen: f, latest: f, checkedAt: model ? Date.now() : 0 };
      save();
    },
    remove(id) {
      delete entries[id];
      save();
    },
    // Store the latest check. The first successful check also becomes the baseline.
    update(id, model, at = Date.now()) {
      const e = entries[id];
      if (!e) return;
      const f = trackFields(model);
      if (!e.seen) e.seen = f;
      e.latest = f;
      e.checkedAt = at;
      e.error = "";
      save();
    },
    fail(id, message) {
      if (entries[id]) entries[id].error = message;
      save();
    },
    markSeen(id) {
      const e = entries[id];
      if (e && e.latest) e.seen = { ...e.latest };
      save();
    },
    changes: (id) => diff(entries[id] && entries[id].seen, entries[id] && entries[id].latest),
    changedCount() {
      return Object.keys(entries).filter((id) => diff(entries[id].seen, entries[id].latest).length).length;
    },
    lastChecked() {
      const t = Object.values(entries).map((e) => e.checkedAt || 0);
      return t.length ? Math.min(...t) : 0;
    },
  };
}
