/* ================= Live updates via the TrialSignal API (Cloudflare Worker + Redis) =================
   - API_BASE comes from assets/config.js (written at deploy time). Empty = no API: talk to ClinicalTrials.gov
     directly when the browser can, and fall back to the static snapshot published to GitHub Pages.
   - Change feed: poll /v1/changes every ~5 min (±20% jitter) while the tab is visible, with ETag/304,
     a durable cursor, and exponential backoff with full jitter on errors.
   - Saving a study registers it for server-side polling with an Idempotency-Key, retried until acknowledged.
   - Direct mode (no API_BASE, browser talks to ClinicalTrials.gov): see "Direct mode" below. The registry republishes
     about once per weekday and GET /api/v2/version reports its dataTimestamp, so that value is the change signal. */
const API_BASE = ((window.TS_CONFIG && window.TS_CONFIG.API_BASE) || "").replace(/\/$/, "");
const POLL_MS = 5 * 60 * 1000;

async function apiFetch(path, {method = "GET", body, headers = {}, timeout = 8000} = {}){
  const r = await fetch(API_BASE + path, {method, headers: {accept: "application/json", ...(body ? {"Content-Type": "application/json"} : {}), ...headers}, body: body ? JSON.stringify(body) : undefined, signal: timeoutSignal(timeout)});
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
    const at = Date.parse(snap.generatedAt);
    let changed = 0;
    for(const id of Object.keys(WATCH)){
      const st = snap.studies && snap.studies[id], w = WATCH[id];
      if(st && w.latest && w.checked > at) continue;   // already checked live after the snapshot was built: keep the fresher data
      if(st && applyStateTo(id, st, at)) changed++;
    }
    LIVE.snapshotAt = snap.generatedAt;
    saveWatch(); renderSaved();
    if(changed) toast("Some saved studies have updates");
  }catch(e){}
}

/* ================= Direct mode: poll the registry's version, refresh only when it moves =================
   Every 5 min (±20% jitter) while the tab is visible, and on visibilitychange / focus / online (at most once per
   60 s), GET /version. Same dataTimestamp = nothing to do. A new one invalidates the 24 h cache and the open study
   page, then refreshes all saved studies in one batched request per 100 ids. Requests are bounded by a timeout, so a
   stalled connection counts as a failure. Errors back off exponentially with full jitter (cap 1 h, never below 15 s);
   focus / online / visible do not skip that backoff. After 3 failures in a row the static snapshot is loaded once.
   If the very first /version probe fails, the same schedule re-probes and starts live updates once it answers. */
const REG_POLL_MS = 5 * 60 * 1000, REG_THROTTLE_MS = 60 * 1000;
const REG_BACKOFF_BASE = 30 * 1000, REG_BACKOFF_MIN = 15 * 1000, REG_BACKOFF_CAP = 60 * 60 * 1000, REG_FAILS_BEFORE_SNAPSHOT = 3;
const REG_VERSION_TIMEOUT_MS = 8 * 1000, REG_BATCH_TIMEOUT_MS = 20 * 1000;   // the batch timeout also covers reading the body
const REG = {
  ts: null,                              // newest dataTimestamp seen (tags cache entries)
  applied: store("ts_registry") || null, // dataTimestamp that saved studies / caches are known to match (persisted)
  inv: null,                             // dataTimestamp the caches were last invalidated for
  last: 0, fails: 0, nextAt: 0, retryAfter: 0, timer: null, busy: null, started: false, listening: false, fellBack: false,
  reprobe: false                         // the boot-time probe failed: keep probing until /version answers
};
REG.inv = REG.applied;
const regDirect = () => LIVE.mode === "http" && LIVE.base === "direct";

async function fetchRegistryVersion(){
  REG.last = Date.now();
  // no manual If-None-Match: a non-safelisted header would force a CORS preflight; "no-cache" lets the browser revalidate (ETag/304) itself
  const r = await fetch(CT_DIRECT + "version", {cache: "no-cache", headers: {accept: "application/json"}, signal: timeoutSignal(REG_VERSION_TIMEOUT_MS)});
  if(!r.ok){
    const e = new Error("ClinicalTrials.gov returned " + r.status); e.status = r.status;
    const ra = Number(r.headers && r.headers.get("retry-after"));   // seconds; only readable if the registry exposes it to CORS
    if(ra > 0) e.retryAfter = Math.min(ra * 1000, REG_BACKOFF_CAP);
    throw e;
  }
  const j = await r.json();
  if(!j || typeof j.dataTimestamp !== "string" || !j.dataTimestamp) throw new Error("ClinicalTrials.gov sent no data timestamp");
  return j.dataTimestamp;
}

function regDelay(){
  if(REG.fails) return Math.max(REG_BACKOFF_MIN, REG.retryAfter, Math.random() * Math.min(REG_BACKOFF_CAP, REG_BACKOFF_BASE * 2 ** REG.fails));   // full jitter
  return REG_POLL_MS * (0.8 + Math.random() * 0.4);
}
const regRun = () => REG.reprobe ? regReprobe() : regCheck();
function regSchedule(delay = regDelay()){
  clearTimeout(REG.timer); REG.timer = null;
  REG.nextAt = REG.fails ? Date.now() + delay : 0;   // during an outage nothing may run before this, whoever asks
  if(!(regDirect() || REG.reprobe) || document.hidden) return;   // no timers while the tab is hidden; visibilitychange restarts them
  REG.timer = setTimeout(() => { REG.timer = null; if(!document.hidden) regRun(); }, delay);
}
function regKick(){   // visibilitychange -> visible, focus, online
  if(document.hidden || !(REG.reprobe || (regDirect() && REG.started))) return;
  if(REG.fails && Date.now() < REG.nextAt){ if(!REG.timer && !REG.busy) regSchedule(Math.min(REG.nextAt - Date.now(), REG_BACKOFF_CAP)); return; }   // backing off (capped in case the clock jumped back)
  if(Date.now() - REG.last < REG_THROTTLE_MS){ if(!REG.timer && !REG.busy) regSchedule(); return; }
  regRun();
}
function regListen(){
  if(REG.listening) return; REG.listening = true;
  document.addEventListener("visibilitychange", () => { if(document.hidden){ clearTimeout(REG.timer); REG.timer = null; } else regKick(); });
  window.addEventListener("focus", regKick);
  window.addEventListener("online", regKick);
}

/* One check: version -> (if moved) invalidate + refresh saved studies. `known` = a dataTimestamp the probe just fetched. */
function regCheck(known){
  if(REG.busy) return REG.busy;
  clearTimeout(REG.timer); REG.timer = null;
  return REG.busy = (async () => {
    await null;   // always yield first, so REG.busy is assigned before the finally below can clear it (the `known` + early-return path never awaits otherwise)
    try{
      const ts = known || await fetchRegistryVersion();
      const newest = [REG.ts, REG.applied].filter(Boolean).sort().pop();
      if(newest && ts < newest){ REG.ts = newest; REG.fails = 0; REG.retryAfter = 0; return; }   // an older replica answered: ignore it, never go back
      REG.ts = ts;
      await regApply(ts, REG.fellBack);   // after a snapshot fallback the saved studies may hold older data: refresh them even if ts is unchanged
      REG.fails = 0; REG.retryAfter = 0; REG.fellBack = false;
    }catch(e){
      REG.fails++; REG.retryAfter = (e && e.retryAfter) || 0;
      if(REG.fails >= REG_FAILS_BEFORE_SNAPSHOT && !REG.fellBack && LIVE.state === "on"){ REG.fellBack = true; loadSnapshotFallback(); }
    }finally{ REG.busy = null; regSchedule(); }
  })();
}
/* The boot-time probe failed (offline, or the registry blinked): retry on the same schedule and listeners, then start live updates once. */
function regProbeLater(){
  if(API_BASE || REG.reprobe || REG.started) return;   // API builds keep their own behaviour; never twice
  REG.reprobe = true; REG.fellBack = true;   // the snapshot is what saved studies hold now: refresh them when live answers
  REG.fails = Math.max(REG.fails, 1);
  regListen(); regSchedule();
}
function regReprobe(){
  if(REG.busy) return REG.busy;
  clearTimeout(REG.timer); REG.timer = null;
  return REG.busy = (async () => {
    await null;   // see regCheck
    let ok = false;
    try{ ok = await probeHttp(); }catch(e){}
    REG.busy = null;
    if(ok){ REG.reprobe = false; REG.fails = 0; REG.retryAfter = 0; startLive(); }   // startLive -> refreshWatch starts the poller (REG.started) exactly once
    else { REG.fails++; regSchedule(); }
  })();
}
async function regApply(ts, force){
  if(ts !== REG.inv){ regInvalidate(); REG.inv = ts; }
  if(ts === REG.applied && !force){
    const missing = Object.keys(WATCH).filter((id) => !WATCH[id].latest && (!WATCH[id].err || WATCH[id].errRetry));   // saved before live data arrived (a transient failure is retried; "not found" waits for the registry to move)
    if(missing.length) await refreshSaved(missing);
    return;
  }
  await refreshSaved();
  REG.applied = ts; store("ts_registry", ts);
}
function regInvalidate(){
  cachePurge(); LIVE.cache = {};
  let open = null;
  try{   // detailState, curView and curTrial live in views.js, later in the bundle: only touch them at call time
    open = curView === "trial" && curTrial && LIVE.state === "on" ? curTrial : null;
    for(const id of Object.keys(detailState)) if(id !== open) delete detailState[id];   // the study being read stays on screen
  }catch(e){}
  if(open) regRefetchOpen(open);
  try{ if(typeof newsOnRegistryMoved === "function") newsOnRegistryMoved(); }catch(e){}   // news.js (later in the bundle): the live "What's new" list is stale now
}
/* The reader is on this study's page: ask for the new record quietly. The page keeps what it shows meanwhile (never the
   "Opening this study…" placeholder), and is redrawn only if something it shows moved. A failure leaves it as it is. */
async function regRefetchOpen(id){
  const ds = detailState[id]; if(!ds) return;
  try{
    const r = await callLive("details", id, {fresh: true});
    const next = detailOf(r.payload, id);
    if(ds.live && !watchChanged(watchCur(ds.live), watchCur(next))) return;
    ds.live = next; ds.at = r.at; delete ds.err;
    if(curView === "trial" && curTrial === id) renderTrialInPlace();
  }catch(e){}
}
/* renderTrial() builds the page again from scratch; this keeps the reader's place: open sections, a half-typed question
   (with focus and selection), the answers so far, and the scroll position. */
function renderTrialInPlace(){
  const out = $("#trialOut"), inp = $("#askInput"), log = $("#askLog");
  const sum = (d) => ($("summary", d) || {}).textContent;
  const open = $$("details", out).map((d) => d.open ? sum(d) : null);
  const keep = {val: inp ? inp.value : "", focus: !!inp && document.activeElement === inp, a: inp ? inp.selectionStart : 0, z: inp ? inp.selectionEnd : 0, nodes: log ? [...log.childNodes] : [], y: window.scrollY};
  renderTrial();
  $$("details", out).forEach((d, i) => { if(open[i] != null && sum(d) === open[i]) d.open = true; });
  const inp2 = $("#askInput"), log2 = $("#askLog");
  if(inp2 && keep.val){ inp2.value = keep.val; }
  if(inp2 && keep.focus){ inp2.focus({preventScroll: true}); try{ inp2.setSelectionRange(keep.a, keep.z); }catch(e){} }
  if(log2 && keep.nodes.length) log2.append(...keep.nodes);
  window.scrollTo(0, keep.y);
}

/* ---- saved studies: ONE request per 100 ids ---- */
const WATCH_FIELDS = "NCTId,BriefTitle,Acronym,OverallStatus,LastUpdatePostDate,PrimaryCompletionDate,EnrollmentCount";
const watchCur = (s) => ({status: s.status || "", lastUpdate: s.lastUpdate || "", title: s.title || "", pc: s.primaryCompletion || "", enr: s.enrollment || "", short: s.short || ""});
const watchChanged = (a, b) => a.status !== b.status || a.lastUpdate !== b.lastUpdate || a.pc !== b.pc || a.enr !== b.enr;
const regTransient = (e) => !(e && e.status) || e.status >= 500 || e.status === 429 || e.status === 408;   // network, timeout, 5xx, 429: worth another try
async function fetchStudiesBatch(ids){
  const params = {"filter.ids": ids.join(","), fields: WATCH_FIELDS, pageSize: 100, format: "json"};
  let j;
  const init = () => ({cache: "no-cache", signal: timeoutSignal(REG_BATCH_TIMEOUT_MS)});   // a stalled request must fail, not wedge the poller
  try{ j = await ctFetch("studies", params, init()); }
  catch(e){ if(e.status === 400){ delete params.fields; j = await ctFetch("studies", params, init()); } else throw e; }
  return j.studies || [];
}
let savedQueue = Promise.resolve();   // refreshes run one at a time, so overlapping callers never interleave their writes
function refreshSaved(only){ const run = savedQueue.catch(() => {}).then(() => doRefreshSaved(only)); savedQueue = run; return run; }
async function doRefreshSaved(only){
  const ids = (only || Object.keys(WATCH)).filter((id) => WATCH[id] && /^NCT\d{8}$/.test(id));
  if(!ids.length) return;
  let changed = 0, failure = null;
  for(let i = 0; i < ids.length; i += 100){
    const chunk = ids.slice(i, i + 100);
    let found = {};
    try{ for(const st of await fetchStudiesBatch(chunk)){ const id = nctOf(st); if(id) found[id] = st; } }
    catch(e){ failure = failure || e; chunk.forEach((id) => { if(WATCH[id]){ WATCH[id].err = liveErr(e).msg; if(regTransient(e)) WATCH[id].errRetry = true; else delete WATCH[id].errRetry; } }); continue; }
    for(const id of chunk){
      const w = WATCH[id]; if(!w) continue;   // un-saved while the request was in flight
      if(!found[id]){ w.err = liveErr({status: 404}).msg; delete w.errRetry; continue; }   // keep the previous state; not found is not retried until the registry moves
      const cur = watchCur(normStudy(found[id], id));
      if(w.latest && watchChanged(w.latest, cur)) changed++;   // no previous latest = first fill: never an "update"
      if(!w.seen) w.seen = cur;
      w.latest = cur; w.checked = Date.now(); delete w.err; delete w.errRetry;
    }
  }
  saveWatch(); renderSaved();
  if(changed) toast(changed === 1 ? "A saved study has an update" : `${changed} saved studies have updates`);
  if(failure) throw failure;
}

/* ---- 24 h cache in localStorage: one key, valid only while the registry's dataTimestamp is unchanged ---- */
const CACHE_KEY = "ts_cache_v1", CACHE_TTL = 24 * 3600 * 1000, CACHE_MAX = 40, CACHE_BUDGET = 1500000, CACHE_ENTRY_MAX = 600000;   // sizes in characters: keeps clear of the ~5 MB quota that ts_saved shares
function cacheRead(){ try{ const m = JSON.parse(localStorage.getItem(CACHE_KEY)); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; }catch(e){ return {}; } }
function cacheWrite(m){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(m)); return true; }catch(e){ return false; } }   // false on QuotaExceededError / blocked storage
function cachePurge(){ try{ localStorage.removeItem(CACHE_KEY); }catch(e){} }
function cacheGet(key, ts){
  const e = cacheRead()[key]; if(!e || e.ts !== ts || !("payload" in e)) return null;
  const age = Date.now() - e.at;
  return age > -60000 && age < CACHE_TTL ? {payload: e.payload, at: e.at} : null;
}
function cachePut(key, ts, out){
  let n; try{ n = JSON.stringify(out.payload).length; }catch(e){ return; }
  if(n > CACHE_ENTRY_MAX) return;
  const m = cacheRead(), now = Date.now();
  m[key] = {at: out.at, ts, n, payload: out.payload};
  for(const k of Object.keys(m)) if(!m[k] || m[k].ts !== ts || !(now - m[k].at < CACHE_TTL && now - m[k].at > -60000)) delete m[k];   // expired, stamped in the future, or from an older registry version (same rule as cacheGet)
  const oldest = () => Object.keys(m).sort((a, b) => m[a].at - m[b].at);
  const total = () => Object.keys(m).reduce((t, k) => t + (m[k].n || 0), 0);
  while(Object.keys(m).length > 1 && (Object.keys(m).length > CACHE_MAX || total() > CACHE_BUDGET)) delete m[oldest()[0]];
  if(cacheWrite(m)) return;
  for(let i = Math.ceil(Object.keys(m).length / 2); i > 0 && Object.keys(m).length > 1; i--) delete m[oldest()[0]];   // quota: evict the older half, retry once
  if(!cacheWrite(m)) cachePurge();   // give up silently, and free what we hold
}

/* ================= refreshWatch ================= */
async function refreshWatch(throwFirst){
  if(LIVE.base === "api"){ flushWatch(); await resyncSaved(); if(!pollTimer) pollChanges(); return; }
  if(regDirect()){
    if(!REG.started){ REG.started = true; regListen(); return regCheck(REG.ts); }   // first call (startLive): the probe already fetched /version
    try{ await refreshSaved(); }catch(e){ if(throwFirst) throw e; }                 // explicit refresh: one batched request now
    return;
  }
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
