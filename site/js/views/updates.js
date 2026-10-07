// Updates: the live registry feed (with area filters), hand-picked headlines, and Compare.

import { $, $$, esc, num, fmtDate, ico } from "../util.js";
import { L, paintCount, countTo } from "../live.js";
import { D, statusOf, loadFeed, loadAreaCounts, feedKey, SNAPSHOT, SNAPSHOT_DATE, swallow } from "../data.js";
import { stHTML, renderFeed, METRIC_TEXT } from "../console.js";
import { LIBRARY, AREAS, lib } from "../../data/library.js";
import { NEWS, NEWS_REVIEWED } from "../../data/news.js";
import { newsDate, ntype } from "./start.js";

let metric = "updated";
let area = "all";
let cmpA = "NCT04184622";
let cmpB = "NCT03548935";

export function bindUpdates() {
  $('[data-tabs="updates"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-metric]");
    if (!b || b.dataset.metric === metric) return;
    metric = b.dataset.metric;
    $$('[data-tabs="updates"] [data-metric]').forEach((x) => x.setAttribute("aria-selected", x === b));
    showFeed(true);
  });
  $("[data-con-areas]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-carea]");
    if (!b || b.dataset.carea === area) return;
    if (L.online === false) return;
    area = b.dataset.carea;
    renderAreas();
    paintTabCounts();
    if (area !== "all" && !D.areaCounts[area]) loadAreaCounts(area).then(paintTabCounts).catch(swallow);
    showFeed(true);
  });
  $("[data-more]").addEventListener("click", async () => {
    const key = feedKey("updates", metric, area);
    if (L.online === false || !D.next[key]) return;
    const b = $("[data-more]");
    b.disabled = true;
    b.textContent = "Loading…";
    const from = (D.feeds[key] || []).length;
    await loadFeed("updates", metric, area, { append: true }).catch(swallow);
    renderFeed("updates", metric, D.feeds[key], { stream: true, from });
    paintMore();
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
  showFeed(false);
  renderCompare();
}

// After a registry refresh, or when this page opens live.
export async function refreshUpdates() {
  if (area !== "all") await loadAreaCounts(area).catch(swallow);
  paintTabCounts();
  const fresh = await loadFeed("updates", metric, area).catch(() => []);
  renderFeed("updates", metric, D.feeds[feedKey("updates", metric, area)], { fresh });
  paintMore();
}

function paintLede() {
  $("[data-up-lede]").textContent = L.online === false
    ? `ClinicalTrials.gov can’t be reached right now, so the feed shows the saved copy from ${fmtDate(SNAPSHOT_DATE)}. Headlines are picked and checked by hand.`
    : "The registry feed is live from ClinicalTrials.gov. Headlines are picked and checked by hand.";
}

function paintTabCounts() {
  const c = area === "all" ? D.counts : D.areaCounts[area];
  ["today", "new7", "results7"].forEach((k) => {
    $$(`[data-tabs="updates"] [data-count="${k}"]`).forEach((el) => {
      if (c && c[k] != null) countTo(el, c[k], { animate: !D.saved });
      else { delete el.dataset.v; el.innerHTML = '<span class="skel"></span>'; }
    });
  });
}

function showFeed(stream) {
  const key = feedKey("updates", metric, area);
  const rows = D.feeds[key];
  renderFeed("updates", metric, rows || null, { stream, saved: D.saved });
  if (!rows && L.online === true) {
    loadFeed("updates", metric, area).then(() => { renderFeed("updates", metric, D.feeds[key], { stream: true }); paintMore(); }).catch(swallow);
  }
  paintMore();
}

function paintMore() {
  const key = feedKey("updates", metric, area);
  const b = $("[data-more]");
  b.hidden = L.online === false || !D.next[key];
  b.disabled = false;
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
  $("[data-news-list]").innerHTML = NEWS.slice(1, 7).map((n) => `<a class="nl" href="${esc(n.trial ? `#${n.trial}` : n.links[0][1])}"${n.trial ? "" : ' target="_blank" rel="noopener"'}>
    <span class="meta">${ntype(n.type)}<span>${newsDate(n.date)} · ${esc(n.company)}</span></span><span class="t">${esc(n.title)}</span></a>`).join("");
  $$("[data-news-note]").forEach((el) => (el.textContent = `Picked and checked by hand, last reviewed ${fmtDate(NEWS_REVIEWED)}. Registry numbers on this site are live.`));
}

export function renderCompare() {
  const box = $("[data-compare]");
  const opt = (sel) => LIBRARY.map((x) => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(x.short)}</option>`).join("");
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
  box.innerHTML = `<div class="cmp-pick"><div class="small">Pick two from the library</div><div><label class="sr" for="cmpA">First trial</label><select id="cmpA" data-cmp="A">${opt(cmpA)}</select></div><div><label class="sr" for="cmpB">Second trial</label><select id="cmpB" data-cmp="B">${opt(cmpB)}</select></div></div>` +
    rows.map(([k, x, y]) => `<div class="cmp-row"><div>${k}</div><div>${x}</div><div>${y}</div></div>`).join("");
}

export { METRIC_TEXT, paintCount };
