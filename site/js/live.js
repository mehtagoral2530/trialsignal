// The live heartbeat. ClinicalTrials.gov publishes new data once a day (Monday to Friday,
// around 9:00 US Eastern). TrialSignal checks /version every 60 seconds while the page is
// open. Only when the registry's dataTimestamp changes does it refetch numbers and feeds,
// so an idle minute costs one small request. Every motion on the page comes from a real
// check or from real data arriving.

import * as api from "./api.js";
import { SITE } from "./config.js";
import { $$ } from "./util.js";

export const CHECK_EVERY = 60_000;
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const L = {
  online: null, // null until the first check, then true or false
  stamp: "", // registry dataTimestamp
  refreshedAt: 0, // that timestamp in ms
  day: "", // registry date, YYYY-MM-DD
  checkedAt: 0,
  nextCheckAt: Date.now() + CHECK_EVERY,
  checking: false,
};

const subs = new Set();
// Listeners receive ("online" | "offline" | "refresh" | "check", detail).
export const onLive = (fn) => subs.add(fn);
const emit = (type, detail) => subs.forEach((fn) => fn(type, detail));

export function announce(msg) {
  const el = document.querySelector("[data-announce]");
  if (el) el.textContent = msg;
}

// ── time helpers ─────────────────────────────────────────────────────
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
export const easternDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const easternTime = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(ms)).replace(/\s?AM/, "\u00a0am").replace(/\s?PM/, "\u00a0pm");
export const easternWeekday = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(ms));

// Next weekday at 9:00 ET after `now`.
export function nextRefresh(now = Date.now()) {
  let day = easternDay(now);
  for (let i = 0; i < 9; i++) {
    const at = easternToMs(`${day}T09:00:00`);
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && at > now) return at;
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    day = d.toISOString().slice(0, 10);
  }
  return 0;
}

// "just now", "12s ago", "3m ago", "2h ago".
export function agoShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}
// "38m", "5h 46m", "1d 3h" (no seconds).
export function hm(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return "under a minute";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// "today", "yesterday" or "on Friday", comparing the registry day with today in ET.
export function whenWord(registryDay, now = Date.now()) {
  if (!registryDay) return "";
  const today = easternDay(now);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${registryDay}T00:00:00Z`)) / 864e5);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return `on ${new Date(`${registryDay}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`;
}

// ── the check ────────────────────────────────────────────────────────
export async function check(reason = "timer", { force = false } = {}) {
  if (L.checking) return;
  if (SITE.preview) { goOffline(); return; }
  L.checking = true;
  const wasOffline = L.online === false;
  try {
    const v = await api.version();
    L.checkedAt = Date.now();
    L.nextCheckAt = L.checkedAt + CHECK_EVERY;
    const first = !L.stamp;
    const changed = v.dataTimestamp !== L.stamp;
    if (L.online !== true) { L.online = true; emit("online"); }
    sweep();
    if (changed || wasOffline || force) {
      L.stamp = v.dataTimestamp;
      L.refreshedAt = easternToMs(L.stamp);
      L.day = L.stamp.slice(0, 10);
      emit("refresh", { first: first || wasOffline, changed, reason });
      if (wasOffline) announce("ClinicalTrials.gov is reachable again. Showing live registry data.");
      else if (!first && changed) announce("ClinicalTrials.gov just published its daily refresh. New numbers and changes are shown.");
    } else if (reason === "manual") {
      // Only a check the reader asked for is announced; the 60-second timer stays quiet.
      announce(`Checked ClinicalTrials.gov. Nothing new since the ${easternTime(L.refreshedAt)} ET refresh.`);
    }
    emit("check", { reason });
  } catch {
    L.nextCheckAt = Date.now() + CHECK_EVERY;
    goOffline();
  } finally {
    L.checking = false;
    tick();
  }
}

function goOffline() {
  if (L.online === false) return;
  L.online = false;
  L.day = "";
  emit("offline");
  if (!SITE.preview) announce("Can’t reach ClinicalTrials.gov. Showing the saved copy until the connection is back.");
}

// ── the one-second ticker ────────────────────────────────────────────
// Elements opt in with data attributes:
//   data-ago="check"       → "12s ago" since the last check
//   data-tick="refreshed"  → "5h 46m ago" since the registry refresh
//   data-tick="retry"      → "58s" until the next attempt (offline)
//   data-tick="next"       → "Thu 9:00 ET, in 18h 11m"
//   data-since="<ms>"      → "12s ago" since that moment
const C_PILL = 59.7;
const C_RING = 50.27;
let lastFrac = 0;
export function tick() {
  const now = Date.now();
  // A due check starts before anything is painted, so labels never flash "1m ago".
  if (now >= L.nextCheckAt && document.visibilityState === "visible" && !SITE.preview && !L.checking) check("timer");
  // While a check is due or running, "checked" stops at 59s rather than rolling over.
  const since = (ms) => agoShort(L.online === true ? Math.min(ms, 59_000) : ms);
  const set = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  $$('[data-ago="check"]').forEach((el) => set(el, L.checkedAt ? since(now - L.checkedAt) : "…"));
  if (L.online === true) $$('[data-ago="pill"]').forEach((el) => set(el, L.checkedAt ? since(now - L.checkedAt) : "…"));
  $$("[data-since]").forEach((el) => set(el, since(now - Math.max(+el.dataset.since, L.checkedAt))));
  $$('[data-tick="refreshed"]').forEach((el) => set(el, L.refreshedAt ? (now - L.refreshedAt < 60_000 ? "just now" : `${hm(now - L.refreshedAt)} ago`) : "…"));
  $$('[data-tick="retry"]').forEach((el) => set(el, `${Math.max(0, Math.ceil((L.nextCheckAt - now) / 1000))}s`));
  const nr = nextRefresh(now);
  if (nr) $$('[data-tick="next"]').forEach((el) => set(el, `${easternWeekday(nr)} 9:00\u00a0ET, in ${hm(nr - now)}`));
  // The preview never checks, so its rings stay still.
  if (SITE.preview) return;
  const frac = Math.min(1, Math.max(0, 1 - (L.nextCheckAt - now) / CHECK_EVERY));
  const rings = [...$$(".lp-ring .val").map((r) => [r, C_PILL]), ...$$(".con-check .ring .val").map((r) => [r, C_RING])];
  // After a check the rings jump back to empty instead of winding backwards.
  const reset = frac < lastFrac - 0.2;
  lastFrac = frac;
  rings.forEach(([r, c]) => {
    const v = String(c * (1 - frac));
    if (!reset) { r.style.strokeDashoffset = v; return; }
    r.style.transition = "none";
    r.style.strokeDashoffset = v;
    void r.getBoundingClientRect();
    r.style.transition = "";
  });
}

export function start() {
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > 15_000) check("visible");
  });
  window.addEventListener("focus", () => { if (Date.now() - L.checkedAt > 15_000) check("focus"); });
  window.addEventListener("online", () => check("online"));
  setInterval(tick, 1000);
  check("load");
}

// ── motion that marks a real check ───────────────────────────────────
export function sweep() {
  if (reduceMotion()) return;
  // Only panels on screen sweep; hidden ones would otherwise replay it when shown.
  $$(".console").filter((c) => c.getClientRects().length).forEach((c) => { c.classList.remove("sweep"); void c.offsetWidth; c.classList.add("sweep"); });
  const bm = document.getElementById("brandMark");
  if (bm) { bm.classList.remove("beat"); void bm.getBoundingClientRect(); bm.classList.add("beat"); }
}

// Count a number up to its value. The box keeps its final width, so text never shifts.
export function countTo(el, to, { delay = 0, dur = 1400, animate = true } = {}) {
  if (!el || to == null) return;
  const prev = el.dataset.v != null ? +el.dataset.v : null;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  el.dataset.v = to;
  el.setAttribute("aria-label", fmt(to));
  el.textContent = fmt(to);
  if (!animate || reduceMotion() || L.online === false || prev === to) { el.style.minWidth = ""; return; }
  const from = prev ?? 0;
  el.style.minWidth = `${el.getBoundingClientRect().width}px`;
  el.textContent = fmt(from);
  const t0 = performance.now() + delay;
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const step = (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / dur));
    el.textContent = fmt(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
    else {
      el.style.minWidth = "";
      if (prev != null) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
    }
  };
  requestAnimationFrame(step);
}

// Paint every element showing a named count, e.g. data-count="today".
export function paintCount(key, value, i = 0, opts = {}) {
  $$(`[data-count="${key}"]`).forEach((el) => countTo(el, value, { delay: i * 90, ...opts }));
}

export { reduceMotion };
