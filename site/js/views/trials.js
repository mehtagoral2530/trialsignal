// Trials: registry search, the library, and the Following console.

import { $, $$, esc, num, shortDate, fmtDate, dayDiff, ico } from "../util.js";
import { L, paintCount } from "../live.js";
import { D, follow, statusOf, loadStatuses, loadTotal, SNAPSHOT_DATE, swallow } from "../data.js";
import { stHTML, skel } from "../console.js";
import * as api from "../api.js";
import { statusLabel } from "../normalize.js";
import { LIBRARY, AREAS, lib } from "../../data/library.js";
import { check } from "../live.js";
import { toast } from "../util.js";

let libArea = "all";
let q = "";
let opts = { recruiting: false, newest: false };
let res = null; // { rows, total, recruiting, next }
let seq = 0;
let timer = 0;

export function bindTrials(go) {
  const input = $("#q2");
  $("#searchForm2").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (/^NCT\d{8}$/i.test(v)) { go(v.toUpperCase()); return; }
    runSearch(v);
  });
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 400); });
  $("[data-suggest]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (b) { input.value = b.dataset.q; runSearch(b.dataset.q); }
  });
  $("[data-areas]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-area]");
    if (b) { libArea = b.dataset.area; renderAreas(); renderLibrary(); }
  });
  $("[data-results]").addEventListener("click", (e) => {
    const t = e.target.closest("[data-opt]");
    if (t) { opts[t.dataset.opt] = !opts[t.dataset.opt]; runSearch(q, { force: true }); }
    if (e.target.closest("[data-more-results]")) moreResults();
  });
  $("[data-following]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seen]");
    if (b) { follow.markSeen(b.dataset.seen); renderFollowing(); toast("Marked as seen"); }
  });
  $("[data-check-follow]").addEventListener("click", async () => {
    const b = $("[data-check-follow]");
    b.disabled = true;
    b.textContent = "Checking…";
    await check("manual");
    if (L.online) await loadStatuses().catch(swallow);
    b.disabled = false;
    b.textContent = "Check now";
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

// ── search ───────────────────────────────────────────────────────────
const toggle = (key, label) => `<button class="chip chip-sm" type="button" data-opt="${key}" aria-pressed="${opts[key]}">${label}</button>`;

async function runSearch(text, { force = false } = {}) {
  const box = $("[data-results]");
  const value = String(text || "").trim();
  if (!value) { q = ""; box.hidden = true; return; }
  if (value === q && !force && res) return;
  q = value;
  box.hidden = false;
  if (L.online === false) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = LIBRARY.filter((t) => { const hay = `${t.short} ${t.condition} ${t.company} ${t.intervention} ${t.id}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
    box.innerHTML = `<div class="results-head"><span><b>${hits.length}</b> library ${hits.length === 1 ? "trial matches" : "trials match"} “${esc(q)}”. Full registry search returns when ClinicalTrials.gov is reachable.</span></div>` +
      (hits.length ? hits.map((t) => `<a class="rrow" href="#${t.id}"><span class="cond">${esc(t.short)}</span>${stHTML(statusOf(t.id)?.status)}<span class="title">${esc(t.condition)}</span><span class="id">${t.id}</span></a>`).join("") : '<p class="rrow">No library trials match. Try a condition, such as obesity.</p>');
    return;
  }
  const my = ++seq;
  box.innerHTML = `<div class="results-head">${skel("width:40%")}</div>${Array.from({ length: 3 }, () => `<div class="rrow">${skel("width:50%")}${skel("width:80%")}</div>`).join("")}`;
  try {
    const r = await api.search(q, opts);
    if (my !== seq) return;
    res = r;
    paintResults();
  } catch {
    if (my !== seq) return;
    box.innerHTML = '<div class="results-head">Search couldn’t reach ClinicalTrials.gov. Try again in a moment.</div>';
  }
}

function rowHTML(r) {
  return `<a class="rrow" href="#${r.id}"><span class="cond">${esc(r.condition || r.title)}</span>${stHTML(r.status)}<span class="title">${r.acronym ? `${esc(r.acronym)} · ` : ""}${esc(r.title)}</span><span class="id">${r.id}</span></a>`;
}

function paintResults() {
  const box = $("[data-results]");
  const { rows, total, recruiting, next } = res;
  box.innerHTML = `<div class="results-head"><span><b>${num(total ?? rows.length)}</b> ${total === 1 ? "study matches" : "studies match"} “${esc(q)}”${recruiting != null && !opts.recruiting ? ` · <b>${num(recruiting)}</b> recruiting now` : ""}</span>
      <a class="link" href="https://clinicaltrials.gov/search?term=${encodeURIComponent(q)}" target="_blank" rel="noopener">All on ClinicalTrials.gov ${ico("ext", "ico ico-sm")}</a></div>
    <div class="results-opts">${toggle("recruiting", "Recruiting only")}${toggle("newest", "Newest updates first")}</div>` +
    (rows.length ? rows.map(rowHTML).join("") : '<p class="rrow">No studies match. Try a simpler word, such as a condition.</p>') +
    (next ? '<div class="results-more"><button class="btn btn-sm" type="button" data-more-results>Show 10 more</button></div>' : "");
}

async function moreResults() {
  const b = $("[data-more-results]");
  if (!b || !res?.next) return;
  b.disabled = true;
  b.textContent = "Loading…";
  try {
    const r = await api.search(q, { ...opts, pageToken: res.next });
    res = { ...res, rows: [...res.rows, ...r.rows], next: r.next };
    paintResults();
  } catch {
    b.disabled = false;
    b.textContent = "Couldn’t load more. Try again";
  }
}

// ── library ──────────────────────────────────────────────────────────
function renderAreas() {
  $("[data-areas]").innerHTML = [["all", "All"], ...AREAS.map((a) => [a.key, a.label])]
    .map(([k, l]) => `<button class="chip" type="button" data-area="${k}" aria-pressed="${libArea === k}">${esc(l)}</button>`).join("");
}

export function renderLibrary() {
  const el = $("[data-lib]");
  const ref = L.online === true ? L.day : null;
  $("[data-lib-note]").textContent = L.online === false ? `Explained in plain words by TrialSignal. Status from the saved copy, ${fmtDate(SNAPSHOT_DATE)}.` : "Explained in plain words by TrialSignal. Status is live.";
  el.innerHTML = LIBRARY.filter((t) => libArea === "all" || t.area === libArea).map((t) => {
    const s = statusOf(t.id);
    const lu = s && s.dates && s.dates.lastUpdate;
    const fresh = ref && lu && dayDiff(ref, lu) <= 1 ? `<span class="upd"><span class="ldot"></span>Updated ${dayDiff(ref, lu) === 0 ? "today" : "yesterday"}</span>` : "";
    return `<a class="lrow" href="#${t.id}"><div><div class="nm">${esc(t.short)}</div><div class="co">${esc(t.company)}</div></div><div class="cd">${esc(t.condition)}</div><div class="ss">${s ? stHTML(s.status) : skel("width:110px;height:12px")}${fresh}</div>${ico("chev", "ico chev")}</a>`;
  }).join("");
}

// ── following ────────────────────────────────────────────────────────
export function renderFollowing() {
  const ids = follow.ids();
  const changed = ids.filter((id) => follow.changes(id).length);
  $$("[data-follow-badge]").forEach((b) => {
    b.hidden = !changed.length;
    b.textContent = changed.length;
    b.setAttribute("aria-label", `${changed.length} followed ${changed.length === 1 ? "trial" : "trials"} changed`);
  });
  const box = $("[data-following]");
  $("[data-follow-count]").textContent = ids.length || "";
  if (!ids.length) {
    box.innerHTML = '<div class="fitem"><p class="fi-cond">You’re not following any trials yet. Open a trial and choose <b>Follow this trial</b>; TrialSignal will flag it here when its record changes.</p></div>';
    return;
  }
  const ref = L.online === true ? L.day : null;
  const order = [...changed, ...ids.filter((id) => !changed.includes(id))];
  box.innerHTML = order.map((id) => {
    const e = follow.get(id);
    const t = lib(id);
    const s = statusOf(id);
    const cur = e.latest || (s && { status: s.status, lastUpdate: s.dates.lastUpdate, phase: s.phase, title: s.title, acronym: s.acronym });
    const name = (t && t.short) || (cur && cur.acronym) || id;
    const cond = (t && t.condition) || (cur && cur.title) || "";
    const lu = cur && cur.lastUpdate;
    const when = lu ? `updated <b>${ref && dayDiff(ref, lu) === 0 ? "today" : ref && dayDiff(ref, lu) === 1 ? "yesterday" : fmtDate(lu)}</b>` : "";
    const ch = follow.changes(id);
    let change = "";
    if (ch.length) {
      const st = ch.find((c) => c.kind === "status");
      const what = st
        ? `Status <s>${esc(statusLabel(e.seen.status))}</s><span class="arrow">→</span>${esc(statusLabel(e.latest.status))}`
        : esc(ch.map((c) => c.text).join(" · "));
      const extra = st ? ch.filter((c) => c !== st && c.kind !== "update").map((c) => c.text) : [];
      change = `<div class="fi-change"><span class="tag-new">Changed</span> <span class="what">${what}</span>${extra.length ? ` · ${esc(extra.join(" · "))}` : ""}. Record updated ${fmtDate(e.latest.lastUpdate)}; you last saw the version from ${fmtDate(e.seen.lastUpdate)}.
        <div class="fi-actions"><a class="link" href="https://clinicaltrials.gov/study/${id}?tab=history" target="_blank" rel="noopener">See exactly what changed ${ico("ext", "ico ico-sm")}</a><button class="cbtn" type="button" data-seen="${id}">Mark as seen</button></div></div>`;
    } else if (e.error) {
      change = `<p class="fi-meta fi-note">${esc(e.error)}</p>`;
    } else if (e.seen) {
      change = `<p class="fi-meta fi-note">No change since the version from ${fmtDate(e.seen.lastUpdate)}.</p>`;
    }
    return `<div class="fitem${ch.length ? " changed" : ""}"><div class="fi-top"><a href="#${id}">${esc(name)}</a><span class="fi-when">${when}</span></div>
      <p class="fi-cond">${esc(cond)}</p>
      <div class="fi-meta">${cur ? stHTML(cur.status) : skel("width:120px;height:11px")}${cur && cur.phase ? `<span>${esc(cur.phase)}</span>` : ""}<span class="mono">${id}</span></div>${change}</div>`;
  }).join("");
}

export { shortDate };
