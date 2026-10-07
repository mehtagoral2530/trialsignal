// Followed trials: kept in this browser, re-checked against the registry, and
// flagged when something meaningful changes.

import { store, fmtDate, num, addDays, dayDiff } from "./util.js";
import { statusLabel } from "./normalize.js";

const KEY = "ts.follow.v2";
const OLD_KEY = "ts.follow.v1";

// First-time visitors start out following three trials so the list shows how tracking works.
export const DEFAULT_FOLLOW = ["NCT03529110", "NCT05929066", "NCT03887455"];
// A default trial whose record really changed in the two weeks before the saved copy is
// shown as an example of a flagged change, labelled as an example. No change is invented:
// the flag is the real update date, and nothing else about the record is altered.
export const EXAMPLE_WINDOW_DAYS = 14;

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

// entries: { [nctId]: { added, seenAt, seen, latest, checkedAt, error, seed, example } }
export function createFollowStore({ snapshot = {}, snapshotDate = "", storage = store } = {}) {
  const seedEntry = (id) => {
    const s = snapshot[id];
    const latest = s ? trackFields(s) : null;
    const example = !!(latest && snapshotDate && latest.lastUpdate && dayDiff(snapshotDate, latest.lastUpdate) < EXAMPLE_WINDOW_DAYS);
    const seen = latest ? { ...latest, ...(example ? { lastUpdate: addDays(snapshotDate, -EXAMPLE_WINDOW_DAYS) } : {}) } : null;
    return { added: Date.now(), seenAt: 0, seen, latest, checkedAt: 0, seed: true, example };
  };
  let entries = storage.get(KEY, null);
  if (!entries) {
    const old = storage.get(OLD_KEY, null);
    entries = {};
    if (old) {
      // Keep everything the reader chose; re-seed only the defaults they still follow.
      for (const [id, e] of Object.entries(old)) entries[id] = DEFAULT_FOLLOW.includes(id) ? seedEntry(id) : { ...e, seenAt: e.seenAt || e.added || 0 };
    } else {
      for (const id of DEFAULT_FOLLOW) entries[id] = seedEntry(id);
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
      entries[id] = { added: Date.now(), seenAt: Date.now(), seen: f, latest: f, checkedAt: model ? Date.now() : 0 };
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
      if (!e.seen) { e.seen = f; e.seenAt = at; }
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
      if (e && e.latest) {
        e.seen = { ...e.latest };
        e.seenAt = Date.now();
        e.seed = false;
        e.example = false;
      }
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
