// Start: live headline, search, "Start here" picks, the home console, five steps,
// live stages and recent headlines.

import { $, $$, esc, num, shortDate, fmtDate, ico } from "../util.js";
import { SITE } from "../config.js";
import { L, whenWord, easternWeekday, easternTime, countTo } from "../live.js";
import { D, statusOf, loadDays, loadFeed, feedKey, SNAPSHOT_DATE, swallow } from "../data.js";
import { stHTML, skel, renderBars, renderFeed } from "../console.js";
import { lib, PICKS } from "../../data/library.js";
import { NEWS, NEWS_TYPES, NEWS_REVIEWED } from "../../data/news.js";

let metric = "updated";

export function bindStart() {
  $('[data-tabs="home"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-metric]");
    if (!b || b.dataset.metric === metric) return;
    metric = b.dataset.metric;
    $$('[data-tabs="home"] [data-metric]').forEach((x) => x.setAttribute("aria-selected", x === b));
    if (D.saved) { paintConsole({ grow: false, stream: false }); return; }
    renderBars("home", metric, { grow: false });
    renderFeed("home", metric, D.feeds[feedKey("home", metric)] || null);
    if (!D.days[metric]) loadDays(metric).then(() => renderBars("home", metric, { grow: true })).catch(swallow);
    else renderBars("home", metric, { grow: true });
    if (D.feeds[feedKey("home", metric)]) renderFeed("home", metric, D.feeds[feedKey("home", metric)], { stream: true });
    else loadFeed("home", metric).then(() => renderFeed("home", metric, D.feeds[feedKey("home", metric)], { stream: true })).catch(swallow);
  });
  renderSteps5();
  renderNews();
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
  } else if (L.refreshedAt) {
    src.textContent = "Live";
    date.textContent = `ClinicalTrials.gov refreshed ${easternWeekday(L.refreshedAt)} ${shortDate(L.day)}, ${easternTime(L.refreshedAt)} ET`;
  }
}

// Whole console from current data (first paint, saved copy, tab switch offline).
export function paintConsole({ grow = true, stream = true, fresh = [] } = {}) {
  // Every count on the page except the Updates tabs, which can be narrowed to one area.
  ["today", "new7", "results7", "recruiting"].forEach((k, i) => {
    if (D.counts[k] == null) return;
    $$(`[data-count="${k}"]`).filter((el) => !el.closest('[data-tabs="updates"]')).forEach((el) => countTo(el, D.counts[k], { delay: i * 90, animate: !D.saved }));
  });
  renderBars("home", metric, { grow: grow && !D.saved });
  renderFeed("home", metric, D.feeds[feedKey("home", metric)] || null, { stream: stream && !D.saved, fresh, saved: D.saved });
  renderLibStrip();
}

// Called after a registry refresh: reload what the home console needs.
export async function refreshHome() {
  const fresh = await loadFeed("home", metric).catch(() => []);
  await (D.days[metric] ? Promise.resolve() : loadDays(metric).catch(swallow));
  paintConsole({ fresh });
}

export const homeMetric = () => metric;

// "From the library": ties the live pulse to the curated trials.
export function renderLibStrip() {
  const el = $("[data-libstrip]");
  if (!el) return;
  const ref = D.saved ? SNAPSHOT_DATE : L.day;
  if (!ref) return;
  const ids = Object.keys(D.lib).filter((id) => lib(id));
  const hits = ids.filter((id) => D.lib[id].dates && D.lib[id].dates.lastUpdate === ref).map(lib);
  if (hits.length) {
    const h = hits[0];
    el.innerHTML = `<span class="lbl">From the library</span><span><b>${esc(h.short)}</b>${hits.length > 1 ? ` and ${hits.length - 1} more` : ""} ${hits.length > 1 ? "were" : "was"} updated ${D.saved ? `on ${shortDate(ref)}` : "in this refresh"}.</span>
      <a class="link" href="https://clinicaltrials.gov/study/${h.id}?tab=history" target="_blank" rel="noopener">See what changed ${ico("ext", "ico ico-sm")}</a>`;
  } else if (ids.length) {
    const recent = ids.sort((a, b) => (D.lib[b].dates.lastUpdate || "").localeCompare(D.lib[a].dates.lastUpdate || ""))[0];
    el.innerHTML = `<span class="lbl">From the library</span><span>None of the 29 library trials changed in this refresh. Most recent: <b>${esc(lib(recent).short)}</b>, ${shortDate(D.lib[recent].dates.lastUpdate)}.</span>`;
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
  $$("[data-news-note]").forEach((el) => (el.textContent = `Picked and checked by hand, last reviewed ${fmtDate(NEWS_REVIEWED)}. Registry numbers on this site are live.`));
  const dec = NEWS.find((n) => n.type === "Approval");
  $("[data-latest-decision]").innerHTML = `${esc(dec.short || dec.title)}<span class="small dec-date">${newsDate(dec.date)} · latest decision</span>`;
}

