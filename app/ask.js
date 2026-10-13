function recordFor(id){
  const L = lib(id), S = (detailState[id]||{}).live;
  const o = {};
  if(L) Object.assign(o, {nct:L.id,name:L.short,title:L.title,sponsor:L.sponsor,phase:L.phase,status:(S&&S.status)||L.status,condition:L.condition,enrollment:L.enrollment,design:L.design,researchQuestion:L.question,population:L.plainPop,inclusion:L.inclusion,exclusion:L.exclusion,intervention:L.intervention,comparator:L.comparator,primaryOutcomes:L.primary,secondaryOutcomes:L.secondary,evidenceStatus:L.evidence,reportedResults:L.result,safety:L.safety,publication:L.pub||null,topline:L.topline||null,nextMilestone:L.next});
  else if(S){ const {rawObj, rawText, ...rest} = S; Object.assign(o, rest); }
  return JSON.stringify(o).slice(0, 24000);
}
async function explain(id){
  const out = $("#explainOut"); out.classList.remove("muted"); out.textContent = "Reading the record…"; $("#explainBtn").disabled = true;
  try{
    const r = await LIVE.sample(`Explain this public clinical-trial record to someone reading a trial for the first time. Use plain words and short paragraphs with these headings on their own lines: What the study asks / Who it is for / What is being tested / How success is measured / Where it stands now. Define any medical term in a few words. Use only the record. Do not judge anyone's eligibility or suggest a treatment is better. Plain text, no markdown symbols.\n\nRECORD:\n${recordFor(id)}`, {modelTier:"quick", onText:({text})=>{ out.textContent = text; }});
    out.textContent = r.text;
  }catch(e){ out.textContent = e && e.code==="not_granted" ? "Claude explanations are turned off for this page." : "Claude couldn’t explain this just now. Try again in a moment."; }
  $("#explainBtn").disabled = false;
}

/* ask */
const SUGG = ["What was this study trying to find out?","What treatment did people get?","Who could take part?","Was it safe?"];
const INTENTS = [
  [/(trying to|find out|purpose|aim|goal|about)/, "purpose"], [/(eligib|who can|who could|take part|inclusion|exclusion|criteria|join|qualif|requirement|age)/, "who"],
  [/(treatment|drug|medic|tested|intervention|dose|placebo|compar)/, "what"], [/(outcome|measur|endpoint|assess)/, "how"],
  [/(result|found|work|effective|benefit|show)/, "found"], [/(safe|side effect|adverse|risk)/, "safety"], [/(status|recruit|when|date|start|finish)/, "status"]
];
function localAnswer(id, q){
  const L = lib(id), S = (detailState[id]||{}).live, s = q.toLowerCase();
  const k = (INTENTS.find(([re]) => re.test(s)) || [])[1];
  if(!k) return "I couldn’t match that to part of the record. Try asking about the purpose, treatment, eligibility, outcomes, results, safety or status.";
  if(L) return ({purpose:L.question, who:L.plainPop+" Key inclusion: "+(L.inclusion||[]).join("; ")+". Key exclusion: "+(L.exclusion||[]).join("; ")+".", what:L.intervention+", compared with "+L.comparator.toLowerCase()+". "+L.plainTx,
    how:"Primary: "+L.primary.map(p=>p[0]+" ("+p[1]+")").join("; ")+". Secondary: "+L.secondary.map(p=>p[0]).join("; ")+".", found:L.result+" ("+EVID[L.evidence][1]+")", safety:L.safety,
    status:"Status: "+((S&&S.status)||L.status||"see the official record")+". Started "+fmtDate(L.start)+"."})[k];
  if(S) return ({purpose:S.summary, who:[S.minAge&&"Ages "+S.minAge+" to "+(S.maxAge||"no limit"), S.sex&&"Sex: "+S.sex, S.eligibility&&S.eligibility.slice(0,900)].filter(Boolean).join(". "), what:S.interventions.join("; "), how:S.primary.map(p=>p[0]).join("; "), found:"No results are linked in TrialSignal. Check the record’s Results section.", safety:"Safety results aren’t in the record summary.", status:"Status: "+S.status+(S.lastUpdate?". Last updated "+fmtDate(S.lastUpdate):"")})[k] || "That part of the record wasn’t returned. Check the official record.";
  return "This trial’s record isn’t loaded.";
}
async function ask(id, q){
  if(!q.trim()) return;
  const log = $("#askLog"), d = document.createElement("div"); d.className = "qa";
  d.innerHTML = `<div class="qa-q">${esc(q)}</div><div class="qa-a"><p></p></div>`; log.prepend(d);
  const p = d.querySelector("p");
  const ai = LIVE.sample && $("#askAI") && $("#askAI").checked;
  if(!ai){ p.textContent = localAnswer(id, q); return; }
  p.innerHTML = '<span class="spinner"></span> Reading the record…';
  try{
    const r = await LIVE.sample(`Answer a question about one public clinical-trial record for a first-time reader. Use ONLY the record below. 2-5 short plain sentences. If the record doesn't say, say so and suggest checking ClinicalTrials.gov. Never judge whether a specific person is eligible or which treatment is better. Mention if results are a company announcement rather than peer-reviewed. Plain text only.\n\nRECORD:\n${recordFor(id)}\n\nQUESTION: ${q}`, {modelTier:"quick", onText:({text})=>{ p.textContent = text; }});
    p.textContent = r.text;
  }catch(e){ p.textContent = localAnswer(id, q); }
}

