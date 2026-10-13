
/* ================= TrialSignal app ================= */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const lib = id => TRIALS.find(t => t.id === id);
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d){
  if(!d) return "";
  d = String(d);
  if(/Q\d/.test(d)){ const [y,q]=d.split("-"); return q+" "+y; }
  const m = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if(!m) return d;
  return (m[3] ? (+m[3])+" " : "") + MON[+m[2]-1] + " " + m[1];
}
const parseNCT = s => { const m = String(s||"").toUpperCase().match(/NCT\d{8}/); return m ? m[0] : null; };
const ctUrl = id => "https://clinicaltrials.gov/study/" + id;
const doiUrl = d => "https://doi.org/" + d;
function store(k, v){ try{ if(v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); }catch(e){ return null; } }
let toastT; function toast(m){ const t=$("#toast"); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
const ago = ms => { const s=Math.round((Date.now()-ms)/1000); if(s<60) return "just now"; const m=Math.round(s/60); if(m<60) return m+" min ago"; const h=Math.round(m/60); if(h<24) return h+" h ago"; return Math.round(h/24)+" days ago"; };

/* ---------- glossary hints ---------- */
const EXTRA_TERMS = [
 ["Randomized","","Participants are assigned to groups by chance, so the groups are alike at the start and differences can be credited to the treatment."],
 ["Recruiting","","The trial is currently enrolling participants."],
 ["Sponsor","","The company or organization responsible for running and usually funding the trial."],
 ["Peer-reviewed","","Checked by independent experts before a journal published it."],
 ["Enrollment","","The number of people taking part, or planned to take part."],
 ["Primary outcome","","The main thing a trial measures to answer its question. The trial’s headline conclusion rests on it."],
 ["Secondary outcome","","Additional measures that support or add detail to the main result."]
];
const TERMS = {}; [...GLOSSARY, ...EXTRA_TERMS].forEach(([t,a,d]) => { TERMS[t.toLowerCase()] = [t,d]; if(a) TERMS[a.toLowerCase()] = [t+" ("+a+")",d]; });
TERMS["phase 1"]=TERMS["phase 2"]=TERMS["phase 3"]=TERMS["phase"];
const term = (text, key) => { const k=(key||text).toLowerCase(); return TERMS[k] ? `<button type="button" class="term" data-term="${esc(k)}">${esc(text)}</button>` : esc(text); };
const tip = $("#tip");
function showTip(el){
  const [t,d] = TERMS[el.dataset.term] || []; if(!t) return;
  tip.innerHTML = `<b>${esc(t)}</b>${esc(d)}`; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = Math.min(300, innerWidth-32);
  tip.style.maxWidth = w+"px";
  let x = r.left + scrollX; x = Math.max(16, Math.min(x, scrollX + innerWidth - w - 16));
  tip.style.left = x+"px"; tip.style.top = (r.bottom + scrollY + 8)+"px";
}
document.addEventListener("mouseover", e => { const t=e.target.closest(".term"); if(t) showTip(t); });
document.addEventListener("mouseout", e => { if(e.target.closest(".term")) tip.hidden = true; });
document.addEventListener("focusin", e => { const t=e.target.closest(".term"); if(t) showTip(t); });
document.addEventListener("focusout", e => { if(e.target.closest(".term")) tip.hidden = true; });
document.addEventListener("click", e => { const t=e.target.closest(".term"); if(t){ e.preventDefault(); tip.hidden ? showTip(t) : (tip.hidden=true); } else tip.hidden = true; });

const phaseTxt = p => { if(!p) return ""; const s = Array.isArray(p) ? p.join(", ") : String(p); return s.replace(/PHASE(\d)/gi,"Phase $1").replace(/_/g," ").replace(/EARLY Phase/i,"Early phase").replace(/\bNA\b/,"Not applicable"); };

/* ================= LIVE DATA (Clinical Trials connector) ================= */
const SERVER = "Clinical Trials";
const LIVE = { mcp:null, sample:null, downloads:null, state:"checking", msg:"", schema:{}, cache:{} };
const WATCH_DEFAULT = [];
let WATCH = store("ts_saved") || Object.fromEntries(WATCH_DEFAULT.map(id => [id,{added:Date.now()}]));
const saveWatch = () => store("ts_saved", WATCH);

function liveErr(e){
  if(e && e.status && LIVE.mode==="http") return {st:"error", msg: e.status>=500 ? "ClinicalTrials.gov didn’t answer just now. Try again in a minute." : e.status===404 ? "ClinicalTrials.gov has no record with this number." : "ClinicalTrials.gov couldn’t handle that request ("+e.status+").", code:"http"};
  if(e && (e.name==="TimeoutError" || e.name==="AbortError") && LIVE.mode==="http" && LIVE.base==="direct") return liveErr({status:504});   // a request we gave up on: same wording as a 5xx
  if(e instanceof TypeError && LIVE.mode==="http") return {st:"error", msg:"You seem to be offline, or ClinicalTrials.gov can’t be reached.", code:"network"};
  const c = e && e.code;
  const map = {
    server_not_connected:["off","Add the Clinical Trials connector in claude.ai Settings → Connectors, then reload this page."],
    selection_required:["off","You have more than one Clinical Trials connector. Choose one when claude.ai asks, then reload."],
    needs_reauth:["off","Reconnect the Clinical Trials connector in claude.ai Settings → Connectors."],
    not_in_manifest:["denied","Live data is turned off for this page. You can allow it from this page’s Permissions menu."],
    consent_required:["denied","Live data needs your permission. Select “Turn on live data” to be asked again."],
    blocked_by_policy:["off","Your organization blocks the Clinical Trials connector."],
    approval_required:["off","Your organization requires approval for the Clinical Trials connector."],
    not_granted:["none","Live data isn’t available in this view."],
    capability_disabled:["none","Live data isn’t available in this view."],
    capability_removed:["none","Live data isn’t available in this view."],
    server_unavailable:["error","ClinicalTrials.gov didn’t answer just now. Try again in a minute."],
    tool_error:["error","ClinicalTrials.gov returned an error: "+((e&&e.message)||"unknown")+"."]
  };
  const [st, msg] = map[c] || ["error","Live lookup failed"+(e&&e.message?": "+e.message:"")+". Try again shortly."];
  return {st, msg, code:c};
}
function setLive(st, msg){ LIVE.state = st; LIVE.msg = msg||""; renderBadge(); if(curView==="trials") renderLiveNote(); }
function renderBadge(){
  const b=$("#liveBadge"), on = LIVE.state==="on";
  b.classList.toggle("on", on);
  $("#liveText").textContent = on ? "Live" : LIVE.state==="checking"||LIVE.state==="connecting" ? "Connecting" : "Library";
  b.title = on ? "Trial data is live from ClinicalTrials.gov" : "Showing the reviewed library. Select for details.";
}
$("#liveBadge") && $("#liveBadge").addEventListener("click", () => { go("trials"); setTimeout(()=>{ const n=$("#liveNote"); n && n.scrollIntoView({block:"center"}); },60); });

/* schema-driven input building */
function propsOf(desc){ const s = desc && desc.inputSchema; return (s && s.properties) ? s.properties : null; }
function buildInput(kind, val){
  const p = LIVE.schema[kind]; if(!p) return null;
  const keys = Object.keys(p), find = re => keys.find(k => re.test(k));
  const inp = {};
  if(kind==="search" && p.advanced_query){
    const d = new Date(Date.now() - (val.days||365)*864e5).toISOString().slice(0,10);
    const term = String(val.q||val).replace(/[’'"()]/g," ").trim();
    inp.advanced_query = `${term} AND AREA[LastUpdatePostDate]RANGE[${d},MAX]`;
    if(p.study_type) inp.study_type = "INTERVENTIONAL";
    if(p.page_size) inp.page_size = val.size || 20;
    if(p.count_total) inp.count_total = true;
    if(val.phases && p.phase) inp.phase = val.phases;
    return inp;
  }
  if(kind==="search"){
    val = val.q || val;
    const k = find(/^(query|q|term|terms|search|search_?term|keywords?|text)$/i) || find(/query|term|search|keyword/i) || find(/^conditions?$/i) || find(/condition|cond/i);
    if(!k) return null; inp[k] = val;
    const lim = find(/^(max_?results|limit|page_?size|count|n|num_?results|max)$/i) || find(/max|limit|size/i);
    if(lim && /integer|number/.test(p[lim].type||"integer")) inp[lim] = 15;
  } else {
    const k = find(/^(nct_?id|nctid|nct_?number|nct)$/i) || find(/nct/i) || find(/^(trial_?id|study_?id|id)$/i) || find(/id$/i);
    if(!k) return null; inp[k] = val;
  }
  return inp;
}
const GUESS = {
  search: v => [{advanced_query:`${String(v.q||v).replace(/[’'"()]/g," ")} AND AREA[LastUpdatePostDate]RANGE[${new Date(Date.now()-(v.days||365)*864e5).toISOString().slice(0,10)},MAX]`, study_type:"INTERVENTIONAL", page_size:v.size||20},{query:v},{condition:v},{term:v},{search_term:v},{q:v}],
  details: v => [{nct_id:v},{nctId:v},{trial_id:v},{id:v}]
};
const TOOL = { search:"search_trials", details:"get_trial_details" };
async function loadSchema(kind){
  if(LIVE.schema[kind]) return;
  try{ const d = await LIVE.mcp.describeTool(SERVER, TOOL[kind]); const p = propsOf(d); if(p) LIVE.schema[kind] = p; }catch(e){}
}
/* Self-hosted mode: ClinicalTrials.gov API v2, through /api/ct (serverless proxy) or directly. */
const CT_DIRECT = "https://clinicaltrials.gov/api/v2/";
const CT_FIELDS = "NCTId,BriefTitle,Acronym,OverallStatus,Phase,LeadSponsorName,LastUpdatePostDate,StartDate,PrimaryCompletionDate,EnrollmentCount,Condition";
function ctUrlFor(path, params){
  const q = new URLSearchParams(params);
  return LIVE.base === "proxy" ? `/api/ct?path=${encodeURIComponent(path)}&${q}` : `${CT_DIRECT}${path}?${q}`;
}
/* AbortSignal.timeout() where the browser has it (Safari < 16, Chrome < 103 and Firefox < 100 do not), else a controller on a timer. */
function timeoutSignal(ms){
  if(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  if(typeof AbortController === "undefined") return undefined;
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
}
async function ctFetch(path, params, init){
  const r = await fetch(ctUrlFor(path, params), {headers:{accept:"application/json"}, ...init});
  if(!r.ok){ const e = new Error("ClinicalTrials.gov returned "+r.status); e.status = r.status; e.code = r.status===404 ? "tool_error" : r.status>=500 ? "server_unavailable" : "tool_error"; throw e; }
  return r.json();
}
async function httpCall(kind, val){
  if(LIVE.base === "api"){
    if(kind === "details"){ const r = await apiFetch(`/v1/studies/${encodeURIComponent(val)}`); return r.raw; }
    const v = typeof val === "object" ? val : {q:val};
    const r = await apiFetch(`/v1/search?q=${encodeURIComponent(String(v.q))}`);
    return {results: r.results || [], total: (r.results||[]).length, degraded: r.degraded || [], asOf: r.asOf};
  }
  if(kind === "details"){
    return await ctFetch("studies/"+val, {format:"json"});
  }
  const v = typeof val === "object" ? val : {q:val};
  const d = new Date(Date.now() - (v.days||365)*864e5).toISOString().slice(0,10);
  const adv = [`AREA[LastUpdatePostDate]RANGE[${d},MAX]`, "AREA[StudyType]INTERVENTIONAL"];
  if(v.phases) adv.push("(" + v.phases.map(p=>`AREA[Phase]${p}`).join(" OR ") + ")");
  const params = {"query.term": String(v.q).replace(/[’'"()]/g," ").trim(), "filter.advanced": adv.join(" AND "), sort:"LastUpdatePostDate:desc", pageSize: v.size||20, countTotal:"true", format:"json", fields: CT_FIELDS};
  let j;
  try{ j = await ctFetch("studies", params); }
  catch(e){ if(e.status===400){ delete params.fields; j = await ctFetch("studies", params); } else throw e; }
  return {studies: j.studies || [], total: j.totalCount};
}
async function probeHttp(){
  if(API_BASE){
    try{ const h = await apiFetch("/v1/health", {timeout:4000}); if(h && h.ok){ LIVE.base = "api"; LIVE.apiRedis = !!h.redis; return true; } }catch(e){}
  }
  for(const base of ["direct"]){
    LIVE.base = base;
    /* GET /version is the cheap reachability probe; its dataTimestamp is what the registry poller (live.js) compares. */
    try{ REG.ts = await fetchRegistryVersion(); return true; }catch(e){}
  }
  LIVE.base = null; return false;
}

async function callLive(kind, val, {fresh=false}={}){
  if(LIVE.mode === "http"){
    const key = "h:"+kind+":"+JSON.stringify(val);
    /* layer 1: memory (2 min). layer 2 (direct mode only): localStorage for 24 h, valid while the registry's dataTimestamp is unchanged. */
    const mem = LIVE.cache[key];
    if(!fresh && mem && Date.now()-(mem.mem ?? mem.at) < 120000) return mem;
    const ts = LIVE.base === "direct" ? REG.ts : null;
    if(!fresh && ts){ const hit = cacheGet(key, ts); if(hit){ LIVE.cache[key] = {...hit, mem: Date.now()}; return hit; } }
    const payload = await httpCall(kind, val);
    const out = {payload, at: Date.now()};
    if(!ts || REG.ts === ts){ LIVE.cache[key] = out; if(ts) cachePut(key, ts, out); }   // an answer that raced a registry update is not kept
    if(LIVE.state!=="on") setLive("on");
    return out;
  }
  const key = kind+":"+JSON.stringify(val);
  if(!fresh && LIVE.cache[key] && Date.now()-LIVE.cache[key].at < 120000) return LIVE.cache[key];
  await loadSchema(kind);
  const built = buildInput(kind, val);
  const tries = built ? [built] : GUESS[kind](val);
  let lastErr;
  for(let i=0;i<tries.length;i++){
    try{
      const r = await LIVE.mcp.callTool(SERVER, TOOL[kind], tries[i], {cache:{staleTime:60000, refresh:fresh}});
      if(!LIVE.schema[kind]) loadSchema(kind);
      const out = {payload: r.payload ?? r, at: r.cache ? r.cache.storedAt : Date.now()};
      LIVE.cache[key] = out; if(LIVE.state!=="on") setLive("on");
      return out;
    }catch(e){
      lastErr = e;
      if(e && (e.code==="upstream_error") && e.retryable && i===0){ await new Promise(r=>setTimeout(r,(e.retryAfterMs||1500)+Math.random()*500)); try{ const r=await LIVE.mcp.callTool(SERVER,TOOL[kind],tries[i]); const out={payload:r.payload??r,at:Date.now()}; LIVE.cache[key]=out; setLive("on"); return out; }catch(e2){ lastErr=e2; } }
      if(!(e && (e.code==="tool_error" || e.code==="bad_request")) || built) break;
      if(!LIVE.schema[kind]){ await loadSchema(kind); const b2 = buildInput(kind,val); if(b2){ tries.splice(i+1, tries.length, b2); } }
    }
  }
  throw lastErr;
}

/* normalizing whatever shape the connector returns */
const isNct = v => typeof v==="string" && /^NCT\d{8}$/i.test(v.trim());
function nctOf(o){
  if(!o || typeof o!=="object" || Array.isArray(o)) return null;
  const im = o.protocolSection && o.protocolSection.identificationModule;
  if(im && isNct(im.nctId)) return im.nctId.toUpperCase();
  for(const k of Object.keys(o)) if(/nct|^id$/i.test(k) && isNct(o[k])) return o[k].toUpperCase();
  return null;
}
function deepPick(o, names, depth=6){
  const want = names.map(n=>n.toLowerCase().replace(/[_\s]/g,""));
  const q = [[o,0]];
  for(const w of want){
    const queue = [[o,0]];
    while(queue.length){
      const [x,d] = queue.shift();
      if(!x || typeof x!=="object") continue;
      if(Array.isArray(x)){ if(d<depth) x.slice(0,30).forEach(v=>queue.push([v,d+1])); continue; }
      for(const [k,v] of Object.entries(x)){
        if(k.toLowerCase().replace(/[_\s]/g,"")===w && v!=null && v!=="") return v;
        if(d<depth && typeof v==="object") queue.push([v,d+1]);
      }
    }
  }
  return null;
}
function txt(v){
  if(v==null) return "";
  if(typeof v==="string") return v;
  if(typeof v==="number"||typeof v==="boolean") return String(v);
  if(Array.isArray(v)) return v.map(txt).filter(Boolean).join("; ");
  for(const k of ["name","date","measure","count","value","text","label"]) if(v[k]!=null) return txt(v[k]) + (k==="measure"&&v.timeFrame?` (${v.timeFrame})`:"");
  return Object.values(v).map(txt).filter(Boolean).slice(0,3).join(", ");
}
function arr(v){ if(v==null) return []; if(Array.isArray(v)) return v; return [v]; }
const DESIGN_MAP = {RANDOMIZED:"Randomized", NON_RANDOMIZED:"Not randomized", NONE:"Open-label", SINGLE:"Single-blind", DOUBLE:"Double-blind", TRIPLE:"Double-blind", QUADRUPLE:"Double-blind", PARALLEL:"Parallel groups", CROSSOVER:"Crossover", SINGLE_GROUP:"Single group", FACTORIAL:"Factorial", SEQUENTIAL:"Sequential", NA:""};
const prettyDesign = s => { const k = String(s).toUpperCase().replace(/[\s-]+/g,"_"); return k in DESIGN_MAP ? DESIGN_MAP[k] : String(s).replace(/_/g," ").toLowerCase().replace(/^\w/,c=>c.toUpperCase()); };
function normStudy(o, id){
  const g = (...n) => deepPick(o, n);
  const outs = v => arr(v).map(x => typeof x==="string" ? [x,""] : [txt(x.measure||x.title||x.name||x.description||x), txt(x.timeFrame||x.time_frame||x.timeframe||"")]).filter(x=>x[0]);
  return {
    id, short: txt(g("acronym")) || null, title: txt(g("briefTitle","brief_title","title","officialTitle")),
    official: txt(g("officialTitle","official_title")) || (o && o.title && o.brief_title ? txt(o.title) : ""),
    status: txt(g("overallStatus","overall_status","status","recruitmentStatus")),
    phase: phaseTxt(g("phases","phase")),
    sponsor: txt(g("leadSponsor","lead_sponsor","sponsor","leadSponsorName")),
    conditions: txt(g("conditions","condition")),
    interventions: arr(g("interventions","intervention")).map(x => typeof x==="string" ? x : txt(x.name||x.interventionName) + (x.type||x.interventionType ? ` (${txt(x.type||x.interventionType).toLowerCase().replace(/_/g," ")})` : "")),
    lastUpdate: txt(g("lastUpdatePostDate","last_update_post_date","lastUpdatePostDateStruct","lastUpdateSubmitDate","last_updated","lastUpdated","last_update")),
    start: txt(g("startDate","start_date","startDateStruct")),
    primaryCompletion: txt(g("primaryCompletionDate","primary_completion_date","primaryCompletionDateStruct")),
    enrollment: txt(g("enrollmentInfo","enrollment","enrollment_count","enrollmentCount")),
    summary: txt(g("briefSummary","brief_summary","summary","description")),
    eligibility: txt(g("eligibilityCriteria","eligibility_criteria","criteria")),
    minAge: txt(g("minimumAge","minimum_age","min_age")), maxAge: txt(g("maximumAge","maximum_age","max_age")),
    sex: txt(g("sex","gender")), healthy: txt(g("healthyVolunteers","healthy_volunteers")),
    primary: outs(g("primaryOutcomes","primary_outcomes","primaryOutcome","primary_outcome")),
    secondary: outs(g("secondaryOutcomes","secondary_outcomes","secondaryOutcome")).slice(0,5),
    design: [g("allocation"), g("masking"), g("interventionModel","intervention_model")].map(txt).filter(Boolean).map(prettyDesign).filter(Boolean),
    hasResults: g("hasResults","has_results")
  };
}
function parseText(s){
  const ids = [...s.matchAll(/NCT\d{8}/g)];
  const out = [], seen = new Set();
  ids.forEach((m,i) => {
    const id = m[0]; if(seen.has(id)) return; seen.add(id);
    const chunk = s.slice(m.index, ids[i+1] ? ids[i+1].index : m.index+1500);
    const f = re => { const r = chunk.match(re); return r ? r[1].trim().replace(/\*+/g,"") : ""; };
    let title = f(/(?:Brief )?Title\**\s*[:\-]\s*([^\n|]+)/i) || chunk.split("\n")[0].replace(id,"").replace(/^[\s:\-–—|*#)\]]+/,"").trim();
    out.push({ id, title, status: f(/Status\**\s*[:\-]\s*([^\n|]+)/i), phase: phaseTxt(f(/Phases?\**\s*[:\-]\s*([^\n|]+)/i)), sponsor: f(/Sponsor\**\s*[:\-]\s*([^\n|]+)/i), conditions: f(/Conditions?\**\s*[:\-]\s*([^\n|]+)/i), lastUpdate: f(/Last (?:Update|Updated)[^:\n]*[:\-]\s*([^\n|]+)/i), start: f(/Start Date\**\s*[:\-]\s*([^\n|]+)/i), raw: chunk });
  });
  return out;
}
function findStudies(p){
  if(typeof p==="string"){ try{ p = JSON.parse(p); }catch(e){ return parseText(p); } }
  const out = [], seen = new Set();
  (function walk(x, d){
    if(!x || typeof x!=="object" || d>7) return;
    if(Array.isArray(x)){ x.forEach(v=>walk(v,d+1)); return; }
    const id = nctOf(x);
    if(id){ if(!seen.has(id)){ seen.add(id); out.push(normStudy(x,id)); } return; }
    Object.values(x).forEach(v=>walk(v,d+1));
  })(p,0);
  return out;
}
function detailOf(payload, id){
  let p = payload;
  if(typeof p==="string"){ try{ p = JSON.parse(p); }catch(e){ const s = parseText(p).find(x=>x.id===id) || {id}; return {...s, rawText: payload}; } }
  const s = findStudies(p).find(x=>x.id===id) || normStudy(p, id);
  s.rawObj = p; return s;
}

/* start-up */
async function boot(){
  const inClaude = /claude\.ai|claudeusercontent|anthropic/.test(location.hostname) || window.parent !== window;
  for(let i=0;i<(inClaude?30:3) && !(window.claude && window.claude.use);i++) await new Promise(r=>setTimeout(r,100));
  if(!(window.claude && window.claude.use)){
    LIVE.mode = "http";
    LIVE.downloads = {save: async ({filename, data}) => { const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([data],{type:"text/markdown"})); a.download=filename; document.body.appendChild(a); a.click(); a.remove(); return {status:"saved"}; }};
    if(await probeHttp()){ startLive(); }
    else { setLive("none","Live updates are unavailable right now, so you’re seeing the saved copy."); loadSnapshotFallback(); regProbeLater(); }
    return;
  }
  LIVE.mode = "mcp";
  const [m, s, d] = await Promise.all(["mcp","sample","downloads"].map(n => window.claude.use(n).catch(()=>null)));
  LIVE.mcp = m; LIVE.sample = s; LIVE.downloads = d;
  if(curView==="trial") renderTrial();
  if(!m){ setLive("none","Live data works when this page is opened in claude.ai with the Clinical Trials connector."); return; }
  try{
    const l = await m.listTools(SERVER);
    const sv = l.servers.find(x=>x.server===SERVER);
    if(!sv || !sv.tools.length){ setLive("off","Add the Clinical Trials connector in claude.ai Settings → Connectors, then reload this page."); return; }
    if(sv.authStatus==="needs_reauth"){ setLive("off","Reconnect the Clinical Trials connector in claude.ai Settings → Connectors."); return; }
  }catch(e){ const r=liveErr(e); setLive(r.st, r.msg); return; }
  const perms = await window.claude.use("permissions").catch(()=>null);
  const ps = perms ? await perms.state("mcp:"+SERVER).catch(()=>"unavailable") : "prompt";
  if(ps==="granted" || store("ts_live")){ startLive(); } else setLive("ready","Turn on live data to search ClinicalTrials.gov and track trials as they change.");
}
async function startLive(){
  setLive("connecting","Connecting to ClinicalTrials.gov…");
  try{
    await refreshWatch(true);
    store("ts_live", 1);
    if(LIVE.state!=="on") setLive("on");
    if(curView==="trials") renderHome();
    if(curView==="trial") renderTrialInPlace();
    if(curView==="new") renderRegLive();
  }catch(e){ const r=liveErr(e); setLive(r.st==="error"?"ready":r.st, r.msg); }
}

/* tracking: refresh followed trials, detect changes */
async function refreshWatch(throwFirst){
  const ids = Object.keys(WATCH); let first = true;
  for(const id of ids){
    try{
      const r = await callLive("details", id, {fresh:true});
      const s = detailOf(r.payload, id);
      const w = WATCH[id] || (WATCH[id] = {});
      const cur = {status:s.status||"", lastUpdate:s.lastUpdate||"", title:s.title||"", pc:s.primaryCompletion||"", enr:s.enrollment||"", short:s.short||""};
      if(!w.seen) w.seen = cur;
      w.latest = cur; w.checked = r.at || Date.now();
    }catch(e){ if(throwFirst && first) throw e; WATCH[id] && (WATCH[id].err = liveErr(e).msg); }
    first = false;
  }
  saveWatch();
  if(curView==="trials") renderFollow();
}
setInterval(() => { if(LIVE.state==="on" && !document.hidden && !regDirect()) refreshWatch(false); }, 15*60*1000);   // direct mode: the registry poller in live.js covers this

