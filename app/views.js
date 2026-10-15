
/* ================= Icons (one stroke family) ================= */
const ICON = {
  weight:'<rect x="3.5" y="4" width="17" height="16" rx="4"/><path d="M8.5 10a3.5 3.5 0 0 1 7 0"/><path d="M12 10l1.6-1.6"/>',
  heart:'<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  memory:'<path d="M9.5 4.5A3 3 0 0 0 6.6 7 3 3 0 0 0 4.5 12a3 3 0 0 0 2.1 4.9A3 3 0 0 0 12 18.5V5.6a2.2 2.2 0 0 0-2.5-1.1z"/><path d="M14.5 4.5A3 3 0 0 1 17.4 7a3 3 0 0 1 2.1 5 3 3 0 0 1-2.1 4.9A3 3 0 0 1 12 18.5"/>',
  lung:'<path d="M12 4v7"/><path d="M12 11c-1.2 0-2.2.9-2.2 2.2v4.3A2.5 2.5 0 0 1 7.3 20C5.2 20 4 18.6 4 16.2 4 11.5 6 7 8.2 7c1 0 1.6.8 1.6 1.8"/><path d="M12 11c1.2 0 2.2.9 2.2 2.2v4.3a2.5 2.5 0 0 0 2.5 2.5c2.1 0 3.3-1.4 3.3-3.8C20 11.5 18 7 15.8 7c-1 0-1.6.8-1.6 1.8"/>',
  breast:'<path d="M12 3.5c1.9 0 3.1 1.5 3.1 3.4 0 2.6-3.1 6.1-3.1 6.1S8.9 9.5 8.9 6.9c0-1.9 1.2-3.4 3.1-3.4z"/><path d="M10.4 11.2 6.8 20l2.9-1.2 1.4 2.4 2-5.2"/><path d="M13.6 11.2 17.2 20l-2.9-1.2"/>',
  kidney:'<path d="M15.5 4C11 4 6 7.2 6 13c0 4 2.1 7 5 7 2 0 3-1.6 3-3.4 0-1.8 1.4-2.2 2.6-3.3 2.2-2 3.2-4.4 1.6-7.2C17.6 4.9 16.6 4 15.5 4z"/>',
  people:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="17" cy="9" r="2.5"/><path d="M15.8 14.8c2.3.2 4 1.9 4.6 4.7"/>',
  pill:'<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.3 8.1l5.4 7.8"/>',
  ruler:'<path d="M4 15.5 15.5 4 20 8.5 8.5 20z"/><path d="M8 11.5l1.8 1.8M10.8 8.7l1.2 1.2M13.6 5.9l1.8 1.8"/>',
  shield:'<path d="M12 3.5 5 6v5.5c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  next:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  back:'<path d="M15 6l-6 6 6 6"/>',
  check:'<path d="M5 12.5l4.2 4.2L19 7"/>', star:'<path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.2-4.6-2.4-4.6 2.4.9-5.2L4.5 10l5.2-.8z"/>',
  flag:'<path d="M6 21V4.5"/><path d="M6 5h11l-2.5 4L17 13H6"/>', clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>', chev:'<path d="M6 9l6 6 6-6"/>', stop:'<circle cx="12" cy="12" r="8.5"/><path d="M8.5 15.5l7-7"/>'
};
const svg = (k, cls="") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]||""}</svg>`;
const VICON = {4:"check", 3:"star", 2:"flag", 1:"clock", 0:"stop", 5:"clock", 6:"clock", 7:"clock"};
function verdictBadge(lv){ const v = VERDICT[lv]; return `<span class="verdict v-${v.key}">${svg(VICON[lv])}${esc(v.label)}</span>`; }
const isApproved = txt => /approv|indication/i.test(txt||"") && !/plans? to|to file|expected/i.test(txt||"");
const resultLevel = t => t.evidence==="published" ? 3 : t.evidence==="topline" ? 2 : 1;
const levelOf = t => isApproved(t.next) ? 4 : resultLevel(t);
const newsLevel = newsHandLevel;   // the rule lives in shared/news.js so the snapshot job and the page agree
const firstSentence = s => { const m = String(s||"").match(/^.*?[.?!](\s|$)/); return (m ? m[0] : String(s||"")).trim(); };
const topicName = id => (TOPICS.find(t=>t.id===id)||{}).label || "";
function renderBadge(){}

/* ================= Router ================= */
let curView = "home", curTrial = null;
const ALIAS = {"":"home", trials:"home", start:"home", new:"news", updates:"news"};
function route(){
  const h = (location.hash||"").replace("#","");
  let v = ALIAS[h] ?? h;
  if(/^NCT\d{8}$/i.test(h)){ v = "trial"; curTrial = h.toUpperCase(); }
  if(!["home","trial","news","about"].includes(v)) v = "home";
  curView = v === "home" ? "trials" : v;
  $$(".view").forEach(s => s.hidden = s.dataset.view !== v);
  const nv = v==="trial" ? "home" : v;
  $$(".nav a").forEach(a => a.getAttribute("href")==="#"+nv ? a.setAttribute("aria-current","page") : a.removeAttribute("aria-current"));
  ({home:renderHome, trial:renderTrial, news:renderNews, about:()=>{}})[v]();
  window.scrollTo(0,0); tip.hidden = true;
  const P = PLAIN[curTrial];
  document.title = v==="trial" ? `${(lib(curTrial)||{}).short || curTrial} · TrialSignal` : v==="news" ? "What’s new · TrialSignal" : v==="about" ? "About · TrialSignal" : "TrialSignal";
}
window.addEventListener("hashchange", route);
const go = h => { if(location.hash==="#"+h) route(); else location.hash = h; };
const openTrial = id => go(id);

/* ================= Home ================= */
let topic = "all", showAll = false, searchState = {q:"", results:null, loading:false, err:"", live:false};
function studyCard(t){
  const P = PLAIN[t.id] || {};
  return `<a class="study" href="#${t.id}"><h3>${esc(P.ask || t.title)}</h3><span class="meta">${verdictBadge(levelOf(t))}<span>${esc(plainStatus(t.status))}</span></span></a>`;
}
function plainTitle(s){
  const drug = (s.interventions||[]).map(x=>String(x).replace(/\s*\(.*\)$/,"")).find(x=>!/placebo|standard|usual|chemo/i.test(x));
  const cond = String(s.conditions||"").split(/;|,/)[0].trim();
  if(drug && cond) return `A study of ${drug} for ${cond.toLowerCase()}`;
  if(cond) return `A study about ${cond.toLowerCase()}`;
  return s.title || "A medical study";
}
function liveCard(s){
  return `<a class="study" href="#${s.id}"><h3>${esc(plainTitle(s))}</h3><span class="meta">${verdictBadge(1)}<span>${esc(plainStatus(s.status))}</span></span></a>`;
}
function renderLiveNote(){ /* live state is shown inside results and on study pages */ }
function renderFollow(){ renderSaved(); }
function renderRegLive(){}
function renderList(){
  const out = $("#studyList"), meta = $("#listMeta"), h = $("#listH");
  if(searchState.q){
    h.textContent = `Results for “${searchState.q}”`;
    meta.innerHTML = `<button class="btn ghost" type="button" id="clearSearch" style="min-height:40px;padding:8px 16px">Clear search</button>`;
    $("#clearSearch").onclick = () => { $("#searchInput").value = ""; searchState = {q:""}; renderList(); };
    if(searchState.loading){ out.innerHTML = `<p class="empty"><span class="spin" aria-hidden="true"></span>Looking on ClinicalTrials.gov…</p>`; return; }
    if(searchState.err){ out.innerHTML = `<p class="empty">${esc(searchState.err)}</p>`; return; }
    const r = searchState.results || [];
    out.innerHTML = r.length ? `<div class="studies">${r.map(x => searchState.live ? liveCard(x) : studyCard(x)).join("")}</div>${searchState.live ? `<p class="small faint" style="margin-top:12px">These are the most recently updated matching studies on ClinicalTrials.gov. Plain-English summaries are only available for the studies in our library.</p>` : ""}`
      : `<p class="empty">We couldn’t find a match. Try a simpler word, like “heart” or “cancer”.</p>`;
    return;
  }
  h.textContent = topic==="all" ? "Studies people ask about" : topicName(topic);
  let list = topic==="all" ? TRIALS : TRIALS.filter(t => (PLAIN[t.id]||{}).topic===topic);
  const total = list.length;
  if(topic==="all" && !showAll) list = ["NCT03548935","NCT03887455","NCT03036124","NCT02578680","NCT03036488","NCT05929066"].map(lib);
  out.innerHTML = `<div class="studies">${list.map(studyCard).join("")}</div>` + (topic==="all" ? `<div style="text-align:center;margin-top:20px"><button class="btn soft" type="button" id="moreBtn">${showAll ? "Show fewer" : `Show all ${total} studies`}</button></div>` : "");
  meta.textContent = "";
  const mb = $("#moreBtn"); if(mb) mb.onclick = () => { showAll = !showAll; renderList(); };
}
function renderTopics(){
  $("#topics").innerHTML = [{id:"all",label:"All"}, ...TOPICS].map(t => `<button class="topic" type="button" data-topic="${t.id}" aria-pressed="${topic===t.id && !searchState.q}">${t.id!=="all"?svg(t.id):""}${esc(t.label)}</button>`).join("");
}
function renderHome(){
  renderTopics(); renderList();
  $("#scale").innerHTML = [4,3,2,1].map(l => `<li>${verdictBadge(l)}<span>${esc(VERDICT[l].why)}</span></li>`).join("");
}
$("#topics").addEventListener("click", e => { const b = e.target.closest("[data-topic]"); if(!b) return; topic = b.dataset.topic; showAll = false; searchState = {q:""}; $("#searchInput").value=""; renderTopics(); renderList(); });
async function doSearch(q){
  q = q.trim();
  const hint = $("#searchHint"); hint.classList.remove("err"); hint.textContent = "You can also paste a study number, like NCT04184622.";
  if(!q){ hint.classList.add("err"); hint.textContent = "Type a condition, a medicine or a study number first."; return; }
  const id = parseNCT(q); if(id){ openTrial(id); return; }
  const words = q.toLowerCase().replace(/[’']s?\b/g,"").split(/\s+/).filter(w=>w.length>2).map(w=>w.slice(0,6));
  const local = TRIALS.filter(t => { const P=PLAIN[t.id]||{}; const hay=[t.short,t.title,t.condition,t.intervention,t.area,P.ask,topicName(P.topic)].join(" ").toLowerCase().replace(/[’']/g,""); return words.some(w=>hay.includes(w)); });
  searchState = {q, results:local, loading:false, err:"", live:false};
  renderTopics();
  if(!local.length && LIVE.state==="on"){
    searchState.loading = true; renderList();
    try{
      const r = await callLive("search", q);
      let list = findStudies(r.payload);
      searchState = {q, results:list, loading:false, err:"", live:true};
    }catch(e){ searchState = {q, results:[], loading:false, err:liveErr(e).msg}; }
  }
  renderList();
  $("#listH").scrollIntoView({block:"start", behavior:"smooth"});
}
$("#searchForm").addEventListener("submit", e => { e.preventDefault(); doSearch($("#searchInput").value); });

/* ================= Study page ================= */
const detailState = {};
function accItem(icon, title, body, open=false){
  return `<details${open?" open":""}><summary><span class="ic">${svg(icon)}</span><span class="t">${esc(title)}</span>${svg("chev","chev")}</summary><div class="body">${body}</div></details>`;
}
function list(a){ return a && a.length ? `<ul>${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : `<p>Not listed here. The official record has the full list.</p>`; }
function renderTrial(){
  const id = curTrial, L = lib(id), P = PLAIN[id], ds = detailState[id] || (detailState[id] = {});
  if(LIVE.state==="on" && !ds.loading && !ds.live && !ds.err){
    ds.loading = true;
    callLive("details", id).then(r => { ds.live = detailOf(r.payload, id); ds.at = r.at; }).catch(e => { ds.err = liveErr(e).msg; })
      .finally(() => { ds.loading = false; if(curView==="trial" && curTrial===id) renderTrial(); });
  }
  const S = ds.live, out = $("#trialOut");
  const back = `<a class="back" href="#home">${svg("back")}All studies</a>`;
  if(!L && !S){
    out.innerHTML = `<div class="stack" style="gap:24px">${back}<div class="t-head"><h1>${ds.loading ? "Opening this study…" : "We don’t have a plain-English summary for this study yet"}</h1>
      <p class="muted" style="font-size:1.1rem">${ds.loading ? `<span class="spin" aria-hidden="true"></span>Getting the details from ClinicalTrials.gov.` : `${ds.err ? esc(ds.err)+" " : ""}You can still read the official record for study ${id}.`}</p>
      ${ds.loading ? "" : `<div class="actions"><a class="btn" href="${ctUrl(id)}" target="_blank" rel="noopener">Open the official record</a><a class="btn ghost" href="#home">Browse studies</a></div>`}</div></div>`;
    return;
  }
  const saved = !!WATCH[id];
  const status = (S && S.status) || (L && L.status);
  const phase = (L && L.phase) || (S && S.phase);
  const people = L ? L.enrollment : S.enrollment;
  const sponsor = (L && L.sponsor) || (S && S.sponsor);
  const lv = L ? levelOf(L) : 1;
  const whyMore = L && lv===4 ? `Tested with ${Number(people).toLocaleString("en-US")} people, checked by outside experts, and approved by the FDA.` : VERDICT[lv].why;
  const facts = [status && ["flag", plainStatus(status)], phase && ["ruler", plainPhase(phase)], sponsor && ["people", `Run by ${sponsor}`], !L && people && ["people", `${Number(people).toLocaleString("en-US")} people`]].filter(Boolean);

  let head, answer, items;
  if(L){
    head = `<h1>${esc(P.ask)}</h1><p class="name">From ${esc(L.short)}, a ${esc(topicName(P.topic).toLowerCase())} study</p>`;
    answer = `<h2>The short answer</h2><p class="big">${esc(P.found)}</p>`;
    const cmp = /placebo/i.test(L.comparator) ? `Others got a ${term("dummy treatment","placebo")} that looked the same, so the two groups could be fairly compared. Nobody knew who got which.` : `Others got ${esc(L.comparator.charAt(0).toLowerCase()+L.comparator.slice(1))}, so the two could be compared.`;
    const src = L.evidence==="published"
      ? `<p><b>Published in:</b> ${esc(L.pub.journal==="N Engl J Med" ? "The New England Journal of Medicine" : L.pub.journal)}, ${L.pub.year}. <a href="${doiUrl(L.pub.doi)}" target="_blank" rel="noopener">Read the paper</a></p>`
      : `<p><b>Announced by the company</b> on ${fmtDate(L.topline.date)}. <a href="${esc(L.topline.url)}" target="_blank" rel="noopener">Read the report</a></p>`;
    items = [
      ["people","Who took part?", `<p>${esc(L.plainPop)}</p><p>${Number(L.enrollment).toLocaleString("en-US")} people took part.</p>
        <details><summary class="small" style="padding:10px 0;font-size:.95rem;color:var(--blue);min-height:44px">See who could and couldn’t join</summary><div style="margin-top:12px;display:flex;flex-direction:column;gap:12px"><div><b>Could join if they had:</b>${list(L.inclusion)}</div><div><b>Couldn’t join if they had:</b>${list(L.exclusion)}</div></div></details>`],
      ["pill","What did people get?", `<p>${esc(L.plainTx)}</p><p>${cmp}</p>`],
      ["ruler","How did they measure it?", `<p>${esc(P.measured)}</p>`],
      ["shield","Was it safe?", `<p>${esc(P.safe)}</p>`],
      ["next","What happens now?", `<p>${esc(L.next)}</p>`],
      ["info","Study details for the curious", `<dl class="kv"><dt>Study number</dt><dd>${id}</dd><dt>Full name</dt><dd>${esc(L.official || L.title)}</dd><dt>Stage</dt><dd>${esc(L.phase)} (${esc(plainPhase(L.phase).toLowerCase())})</dd><dt>Run by</dt><dd>${esc(L.sponsor)}</dd>${L.start?`<dt>Started</dt><dd>${fmtDate(L.start)}</dd>`:""}<dt>Main measure</dt><dd>${esc(L.primary.map(p=>`${p[0]} (${p[1]})`).join("; "))}</dd></dl>${src}<p><a href="${ctUrl(id)}" target="_blank" rel="noopener">Official record on ClinicalTrials.gov</a></p>`]
    ];
  } else {
    head = `<h1>${esc(plainTitle(S))}</h1><p class="name">Study ${id}</p>`;
    const n = S.enrollment ? `${Number(S.enrollment).toLocaleString("en-US")} people` : "";
    answer = `<h2>What we know so far</h2><p class="big">We don’t have a plain-English summary for this study yet. It is a ${esc((plainPhase(S.phase)||"medical study").toLowerCase())}${n?` with ${n}`:""}, and it is ${esc(plainStatus(S.status).toLowerCase() || "listed on the official registry")}.</p>`;
    items = [
      ["people","Who can take part?", `<dl class="kv">${S.minAge?`<dt>Ages</dt><dd>${esc(S.maxAge ? `${S.minAge.replace(/ Years?/i,"")} to ${S.maxAge.replace(/ Years?/i,"")}` : `${S.minAge.replace(/ Years?/i,"")} and older`)}</dd>`:""}${S.sex?`<dt>Sex</dt><dd>${esc(/^all$/i.test(S.sex)?"Anyone":S.sex.charAt(0)+S.sex.slice(1).toLowerCase())}</dd>`:""}${S.conditions?`<dt>Condition</dt><dd>${esc(S.conditions)}</dd>`:""}</dl>
        ${S.eligibility ? `<details><summary class="small" style="padding:10px 0;font-size:.95rem;color:var(--blue);min-height:44px">See the full list from the registry</summary><div class="raw" style="margin-top:12px">${esc(S.eligibility)}</div></details>` : ""}<p class="small">Only the study team can say whether someone can join.</p>`],
      ["pill","What do people get?", S.interventions.length ? list(S.interventions) : `<p>Not listed. The official record has the details.</p>`],
      ["ruler","How will they measure it?", S.primary.length ? list(S.primary.map(p=>p[0]+(p[1]?` (${p[1]})`:""))) : `<p>Not listed. The official record has the details.</p>`],
      ["next","Are there results?", `<p>We haven’t linked results for this study yet. The official record shows results if they’ve been posted, and a search on PubMed may find a published paper.</p><p><a href="https://pubmed.ncbi.nlm.nih.gov/?term=${id}" target="_blank" rel="noopener">Search PubMed for ${id}</a></p>`],
      ["info","Study details for the curious", `${S.summary?`<p><b>The registry’s description:</b> ${esc(S.summary)}</p>`:""}<dl class="kv"><dt>Study number</dt><dd>${id}</dd>${S.title?`<dt>Registry title</dt><dd>${esc(S.title)}</dd>`:""}${S.official?`<dt>Full name</dt><dd>${esc(S.official)}</dd>`:""}${S.sponsor?`<dt>Run by</dt><dd>${esc(S.sponsor)}</dd>`:""}${S.start?`<dt>Started</dt><dd>${esc(fmtDate(S.start))}</dd>`:""}${S.lastUpdate?`<dt>Last updated</dt><dd>${esc(fmtDate(S.lastUpdate))}</dd>`:""}</dl><p><a href="${ctUrl(id)}" target="_blank" rel="noopener">Official record on ClinicalTrials.gov</a></p>`]
    ];
  }
  const liveLine = S ? `Status is live from ClinicalTrials.gov.` : ds.loading ? `Checking the latest status…` : "";

  out.innerHTML = `<div class="stack" style="gap:28px">
    ${back}
    <header class="t-head">${head}</header>
    <div class="answer">${answer}
      <div class="sure">${verdictBadge(lv)}<p>${esc(whyMore)}</p></div>
      <ol class="ladder" aria-label="How sure we can be, from least to most">${[1,2,3,4].map(l=>`<li class="${l===lv?"on v-"+VERDICT[l].key:""}"${l===lv?' aria-current="step"':""}>${esc(VERDICT[l].label)}</li>`).join("")}</ol>
    </div>
    <div class="facts">${facts.map(([ic,f])=>`<span class="fact">${svg(ic)}${esc(f)}</span>`).join("")}</div>${liveLine?`<p class="small faint" style="margin-top:-12px">${liveLine}</p>`:""}
    <div class="actions">
      <button class="btn" id="saveBtn" type="button" aria-pressed="${saved}">${svg("bookmark")}${saved ? "Saved" : "Save this study"}</button>
      <a class="btn ghost" href="${ctUrl(id)}" target="_blank" rel="noopener">Official record</a>
    </div>
    <section class="stack" aria-labelledby="moreH" style="margin-top:20px">
      <h2 id="moreH">Want to know more?</h2>
      <div class="acc" id="acc">${items.map(([ic,t,b]) => accItem(ic,t,b)).join("")}</div>
    </section>
    <section class="ask" aria-labelledby="askH" style="margin-top:20px">
      <h2 id="askH">Have a question?</h2>
      <div class="qchips">${SUGG.map(s=>`<button class="qchip" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <form class="search" id="askForm" autocomplete="off" style="width:100%;box-shadow:none">
        <input type="text" id="askInput" placeholder="Type your own question" aria-label="Your question"><button class="btn" type="submit">Ask</button>
      </form>
      ${LIVE.sample ? `<label class="small muted" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="askAI" checked> Let Claude answer in plain words, using only this study’s record</label>` : ""}
      <div id="askLog" aria-live="polite"></div>
    </section>
  </div>`;

  const acc = $("#acc");
  acc.addEventListener("toggle", e => { if(e.target.open && e.target.parentElement===acc) $$(":scope > details", acc).forEach(d => { if(d!==e.target) d.open = false; }); }, true);
  $("#saveBtn").onclick = () => {
    if(WATCH[id]) delete WATCH[id];
    else { WATCH[id] = {added:Date.now()}; if(S){ const snap = {status:S.status||"",lastUpdate:S.lastUpdate||"",title:S.title||"",pc:S.primaryCompletion||"",enr:S.enrollment||"",short:S.short||""}; WATCH[id].seen = {...snap}; WATCH[id].latest = snap; WATCH[id].checked = ds.at; } }
    saveWatch(); renderSaved(); if(WATCH[id]) registerWatch([id]); toast(WATCH[id] ? "Saved. We’ll show any updates here." : "Removed from saved");
    const b = $("#saveBtn"); b.setAttribute("aria-pressed", !!WATCH[id]); b.innerHTML = svg("bookmark") + (WATCH[id] ? "Saved" : "Save this study");
  };
  $(".qchips", out).onclick = e => { const b=e.target.closest("[data-q]"); if(b) ask(id, b.dataset.q); };
  $("#askForm").onsubmit = e => { e.preventDefault(); const q=$("#askInput").value; $("#askInput").value=""; ask(id, q); };
}

/* ================= News ================= */
/* Drawing only. What is shown, and when it is fetched, is decided in news.js. */
function newsCard(n){
  const t = n.hand ? n.trial && lib(n.trial) : n.nct && lib(n.nct);
  const links = (t ? `<a href="#${t.id}">Read our plain-English summary</a>` : "") + n.links.map(([l,u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n.hand ? plainLink(l) : l)}</a>`).join("");
  const when = n.hand ? `${fmtDate(n.date)} · Picked by hand` : `${n.datePrefix||""}${fmtDate(n.date)} · ${n.sourcesLabel}`;
  const text = n.hand ? esc : newsBreakHtml;   // live text comes from a registry: very long unbroken runs (a URL) get break points so a phone never scrolls sideways
  return `<article class="news-item">
    <div class="top">${verdictBadge(n.level)}<span>${esc(when)}</span></div>
    <h3>${text(n.title)}</h3><p class="muted">${text(n.summary)}</p>
    <p class="links">${links}</p></article>`;
}
let newsLastHtml = null, newsLastIntro = null;
function newsDraw(){
  if(curView !== "news") return;
  const v = newsView(), html = v.items.map(newsCard).join(""), live = $("#newsLive"), list = $("#newsList");
  if(live && newsLastIntro !== v.intro){ live.innerHTML = v.intro; newsLastIntro = v.intro; }
  if(newsLastHtml !== html){ list.innerHTML = html; newsLastHtml = html; }   // unchanged: leave the DOM alone, so a focused link stays focused
}
function renderNews(){ newsOnOpen(); newsDraw(); }

/* ================= Saved ================= */
let lastFocus = null;
function renderSaved(){
  const ids = Object.keys(WATCH);
  $("#savedCount").textContent = ids.length ? ids.length : "";
  const box = $("#savedList"); if(!box) return;
  box.innerHTML = ids.length ? ids.map(id => {
    const L = lib(id), w = WATCH[id], latest = w.latest || {}, seen = w.seen || {};
    const changed = seen.status && latest.status && seen.status!==latest.status;
    const title = L ? (PLAIN[id]||{}).ask : (latest.title || id);
    return `<a class="study" href="#${id}" data-close="1"><h3>${esc(title)}</h3><span class="meta">${L?verdictBadge(levelOf(L)):""}<span>${esc(plainStatus(latest.status || (L&&L.status)))}</span></span>${changed?`<span class="small" style="color:var(--ink);font-weight:600">Status changed to “${esc(plainStatus(latest.status))}”</span>`:""}</a>`;
  }).join("") : `<p class="empty">Nothing saved yet. Open a study and select “Save this study” to keep it here.</p>`;
}
function openDrawer(){ lastFocus = document.activeElement; renderSaved(); $("#drawer").hidden = false; $("#scrim").hidden = false; $("#drawerClose").focus(); }
function closeDrawer(){ $("#drawer").hidden = true; $("#scrim").hidden = true; if(lastFocus) lastFocus.focus(); }
$("#savedBtn").onclick = openDrawer; $("#drawerClose").onclick = closeDrawer; $("#scrim").onclick = closeDrawer;
$("#savedList").addEventListener("click", e => { if(e.target.closest("[data-close]")) { $("#drawer").hidden = true; $("#scrim").hidden = true; } });
document.addEventListener("keydown", e => { if(e.key==="Escape" && !$("#drawer").hidden) closeDrawer(); });
function addNote(){}
function localAnswer(id, q){
  const L = lib(id), P = PLAIN[id], S = (detailState[id]||{}).live, s = q.toLowerCase();
  const k = (INTENTS.find(([re]) => re.test(s)) || [])[1];
  if(!k) return "Try asking what the study tested, who could take part, what they found, or whether it was safe.";
  if(L && P) return ({purpose:`${L.plainTx} ${P.measured}`, who:L.plainPop, what:L.plainTx, how:P.measured, found:P.found+" ("+VERDICT[levelOf(L)].label+")", safety:P.safe, status:"Status: "+plainStatus((S&&S.status)||L.status)+"."})[k];
  if(S) return ({purpose:firstSentence(S.summary)||"The registry has no short description.", who:[S.minAge&&`Ages ${S.minAge}${S.maxAge?` to ${S.maxAge}`:" and older"}`, S.conditions&&`People with ${S.conditions}`].filter(Boolean).join(". ")||"See the official record.", what:S.interventions.join(", ")||"Not listed.", how:S.primary.map(p=>p[0]).join("; ")||"Not listed.", found:"No results are linked here yet. Check the official record.", safety:"Safety results aren’t in the registry summary yet.", status:"Status: "+plainStatus(S.status)+"."})[k];
  return "This study’s record isn’t loaded.";
}

/* ================= go ================= */
renderSaved(); route(); boot();
