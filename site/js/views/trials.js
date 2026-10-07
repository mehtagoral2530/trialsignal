import { $, $$, esc, ago, plural, parseNCT, fmtDate } from "../util.js";
import { trialRow, rowFromModel, spinner, empty } from "../ui.js";
import { LIBRARY, AREAS, lib } from "../../data/library.js";
import { SITE } from "../config.js";
import * as api from "../api.js";
import { follow, known, tracking, checkFollowed, markSeen, SNAPSHOT_DATE } from "../state.js";

const TOPICS = ["Obesity", "Alzheimer’s disease", "Breast cancer", "Lung cancer", "Heart failure", "RSV vaccine"];
const STATUSES = [
  ["", "Any status"],
  ["RECRUITING", "Recruiting"],
  ["NOT_YET_RECRUITING", "Not yet recruiting"],
  ["ACTIVE_NOT_RECRUITING", "Active, not recruiting"],
  ["COMPLETED", "Completed"],
  ["TERMINATED,WITHDRAWN,SUSPENDED", "Stopped early"],
];

let search = { q: "", status: "", sort: "", list: [], total: null, next: "", loading: false, err: "", live: false, at: 0 };
let area = "all";
let go = () => {};

export function bindTrials(goFn) {
  go = goFn;
  $("#statusSel").innerHTML = STATUSES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); runSearch($("#searchInput").value); });
  $("#statusSel").addEventListener("change", () => search.q && runSearch(search.q));
  $("#sortSel").addEventListener("change", () => search.q && runSearch(search.q));
  $("#topics").addEventListener("click", (e) => {
    const c = e.target.closest("[data-topic]");
    if (!c) return;
    $("#searchInput").value = c.dataset.topic;
    runSearch(c.dataset.topic);
  });
  $("#areaChips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-area]");
    if (c) { area = c.dataset.area; renderResults(); }
  });
  $("#followList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seen]");
    if (b) markSeen(b.dataset.seen);
  });
  $("#checkNow").addEventListener("click", () => checkFollowed());
  $("#resList").addEventListener("click", (e) => {
    if (e.target.closest("#clearSearch")) { $("#searchInput").value = ""; runSearch(""); }
    if (e.target.closest("#moreBtn")) loadMore();
  });
}

export function renderTrials(params = {}) {
  if (params.q !== undefined && params.q !== search.q) {
    $("#searchInput").value = params.q;
    runSearch(params.q);
  }
  $("#topics").innerHTML = `<span class="small faint">Try:</span>` +
    TOPICS.map((t) => `<button class="chip" type="button" data-topic="${esc(t)}" aria-pressed="${search.q === t}">${esc(t)}</button>`).join("");
  renderBanner();
  renderFollow();
  renderResults();
}

export function renderBanner() {
  const b = $("#liveBanner");
  if (SITE.preview) {
    b.innerHTML = `<div class="banner"><p><b>Preview mode.</b> This copy can’t reach ClinicalTrials.gov, so search covers the TrialSignal library and trial details come from the copy saved on ${esc(fmtDate(SNAPSHOT_DATE))}. The hosted site searches and tracks every trial live.</p></div>`;
  } else if (api.live.state === "offline") {
    b.innerHTML = `<div class="banner warn"><p><b>Can’t reach ClinicalTrials.gov right now.</b> Search covers the TrialSignal library, and trial details come from the copy saved on ${esc(fmtDate(SNAPSHOT_DATE))}. TrialSignal will try again on your next search.</p></div>`;
  } else b.innerHTML = "";
}

// ── following ────────────────────────────────────────────────────────
export function renderFollow() {
  const ids = follow.ids();
  const meta = $("#followMeta");
  const btn = $("#checkNow");
  btn.hidden = SITE.preview || !ids.length;
  btn.disabled = tracking.busy;
  btn.innerHTML = tracking.busy ? `${spinner} Checking` : "Check now";
  if (SITE.preview) meta.textContent = "Live checks run on the hosted site";
  else if (tracking.error) meta.textContent = tracking.error;
  else if (follow.lastChecked()) meta.textContent = `Checked ${ago(follow.lastChecked())} · re-checks every ${SITE.refreshMinutes} minutes while open`;
  else meta.textContent = ids.length ? "Waiting for the first check" : "";

  if (!ids.length) {
    $("#followList").innerHTML = empty("You aren’t following any trials yet. Open a trial and choose <b>Follow</b> to track its status here.");
    return;
  }
  $("#followList").innerHTML = `<div class="rows">${ids.map((id) => {
    const e = follow.get(id);
    const L = lib(id);
    const snap = known(id).model;
    const cur = e.latest || (snap && { status: snap.status, title: snap.title, acronym: snap.acronym, phase: snap.phase, lastUpdate: snap.dates.lastUpdate }) || {};
    const changes = follow.changes(id);
    const row = trialRow({ id, short: (L && L.short) || cur.acronym, title: cur.title || "Followed trial", status: cur.status, phase: cur.phase, lastUpdate: cur.lastUpdate });
    let bar = "";
    if (changes.length) {
      bar = `<div class="change"><span class="pill p-sun dot">Changed</span><span>${changes.map((c) => esc(c.text)).join(" · ")}</span><button class="linkbtn" type="button" data-seen="${id}">Mark as seen</button></div>`;
    } else if (e.error) bar = `<div class="change quiet">${esc(e.error)}</div>`;
    return `<div class="frow${changes.length ? " is-changed" : ""}">${row}${bar}</div>`;
  }).join("")}</div>`;
}

// ── search & library ─────────────────────────────────────────────────
function librarySearch(q) {
  const words = q.toLowerCase().replace(/[’']s?\b/g, "").split(/\s+/).filter((w) => w.length > 2).map((w) => w.slice(0, 6));
  return LIBRARY.filter((t) => {
    const m = known(t.id).model || {};
    const hay = [t.short, t.condition, t.company, t.intervention, m.title, (m.conditions || []).join(" ")].join(" ").toLowerCase().replace(/[’']/g, "");
    return words.every((w) => hay.includes(w));
  }).map((t) => ({ ...rowFromModel(known(t.id).model || { id: t.id }, t.short), title: t.condition, sponsor: t.company }));
}

async function runSearch(q) {
  q = q.trim();
  const id = parseNCT(q);
  if (id) { go(id); return; }
  search = { q, status: $("#statusSel").value, sort: $("#sortSel").value, list: [], total: null, next: "", loading: !!q, err: "", live: false, at: 0 };
  $$("#topics .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.topic === q));
  renderResults();
  if (!q) return;
  if (SITE.preview) {
    search = { ...search, loading: false, list: librarySearch(q), live: false };
    renderResults();
    return;
  }
  try {
    const r = await api.searchStudies({ q, status: search.status, sort: search.sort });
    if (search.q !== q) return;
    search = { ...search, loading: false, list: r.studies.map((m) => rowFromModel(m)), total: r.total, next: r.next, live: true, at: Date.now() };
  } catch (e) {
    if (search.q !== q) return;
    search = { ...search, loading: false, list: librarySearch(q), live: false, err: e.offline ? "" : e.message };
  }
  renderBanner();
  renderResults();
}

async function loadMore() {
  const btn = $("#moreBtn");
  btn.disabled = true;
  btn.innerHTML = `${spinner} Loading`;
  try {
    const r = await api.searchStudies({ q: search.q, status: search.status, sort: search.sort, pageToken: search.next });
    search.list.push(...r.studies.map((m) => rowFromModel(m)));
    search.next = r.next;
  } catch (e) {
    search.err = e.message;
  }
  renderResults();
}

function renderResults() {
  const view = $('[data-view="trials"]');
  const results = $("#resultsBlock");
  // While searching, results sit right under the search box.
  if (search.q) view.insertBefore(results, $("#followBlock"));
  else view.appendChild(results);

  const title = $("#resTitle");
  const meta = $("#resMeta");
  const out = $("#resList");
  const chips = $("#areaChips");

  if (!search.q) {
    title.textContent = "The TrialSignal library";
    meta.textContent = `${LIBRARY.length} trials explained in plain words`;
    chips.hidden = false;
    chips.innerHTML = [["all", "All"], ...AREAS.map((a) => [a.key, a.label])]
      .map(([k, l]) => `<button class="chip" type="button" data-area="${k}" aria-pressed="${area === k}">${esc(l)}</button>`).join("");
    // Library rows use the plain condition instead of the registry's long official title.
    const rowsFor = (list) => `<div class="rows">${list.map((t) => trialRow({ ...rowFromModel(known(t.id).model || { id: t.id }, t.short), title: t.condition, sponsor: t.company, lastUpdate: "" })).join("")}</div>`;
    out.innerHTML = area === "all"
      ? AREAS.map((a) => `<div class="group"><h3>${esc(a.label)}</h3>${rowsFor(LIBRARY.filter((t) => t.area === a.key))}</div>`).join("")
      : rowsFor(LIBRARY.filter((t) => t.area === area));
    return;
  }

  chips.hidden = true;
  title.textContent = `Results for “${search.q}”`;
  if (search.loading) {
    meta.textContent = "";
    out.innerHTML = empty(`${spinner} Searching ClinicalTrials.gov…`);
    return;
  }
  if (search.err && !search.list.length) {
    meta.textContent = "";
    out.innerHTML = empty(esc(search.err));
    return;
  }
  meta.textContent = search.live
    ? `${search.total != null ? `${plural(search.total, "trial")} · ` : ""}live from ClinicalTrials.gov`
    : "From the TrialSignal library";
  const clear = `<p class="small"><button class="linkbtn" type="button" id="clearSearch">Clear search</button></p>`;
  if (!search.list.length) {
    out.innerHTML = empty("No trials found. Try a broader word, such as the condition name.") + clear;
    return;
  }
  out.innerHTML = `<div class="rows">${search.list.map((s) => trialRow(s)).join("")}</div>` +
    (search.next ? `<p><button class="btn quiet" type="button" id="moreBtn">Show more results</button></p>` : "") +
    (search.err ? `<p class="small warn-text">${esc(search.err)}</p>` : "") + clear;
}
