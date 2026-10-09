// Updates: the live registry feed (with area filters), hand-picked headlines, and Compare.

import { $, $$, esc, num, fmtDate, shortDate, ico } from "../util.js";
import { SITE } from "../config.js";
import { L, paintCount, countTo } from "../live.js";
import { D, statusOf, loadFeed, loadAreaCounts, feedKey, isCurrent, isStale, SNAPSHOT, SNAPSHOT_DATE, swallow } from "../data.js";
import { stHTML, renderFeed, renderFeedSkeleton, hideNewPill, errorRow, METRIC_TEXT } from "../console.js";
import { LIBRARY, AREAS, lib } from "../../data/library.js";
import { NEWS, NEWS_REVIEWED } from "../../data/news.js";
import { newsDate, ntype } from "./start.js";

let metric = "updated";
let area = "all";
let cmpA = "NCT04184622";
let cmpB = "NCT03548935";

const busy = (b) => b && b.getAttribute("aria-disabled") === "true";

export function bindUpdates() {
  $('[data-tabs="updates"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-metric]");
    if (!b || b.dataset.metric === metric) return;
    metric = b.dataset.metric;
    $$('[data-tabs="updates"] [data-metric]').forEach((x) => x.setAttribute("aria-pressed", x === b));
    hideNewPill("updates");
    showFeed(true);
  });
  $("[data-con-areas]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-carea]");
    if (!b || b.dataset.carea === area || busy(b)) return;
    if (L.online === false && b.dataset.carea !== "all") return;
    area = b.dataset.carea;
    renderAreas();
    $(`[data-carea="${area}"]`)?.focus();
    paintTabCounts();
    const a = area;
    if (a !== "all" && !D.areaCounts[a]) loadAreaCounts(a).then(() => { if (area === a) paintTabCounts(); }).catch(swallow);
    hideNewPill("updates");
    showFeed(true);
  });
  $("[data-more]").addEventListener("click", async () => {
    const b = $("[data-more]");
    const key = feedKey("updates", metric, area);
    const m = metric;
    if (L.online === false || !D.next[key] || busy(b)) return;
    b.setAttribute("aria-disabled", "true");
    b.textContent = "Loading…";
    const from = (D.feeds[key] || []).length;
    const ok = await loadFeed("updates", m, area, { append: true }).then(() => true, () => false);
    if (feedKey("updates", metric, area) !== key) return;
    if (!ok) { b.removeAttribute("aria-disabled"); b.textContent = "Couldn’t load more. Try again"; return; }
    renderFeed("updates", m, D.feeds[key], { stream: true, from, area });
    paintMore();
    $$('[data-feed="updates"] .frow')[from]?.focus();
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-cmp]")) {
      if (e.target.dataset.cmp === "A") cmpA = e.target.value; else cmpB = e.target.value;
      renderCompare();
    }
  });
  renderAreas();
  renderNews();
}

export function renderUpdates() {
  paintLede();
  paintTabCounts();
  loadAreaIfMissing();
  showFeed(false);
  renderCompare();
}

// A chosen area's counts are cleared by a registry refresh; fetch them again.
function loadAreaIfMissing() {
  const a = area;
  if (a === "all" || D.areaCounts[a] || L.online !== true) return;
  loadAreaCounts(a).then(() => { if (area === a) paintTabCounts(); }).catch(swallow);
}

export const currentKey = () => feedKey("updates", metric, area);

// Offline the feed is the saved copy, which covers all areas only.
export function resetArea() {
  area = "all";
  renderAreas();
}

// After a registry refresh, or when this page opens live.
export async function refreshUpdates() {
  const key = feedKey("updates", metric, area);
  const [m, a] = [metric, area];
  if (a !== "all") await loadAreaCounts(a).catch(swallow);
  paintTabCounts();
  let fresh = [];
  let ok = true;
  await loadFeed("updates", m, a).then((f) => (fresh = f), () => (ok = false));
  // Moved to another tab or area, or gone offline (the saved copy is already painted).
  if (feedKey("updates", metric, area) !== key || L.online !== true) return;
  if (ok || D.feeds[key]) renderFeed("updates", m, D.feeds[key], { fresh, area: a });
  else $('[data-feed="updates"]').innerHTML = errorRow();
  paintMore();
}

// The lede and the source line under the headlines follow the connection.
export function paintLede() {
  $("[data-up-lede]").textContent = L.online === false
    ? (SITE.preview
      ? `This preview can’t reach ClinicalTrials.gov, so the feed shows the copy saved on ${fmtDate(SNAPSHOT_DATE)}. Headlines are picked and checked by hand.`
      : `TrialSignal can’t reach ClinicalTrials.gov right now, so the feed shows the saved copy from ${fmtDate(SNAPSHOT_DATE)}. Headlines are picked and checked by hand.`)
    : L.online === null ? "Connecting to the ClinicalTrials.gov feed. Headlines are picked and checked by hand."
      : "The registry feed is live from ClinicalTrials.gov. Headlines are picked and checked by hand.";
}

export function paintTabCounts() {
  const c = area === "all" ? D.counts : D.areaCounts[area];
  ["today", "new7", "results7"].forEach((k) => {
    $$(`[data-tabs="updates"] [data-count="${k}"]`).forEach((el) => {
      if (c && c[k] != null) countTo(el, c[k], { animate: !D.saved });
      else { delete el.dataset.v; el.innerHTML = '<span class="skel"></span>'; }
    });
  });
}

// A feed from an older registry refresh stays on screen while the current one loads.
function showFeed(stream) {
  const key = feedKey("updates", metric, area);
  const [m, a] = [metric, area];
  const rows = D.feeds[key];
  renderFeed("updates", m, rows || null, { stream, saved: D.saved, area: a });
  if ((!rows || (!D.saved && !isCurrent(D.feedStamp[key]))) && L.online === true) {
    loadFeed("updates", m, a)
      .then((fresh) => { if (feedKey("updates", metric, area) === key) { renderFeed("updates", m, D.feeds[key], { stream: !rows, fresh: rows ? fresh : [], area: a }); paintMore(); } })
      .catch((e) => { if (feedKey("updates", metric, area) === key && L.online === true && !isStale(e) && !D.feeds[key]) $('[data-feed="updates"]').innerHTML = errorRow(); });
  }
  paintMore();
}

// Called on each check: reload what failed to load or is from an older refresh.
export function retryUpdates() {
  if (L.online !== true) return;
  loadAreaIfMissing();
  const key = feedKey("updates", metric, area);
  if (!D.feeds[key]) { renderFeedSkeleton("updates"); showFeed(true); }
  else if (!isCurrent(D.feedStamp[key])) showFeed(false);
}

function paintMore() {
  const key = feedKey("updates", metric, area);
  const b = $("[data-more]");
  b.hidden = L.online === false || !D.next[key];
  b.removeAttribute("aria-disabled");
  b.textContent = "Show 8 more";
}

function renderAreas() {
  $("[data-con-areas]").innerHTML = [["all", "All areas"], ...AREAS.map((a) => [a.key, a.label])]
    .map(([k, l]) => `<button class="cchip" type="button" data-carea="${k}" aria-pressed="${area === k}"${L.online === false && k !== "all" ? " disabled" : ""}>${esc(l)}</button>`).join("");
}
export const repaintUpdatesAreas = renderAreas;

function renderNews() {
  const f = NEWS[0];
  $("[data-news-feature]").innerHTML = `${ntype(f.type)}<span class="nf-date">${newsDate(f.date)}</span>
    <h3>${esc(f.title)}</h3><p>${esc(f.summary)}</p><p class="ev"><b>How firm is this?</b> ${esc(f.evidence)}</p>
    <div class="src-links">${f.links.map(([t, u]) => `<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ${ico("ext", "ico ico-sm")}</a>`).join("")}</div>`;
  $("[data-news-list]").innerHTML = NEWS.slice(1, 5).map((n) => `<a class="nl" href="${esc(n.trial ? `#${n.trial}` : n.links[0][1])}"${n.trial ? "" : ' target="_blank" rel="noopener"'}>
    <span class="meta">${ntype(n.type)}<span>${newsDate(n.date)} · ${esc(n.company)}</span></span><span class="t">${esc(n.title)}</span></a>`).join("");
}

// Under the headlines on Start and Updates: how they were picked, and where the numbers come from.
export function paintNewsNote() {
  const src = L.online === false ? `Registry numbers are from the saved copy, ${fmtDate(SNAPSHOT_DATE)}.` : L.online === true ? "Registry numbers on this site are live." : "Registry numbers load from ClinicalTrials.gov.";
  $$("[data-news-note]").forEach((el) => (el.textContent = `Picked and checked by hand, last reviewed ${fmtDate(NEWS_REVIEWED)}. ${src}`));
}

// The pickers are built once, so changing one keeps keyboard focus on it.
export function renderCompare() {
  const box = $("[data-compare]");
  const opt = (sel) => LIBRARY.map((x) => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(x.short)}</option>`).join("");
  if (!$(".cmp-pick", box)) {
    box.innerHTML = `<div class="cmp-pick"><div class="small">Pick two from the library</div><div><label class="sr" for="cmpA">First trial</label><select id="cmpA" data-cmp="A">${opt(cmpA)}</select></div><div><label class="sr" for="cmpB">Second trial</label><select id="cmpB" data-cmp="B">${opt(cmpB)}</select></div></div><div class="cmp-rows"></div>`;
  }
  const col = (id) => {
    const T = lib(id);
    const s = statusOf(id);
    const full = (D.records[id] && D.records[id].primaryOutcomes.length ? D.records[id] : SNAPSHOT[id]) || {};
    const po = full.primaryOutcomes && full.primaryOutcomes[0];
    return {
      st: s ? stHTML(s.status, true) : "",
      q: esc(T.question),
      who: esc(T.plainPop),
      tx: `${esc(T.intervention)}. Compared with: ${esc(T.comparator)}.`,
      m: po ? `${esc(po.measure)} <span class="small">(${esc(po.timeFrame)})</span>` : esc(T.measurePlain || "See the official record"),
      f: `${esc(T.result)}<br><span class="small">${T.evidence === "published" ? "Peer-reviewed paper" : "Company announcement only"}</span>`,
      n: s && s.enrollment && s.enrollment.count != null ? `${num(s.enrollment.count)} people` : "Not listed",
    };
  };
  const A = col(cmpA);
  const B = col(cmpB);
  const rows = [["Status", A.st, B.st], ["The question", A.q, B.q], ["Who it’s for", A.who, B.who], ["What’s tested", A.tx, B.tx], ["How it’s measured", A.m, B.m], ["What’s been found", A.f, B.f], ["People", A.n, B.n]];
  // Each value names its trial (for screen readers, and on screen once the columns stack).
  const who = (id) => `<span class="cmp-who">${esc(lib(id).short)}</span>`;
  $(".cmp-rows", box).innerHTML = rows.map(([k, x, y]) => `<div class="cmp-row"><div>${k}</div><div>${who(cmpA)}${x}</div><div>${who(cmpB)}${y}</div></div>`).join("");
}

export { METRIC_TEXT, paintCount, shortDate };
