// Trials: registry search, the library, and the Following console.

import { $, $$, esc, num, shortDate, fmtDate, dayDiff, ico, toast, parseNCT, localDay } from "../util.js";
import { SITE } from "../config.js";
import { L, paintCount, check, announce, easternDay } from "../live.js";
import { D, follow, statusOf, loadStatuses, loadTotal, SNAPSHOT_DATE, swallow } from "../data.js";
import { stHTML, skel } from "../console.js";
import * as api from "../api.js";
import { statusLabel } from "../normalize.js";
import { LIBRARY, AREAS, lib } from "../../data/library.js";

let libArea = "all";
let q = "";
let opts = { recruiting: false, newest: false };
let res = null; // { rows, total, recruiting, next, field } or { offline: true }
let seq = 0;
let timer = 0;

const busy = (b) => b && b.getAttribute("aria-disabled") === "true";

export function bindTrials(go) {
  const input = $("#q2");
  $("#searchForm2").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(timer);
    const v = input.value.trim();
    const id = parseNCT(v);
    if (id) { go(id); return; }
    runSearch(v);
  });
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 400); });
  $("[data-suggest]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (b) { clearTimeout(timer); input.value = b.dataset.q; runSearch(b.dataset.q); }
  });
  $("[data-areas]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-area]");
    if (!b) return;
    libArea = b.dataset.area;
    renderAreas();
    renderLibrary();
    $(`[data-area="${libArea}"]`)?.focus();
  });
  $("[data-results]").addEventListener("click", (e) => {
    const t = e.target.closest("[data-opt]");
    if (t) {
      opts[t.dataset.opt] = !opts[t.dataset.opt];
      t.setAttribute("aria-pressed", opts[t.dataset.opt]);
      runSearch(q, { force: true, focus: `[data-opt="${t.dataset.opt}"]` });
    }
    if (e.target.closest("[data-more-results]")) moreResults();
  });
  $("[data-following]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seen]");
    if (!b) return;
    const id = b.dataset.seen;
    follow.markSeen(id);
    renderFollowing();
    $(`[data-following] .fi-top a[href="#${id}"]`)?.focus();
    toast("Marked as seen");
  });
  $("[data-check-follow]").addEventListener("click", async () => {
    const b = $("[data-check-follow]");
    if (busy(b)) return;
    b.setAttribute("aria-disabled", "true");
    b.textContent = "Checking…";
    await check("manual");
    if (L.online) await loadStatuses().catch(swallow);
    b.removeAttribute("aria-disabled");
    paintFollowFoot();
  });
  renderAreas();
}

export function renderTrials(params = {}) {
  if (params.q) { $("#q2").value = params.q; runSearch(params.q); }
  renderSearchLive();
  renderLibrary();
  renderFollowing();
  if (L.online) loadTotal().then(() => paintCount("total", D.counts.total)).catch(swallow);
}

export function renderSearchLive() {
  const el = $("[data-search-live]");
  if (L.online === false) {
    el.innerHTML = `<span class="ldot off"></span><span>Search needs a connection to ClinicalTrials.gov. Until it’s back, search covers the ${LIBRARY.length} library trials.</span>`;
  } else if (!el.querySelector('[data-count="total"]')) {
    el.innerHTML = `<span class="ldot"></span><span>Searching <b class="num" data-count="total">${skel()}</b> studies on ClinicalTrials.gov</span>`;
    if (D.counts.total != null) paintCount("total", D.counts.total);
  }
}

// When the connection comes back, a search made offline is run again live.
export function refreshSearch() {
  if (q && !$("[data-results]").hidden) runSearch(q, { force: true });
}

// ── search ───────────────────────────────────────────────────────────
const toggle = (key, label) => `<button class="chip chip-sm" type="button" data-opt="${key}" aria-pressed="${opts[key]}">${label}</button>`;

async function runSearch(text, { force = false, focus = "" } = {}) {
  const box = $("[data-results]");
  let value = String(text || "").trim();
  // A pasted registry link or a trial number searches for that trial.
  const id = parseNCT(value);
  if (id) value = id;
  if (!value) { q = ""; res = null; seq++; box.hidden = true; return; }
  if (value === q && !force && res && !!res.offline === (L.online === false)) return;
  q = value;
  box.hidden = false;
  const my = ++seq;
  if (L.online === false) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = LIBRARY.filter((t) => { const hay = `${t.short} ${t.condition} ${t.company} ${t.intervention} ${t.id}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
    res = { offline: true };
    box.innerHTML = `<div class="results-head"><span><b>${hits.length}</b> library ${hits.length === 1 ? "trial matches" : "trials match"} “${esc(q)}”. Full registry search returns when ClinicalTrials.gov is reachable.</span></div>` +
      (hits.length ? hits.map((t) => `<a class="rrow" href="#${t.id}"><span class="cond">${esc(t.short)}</span>${stHTML(statusOf(t.id)?.status)}<span class="title">${esc(t.condition)}</span><span class="id">${t.id}</span></a>`).join("") : '<p class="rrow">No library trials match. Try a condition, such as obesity.</p>');
    announce(`${hits.length} library ${hits.length === 1 ? "trial matches" : "trials match"} ${q}.`);
    return;
  }
  box.setAttribute("aria-busy", "true");
  box.innerHTML = `<div class="results-head">${skel("width:40%")}</div>${Array.from({ length: 3 }, () => `<div class="rrow">${skel("width:50%")}${skel("width:80%")}</div>`).join("")}`;
  try {
    // Conditions first: "Obesity" should find obesity studies, not every study that
    // mentions the word. If that finds little (a drug name, say), search all text.
    let r = await api.search(q, { ...opts, field: "cond" });
    if (my !== seq) return;
    if (!id && (r.total ?? r.rows.length) < 10) {
      const t = await api.search(q, { ...opts, field: "term" });
      if (my !== seq) return;
      if ((t.total ?? t.rows.length) > (r.total ?? r.rows.length)) r = t;
    }
    res = r;
    paintResults();
    if (focus) $(focus)?.focus();
    const n = r.total ?? r.rows.length;
    announce(n ? `${num(n)} ${n === 1 ? "study matches" : "studies match"} ${q}${r.recruiting != null ? `, ${num(r.recruiting)} recruiting now` : ""}.` : `No studies match ${q}.`);
  } catch {
    if (my !== seq) return;
    res = null;
    box.innerHTML = '<div class="results-head err-row">Search couldn’t reach ClinicalTrials.gov. Try again in a moment.</div>';
  } finally {
    if (my === seq) box.removeAttribute("aria-busy");
  }
}

function rowHTML(r) {
  return `<a class="rrow" href="#${esc(r.id)}"><span class="cond">${esc(r.condition || r.title)}</span>${stHTML(r.status)}<span class="title">${r.acronym ? `${esc(r.acronym)} · ` : ""}${esc(r.title)}</span><span class="id">${esc(r.id)}</span></a>`;
}

function paintResults() {
  const box = $("[data-results]");
  const { rows, total, recruiting, next, field } = res;
  const n = total ?? rows.length;
  const all = `https://clinicaltrials.gov/search?${field === "cond" ? "cond" : "term"}=${encodeURIComponent(q)}`;
  const head = rows.length
    ? `<b>${num(n)}</b> ${n === 1 ? "study matches" : "studies match"} “${esc(q)}”${recruiting != null && !opts.recruiting ? ` · <b>${num(recruiting)}</b> recruiting now` : ""}`
    : `No studies match “${esc(q)}”${opts.recruiting ? " among trials recruiting now" : ""}`;
  box.innerHTML = `<div class="results-head"><span>${head}</span>
      <a class="link" href="${all}" target="_blank" rel="noopener">All on ClinicalTrials.gov ${ico("ext", "ico ico-sm")}</a></div>
    <div class="results-opts">${toggle("recruiting", "Recruiting only")}${toggle("newest", "Newest updates first")}</div>` +
    (rows.length ? rows.map(rowHTML).join("") : `<p class="rrow">${opts.recruiting ? "Turn off “Recruiting only” to include trials that have stopped recruiting, or try a simpler word." : "Try a simpler word, such as a condition."}</p>`) +
    (next ? '<div class="results-more"><button class="btn btn-sm" type="button" data-more-results>Show 10 more</button></div>' : "");
}

async function moreResults() {
  const b = $("[data-more-results]");
  if (!b || busy(b) || !res?.next) return;
  const my = seq;
  const from = res.rows.length;
  b.setAttribute("aria-disabled", "true");
  b.textContent = "Loading…";
  try {
    const r = await api.search(q, { ...opts, field: res.field, pageToken: res.next });
    if (my !== seq) return;
    res = { ...res, rows: [...res.rows, ...r.rows], next: r.next };
    paintResults();
    $$("[data-results] .rrow")[from]?.focus();
  } catch {
    if (my !== seq) return;
    b.removeAttribute("aria-disabled");
    b.textContent = "Couldn’t load more. Try again";
  }
}

// ── library ──────────────────────────────────────────────────────────
function renderAreas() {
  $("[data-areas]").innerHTML = [["all", "All"], ...AREAS.map((a) => [a.key, a.label])]
    .map(([k, l]) => `<button class="chip" type="button" data-area="${k}" aria-pressed="${libArea === k}">${esc(l)}</button>`).join("");
}

// "today", "yesterday" or a date, against today in US Eastern time (the registry's clock).
function dayWord(ymd) {
  const d = dayDiff(easternDay(Date.now()), ymd);
  return d === 0 ? "today" : d === 1 ? "yesterday" : "";
}

export function renderLibrary() {
  const el = $("[data-lib]");
  const live = L.online !== false && D.libAt > 0;
  $("[data-lib-note]").textContent = L.online === false
    ? `Explained in plain words by TrialSignal. Status from the saved copy, ${fmtDate(SNAPSHOT_DATE)}.`
    : live ? "Explained in plain words by TrialSignal. Status checked live." : "Explained in plain words by TrialSignal. Checking status…";
  el.innerHTML = LIBRARY.filter((t) => libArea === "all" || t.area === libArea).map((t) => {
    const s = statusOf(t.id);
    const lu = s && s.dates && s.dates.lastUpdate;
    const w = live && lu ? dayWord(lu) : "";
    const fresh = w ? `<span class="upd"><span class="ldot"></span>Updated ${w}</span>` : "";
    return `<a class="lrow" href="#${t.id}"><div><div class="nm">${esc(t.short)}</div><div class="co">${esc(t.company)}</div></div><div class="cd">${esc(t.condition)}</div><div class="ss">${s ? stHTML(s.status) : skel("width:110px;height:12px")}${fresh}</div>${ico("chev", "ico chev")}</a>`;
  }).join("");
}

// ── following ────────────────────────────────────────────────────────
const lookedOn = (ms) => shortDate(localDay(new Date(ms)));

function paintFollowFoot() {
  const b = $("[data-check-follow]");
  const note = $("[data-following]").closest(".console").querySelector(".con-note");
  b.hidden = SITE.preview;
  if (!busy(b)) b.textContent = L.online === false ? "Try now" : "Check now";
  note.textContent = SITE.preview
    ? `Preview: saved copy from ${shortDate(SNAPSHOT_DATE)}`
    : L.online === false ? "Can’t reach the registry. Trying again every 60 seconds" : "Rechecks every 60 seconds while this page is open";
}

function changeHTML(id, e, ch) {
  const lu = e.latest.lastUpdate;
  const looked = e.seenAt ? lookedOn(e.seenAt) : "";
  const st = ch.find((c) => c.kind === "status");
  const others = ch.filter((c) => c !== st && c.kind !== "update").map((c) => c.text);
  let what;
  if (e.example) {
    what = `The sponsor updated this record on ${fmtDate(lu)}.<span class="fi-ex">An example flag for this starter list. The update is real.</span>`;
  } else if (st) {
    what = `Status <s>${esc(statusLabel(e.seen.status))}</s><span class="arrow">→</span>${esc(statusLabel(e.latest.status))}${others.length ? ` · ${esc(others.join(" · "))}` : ""}, posted ${fmtDate(lu)}.${looked ? ` You last looked on ${looked}.` : ""}`;
  } else if (others.length) {
    what = `${esc(others.join(" · "))}, posted ${fmtDate(lu)}.${looked ? ` You last looked on ${looked}.` : ""}`;
  } else {
    what = `The sponsor updated this record on ${fmtDate(lu)}${looked ? `, after you last looked on ${looked}` : ""}.`;
  }
  return `<div class="fi-change"><span class="tag-new">Changed</span> <span class="what">${what}</span>
    <div class="fi-actions"><a class="link" href="https://clinicaltrials.gov/study/${id}?tab=history" target="_blank" rel="noopener">See exactly what changed ${ico("ext", "ico ico-sm")}</a><button class="cbtn" type="button" data-seen="${id}">Mark as seen</button></div></div>`;
}

export function renderFollowing() {
  const ids = follow.ids();
  const changed = ids.filter((id) => follow.changes(id).length);
  $$("[data-follow-badge]").forEach((b) => {
    b.hidden = !changed.length;
    b.textContent = changed.length;
    b.setAttribute("aria-label", `${changed.length} followed ${changed.length === 1 ? "trial" : "trials"} changed`);
  });
  const box = $("[data-following]");
  paintFollowFoot();
  $("[data-follow-count]").textContent = ids.length || "";
  if (!ids.length) {
    box.innerHTML = '<div class="fitem"><p class="fi-cond">You’re not following any trials yet. Open a trial and choose <b>Follow this trial</b>; TrialSignal will flag it here when its record changes.</p></div>';
    return;
  }
  const order = [...changed, ...ids.filter((id) => !changed.includes(id))];
  box.innerHTML = order.map((id) => {
    const e = follow.get(id);
    const t = lib(id);
    const s = statusOf(id);
    const cur = e.latest || (s && { status: s.status, lastUpdate: s.dates.lastUpdate, phase: s.phase, title: s.title, acronym: s.acronym });
    const name = (t && t.short) || (cur && cur.acronym) || id;
    const cond = (t && t.condition) || (cur && cur.title) || "";
    const lu = cur && cur.lastUpdate;
    const w = lu && L.online !== false ? dayWord(lu) : "";
    const when = lu ? `updated <b>${w || fmtDate(lu)}</b>` : "";
    const ch = follow.changes(id);
    let change = "";
    if (ch.length) change = changeHTML(id, e, ch);
    else if (e.error) change = `<p class="fi-meta fi-note">${esc(e.error)}</p>`;
    else if (e.seed) change = '<p class="fi-meta fi-note">No change yet. It will be flagged here when its record changes.</p>';
    else if (e.seen) change = `<p class="fi-meta fi-note">No change since you last looked${e.seenAt ? ` on ${lookedOn(e.seenAt)}` : ""}.</p>`;
    return `<div class="fitem${ch.length ? " changed" : ""}"><div class="fi-top"><a href="#${esc(id)}">${esc(name)}</a><span class="fi-when">${when}</span></div>
      <p class="fi-cond">${esc(cond)}</p>
      <div class="fi-meta">${cur ? stHTML(cur.status) : skel("width:120px;height:11px")}${cur && cur.phase ? `<span>${esc(cur.phase)}</span>` : ""}<span class="mono">${esc(id)}</span></div>${change}</div>`;
  }).join("");
}
