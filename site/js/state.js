// Shared state: the saved snapshot, live records fetched this visit, and the
// followed-trials store with its re-check schedule.

import { SITE } from "./config.js";
import * as api from "./api.js";
import { createFollowStore } from "./tracking.js";
import { SNAPSHOT, SNAPSHOT_DATE } from "../data/snapshot.js";

export { SNAPSHOT, SNAPSHOT_DATE };
export const events = new EventTarget();
const emit = (type) => events.dispatchEvent(new Event(type));

export const follow = createFollowStore({ snapshot: SNAPSHOT });

// Full records fetched live during this visit.
const liveRecords = new Map();

// Best record we have right now, and where it came from.
export function known(id) {
  const l = liveRecords.get(id);
  if (l) return { model: l.model, source: "live", at: l.at };
  if (SNAPSHOT[id]) return { model: SNAPSHOT[id], source: "snapshot", at: Date.parse(SNAPSHOT_DATE) };
  return { model: null, source: null, at: 0 };
}

export async function loadStudy(id, { fresh = false } = {}) {
  const model = await api.getStudy(id, { fresh, ttl: 300_000 });
  liveRecords.set(id, { model, at: Date.now() });
  return model;
}

// Re-check every followed trial in one request.
export const tracking = { busy: false, error: "" };
export async function checkFollowed() {
  const ids = follow.ids();
  if (!ids.length || tracking.busy || SITE.preview) return;
  tracking.busy = true;
  emit("follow");
  try {
    const latest = await api.getStudies(ids, { fresh: true });
    const now = Date.now();
    for (const id of ids) {
      if (latest[id]) follow.update(id, latest[id], now);
      else follow.fail(id, "ClinicalTrials.gov didn’t return this trial.");
    }
    tracking.error = "";
  } catch (e) {
    tracking.error = e.message;
  } finally {
    tracking.busy = false;
    emit("follow");
  }
}

// Check on load, then every few minutes while the tab is visible.
export function startTracking() {
  const every = SITE.refreshMinutes * 60_000;
  const due = () => Date.now() - follow.lastChecked() > every - 5_000;
  checkFollowed();
  setInterval(() => { if (!document.hidden) checkFollowed(); }, every);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && due()) checkFollowed(); });
}

export function toggleFollow(id) {
  if (follow.has(id)) follow.remove(id);
  else follow.add(id, known(id).source === "live" ? known(id).model : null);
  emit("follow");
  if (follow.has(id) && known(id).source !== "live") checkFollowed();
  return follow.has(id);
}

export function markSeen(id) {
  follow.markSeen(id);
  emit("follow");
}
