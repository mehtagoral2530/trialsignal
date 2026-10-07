// The live pulse: what the registry is doing right now, refreshed while the page is open.
// ClinicalTrials.gov publishes new data once a day (Monday to Friday). TrialSignal checks it
// every minute and on return to the tab, so a refresh shows up within a minute of release.

import * as api from "./api.js";
import { SITE } from "./config.js";

export const PULSE_EVERY = 60_000;

export const pulse = {
  state: SITE.preview ? "offline" : "loading", // loading | live | offline
  refreshedAt: 0, // when ClinicalTrials.gov last published data (ms)
  day: "", // registry date of that refresh, YYYY-MM-DD
  stats: null, // { updated, added, results, recruiting }
  checkedAt: 0, // when TrialSignal last asked
  error: "",
};

const subs = new Set();
export const onPulse = (fn) => subs.add(fn);
const emit = () => subs.forEach((fn) => fn(pulse));

export function isoMinusDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// The API's dataTimestamp has no zone; ClinicalTrials.gov runs on US Eastern time.
export function easternToMs(ts) {
  if (!ts) return 0;
  const asUtc = Date.parse(`${ts}Z`);
  if (Number.isNaN(asUtc)) return 0;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]),
    );
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc + (asUtc - shown);
  } catch {
    return asUtc;
  }
}

let running = null;
export async function refreshPulse({ fresh = false } = {}) {
  if (SITE.preview) { emit(); return; }
  if (running) return running;
  running = (async () => {
    try {
      const reg = await api.registryStatus({ fresh });
      const day = (reg.dataTimestamp || new Date().toISOString()).slice(0, 10);
      const week = isoMinusDays(day, 7);
      const [updated, added, results, recruiting] = await Promise.all([
        api.countWhere(`AREA[LastUpdatePostDate]RANGE[${day},MAX]`, { fresh }),
        api.countWhere(`AREA[StudyFirstPostDate]RANGE[${week},MAX]`, { fresh }),
        api.countWhere(`AREA[ResultsFirstPostDate]RANGE[${week},MAX]`, { fresh }),
        api.countWhere("AREA[OverallStatus]RECRUITING AND AREA[StudyType]INTERVENTIONAL", { fresh }),
      ]);
      Object.assign(pulse, { state: "live", refreshedAt: easternToMs(reg.dataTimestamp), day, stats: { updated, added, results, recruiting }, checkedAt: Date.now(), error: "" });
    } catch (e) {
      Object.assign(pulse, { state: pulse.stats ? "live" : "offline", error: e.message, checkedAt: pulse.checkedAt });
      if (e.offline) pulse.state = "offline";
    } finally {
      running = null;
      emit();
    }
  })();
  return running;
}

export function startPulse() {
  refreshPulse();
  setInterval(() => { if (!document.hidden) refreshPulse({ fresh: true }); }, PULSE_EVERY);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - pulse.checkedAt > PULSE_EVERY / 2) refreshPulse({ fresh: true });
  });
}

// ── ticking timestamps ───────────────────────────────────────────────
// Any element with data-since="<ms>" shows a relative time that updates every second.
export function agoLive(ms, now = Date.now()) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m ` : ""}ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function startTicker() {
  const tick = () => {
    const now = Date.now();
    document.querySelectorAll("[data-since]").forEach((el) => {
      const t = agoLive(+el.dataset.since, now);
      if (el.textContent !== t) el.textContent = t;
    });
  };
  tick();
  setInterval(tick, 1000);
}

// ── new-item detection for feeds ─────────────────────────────────────
// Remembers which ids a feed showed last time, so newly arrived rows can be highlighted.
const seenByFeed = new Map();
export function markNew(key, ids) {
  const before = seenByFeed.get(key);
  seenByFeed.set(key, new Set(ids));
  if (!before) return new Set();
  return new Set(ids.filter((id) => !before.has(id)));
}

// ── count-up animation ───────────────────────────────────────────────
export function countUp(el, to, { duration = 900 } = {}) {
  if (to == null || Number.isNaN(+to)) return;
  const from = +(el.dataset.value || 0);
  el.dataset.value = to;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  if (from === +to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / duration);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
