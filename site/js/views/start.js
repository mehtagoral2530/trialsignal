// Start: live headline, search, "Start here" picks, the home console, five steps,
// live stages and recent headlines.

import { $, $$, esc, num, shortDate, fmtDate, ico } from "../util.js";
import { SITE } from "../config.js";
import { L, whenWord, easternWeekday, easternTime, countTo } from "../live.js";
import { D, statusOf, loadDays, loadFeed, feedKey, SNAPSHOT_DATE, swallow } from "../data.js";
import { stHTML, skel, renderBars, renderFeed, hideNewPill, errorRow, bindBarKeys } from "../console.js";
import { lib, PICKS, LIBRARY } from "../../data/library.js";
import { NEWS, NEWS_TYPES } from "../../data/news.js";

let metric = "updated";

export function bindStart() {
  $('[data-tabs="home"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-metric]");
    if (!b || b.dataset.metric === metric) return;
    metric = b.dataset.metric;
    $$('[data-tabs="home"] [data-metric]').forEach((x) => x.setAttribute("aria-pressed", x === b));
    hideNewPill("home");
    if (D.saved) { paintConsole({ grow: false, stream: false }); return; }
    showMetric();
  });
  bindBarKeys("home");
  renderSteps5();
  renderNews();
}

// Bars and feed for the selected tab; anything missing is loaded. A response that
// arrives after the reader has moved to another tab is not painted.
function showMetric() {
  const m = metric;
  const key = feedKey("home", m);
  if (D.days[m]) renderBars("home", m, { grow: true });
  else {
    renderBars("home", m);
    if (L.online === true) loadDays(m).then(() => { if (metric === m) renderBars("home", m, { grow: true }); }).catch(swallow);
  }
  if (D.feeds[key]) renderFeed("home", m, D.feeds[key], { stream: true });
  else {
    renderFeed("home", m, null);
    if (L.online === true) {
      loadFeed("home", m)
        .then(() => { if (metric === m) renderFeed("home", m, D.feeds[key], { stream: true }); })
        .catch(() => { if (metric === m) $('[data-feed="home"]').innerHTML = errorRow(); });
    }
  }
}

// Called on each check: reload whatever failed to load.
export function retryHome() {
  if (L.online !== true || D.saved) return;
  if (!D.days[metric] || !D.feeds[feedKey("home", metric)]) showMetric();
}

export function renderStart() {
  renderPicks();
  paintHero();
}

// Headline: "1,120 trials updated today."
export function paintHero() {
  const off = L.online === false;
  const w = off ? `on ${shortDate(SNAPSHOT_DATE)}` : whenWord(L.day) || "today";
  $$("[data-hero-when], [data-when-short]").forEach((el) => (el.textContent = w));
  const src = $("[data-hero-src]");
  const date = $("[data-hero-date]");
  if (off) {
    src.textContent = SITE.preview ? "Preview" : `Saved copy from ${shortDate(SNAPSHOT_DATE)}`;
    date.textContent = SITE.preview ? `saved copy from ${shortDate(SNAPSHOT_DATE)}` : "can’t reach the registry right now";
  } else if (L.online === true && L.refreshedAt) {
    src.textContent = "Live";
    date.textContent = `ClinicalTrials.gov refreshed ${easternWeekday(L.refreshedAt)} ${shortDate(L.day)}, ${easternTime(L.refreshedAt)}\u00a0ET`;
  } else {
    src.textContent = "Checking";
    date.textContent = "connecting to ClinicalTrials.gov…";
  }
}

// Whole console from current data (first paint, saved copy, tab switch offline).
// Every count on the page except the Updates tabs, which can be narrowed to one area.
export function paintCounts() {
  ["today", "new7", "results7", "recruiting"].forEach((k, i) => {
    if (D.counts[k] == null) return;
    $$(`[data-count="${k}"]`).filter((el) => !el.closest('[data-tabs="updates"]')).forEach((el) => countTo(el, D.counts[k], { delay: i * 90, animate: !D.saved }));
  });
}

export function paintConsole({ grow = true, stream = true, fresh = [] } = {}) {
  paintCounts();
  renderBars("home", metric, { grow: grow && !D.saved });
  renderFeed("home", metric, D.feeds[feedKey("home", metric)] || null, { stream: stream && !D.saved, fresh, saved: D.saved });
  renderLibStrip();
}

// Called after a registry refresh: reload the home feed alongside `pending` (the
// counts and bars), then paint the panel once.
export async function refreshHome(pending) {
  const m = metric;
  const [fresh] = await Promise.all([loadFeed("home", m).catch(() => null), pending]);
  if (metric !== m) return;
  paintConsole({ fresh: fresh || [] });
  if (!fresh && !D.feeds[feedKey("home", m)]) $('[data-feed="home"]').innerHTML = errorRow();
}

export const homeMetric = () => metric;

// "From the library": ties the live pulse to the curated trials.
export function renderLibStrip() {
  const el = $("[data-libstrip]");
  if (!el) return;
  const ref = D.saved ? SNAPSHOT_DATE : D.libAt ? L.day : "";
  if (!ref) return;
  const ids = Object.keys(D.lib).filter((id) => lib(id));
  const hits = ids.filter((id) => D.lib[id].dates && D.lib[id].dates.lastUpdate === ref).map(lib);
  if (hits.length) {
    const h = hits[0];
    el.innerHTML = `<span class="lbl">From the library</span><span><b>${esc(h.short)}</b>${hits.length > 1 ? ` and ${hits.length - 1} more` : ""} ${hits.length > 1 ? "were" : "was"} updated ${D.saved ? `on ${shortDate(ref)}` : "in this refresh"}.</span>
      <a class="link" href="https://clinicaltrials.gov/study/${h.id}?tab=history" target="_blank" rel="noopener">See what changed ${ico("ext", "ico ico-sm")}</a>`;
  } else if (ids.length) {
    const recent = ids.sort((a, b) => (D.lib[b].dates.lastUpdate || "").localeCompare(D.lib[a].dates.lastUpdate || ""))[0];
    el.innerHTML = `<span class="lbl">From the library</span><span>None of the ${LIBRARY.length} library trials changed ${D.saved ? `on ${shortDate(ref)}` : "in this refresh"}. Most recent: <b>${esc(lib(recent).short)}</b>, ${shortDate(D.lib[recent].dates.lastUpdate)}.</span>`;
  }
}

export function renderPicks() {
  $("[data-picks]").innerHTML = PICKS.map(([id, label]) => {
    const t = lib(id);
    const s = statusOf(id);
    return `<a class="pick" href="#${id}"><span class="area">${esc(label)}</span><span class="name">${esc(t.short.replace(/ vaccine$/, ""))}${ico("arrow", "ico ico-sm")}</span>${s ? stHTML(s.status) : skel("width:70%;height:12px;margin-top:4px")}</a>`;
  }).join("");
}

function renderSteps5() {
  const t = lib("NCT04184622");
  const names = ["The question", "Who it’s for", "What’s tested", "How it’s measured", "What’s been found"];
  $("[data-steps5]").innerHTML = names.map((n, i) => `<div class="s5"><span class="k">0${i + 1}</span><h3>${n}</h3><p>${t.five[i]}</p></div>`).join("");
}

export const newsDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDate(s) : fmtDate(s));
export const ntype = (type, extra = "") => `<span class="ntype nt-${NEWS_TYPES[type].tone}"${extra}><i></i>${NEWS_TYPES[type].label}</span>`;

function renderNews() {
  $("[data-news-rows]").innerHTML = NEWS.slice(0, 3).map((n) => `<div class="hrow">
      <span class="d">${newsDate(n.date)}</span>${ntype(n.type)}
      <a class="t" href="${esc(n.links[0][1])}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <span class="c">${esc(n.company)}</span></div>`).join("");
  const dec = NEWS.find((n) => n.type === "Approval");
  $("[data-latest-decision]").innerHTML = `${esc(dec.short || dec.title)}<span class="small dec-date">${newsDate(dec.date)} · latest decision</span>`;
}

