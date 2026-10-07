// One trial, read as five plain steps, with a live-record panel and questions.

import { $, $$, esc, num, fmtDate, shortDate, sinceDay, ico, toast } from "../util.js";
import { L, reduceMotion } from "../live.js";
import { D, follow, record, loadRecord, SNAPSHOT_DATE } from "../data.js";
import { stHTML, skel } from "../console.js";
import { statusLabel, statusClass, statusGloss, phaseGloss, splitCriteria, isRunning } from "../normalize.js";
import { linkTerms } from "../ui.js";
import { answer, SUGGESTIONS } from "../ask.js";
import { addNote } from "../notes.js";
import { lib, AREAS, LIBRARY_REVIEWED } from "../../data/library.js";

let current = null;
const tried = {};
let stepIO = null;
let motionIO = null;

export function renderTrial(id, { quiet = false } = {}) {
  const changedTrial = current !== id;
  current = id;
  const root = $("[data-trial-root]");
  const r = record(id);
  if (!r.live && L.online === true && !tried[id]) {
    tried[id] = true;
    if (!r.model) root.innerHTML = skeleton(id);
    loadRecord(id)
      .then(() => { if (current === id && location.hash.slice(1).toUpperCase() === id) renderTrial(id, { quiet: true }); })
      .catch((e) => { if (current === id && !record(id).model) root.innerHTML = missing(id, e.status === 404 ? "ClinicalTrials.gov has no study with that number. Check the digits and try again." : "ClinicalTrials.gov didn’t answer just now. TrialSignal will try again on the next check."); });
    if (!r.model) return;
  }
  if (!r.model) {
    root.innerHTML = L.online === null ? skeleton(id) : missing(id, "TrialSignal can’t reach ClinicalTrials.gov right now, and there’s no saved copy of this trial. It will load as soon as the connection is back.");
    return;
  }
  const keepAsk = quiet && !changedTrial ? $("[data-answer]", root)?.innerHTML : "";
  paint(id, r.model, r.live, r.at);
  if (keepAsk) $("[data-answer]", root).innerHTML = keepAsk;
}

// Called after a registry refresh while a trial page is open.
export function refreshTrial(id) {
  tried[id] = false;
  renderTrial(id, { quiet: true });
}

const skeleton = (id) => `<nav class="crumbs"><a href="#trials">Trials</a><span>/</span><span>${id}</span></nav>
  <div class="trial-top"><div class="t-head"><p class="t-meta"><span class="mono">${id}</span></p><div class="t-name">${skel("width:60%;height:.8em")}</div><p class="t-hook">${skel("width:80%")}</p></div>
  <aside class="console rec-con" data-state="loading"><div class="con-head"><span class="con-badge"><span class="ldot"></span>LIVE RECORD</span><div class="con-ticker">loading the record…</div></div><div class="rec-live rec-pad">${skel("width:60%;height:28px")}</div></aside></div>`;

const missing = (id, msg) => `<nav class="crumbs"><a href="#trials">Trials</a><span>/</span><span>${id}</span></nav>
  <div class="page-head"><h1 class="display t-missing">${id}</h1><p class="lede">${esc(msg)}</p>
  <div class="t-actions"><a class="btn btn-primary" href="https://clinicaltrials.gov/study/${id}" target="_blank" rel="noopener">Open on ClinicalTrials.gov ${ico("ext")}</a><a class="btn" href="#trials">Browse the library</a></div></div>`;

// ── helpers ──────────────────────────────────────────────────────────
function jargonTiles(M) {
  const t = [];
  const d = M.design || {};
  if (d.allocation === "RANDOMIZED") t.push(["Randomized", "A computer decided who got which treatment, so the groups start out alike."]);
  else if (d.allocation === "NON_RANDOMIZED") t.push(["Not randomized", "People were not put into groups by chance."]);
  const mk = { SINGLE: "Single-blind", DOUBLE: "Double-blind", TRIPLE: "Triple-blind", QUADRUPLE: "Quadruple-blind" }[d.masking];
  if (mk) t.push([mk, "Participants and the study doctors didn’t know who got what, so expectations couldn’t sway the results."]);
  else if (d.masking === "NONE") t.push(["Open label", "Everyone knew who got which treatment."]);
  const types = M.arms.map((a) => a.type);
  if (types.includes("PLACEBO_COMPARATOR")) t.push(["Placebo-controlled", "One group got a dummy treatment, so any difference can be credited to the real one."]);
  else if (types.includes("SHAM_COMPARATOR")) t.push(["Sham-controlled", "One group had a fake procedure, so any difference can be credited to the real one."]);
  else if (types.includes("ACTIVE_COMPARATOR")) t.push(["Compared with a standard treatment", "One group got a treatment already in use, as the yardstick."]);
  else if (M.arms.length === 1) t.push(["Single group", "Everyone got the same treatment; there was no comparison group."]);
  return t.slice(0, 3);
}

const FILLER = new Set(["arm", "group", "phase", "dose", "the", "and", "with", "plus", "period", "randomized", "blinded", "extension", "global", "china", "for"]);
const words = (s, keepParens = false) => String(s || "").toLowerCase().replace(keepParens ? /$^/ : /\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !FILLER.has(w));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Do a group's drug names appear in a curated description? Short registry codes such
// as "Dapa" count when they start a longer word ("dapagliflozin").
function share(title, text, keepParens = true) {
  const w = words(title);
  if (!w.length) return 0;
  const t = words(text, keepParens);
  return w.filter((x) => t.some((y) => y === x || (x.length >= 4 && y.startsWith(x)))).length / w.length;
}

// One group: "C" (comparison), "T" (tested) or null (can't tell yet).
function classify(title, M, L) {
  if (/placebo|control|sham|standard of care|standard care|usual care|\bsoc\b|physician'?s choice|investigator'?s choice/i.test(title)) return "C";
  // The reviewed summary wins over the registry's arm types, which are sometimes swapped.
  // Text in brackets is left out here: "(people could switch to pembrolizumab)" is not the comparator.
  if (L && share(title, L.comparator, false) >= 0.6) return "C";
  if (L && share(title, L.intervention) > 0) return "T";
  const arm = M.arms.find((a) => norm(a.label) === norm(title));
  if (arm && /COMPARATOR|SHAM/.test(arm.type || "")) return "C";
  if (arm && arm.type === "EXPERIMENTAL" && M.arms.some((a) => /COMPARATOR|SHAM/.test(a.type || ""))) return "T";
  return null;
}

// Which baseline groups are the comparison? If nothing marks one, groups whose drugs
// aren't the tested treatment are taken as the comparison.
export function groupKinds(groups, M, L) {
  let kinds = groups.map(([t]) => classify(t, M, L));
  if (!kinds.includes("C") && L) kinds = kinds.map((k) => k || "C");
  return kinds.map((k) => k === "C");
}
export const isComparison = (title, M, L) => groupKinds([[title, 0]], M, L)[0];

// Largest-remainder rounding so the dots add up to exactly 100.
export function dotsFor(groups) {
  const total = groups.reduce((s, [, n]) => s + n, 0) || 1;
  const raw = groups.map(([, n]) => (n / total) * 100);
  const base = raw.map(Math.floor);
  let left = 100 - base.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) base[i]++; });
  return base;
}

// "72 weeks" from a primary outcome time frame.
export function followUp(tf) {
  let m = String(tf || "").match(/Week\s*(\d+)/i) || String(tf || "").match(/(\d+)\s*weeks?/i);
  if (m) return `${m[1]} weeks`;
  m = String(tf || "").match(/(\d+)\s*months?/i);
  if (m) return `${m[1]} months`;
  m = String(tf || "").match(/(\d+(?:\.\d+)?)\s*years?/i);
  if (m) return `${m[1]} years`;
  return "See step 4";
}

const ageText = (e) => {
  const a = (s) => parseInt(s, 10);
  const unit = (s) => (/month/i.test(s) ? " months" : /week/i.test(s) ? " weeks" : /day/i.test(s) ? " days" : "");
  if (e.minAge && e.maxAge) return `Age ${a(e.minAge)}${unit(e.minAge)} to ${a(e.maxAge)}${unit(e.maxAge)}`;
  if (e.minAge) return `Age <b>${a(e.minAge)}${unit(e.minAge)}+</b>`;
  if (e.maxAge) return `Up to <b>${a(e.maxAge)}${unit(e.maxAge)}</b> old`;
  return "Any age";
};

// ── the page ─────────────────────────────────────────────────────────
function paint(id, M, live, at) {
  const root = $("[data-trial-root]");
  const T = lib(id);
  const area = T ? (AREAS.find((a) => a.key === T.area) || {}).label : null;
  const name = (T && T.short) || M.acronym || id;
  const used = new Set();
  const lt = (s) => linkTerms(s, { used });
  const ph = M.phase && !/not applicable/i.test(M.phase) ? M.phase : "";
  const enr = M.enrollment && M.enrollment.count;
  const ctry = M.countries.length;
  const design = [M.design.allocation === "RANDOMIZED" ? "randomized" : M.design.allocation === "NON_RANDOMIZED" ? "not randomized" : null, { DOUBLE: "double-blind", TRIPLE: "triple-blind", QUADRUPLE: "quadruple-blind", SINGLE: "single-blind", NONE: "open label" }[M.design.masking]].filter(Boolean).join(", ");
  const d = M.dates;
  const ref = live ? L.day : SNAPSHOT_DATE;
  const following = follow.has(id);
  const savedLabel = `Saved copy from ${fmtDate(SNAPSHOT_DATE)}`;

  // where the trial is on the road from plan to decision
  const running = isRunning(M.status);
  const ended = ["COMPLETED", "TERMINATED"].includes(M.status);
  const decision = T && T.decision;
  const stage = (done, now, title, body, src = "") => `<li class="jstep${done ? " done" : ""}${now ? " now" : ""}"><span class="jdot">${done ? ico("check") : ""}</span><div><h4>${title}<span class="sr">${done ? " (done)" : now ? " (current stage)" : " (not yet)"}</span></h4><p>${body}</p>${src ? `<p class="srcnote">${src}</p>` : ""}</div></li>`;
  const journey = [
    stage(!!d.firstPosted, false, "Registered", d.firstPosted ? `Plan posted ${fmtDate(d.firstPosted)}` : "On ClinicalTrials.gov"),
    stage(ended, running, "Running", M.status === "WITHDRAWN" ? "Withdrawn before anyone joined" : d.start ? `Started ${fmtDate(d.start)}${d.primaryCompletion ? `; main data ${d.primaryCompletionType === "ESTIMATED" ? "expected" : "collected"} ${fmtDate(d.primaryCompletion)}` : ""}` : "Not started yet"),
    stage(!!d.resultsPosted || (T && T.evidence === "published"), T && T.evidence === "topline" && !d.resultsPosted, "Results",
      d.resultsPosted ? `Posted on the registry ${fmtDate(d.resultsPosted)}` : T && T.evidence === "published" ? `Paper in ${esc(T.pub.journal)}, ${T.pub.year}` : T && T.evidence === "topline" ? `Company announcement, ${fmtDate(T.topline.date)}` : "Not posted yet"),
    stage(!!decision, false, "Decision", decision ? `${esc(decision.label)}, ${fmtDate(decision.date)}` : "No decision recorded yet", decision ? "From TrialSignal’s reviewed summary" : ""),
  ].join("");

  // eligibility
  const e = M.eligibility;
  const crit = splitCriteria(e.criteria);
  const inc = crit.inclusion.filter((x) => !x.level);
  const exc = crit.exclusion.filter((x) => !x.level);

  // groups: dots when the registry posts 2 to 5 group sizes
  const groups = M.groups && M.groups.length >= 2 && M.groups.length <= 5 ? M.groups : null;
  let groupHTML = "";
  let totalPeople = 0;
  if (groups) {
    const dots = dotsFor(groups);
    totalPeople = groups.reduce((s, [, n]) => s + n, 0);
    const kinds = groupKinds(groups, M, T);
    const mixed = kinds.some(Boolean) && kinds.some((k) => !k);
    let dose = 0;
    groupHTML = groups.map(([t, n], gi) => {
      const comp = mixed && kinds[gi];
      const c = comp ? "var(--mark-b)" : `var(--dose-${Math.min(3, ++dose)})`;
      return `<div class="dg-g"><div class="dg-dots">${Array.from({ length: dots[gi] }, (_, k) => `<i style="--c:${c};--d:${gi * 120 + k * 12}ms"></i>`).join("")}</div><p class="dg-l">${esc(t)}</p><p class="dg-s">${mixed ? (comp ? "Comparison · " : "Tested · ") : ""}${num(n)} people</p></div>`;
    }).join("");
  }

  // result bars from the reviewed summary
  const series = T && (T.series || (T.chart && T.chart.pbo != null ? [["Placebo", T.chart.pbo, 0], [T.chart.label, T.chart.tx, 3]] : null));
  const sfmt = (T && T.seriesFmt) || "loss";
  const smax = series ? Math.max(...series.map((s) => s[1])) : 1;
  // Same number of decimals on every bar (8.0% next to 6.5%, not 8% next to 6.5%).
  const dec = series ? Math.min(2, Math.max(...series.map(([, v]) => (String(v).split(".")[1] || "").length))) : 0;
  const sval = (v) => `${sfmt === "loss" ? "−" : ""}${Number(v).toFixed(dec)}%`;

  const tiles = jargonTiles(M);
  const recWhen = `${sinceDay(d.lastUpdate, ref)}${live && L.refreshedAt ? ` · registry refreshed <span data-tick="refreshed">…</span>` : ""}`;
  const hook = (T && T.hook) || (T && T.condition) || `A ${ph ? `${ph} ` : ""}trial on ${(M.conditions[0] || "a condition").toLowerCase()}`;

  root.innerHTML = `
  <nav class="crumbs" aria-label="Breadcrumb"><a href="#trials">Trials</a><span aria-hidden="true">/</span>${area ? `<span>${esc(area)}</span><span aria-hidden="true">/</span>` : ""}<span>${esc(name)}</span></nav>
  <div class="trial-top">
    <div class="t-head">
      <p class="t-meta"><span class="mono">${id}</span>${M.sponsor ? `<span aria-hidden="true">·</span><span>${esc(M.sponsor)}</span>` : ""}</p>
      <h1 class="t-name" id="trial-h">${esc(name)}</h1>
      <p class="t-hook">${esc(hook)}</p>
      <p class="t-official">Official title: ${esc(M.title)}</p>
      <p class="t-strip">${live
        ? `<span class="ldot"></span><span><b>Live record</b> · last changed ${fmtDate(d.lastUpdate)} · checked <span data-since="${at}">just now</span></span>`
        : `<span class="ldot off"></span><span><b>Saved copy</b> from ${fmtDate(SNAPSHOT_DATE)} · last changed ${fmtDate(d.lastUpdate)}</span>`}</p>
      <div class="t-tags">
        <span class="tag">${stHTML(M.status, true)}</span>
        ${ph ? `<span class="tag">${esc(ph)}${phaseGloss(ph) ? `<span class="gloss">· ${phaseGloss(ph)}</span>` : ""}</span>` : ""}
        ${M.hasResults ? '<span class="tag">Results posted</span>' : ""}
        ${T && T.evidence === "published" ? '<span class="tag">Peer-reviewed paper</span>' : T && T.evidence === "topline" ? '<span class="tag tag-warn">Company announcement only</span>' : ""}
      </div>
      <div class="facts">
        <div class="fact"><div class="k">People</div><div class="v">${enr ? num(enr) : "Not listed"}</div></div>
        <div class="fact"><div class="k">Where</div><div class="v">${M.sites ? `${num(M.sites)} ${M.sites === 1 ? "site" : "sites"}, ${ctry} ${ctry === 1 ? "country" : "countries"}` : "Not listed"}</div></div>
        <div class="fact"><div class="k">Design</div><div class="v">${design ? design[0].toUpperCase() + design.slice(1) : "Not listed"}</div></div>
        <div class="fact"><div class="k">Main follow-up</div><div class="v">${followUp(M.primaryOutcomes[0] && M.primaryOutcomes[0].timeFrame)}</div></div>
      </div>
      <div class="t-actions">
        <button class="btn btn-primary" type="button" data-follow="${id}" aria-pressed="${following}">${ico("bell")}<span>${following ? "Following" : "Follow this trial"}</span></button>
        <a class="btn" href="https://clinicaltrials.gov/study/${id}" target="_blank" rel="noopener">Official record ${ico("ext")}</a>
        <button class="btn btn-ghost" type="button" data-note>${ico("pen")}<span>Save a note</span></button>
      </div>
    </div>
    <aside class="console rec-con" data-state="${live ? "live" : "offline"}" aria-label="${live ? "Live record" : "Saved copy"}">
      <div class="con-head"><span class="con-badge"><span class="ldot"></span><span data-badge-word>${live ? "LIVE RECORD" : "SAVED COPY"}</span></span>
        <div class="con-ticker">${live ? `<span>checked <b class="tk" data-since="${at}">just now</b></span>` : `<span>from ${shortDate(SNAPSHOT_DATE)}</span>`}</div></div>
      <div class="rec-live">
        <p class="rec-k">Last changed by the sponsor</p>
        <p class="rec-big">${fmtDate(d.lastUpdate) || "Not listed"}</p>
        <p class="rec-sub">${recWhen}</p>
      </div>
      <p class="rec-k rec-pad-t">Where this trial is now</p>
      <ol class="journey">${journey}</ol>
      <div class="con-foot con-foot-sm">Facts here come from the registry record.${T ? ` The plain-language steps are written by TrialSignal, reviewed ${fmtDate(LIBRARY_REVIEWED)}.` : " This trial isn’t in the TrialSignal library, so the steps use the registry’s own words."}</div>
    </aside>
  </div>

  <div class="trial-body">
    <ol class="snav" aria-label="Steps">
      ${["The question", "Who it’s for", "What’s tested", "How it’s measured", "What’s been found", "Ask a question"].map((n, i) => `<li><a href="#${id}" data-step="${i + 1}"${i === 0 ? ' aria-current="step"' : ""}><span class="n">${i < 5 ? i + 1 : "?"}</span>${n}</a></li>`).join("")}
      <li class="small">${T ? `Plain-language summary reviewed ${fmtDate(LIBRARY_REVIEWED)}.` : "No plain summary yet: these steps use the registry’s own words."}<br>${live ? `<span class="ldot"></span>Live · checked <span data-since="${at}">just now</span>` : `<span class="ldot off"></span>${savedLabel}`}</li>
    </ol>
    <div class="steps">
      <section class="step" id="s1"><p class="step-k"><span class="n">1</span>The question</p><h2>What is this study trying to find out?</h2>
        <p class="q">${T ? lt(T.question) : esc(M.title)}</p>
        ${tiles.length ? `<div class="jargon">${tiles.map(([k, v]) => `<div class="jt"><b>${k}</b><span>${v}</span></div>`).join("")}</div>` : ""}
        <details class="words"><summary>${ico("chev", "ico ico-sm")}In the registry’s words</summary><div class="body"><p><b>${esc(M.officialTitle || M.title)}</b></p>${M.summary ? `<p class="mt8">${esc(M.summary)}</p>` : ""}<span class="src">${live ? "From the live registry record" : `From the saved copy, ${fmtDate(SNAPSHOT_DATE)}`}</span></div></details>
      </section>

      <section class="step" id="s2"><p class="step-k"><span class="n">2</span>Who it’s for</p><h2>Who could take part?</h2>
        <p class="p">${T ? lt(T.plainPop) : "The registry lists who could join. Here are the basics."}</p>
        <div class="elig">
          <span class="ec yes"><span class="mk">${ico("check")}</span><span>${ageText(e)}</span></span>
          ${e.sex ? `<span class="ec yes"><span class="mk">${ico("check")}</span><span>${{ ALL: "All sexes", FEMALE: "Women only", MALE: "Men only" }[e.sex] || "Sex not stated"}</span></span>` : ""}
          ${((T && T.yes) || []).map((x) => `<span class="ec yes"><span class="mk">${ico("check")}</span><span>${x}</span></span>`).join("")}
          ${((T && T.no) || []).map((x) => `<span class="ec no"><span class="mk">${ico("x")}</span><span>${x}</span></span>`).join("")}
          ${e.healthy === false ? `<span class="ec no"><span class="mk">${ico("x")}</span><span>No healthy volunteers</span></span>` : e.healthy ? `<span class="ec yes"><span class="mk">${ico("check")}</span><span>Healthy volunteers welcome</span></span>` : ""}
        </div>
        ${inc.length || exc.length ? `<details class="words"><summary>${ico("chev", "ico ico-sm")}In the registry’s words: who could and couldn’t join</summary><div class="body"><div class="cols2">
          <div><h4>${ico("check", "ico ico-sm")}Could join</h4><ul>${inc.slice(0, 4).map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>${inc.length > 4 ? `<span class="src">and ${inc.length - 4} more in the official record</span>` : ""}</div>
          <div><h4>${ico("x", "ico ico-sm")}Could not join</h4><ul>${exc.slice(0, 4).map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>${exc.length > 4 ? `<span class="src">and ${exc.length - 4} more in the official record</span>` : ""}</div>
        </div></div></details>` : ""}
        <p class="small mt12">Meeting these on paper doesn’t make someone eligible. Only the study team decides.</p>
      </section>

      <section class="step" id="s3"><p class="step-k"><span class="n">3</span>What’s tested</p><h2>What did people get?</h2>
        <p class="p">${T ? lt(T.plainTx) : "The registry lists these groups."}</p>
        ${T ? `<div class="txcmp"><div><span class="k">Tested</span><span>${esc(T.intervention)}</span></div><div><span class="k">Compared with</span><span>${lt(T.comparator)}</span></div></div>` : ""}
        ${groups ? `<div class="dotgrid" data-dotgrid><div class="dg-groups" style="--g:${groups.length}">${groupHTML}</div>
          <p class="dg-cap">${num(totalPeople)} people were split ${M.design.allocation === "RANDOMIZED" ? "at random " : ""}into ${groups.length} groups. Each dot is about ${num(Math.round(totalPeople / 100))} ${Math.round(totalPeople / 100) === 1 ? "person" : "people"}. Group sizes come from the results posted on the registry.</p></div>`
        : `<div class="arms-list">${M.arms.map((a) => `<div class="arm"><span class="k">${/COMPARATOR|SHAM/.test(a.type || "") ? "Comparison" : a.type === "EXPERIMENTAL" ? "Tested" : "Group"}</span><span>${esc(a.label)}</span></div>`).join("")}</div>
          <p class="small mt10">${M.groups ? `The registry posts ${M.groups.length} separate result groups for this trial, so they are listed rather than drawn.` : "Group sizes appear here once the trial posts results."}</p>`}
      </section>

      <section class="step" id="s4"><p class="step-k"><span class="n">4</span>How it’s measured</p><h2>What counts as success?</h2>
        <p class="p">The main measure is fixed before the trial starts. It is what the trial is judged on.</p>
        <div class="measure"><p class="plain">${esc((T && T.measurePlain) || (M.primaryOutcomes[0] && M.primaryOutcomes[0].measure) || "Not listed")}</p>
          ${M.primaryOutcomes.length ? `<ol>${M.primaryOutcomes.slice(0, 3).map((o) => `<li>${esc(o.measure)}${o.timeFrame ? `<span class="tf">${esc(o.timeFrame)}</span>` : ""}</li>`).join("")}</ol>` : ""}
          <span class="src">Main measures in the registry’s words${live ? ", from the live record" : `, from the saved copy`}${M.primaryOutcomes.length > 3 ? ` · ${M.primaryOutcomes.length - 3} more in the official record` : ""}</span></div>
      </section>

      <section class="step" id="s5"><p class="step-k"><span class="n">5</span>What’s been found</p><h2>What happened?</h2>
        ${T && T.evidence === "topline" ? `<p class="caution">${ico("info", "ico ico-sm")}<span>These are the company’s own <b>topline results</b>, not yet checked in a peer-reviewed paper. Treat them as preliminary.</span></p>` : ""}
        <p class="q q-sm">${T ? lt(T.result) : esc(M.hasResults ? "Results are posted on the registry. TrialSignal hasn’t summarised them yet." : `No results posted yet.${d.primaryCompletion ? ` Main data is ${d.primaryCompletionType === "ESTIMATED" ? "expected" : "collected"} by ${fmtDate(d.primaryCompletion)}.` : ""}`)}</p>
        ${series ? `<div class="result-bars" data-rbars>${series.map(([l, v, k], i) => `<div class="rb"><span class="l">${esc(l)}</span><span class="track"><span class="fill" style="--w:${(v / smax) * 100}%;--c:${k === 0 ? "var(--mark-b)" : `var(--dose-${Math.min(3, k)})`};--d:${i * 120}ms"></span></span><span class="v">${sval(v)}</span></div>`).join("")}<p class="rb-cap">${esc((T && T.seriesCap) || (T && T.chart ? `Average body-weight change after ${T.chart.weeks} weeks. A longer bar means more weight lost.` : ""))}</p></div>` : ""}
        ${T && T.safety ? `<p class="p"><b class="ink">Side effects.</b> ${lt(T.safety)}</p>` : ""}
        ${T && T.next ? `<p class="p"><b class="ink">What happened next.</b> ${lt(T.next)}</p>` : ""}
        ${T && T.pub ? `<div class="paper">${ico("doc")}<span>Peer-reviewed paper: ${esc(T.pub.authors)} ${esc(T.pub.title)}. <i>${esc(T.pub.journal)}</i> ${T.pub.year};${esc(T.pub.ref)}. <a href="https://doi.org/${esc(T.pub.doi)}" target="_blank" rel="noopener">Read the paper</a></span></div>` : ""}
        ${T && T.topline ? `<div class="paper">${ico("doc")}<span>${esc(T.topline.source)}, ${fmtDate(T.topline.date)}. <a href="${esc(T.topline.url)}" target="_blank" rel="noopener">Read the report</a></span></div>` : ""}
        ${M.hasResults ? `<p class="small mt12"><a class="link" href="https://clinicaltrials.gov/study/${id}?tab=results" target="_blank" rel="noopener">Results posted on the registry ${ico("ext", "ico ico-sm")}</a></p>` : !T ? `<p class="small mt12"><a class="link" href="https://pubmed.ncbi.nlm.nih.gov/?term=${id}" target="_blank" rel="noopener">Search PubMed for ${id} ${ico("ext", "ico ico-sm")}</a></p>` : ""}
      </section>

      <section class="step" id="s6"><p class="step-k"><span class="n">?</span>Ask a question</p><h2>Still curious? Ask about this trial.</h2>
        <form class="ask" data-ask autocomplete="off"><div class="ask-box"><label class="sr" for="askq">Your question</label><input id="askq" placeholder="For example: who could not join?"><button class="btn btn-primary btn-sm" type="submit">Ask</button></div>
          <div class="chips">${SUGGESTIONS.map((s) => `<button class="chip" type="button" data-askq="${esc(s)}">${esc(s)}</button>`).join("")}</div></form>
        <div data-answer aria-live="polite"></div>
        <p class="small mt12">Answers use only this trial’s registry record and TrialSignal’s reviewed summary, and say which one they came from.</p>
      </section>
    </div>
  </div>`;

  bind(id, M, T, live, name);
  if (!reduceMotion()) requestAnimationFrame(() => requestAnimationFrame(() => $(".journey", root)?.classList.add("fill")));
  else $(".journey", root)?.classList.add("fill");
  $$(".journey .jstep", root).forEach((s, i) => s.style.setProperty("--d", `${200 + i * 260}ms`));
  observe(root);
}

function bind(id, M, T, live, name) {
  const root = $("[data-trial-root]");
  $("[data-follow]", root).onclick = (ev) => {
    const b = ev.currentTarget;
    if (follow.has(id)) follow.remove(id);
    else follow.add(id, live ? M : D.lib[id] || null);
    const on = follow.has(id);
    b.setAttribute("aria-pressed", on);
    $("span", b).textContent = on ? "Following" : "Follow this trial";
    toast(on ? "Following. Changes will show on the Trials page." : "Stopped following");
    document.dispatchEvent(new CustomEvent("ts:follow"));
  };
  $("[data-note]", root).onclick = () => addNote(`${name} (${id})`,
    `${T ? `Question: ${T.question}\nReported: ${T.result}\nHow firm: ${T.evidence === "published" ? "Peer-reviewed paper" : "Company announcement only"}\n` : `Status: ${statusLabel(M.status)}\n`}Record: https://clinicaltrials.gov/study/${id}\n\nMy observations:\n`);
  const ask = (q) => {
    if (!q.trim()) return;
    const a = answer(q, { model: M, curated: T });
    const src = a.from === "registry"
      ? `From the ${a.part} of the registry record${live ? ", checked live" : `, saved copy from ${fmtDate(SNAPSHOT_DATE)}`}`
      : a.from === "summary" ? `From TrialSignal’s reviewed summary, ${fmtDate(LIBRARY_REVIEWED)}` : "";
    $("[data-answer]", root).innerHTML = `<div class="answer"><p class="aq">You asked: ${esc(q)}</p><p class="aa">${esc(a.text)}</p>
      ${a.items && a.items.length ? `<ul>${a.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${a.note ? `<p class="an">${esc(a.note)}</p>` : ""}${src ? `<span class="src">${esc(src)}</span>` : ""}</div>`;
  };
  $("[data-ask]", root).onsubmit = (e) => { e.preventDefault(); ask($("#askq").value); };
  $$("[data-askq]", root).forEach((b) => (b.onclick = () => { $("#askq").value = b.dataset.askq; ask(b.dataset.askq); }));
  $$(".snav a", root).forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    $(`#s${a.dataset.step}`).scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
  }));
}

function observe(root) {
  if (!("IntersectionObserver" in window)) {
    $$("[data-dotgrid]", root).forEach((el) => el.classList.add("pop"));
    $$("[data-rbars]", root).forEach((el) => el.classList.add("go"));
    return;
  }
  motionIO?.disconnect();
  stepIO?.disconnect();
  motionIO = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    motionIO.unobserve(en.target);
    en.target.classList.remove("wait");
    en.target.classList.add(en.target.matches("[data-dotgrid]") ? "pop" : "go");
  }), { threshold: 0.3 });
  stepIO = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    const n = en.target.id.slice(1);
    $$(".snav a", root).forEach((a) => (a.dataset.step === n ? a.setAttribute("aria-current", "step") : a.removeAttribute("aria-current")));
  }), { rootMargin: "-30% 0px -60% 0px" });
  $$("[data-dotgrid], [data-rbars]", root).forEach((el) => {
    const cls = el.matches("[data-dotgrid]") ? "pop" : "go";
    if (reduceMotion()) return;
    if (el.getBoundingClientRect().top < innerHeight) { el.classList.add(cls); return; }
    el.classList.add("wait");
    motionIO.observe(el);
  });
  $$(".step", root).forEach((s) => stepIO.observe(s));
}

export { statusClass, statusGloss };
