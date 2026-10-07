// One trial, read as five plain steps plus questions.

import { $, $$, esc, fmtDate, ago, num, ctUrl, doiUrl, pubmedUrl, toast } from "../util.js";
import { term, linkTerms, statusPill, evidencePill, evidenceLabel, spinner } from "../ui.js";
import { statusLabel, isRunning, splitCriteria, designTags, ageLabel, sexLabel, armTypeLabel } from "../normalize.js";
import { lib, LIBRARY_REVIEWED } from "../../data/library.js";
import { SITE } from "../config.js";
import { known, loadStudy, follow, toggleFollow, SNAPSHOT_DATE } from "../state.js";
import { answer, SUGGESTIONS } from "../ask.js";
import { addNote } from "../notes.js";

const detail = {}; // per trial: { loading, err, status, asked: [] }
let current = null;
let observer = null;

const STEPS = [
  ["question", "The question"],
  ["who", "Who it’s for"],
  ["what", "What’s tested"],
  ["how", "How it’s measured"],
  ["found", "What’s been found"],
  ["ask", "Ask a question"],
];

export function renderTrial(id) {
  current = id;
  const ds = detail[id] || (detail[id] = { asked: [] });
  const k = known(id);
  if (!SITE.preview && k.source !== "live" && !ds.loading && !ds.tried) {
    ds.loading = true;
    loadStudy(id)
      .catch((e) => { ds.err = e.message; ds.status = e.status; })
      .finally(() => { ds.loading = false; ds.tried = true; if (current === id && location.hash.slice(1).toUpperCase() === id) renderTrial(id); });
  }
  const L = lib(id);
  const { model: M, source, at } = known(id);
  const out = $("#trialOut");

  if (!M) {
    out.innerHTML = `<div class="block">
      <a class="back" href="#trials">← All trials</a>
      <div class="t-head"><span class="nct">${id}</span>
        <h1>${ds.loading ? "Loading this trial…" : ds.status === 404 ? "No trial with this number" : "This trial can’t be loaded here"}</h1>
        ${ds.loading ? `<p class="muted">${spinner} Reading the record from ClinicalTrials.gov.</p>` : `
        <p class="lede">${ds.status === 404 ? "ClinicalTrials.gov has no study with that number. Check the digits and try again." : SITE.preview ? "This preview only includes the trials in the TrialSignal library. The hosted site reads any trial live from ClinicalTrials.gov." : esc(ds.err || "")}</p>
        <div class="t-actions"><a class="btn" href="${ctUrl(id)}" target="_blank" rel="noopener">Open on ClinicalTrials.gov ↗</a><a class="btn quiet" href="#trials">Browse the library</a></div>`}
      </div></div>`;
    return;
  }

  const used = new Set();
  const lt = (s) => linkTerms(s, { used });
  const name = (L && L.short) || M.acronym || M.title;
  const following = follow.has(id);

  const src = source === "live"
    ? `<span class="pill p-ok dot">Live</span> Registry details from ClinicalTrials.gov, fetched ${ago(at)}.${L ? ` Plain-language summary reviewed ${fmtDate(LIBRARY_REVIEWED)}.` : ""}`
    : `<span class="pill">Saved copy</span> Registry details saved ${fmtDate(SNAPSHOT_DATE)}.${ds.loading ? ` ${spinner} Checking for updates…` : ""}${L ? ` Plain-language summary reviewed ${fmtDate(LIBRARY_REVIEWED)}.` : ""}`;

  const enrol = M.enrollment && M.enrollment.count != null
    ? `${num(M.enrollment.count)} ${M.enrollment.type === "ESTIMATED" ? "planned" : "people"}` : "";
  const pc = M.dates.primaryCompletion;
  const facts = [
    M.sponsor && [term("Sponsor"), esc(M.sponsor)],
    enrol && [term("Enrollment"), `<span class="num">${enrol}</span>`],
    M.dates.start && ["Started", esc(fmtDate(M.dates.start))],
    pc && [M.dates.primaryCompletionType === "ESTIMATED" ? "Main results expected" : "Main results collected", esc(fmtDate(pc))],
    M.sites && ["Sites", `<span class="num">${num(M.sites)}</span>${M.countries.length ? ` in ${plural(M.countries.length)}` : ""}`],
    M.dates.lastUpdate && ["Record updated", esc(fmtDate(M.dates.lastUpdate))],
  ].filter(Boolean);

  const steps = L ? libSteps(L, M, lt) : liveSteps(M);
  steps.push(askStep(id, ds));

  out.innerHTML = `
  <div class="block t-top">
    <a class="back" href="#trials">← All trials</a>
    <div class="t-head">
      <div class="t-meta"><span class="nct">${id}</span>${statusPill(M.status)}${M.phase ? `<span class="pill">${term(M.phase, "phase")}</span>` : ""}${L ? evidencePill(L.evidence) : ""}</div>
      <h1>${esc(name)}</h1>
      ${name !== M.title ? `<p class="t-title">${esc(M.title)}</p>` : ""}
      <div class="t-actions">
        <button class="btn" type="button" id="followBtn" aria-pressed="${following}">${following ? "✓ Following" : "Follow this trial"}</button>
        <a class="btn quiet" href="${ctUrl(id)}" target="_blank" rel="noopener">Official record ↗</a>
        <button class="btn quiet" type="button" id="noteBtn">Add to notes</button>
      </div>
      <p class="srcline">${src}</p>
    </div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${stages(L, M)}
  </div>
  <div class="reader">
    <nav class="toc" aria-label="Steps in this trial">${steps.map((s, i) => `<a href="#${id}" data-jump="${s.key}"><span class="toc-n">${i + 1}</span>${esc(s.label)}</a>`).join("")}</nav>
    <div class="steps">
      ${steps.map((s, i) => `<section class="step" id="st-${s.key}" aria-labelledby="h-${s.key}">
        <div class="step-h"><span class="eyebrow">Step ${i + 1} · ${esc(s.label)}</span><h2 id="h-${s.key}">${esc(s.q)}</h2></div>
        ${s.body}
      </section>`).join("")}
    </div>
  </div>`;

  bind(id, L, M, name);
}

function plural(n) { return n === 1 ? "1 country" : `${n} countries`; }

// ── where the trial is on the road from plan to decision ─────────────
function stages(L, M) {
  const st = M.status;
  const running = isRunning(st);
  const ended = ["COMPLETED", "TERMINATED", "WITHDRAWN"].includes(st);
  const results = L
    ? L.evidence === "published"
      ? { state: "done", cap: `Paper in ${L.pub.journal}, ${L.pub.year}` }
      : { state: "now", cap: `Company announcement, ${fmtDate(L.topline.date)}` }
    : M.hasResults
      ? { state: "done", cap: `Posted on the registry${M.dates.resultsPosted ? `, ${fmtDate(M.dates.resultsPosted)}` : ""}` }
      : { state: "", cap: M.dates.primaryCompletionType === "ESTIMATED" && M.dates.primaryCompletion ? `Expected after ${fmtDate(M.dates.primaryCompletion)}` : "None linked yet" };
  const list = [
    ["Registered", "done", M.dates.firstPosted ? `Posted ${fmtDate(M.dates.firstPosted)}` : "On ClinicalTrials.gov"],
    ["Running", running ? "now" : ended ? "done" : "", running ? statusLabel(st) : st === "TERMINATED" ? "Stopped early" : st === "WITHDRAWN" ? "Withdrawn before enrolling" : ended ? `Finished ${fmtDate(M.dates.primaryCompletion)}` : statusLabel(st) || "Status unknown"],
    ["Results", results.state, results.cap],
    ["Decision", L && L.decision ? "done" : "", L && L.decision ? `${L.decision.label}, ${fmtDate(L.decision.date)}` : "No regulatory decision recorded here"],
  ];
  return `<div class="stages-wrap"><p class="eyebrow">Where this trial is now</p>
    <ol class="stages">${list.map(([t, s, c]) => `<li class="${s}"><b>${t}<span class="sr">${s === "done" ? " (done)" : s === "now" ? " (current stage)" : " (not yet)"}</span></b><span>${esc(c)}</span></li>`).join("")}</ol></div>`;
}

// ── step bodies ──────────────────────────────────────────────────────
const plainly = (html) => `<div class="plainly"><span class="eyebrow">In plain words</span><p>${html}</p></div>`;
const gap = (what = "Not listed in the record.") => `<p class="gap">${what} Check the official record.</p>`;

function critList(items) {
  if (!items.length) return gap("Not listed.");
  const li = (arr) => arr.map((x) => `<li${x.level ? ' class="sub"' : ""}>${esc(x.text)}</li>`).join("");
  const top = items.slice(0, 6);
  const rest = items.slice(6);
  return `<ul class="crit">${li(top)}</ul>${rest.length ? `<details class="more"><summary>Show ${rest.length} more</summary><ul class="crit">${li(rest)}</ul></details>` : ""}`;
}

function whoBody(M, L, lt) {
  const e = M.eligibility;
  const c = splitCriteria(e.criteria);
  const facts = [
    ["Ages", `${e.minAge ? ageLabel(e.minAge) : "Any age"} to ${e.maxAge ? ageLabel(e.maxAge) : "no upper limit"}`],
    e.sex && ["Sex", sexLabel(e.sex)],
    e.healthy != null && ["Healthy volunteers", e.healthy ? "Accepted" : "Not accepted"],
  ].filter(Boolean);
  return `${L ? plainly(lt(L.plainPop)) : ""}
    <dl class="facts small-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    ${c.inclusion.length || c.exclusion.length ? `<div class="two">
      <div class="yes"><h3 class="h-sm">Who can join</h3>${critList(c.inclusion)}</div>
      <div class="no"><h3 class="h-sm">Who can’t join</h3>${critList(c.exclusion)}</div>
    </div>` : e.criteria ? `<div class="raw">${esc(e.criteria)}</div>` : gap()}
    <p class="small faint">These are the ${term("eligibility criteria")} as written in the registry record. Meeting them on paper doesn’t make someone eligible. Only the study team decides.</p>`;
}

function armsList(M) {
  if (!M.arms.length) return M.interventions.length ? `<ul class="plain">${M.interventions.map((i) => `<li>${esc(i.name)}</li>`).join("")}</ul>` : gap();
  return `<ul class="arms">${M.arms.map((a) => `<li><div class="arm-h"><b>${esc(a.label)}</b>${a.type ? `<span class="pill">${esc(armTypeLabel(a.type))}</span>` : ""}</div>
    ${a.interventions.length ? `<span class="small muted">${esc(a.interventions.join(" · "))}</span>` : ""}</li>`).join("")}</ul>`;
}

const tags = (M) => {
  const t = designTags(M.design);
  return t.length ? `<div class="row">${t.map((x) => `<span class="pill">${x.term ? term(x.text, x.term) : esc(x.text)}</span>`).join("")}</div>` : "";
};

function outcomes(M) {
  const li = (arr) => arr.map((o) => `<li><span>${esc(o.measure)}</span>${o.timeFrame ? `<span class="tf">${esc(o.timeFrame)}</span>` : ""}</li>`).join("");
  const sec = M.secondaryOutcomes;
  return `<div><h3 class="h-sm">${term("Primary outcome")}${M.primaryOutcomes.length > 1 ? "s" : ""}</h3>${M.primaryOutcomes.length ? `<ul class="outs">${li(M.primaryOutcomes)}</ul>` : gap()}</div>
    ${sec.length ? `<div><h3 class="h-sm">${term("Secondary outcome", "secondary outcome")}s</h3><ul class="outs">${li(sec.slice(0, 4))}</ul>
      ${sec.length > 4 ? `<details class="more"><summary>Show ${sec.length - 4} more</summary><ul class="outs">${li(sec.slice(4))}</ul></details>` : ""}</div>` : ""}`;
}

function libSteps(L, M, lt) {
  const found = L.evidence === "published"
    ? `<div class="found"><div class="row">${evidencePill("published")}<span class="small faint">${esc(L.pub.journal)} · ${L.pub.year}</span></div>
        <p class="big">${lt(L.result)}</p>
        <p class="cite">${esc(L.pub.authors)} ${esc(L.pub.title)}. <i>${esc(L.pub.journal)}</i>. ${L.pub.year};${esc(L.pub.ref)}. <a href="${doiUrl(L.pub.doi)}" target="_blank" rel="noopener">Read the paper ↗</a></p></div>`
    : `<div class="found topline"><div class="row">${evidencePill("topline")}<span class="small faint">${esc(fmtDate(L.topline.date))}</span></div>
        <p class="big">${lt(L.result)}</p>
        <p class="cite">${term("Topline results", "topline results")} from the company, not yet in a peer-reviewed paper. Treat them as preliminary. <a href="${esc(L.topline.url)}" target="_blank" rel="noopener">Read the report ↗</a></p></div>`;
  return [
    { key: "question", label: "The question", q: "What is this study trying to find out?",
      body: `<p class="lead-q">${lt(L.question)}</p>${M.officialTitle ? `<details class="more"><summary>Official title</summary><p class="small muted">${esc(M.officialTitle)}</p></details>` : ""}` },
    { key: "who", label: "Who it’s for", q: "Who can take part?", body: whoBody(M, L, lt) },
    { key: "what", label: "What’s tested", q: "What treatment is being tested?",
      body: `${plainly(lt(L.plainTx))}
        <dl class="facts"><div><dt>Treatment</dt><dd>${esc(L.intervention)}</dd></div><div><dt>Compared with</dt><dd>${lt(L.comparator)}</dd></div></dl>
        ${tags(M)}
        <details class="more"><summary>Groups in the registry record (${M.arms.length})</summary>${armsList(M)}</details>` },
    { key: "how", label: "How it’s measured", q: "What are the researchers measuring?", body: outcomes(M) },
    { key: "found", label: "What’s been found", q: "What has been reported so far?",
      body: `${found}
        <dl class="facts stack"><div><dt>Safety reported</dt><dd>${lt(L.safety)}</dd></div><div><dt>What happened next</dt><dd>${lt(L.next)}</dd></div></dl>
        ${M.hasResults ? `<p class="small"><a href="${ctUrl(M.id)}?tab=results" target="_blank" rel="noopener">Results are also posted on the registry ↗</a></p>` : ""}` },
  ];
}

function liveSteps(M) {
  return [
    { key: "question", label: "The question", q: "What is this study trying to find out?",
      body: `${M.summary ? `<p class="small faint">From the registry’s brief summary</p><div class="summary">${esc(M.summary).replace(/\n{2,}/g, "</p><p>").replace(/^/, "<p>")}</p></div>` : gap("No summary in the record.")}
        ${M.conditions.length ? `<dl class="facts"><div><dt>Condition${M.conditions.length > 1 ? "s" : ""}</dt><dd>${esc(M.conditions.join(", "))}</dd></div></dl>` : ""}
        ${M.officialTitle ? `<details class="more"><summary>Official title</summary><p class="small muted">${esc(M.officialTitle)}</p></details>` : ""}` },
    { key: "who", label: "Who it’s for", q: "Who can take part?", body: whoBody(M, null) },
    { key: "what", label: "What’s tested", q: "What is being tested?", body: `${armsList(M)}${tags(M)}` },
    { key: "how", label: "How it’s measured", q: "What are the researchers measuring?", body: outcomes(M) },
    { key: "found", label: "What’s been found", q: "What has been reported so far?",
      body: `<div class="found">${evidencePill("registry")}
        <p>${M.hasResults ? "Results are posted on the registry. Read them there, and look for a published paper." : "No results are posted on the registry yet, and TrialSignal hasn’t linked a publication."}</p>
        <div class="row">${M.hasResults ? `<a href="${ctUrl(M.id)}?tab=results" target="_blank" rel="noopener">Registry results ↗</a>` : `<a href="${ctUrl(M.id)}" target="_blank" rel="noopener">Registry record ↗</a>`}<a href="${pubmedUrl(M.id)}" target="_blank" rel="noopener">Search PubMed for ${M.id} ↗</a></div></div>` },
  ];
}

function askStep(id, ds) {
  return {
    key: "ask", label: "Ask a question", q: "Ask about this trial",
    body: `<p class="muted">Answers come only from this trial’s record, and each one says which part it came from.</p>
      <div class="chips" id="askChips">${SUGGESTIONS.map((s) => `<button class="chip" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <form class="searchbar slim" id="askForm" autocomplete="off"><label class="sr" for="askInput">Your question</label><input type="text" id="askInput" placeholder="Type your own question"><button class="btn" type="submit">Ask</button></form>
      <div class="ask" id="askLog" aria-live="polite">${ds.asked.map(qaHTML).join("")}</div>`,
  };
}

function qaHTML({ q, a }) {
  return `<div class="qa"><p class="qa-q">${esc(q)}</p><div class="qa-a">
    <p>${esc(a.text)}</p>
    ${a.items && a.items.length ? `<ul>${a.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${a.note ? `<p class="small">${esc(a.note)}</p>` : ""}
    ${a.source ? `<p class="qa-src">Source: ${esc(a.source)}</p>` : ""}
  </div></div>`;
}

// ── wiring ───────────────────────────────────────────────────────────
function bind(id, L, M, name) {
  $("#followBtn").onclick = () => {
    const on = toggleFollow(id);
    toast(on ? "Following. Changes will show on the Trials page." : "Stopped following");
    const b = $("#followBtn");
    b.setAttribute("aria-pressed", on);
    b.textContent = on ? "✓ Following" : "Follow this trial";
  };
  $("#noteBtn").onclick = () => addNote(`${name} (${id})`,
    `${L ? `Question: ${L.question}\nReported: ${L.result}\nHow firm: ${evidenceLabel(L.evidence)}\n` : `Status: ${statusLabel(M.status)}\n`}Record: ${ctUrl(id)}\n\nMy observations:\n`);
  const ask = (q) => {
    if (!q.trim()) return;
    const ds = detail[id];
    const a = answer(q, { model: known(id).model, curated: L });
    ds.asked.unshift({ q, a });
    $("#askLog").innerHTML = ds.asked.map(qaHTML).join("");
  };
  $("#askChips").onclick = (e) => { const b = e.target.closest("[data-q]"); if (b) ask(b.dataset.q); };
  $("#askForm").onsubmit = (e) => { e.preventDefault(); const i = $("#askInput"); ask(i.value); i.value = ""; };
  $$("[data-jump]").forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    $(`#st-${a.dataset.jump}`).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));

  // Highlight the step being read.
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    const key = vis.target.id.replace("st-", "");
    $$(".toc a").forEach((a) => a.classList.toggle("on", a.dataset.jump === key));
  }, { rootMargin: "-20% 0px -60% 0px" });
  $$(".step").forEach((s) => observer.observe(s));
}
