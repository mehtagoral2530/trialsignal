// Pieces shared by the live panels ("consoles"): status labels, the 14-day bars and feed rows.

import { $, esc, num, shortDate, weekday, ico } from "./util.js";
import { statusLabel, statusClass, statusGloss } from "./normalize.js";
import { L, easternDay, reduceMotion } from "./live.js";
import { D } from "./data.js";

export const METRIC_TEXT = {
  updated: { title: "Latest changes", cap: "Trials updated per day, last two weeks.", tip: "trials updated" },
  new: { title: "Newly posted trials", cap: "New trials posted per day, last two weeks.", tip: "new trials posted" },
  results: { title: "Trials that just shared results", cap: "Trials sharing results per day, last two weeks.", tip: "trials shared results" },
};

// Status dot plus the official label, with an optional plain gloss.
export function stHTML(code, gloss = false) {
  if (!code) return "";
  const g = gloss ? statusGloss(code) : "";
  return `<span class="st ${statusClass(code)}"><i></i>${esc(statusLabel(code))}${g ? `<span class="gloss"> · ${esc(g)}</span>` : ""}</span>`;
}

export const skel = (style = "") => `<span class="skel"${style ? ` style="${style}"` : ""}></span>`;

// ── 14-day bars ──────────────────────────────────────────────────────
export function renderBars(scope, metric, { grow = false } = {}) {
  const el = $(`[data-bars="${scope}"]`);
  const vals = D.days[metric];
  if (!el) return;
  const cap = $(`[data-bars-cap="${scope}"]`);
  if (cap) cap.textContent = METRIC_TEXT[metric].cap;
  if (!vals) {
    // Loading: even, faint placeholders (no fake shape).
    el.innerHTML = Array.from({ length: 14 }, () => '<div class="bar loading"><i style="--h:30%"></i></div>').join("");
    $(`[data-barx="${scope}"]`).innerHTML = "";
    return;
  }
  const days = Object.keys(vals).sort();
  const max = Math.max(1, ...days.map((d) => vals[d]));
  const last = days[days.length - 1];
  const isToday = L.online === true && last === easternDay(Date.now());
  const anim = grow && !reduceMotion();
  el.innerHTML = days.map((d, i) => {
    const v = vals[d];
    const zero = v === 0;
    const lab = `${weekday(d)} ${shortDate(d)}`;
    const tip = zero ? `${lab} · <b>no refresh</b>` : `<b>${num(v)}</b> ${METRIC_TEXT[metric].tip} · ${lab}`;
    return `<div class="bar${zero ? " wkend" : ""}${d === last ? " today" : ""}${anim ? " grow" : ""}" role="listitem" tabindex="0" style="--d:${i * 35}ms" aria-label="${lab}: ${zero ? "no refresh" : `${num(v)} ${METRIC_TEXT[metric].tip}`}"><i style="--h:${zero ? 0 : Math.max(4, (v / max) * 100)}%"></i><span class="tip">${tip}</span></div>`;
  }).join("");
  const xs = [];
  for (let i = 0; i < days.length; i++) {
    const wd = weekday(days[i]);
    if (wd === "Sat" && i + 1 < days.length && vals[days[i]] === 0 && vals[days[i + 1]] === 0) { xs.push('<span class="we">weekend</span>'); i++; continue; }
    if (i === days.length - 1) { xs.push(`<span class="t">${isToday ? "Today" : L.online === false ? shortDate(days[i]) : wd}</span>`); continue; }
    xs.push(`<span>${wd[0]}</span>`);
  }
  $(`[data-barx="${scope}"]`).innerHTML = xs.join("");
}

// ── feed rows ────────────────────────────────────────────────────────
const newSince = { home: 0, updates: 0 };

export function renderFeedSkeleton(scope) {
  const ul = $(`[data-feed="${scope}"]`);
  if (!ul) return;
  ul.innerHTML = Array.from({ length: scope === "home" ? 4 : 6 }, () => `<li class="feed-skel">${skel("width:38%")}${skel("width:82%")}</li>`).join("");
}

export function feedRowHTML(r, { isNew = false, cls = "", delay = 0 } = {}) {
  return `<li class="${cls}" style="--d:${delay}ms"><a class="frow" href="#${r.id}">
    <span class="cond">${isNew ? '<span class="tag-new">New</span> ' : ""}${esc(r.condition || "Condition not listed")}${r.phase ? `<span class="ph">${esc(r.phase)}</span>` : ""}</span>
    ${stHTML(r.status)}
    <span class="title">${r.acronym ? `${esc(r.acronym)} · ` : ""}${esc(r.title)}</span>
    <span class="id">${r.id}</span></a></li>`;
}

// stream: rows rise in one after another; fresh: ids that just arrived after a refresh.
export function renderFeed(scope, metric, rows, { stream = false, fresh = [], from = 0, saved = false } = {}) {
  const ul = $(`[data-feed="${scope}"]`);
  if (!ul) return;
  const t = $(`[data-feed-title="${scope}"]`);
  if (t) t.textContent = METRIC_TEXT[metric].title;
  if (!rows) { renderFeedSkeleton(scope); return; }
  if (!rows.length) {
    ul.innerHTML = `<li class="feed-empty">Nothing in this view ${saved ? "in the saved copy" : "yet today"}. Try another tab.</li>`;
    return;
  }
  const motion = !reduceMotion();
  ul.innerHTML = rows.map((r, i) => {
    const isNew = motion && fresh.includes(r.id);
    const cls = isNew ? "is-new" : stream && motion && i >= from ? "in" : "";
    return feedRowHTML(r, { isNew: fresh.includes(r.id), cls, delay: Math.max(0, i - from) * 90 });
  }).join("");
  if (fresh.length) {
    newSince[scope] += fresh.length;
    const pill = ul.closest(".console")?.querySelector("[data-newpill]");
    if (pill) { pill.hidden = false; pill.innerHTML = `<span class="ldot"></span>${newSince[scope]} new since you opened`; }
  }
}

export const extLink = (href, text) => `<a class="link" href="${esc(href)}" target="_blank" rel="noopener">${esc(text)} ${ico("ext", "ico ico-sm")}</a>`;
