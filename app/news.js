/* ================= Live "What's new" (browser side) =================
   All the rules (what to ask, how sources must agree, wording, caps, de-duplication) live in shared/news.js, which
   scripts/build-site.mjs inlines above this file. This file only does what a browser has to: fetch (paced and bounded
   by timeouts), cache, keep state, and decide when to refresh. views.js draws; nothing here touches the global "Live" badge.
   - Opening #news fetches at most once per 60 s. The registry poller (live.js) tells us when ClinicalTrials.gov moved:
     refetch at once if #news is open, otherwise mark stale and refetch when it is next opened.
   - Registry lists are cached 24 h in the existing cache, tied to the registry's dataTimestamp. FDA, RxNorm, PubMed and
     Europe PMC answers are cached 24 h in their own localStorage key (negative answers too, failures never).
   - Every source fails on its own. A list that could not be fetched keeps what was already drawn from a live answer (if that is
     under a day old), otherwise it falls back to the saved copy (data/news.json) for that list only; if nothing live answered,
     the saved copy is shown with a plain "paused" sentence.
   - Live data runs only in direct mode (browser -> ClinicalTrials.gov). Every other mode shows the saved copy. */
const NEWS_LS_KEY = "ts_news_v1", NEWS_LS_TTL = 24 * 3600 * 1000, NEWS_LS_MAX = 150, NEWS_LS_CHARS = 200000;   // sizes in characters: keeps clear of the ~5 MB quota
const NEWS_REFRESH_MS = 60 * 1000, NEWS_PM_GAP_MS = 450, NEWS_TICK_MS = 30 * 1000;
const NEWS_KINDS = ["results", "stopped", "approvals"];
const NEWSLIVE = {
  status: "idle",       // idle | loading | live | partial | paused
  live: null,           // {results, stopped, approvals}: the items shown for each kind
  liveFrom: {},         // per kind: "live" (its source answered), "saved" (taken from the saved copy), "none" (it failed and nothing was saved)
  liveAt: {},           // per kind: when its live answer arrived
  answered: {},         // which lookup sources (PubMed, Europe PMC, RxNorm) answered behind what is shown
  checkedAt: 0,         // the OLDEST live answer on show, so "Checked ..." is never more generous than the truth
  lastStart: 0, stale: false, busy: null, again: false, partial: false, usedSaved: false, sources: {},
  saved: null, savedLoaded: false, savedP: null, hand: null,
};

/* ---- the saved copy: data/news.json, fetched once per page view ---- */
function newsLoadSaved(){
  if(!NEWSLIVE.savedP) NEWSLIVE.savedP = (async () => {
    try{
      const r = await fetch("data/news.json", {cache: "no-cache", signal: timeoutSignal(8000)});
      if(!r.ok) throw new Error("news.json " + r.status);
      NEWSLIVE.saved = newsCheckSaved(await r.json());
    }catch(e){ NEWSLIVE.saved = null; }
    NEWSLIVE.savedLoaded = true;
    return NEWSLIVE.saved;
  })();
  return NEWSLIVE.savedP;
}

/* ---- 24 h cache for lookups (own localStorage key, memory first, every access guarded) ---- */
let newsLsMem = null, newsLsDirty = false;
let newsRegMem = {ts: null, m: {}};   // registry lists of this page view, for when storage will not hold them (private window, quota)
function newsLsLoad(){
  if(newsLsMem) return newsLsMem;
  try{ const m = JSON.parse(localStorage.getItem(NEWS_LS_KEY)); newsLsMem = m && typeof m === "object" && !Array.isArray(m) ? m : {}; }catch(e){ newsLsMem = {}; }
  return newsLsMem;
}
const newsLsFresh = (e, now) => !!e && typeof e.at === "number" && now - e.at < NEWS_LS_TTL && now - e.at > -60000;
function newsLsGet(key){ const e = newsLsLoad()[key]; return newsLsFresh(e, Date.now()) ? e.v : undefined; }
function newsLsPut(key, v){
  newsLsLoad()[key] = {at: Date.now(), v};
  if(!newsLsDirty){ newsLsDirty = true; Promise.resolve().then(newsLsFlush); }   // one write per burst of answers
}
/* Expired entries and anything over the entry cap, oldest first. Works on whatever object it is given. */
function newsLsTrim(m, now){
  for(const k of Object.keys(m)) if(!newsLsFresh(m[k], now)) delete m[k];
  const oldest = () => Object.keys(m).sort((a, b) => m[a].at - m[b].at)[0];
  while(Object.keys(m).length > NEWS_LS_MAX) delete m[oldest()];
  return m;
}
/* Memory is the first cache: only age and the entry cap shrink it. The size limit and any storage failure shrink a COPY that is
   being written out, so storage that refuses writes never costs the page its in-memory answers. */
function newsLsFlush(){
  newsLsDirty = false;
  const m = {...newsLsTrim(newsLsLoad(), Date.now())};
  const oldest = () => Object.keys(m).sort((a, b) => m[a].at - m[b].at)[0];
  let s = JSON.stringify(m);
  while(s.length > NEWS_LS_CHARS && Object.keys(m).length > 1){ delete m[oldest()]; s = JSON.stringify(m); }
  try{ localStorage.setItem(NEWS_LS_KEY, s); return; }catch(e){}
  for(let i = Math.ceil(Object.keys(m).length / 2); i > 0 && Object.keys(m).length > 1; i--) delete m[oldest()];   // quota: write the newer half, once
  try{ localStorage.setItem(NEWS_LS_KEY, JSON.stringify(m)); }catch(e){ try{ localStorage.removeItem(NEWS_LS_KEY); }catch(e2){} }
}

/* ---- requests ---- */
/* PubMed allows 3 requests a second without a key: starts are at least NEWS_PM_GAP_MS apart, in one queue. */
let newsPmChain = Promise.resolve(), newsPmLast = 0;
function newsPmSlot(){
  const run = newsPmChain.then(async () => {
    const wait = newsPmLast + NEWS_PM_GAP_MS - Date.now();
    if(wait > 0) await new Promise((r) => setTimeout(r, wait));
    newsPmLast = Date.now();
  });
  newsPmChain = run.catch(() => {});
  return run;
}
/* Only an Accept header (no preflight). A rate-limited PubMed reply has no CORS header, so the browser reports it as a network error. */
async function newsFetchJson(source, url, {timeoutMs}){
  if(source === "pubmed") await newsPmSlot();
  const r = await fetch(url, {cache: "no-cache", headers: {accept: "application/json"}, signal: timeoutSignal(timeoutMs)});
  if(!r.ok){
    const e = new Error(source + " returned " + r.status); e.status = r.status;
    try{ const c = ((await r.json()) || {}).error; if(c && typeof c.code === "string" && /^[A-Z_]{1,40}$/.test(c.code)) e.code = c.code; }catch(x){}   // openFDA's own "no matches" 404 says NOT_FOUND; a proxy's 404 does not
    throw e;
  }
  return r.json();
}
function newsIo(ts){
  return {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fetchJson: newsFetchJson,
    cache: {
      get: (k) => {
        if(!k.startsWith("reg:")) return newsLsGet(k);
        if(!ts) return undefined;                                                        // registry lists: tied to the registry's dataTimestamp
        const hit = cacheGet("h:news:" + k, ts);
        if(hit && hit.payload !== undefined) return hit.payload;
        const mem = newsRegMem.ts === ts ? newsRegMem.m[k] : null;
        return mem && Date.now() - mem.at < NEWS_LS_TTL ? mem.payload : undefined;
      },
      put: (k, v) => {
        if(!k.startsWith("reg:")){ newsLsPut(k, v); return; }
        if(!ts || REG.ts !== ts) return;                                                 // an answer that raced a registry update is not kept
        cachePut("h:news:" + k, ts, {payload: v, at: Date.now()});
        if(newsRegMem.ts !== ts) newsRegMem = {ts, m: {}};
        newsRegMem.m[k] = {payload: v, at: Date.now()};
      },
    },
  };
}

/* ---- when to fetch ---- */
function newsMode(){
  if(LIVE.mode === "http" && LIVE.base === "direct" && LIVE.state === "on") return "direct";
  if(!LIVE.mode || LIVE.state === "checking" || LIVE.state === "connecting") return "wait";
  return "saved";   // claude.ai connector, offline, probe failed, optional Worker build: the saved copy
}
function newsHand(){ return NEWSLIVE.hand || (NEWSLIVE.hand = newsHandItems(NEWS, NEWS_PLAIN, newsLevel)); }
function newsOnOpen(){
  const mode = newsMode(), S = NEWSLIVE;
  newsTickStart();
  if(mode === "saved" && !S.savedP) newsLoadSaved().then(() => newsDraw());
  if(mode === "direct" && !S.busy && (S.stale || Date.now() - S.lastStart >= NEWS_REFRESH_MS)) newsRefresh();
}
function newsOnLiveState(){ if(curView === "news"){ newsOnOpen(); newsDraw(); } }   // setLive() in core.js
function newsOnRegistryMoved(){   // regInvalidate() in live.js
  NEWSLIVE.stale = true;
  if(curView === "news" && !document.hidden && newsMode() === "direct") newsRefresh();
}
function newsRefresh(){
  const S = NEWSLIVE;
  if(S.busy){ S.again = true; return S.busy; }
  S.lastStart = Date.now(); S.stale = false;
  if(!S.live && S.status !== "paused") S.status = "loading";
  const ts = REG.ts;
  S.busy = (async () => {
    let res = null;
    try{ res = await newsRun(newsIo(ts), {nowMs: Date.now(), hand: newsHand(), getSaved: newsLoadSaved, concurrency: 4, pubmedRetryMs: 2000}); }catch(e){}
    if(res && res.anyLive && newsTake(res)) return;
    if(!S.live || Date.now() - S.checkedAt >= NEWS_LS_TTL){ S.live = null; S.status = "paused"; }   // nothing answered: keep earlier live stories only while they are under a day old
  })().finally(() => {
    S.busy = null;
    if(S.again){ S.again = false; newsRefresh(); } else newsDraw();
  });
  return S.busy;
}
/* Adopt a refresh, kind by kind. A kind whose source failed this time keeps what was already drawn from a live answer while that is
   under a day old (one blip must not swap fresh stories for an older saved copy); only otherwise does it come from the saved copy.
   Returns false when no kind has a live answer at all. */
function newsTake(res){
  const S = NEWSLIVE, now = Date.now(), live = {}, from = {}, at = {}, kept = {};
  for(const k of NEWS_KINDS){
    if(!res.failedKinds.includes(k)){ live[k] = res.live[k]; from[k] = "live"; at[k] = now; continue; }
    if(S.live && S.liveFrom[k] === "live" && now - S.liveAt[k] < NEWS_LS_TTL){ live[k] = S.live[k]; from[k] = "live"; at[k] = S.liveAt[k]; kept[k] = true; continue; }
    live[k] = res.live[k]; from[k] = res.usedSaved.includes(k) ? "saved" : "none"; at[k] = now;
  }
  const liveAts = NEWS_KINDS.filter((k) => from[k] === "live").map((k) => at[k]);
  if(!liveAts.length) return false;
  const a = {...res.answered};
  if(kept.results){ a.pubmed = a.pubmed || S.answered.pubmed; a.epmc = a.epmc || S.answered.epmc; }   // those stories were cross-checked in an earlier refresh
  if(kept.approvals) a.rxnorm = a.rxnorm || S.answered.rxnorm;
  S.live = live; S.liveFrom = from; S.liveAt = at; S.answered = a; S.sources = res.sources;
  S.checkedAt = Math.min(...liveAts);
  S.usedSaved = NEWS_KINDS.some((k) => from[k] === "saved");
  S.partial = NEWS_KINDS.some((k) => from[k] !== "live");
  S.status = S.partial ? "partial" : "live";
  return true;
}

/* ---- what to show ---- */
function newsView(){
  const S = NEWSLIVE, hand = newsHand(), mode = newsMode(), now = Date.now();
  const fresh = !!S.live && now - S.checkedAt < NEWS_LS_TTL;
  const kind = fresh ? (S.partial ? "partial" : "live")
    : mode === "saved" ? (S.savedLoaded ? "paused" : "loading")
    : mode === "direct" && S.status === "paused" ? "paused" : "loading";
  const saved = S.saved, savedDate = saved ? fmtDate(saved.generatedAt.slice(0, 10)) : "";
  let by = {};
  if(fresh) by = S.live;
  else if(kind === "paused" && saved) by = {results: saved.items.filter((i) => i.kind === "results"), stopped: saved.items.filter((i) => i.kind === "stopped"), approvals: saved.items.filter((i) => i.kind === "approval")};
  const items = newsMerge({hand, ...by, nowMs: now});
  if(!fresh) return {kind, items, intro: newsIntro(kind, {savedDate: kind === "paused" ? savedDate : ""})};
  /* The intro names only the sources this browser itself asked and that really answered. DailyMed is never named here (only the hourly job can ask it; each approval it confirms says so on its own card). */
  const from = S.liveFrom, A = S.answered || {};
  return {
    kind, items,
    intro: newsIntro(kind, {
      checked: ago(S.checkedAt), savedDate: kind === "partial" && S.usedSaved ? savedDate : "",
      primary: [(from.results === "live" || from.stopped === "live") && "ClinicalTrials.gov", from.approvals === "live" && "the FDA"].filter(Boolean),
      crossChecked: [A.pubmed && "PubMed", A.epmc && "Europe PMC", A.rxnorm && "RxNorm"].filter(Boolean),
    }),
  };
}
/* The relative time is the only text that changes by itself: update that one text node, and only while the page is being looked at.
   The timer exists only while #news is open (it ends itself on the first tick after the reader leaves), so other pages carry no extra timer. */
let newsTickT = null;
function newsTickStart(){ if(!newsTickT) newsTickT = setInterval(newsTick, NEWS_TICK_MS); }
function newsTick(){
  const S = NEWSLIVE;
  if(curView !== "news"){ clearInterval(newsTickT); newsTickT = null; return; }
  if(document.hidden) return;
  if(S.live && Date.now() - S.checkedAt >= NEWS_LS_TTL){ S.live = null; S.status = "paused"; newsOnOpen(); newsDraw(); return; }   // never say "1 days ago" under a live sentence
  const el = $("#newsChecked");
  if(el && S.checkedAt) el.textContent = ago(S.checkedAt);
}
