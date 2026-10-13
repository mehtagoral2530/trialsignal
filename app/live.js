/* ================= Live updates via the TrialSignal API (Cloudflare Worker + Redis) =================
   - API_BASE comes from assets/config.js (written at deploy time). Empty = no API: talk to ClinicalTrials.gov
     directly when the browser can, and fall back to the static snapshot published to GitHub Pages.
   - Change feed: poll /v1/changes every ~5 min (±20% jitter) while the tab is visible, with ETag/304,
     a durable cursor, and exponential backoff with full jitter on errors.
   - Saving a study registers it for server-side polling with an Idempotency-Key, retried until acknowledged. */
const API_BASE = ((window.TS_CONFIG && window.TS_CONFIG.API_BASE) || "").replace(/\/$/, "");
const POLL_MS = 5 * 60 * 1000;

async function apiFetch(path, {method = "GET", body, headers = {}, timeout = 8000} = {}){
  const r = await fetch(API_BASE + path, {method, headers: {accept: "application/json", ...(body ? {"Content-Type": "application/json"} : {}), ...headers}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout)});
  if(r.status === 304) return {notModified: true, etag: r.headers.get("ETag")};
  const j = await r.json().catch(() => ({}));
  if(!r.ok){ const e = new Error((j.error && j.error.message) || `Request failed (${r.status})`); e.status = r.status; e.code = (j.error && j.error.code) || "http"; e.body = j; throw e; }
  return Object.assign(j, {etag: r.headers.get("ETag")});
}

/* ---- apply a feed entry / state record to a saved study ---- */
function applyStateTo(id, st, at){
  const w = WATCH[id]; if(!w || !st) return false;
  const cur = {status: st.status || "", lastUpdate: st.lup || (w.latest && w.latest.lastUpdate) || "", title: (w.latest && w.latest.title) || "", pc: st.pcd || "", enr: st.enroll != null ? String(st.enroll) : "", short: (w.latest && w.latest.short) || ""};
  const before = w.latest ? w.latest.status : null;
  if(!w.seen) w.seen = cur;
  w.latest = cur; w.checked = at || Date.now();
  return before != null && before !== cur.status;
}

/* ---- change feed polling ---- */
let pollTimer = null, failures = 0;
async function pollChanges(){
  clearTimeout(pollTimer);
  if(document.hidden){ return; }
  const cursor = store("ts_cursor") || {};
  try{
    const qs = cursor.next ? `?since=${encodeURIComponent(cursor.next)}` : "";
    const r = await apiFetch(`/v1/changes${qs}`, {headers: cursor.etag ? {"If-None-Match": cursor.etag} : {}});
    failures = 0;
    if(!r.notModified){
      let changed = [];
      for(const e of r.entries || []) if(WATCH[e.nct] && applyStateTo(e.nct, e.state, e.at)) changed.push(e.nct);
      store("ts_cursor", {next: r.next, etag: r.etag});
      if(r.more) return setTimeout(pollChanges, 1000);
      if(changed.length){ saveWatch(); renderSaved(); toast(changed.length === 1 ? "A saved study has an update" : `${changed.length} saved studies have updates`); }
    }
  }catch(e){
    if(e.status === 410){ store("ts_cursor", {next: e.body && e.body.next}); await resyncSaved(); }
    else { failures++; }
  }
  const base = failures ? Math.min(POLL_MS * 2 ** failures, 60 * 60 * 1000) * Math.random() : POLL_MS * (0.8 + Math.random() * 0.4);
  pollTimer = setTimeout(pollChanges, Math.max(15000, base));
}
document.addEventListener("visibilitychange", () => { if(!document.hidden && LIVE.base === "api") pollChanges(); });

/* ---- saved studies: one /v1/state call instead of one request per study ---- */
async function resyncSaved(){
  const ids = Object.keys(WATCH).slice(0, 50); if(!ids.length) return;
  try{
    const r = await apiFetch(`/v1/state?ids=${ids.sort().join(",")}`);
    let changed = 0;
    for(const id of ids){ if(r.state[id]) { if(applyStateTo(id, r.state[id], r.state[id].polledAt)) changed++; } }
    const untracked = ids.filter((id) => !r.state[id]);
    if(untracked.length) registerWatch(untracked);
    saveWatch(); renderSaved();
    if(changed) toast("Some saved studies have updates");
  }catch(e){ /* keep last known state */ }
}

/* ---- register saved studies for server polling (idempotent, retried until acknowledged) ---- */
function registerWatch(ids){
  if(LIVE.base !== "api") return;
  const pending = store("ts_watch_pending") || [];
  pending.push({key: crypto.randomUUID(), ids});
  store("ts_watch_pending", pending);
  flushWatch();
}
async function flushWatch(){
  const pending = store("ts_watch_pending") || [];
  const left = [];
  for(const p of pending){
    try{ await apiFetch("/v1/watch", {method: "POST", body: {ids: p.ids}, headers: {"Idempotency-Key": p.key}}); }
    catch(e){ if(e.status !== 400) left.push(p); }   // 409/5xx/network: retry later with the SAME key
  }
  store("ts_watch_pending", left);
}

/* ---- static fallback: GitHub Pages snapshot built by the scheduled Action ---- */
async function loadSnapshotFallback(){
  try{
    const r = await fetch("data/snapshot.json", {cache: "no-cache"});
    if(!r.ok) return;
    const snap = await r.json();
    let changed = 0;
    for(const id of Object.keys(WATCH)){ const st = snap.studies && snap.studies[id]; if(st && applyStateTo(id, st, Date.parse(snap.generatedAt))) changed++; }
    LIVE.snapshotAt = snap.generatedAt;
    saveWatch(); renderSaved();
    if(changed) toast("Some saved studies have updates");
  }catch(e){}
}

/* In API mode, saved-study refresh uses the state endpoint + change feed. */
async function refreshWatch(throwFirst){
  if(LIVE.base === "api"){ flushWatch(); await resyncSaved(); if(!pollTimer) pollChanges(); return; }
  if(LIVE.base === null || LIVE.state !== "on"){ return loadSnapshotFallback(); }
  const ids = Object.keys(WATCH); let first = true;
  for(const id of ids){
    try{
      const r = await callLive("details", id, {fresh: true});
      const s = detailOf(r.payload, id);
      const w = WATCH[id] || (WATCH[id] = {});
      const cur = {status: s.status || "", lastUpdate: s.lastUpdate || "", title: s.title || "", pc: s.primaryCompletion || "", enr: s.enrollment || "", short: s.short || ""};
      if(!w.seen) w.seen = cur;
      w.latest = cur; w.checked = r.at || Date.now();
    }catch(e){ if(throwFirst && first) throw e; }
    first = false;
  }
  saveWatch(); renderSaved();
}
