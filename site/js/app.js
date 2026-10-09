// Entry point: routing, the live chrome (header pill, panel badges, tickers), theme and start-up.

import { $, $$, esc, fmtDate, shortDate, store, parseNCT, toast } from "./util.js";
import { SITE } from "./config.js";
import { L, onLive, start as startLive, check, tick, countTo } from "./live.js";
import { D, onData, useSaved, refreshAll, loadTotal, loadCounts, loadStatuses, clearLive, feedKey, isCurrent, SNAPSHOT_DATE, swallow } from "./data.js";
import { initTips } from "./ui.js";
import { initNotes } from "./notes.js";
import { LIBRARY, LIBRARY_REVIEWED, lib } from "../data/library.js";
import { NEWS_REVIEWED } from "../data/news.js";
import { GLOSSARY, EXTRA_TERMS } from "../data/glossary.js";
import * as start from "./views/start.js";
import * as trials from "./views/trials.js";
import * as trial from "./views/trial.js";
import * as updates from "./views/updates.js";
import { renderFeedSkeleton, renderBars, hideNewPill } from "./console.js";

const VIEWS = ["start", "trials", "updates", "about"];
let view = "";
let trialId = null;
let pending = {};
let hideTip = () => {};

// ── routing: bare hash tokens (#trials, #NCT04184622) work on any static host ──
function route() {
  let h = decodeURIComponent(location.hash.slice(1)) || "start";
  // The skip link targets #main: keep the page and move focus to the content.
  if (h === "main") {
    if (view) {
      history.replaceState(null, "", `#${trialId || view}`);
      $("#main").focus();
      return;
    }
    history.replaceState(null, "", "#start");
    h = "start";
  }
  const story = h === "story";
  if (story) {
    history.replaceState(null, "", "#about");
    h = "about";
    const s = $("#story");
    if (s) { s.open = true; setTimeout(() => s.scrollIntoView(), 50); }
  }
  // #trial is a short link to the example trial; the address shows its real number.
  if (h === "trial") { history.replaceState(null, "", "#NCT04184622"); h = "NCT04184622"; }
  let v = VIEWS.includes(h) ? h : "start";
  let id = null;
  if (/^NCT\d{8}$/i.test(h)) { v = "trial"; id = h.toUpperCase(); }
  const same = v === view && id === trialId;
  const first = !view;
  view = v;
  trialId = id;
  $$(".view").forEach((s) => s.classList.toggle("on", s.dataset.view === v));
  const navKey = v === "trial" ? "trials" : v;
  $$("[data-nav]").forEach((a) => (a.dataset.nav === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  hideTip();
  if (!same && !story) window.scrollTo(0, 0);
  if (v === "start") start.renderStart();
  if (v === "trials") trials.renderTrials(pending);
  if (v === "updates") updates.renderUpdates();
  if (v === "trial") trial.renderTrial(id);
  pending = {};
  // Trial pages set their own title from the trial's name.
  if (v !== "trial") document.title = v === "start" ? SITE.name : `${v[0].toUpperCase()}${v.slice(1)} · ${SITE.name}`;
  tick();
  // After moving to another page, focus its heading so keyboard and screen-reader users start there.
  if (!first && !same && !story) $(`[data-view="${v}"] h1`)?.focus({ preventScroll: true });
}

export function go(target, params = {}) {
  pending = params;
  if (location.hash === `#${target}`) route();
  else location.hash = target;
}

// ── live chrome ──────────────────────────────────────────────────────
const RING = '<button class="con-check" type="button" data-check-now aria-label="Check the registry now"><svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle class="trk" cx="10" cy="10" r="8"/><circle class="val" cx="10" cy="10" r="8" style="stroke-dashoffset:50.27"/></svg></button>';

function paintChrome() {
  const on = L.online === true;
  const off = L.online === false;
  const saved = shortDate(SNAPSHOT_DATE);
  document.body.dataset.online = String(L.online);
  const pill = $("#livePill");
  pill.dataset.state = on ? "live" : off ? "offline" : "loading";
  $(".lp-word", pill).textContent = off ? (SITE.preview ? "Preview" : "Offline") : on ? "Live" : "Checking…";
  $(".lp-long", pill).textContent = on ? "checked " : "";
  $('[data-ago="pill"]', pill).textContent = off ? `saved ${saved}` : on ? "…" : "";
  $(".lp-sr", pill).textContent = off && SITE.preview ? ". This preview shows the saved copy" : off ? ". Try ClinicalTrials.gov again now" : ". Check ClinicalTrials.gov now";
  pill.title = off ? (SITE.preview ? "Preview: showing the saved copy" : "Try ClinicalTrials.gov again now") : "Check ClinicalTrials.gov now";
  $$('.console:not(.rec-con):not([data-console="follow"])').forEach((c) => (c.dataset.state = on ? "live" : off ? "offline" : "loading"));
  $$('.console:not(.rec-con):not([data-console="follow"]) [data-badge-word]').forEach((w) => (w.textContent = off ? "SAVED COPY" : on ? "LIVE" : "CHECKING"));
  const ticker = on
    ? '<span>Refreshed <b class="tk" data-tick="refreshed">…</b></span><span>checked <b class="tk" data-ago="check">…</b></span>'
    : !off ? "<span>Connecting to the registry…</span>"
      : SITE.preview ? `<span>Preview · saved copy from ${saved}</span>`
        : `<span>Saved ${saved} · retrying in <b class="tk" data-tick="retry">…</b></span>`;
  $$('[data-console="home"] .con-ticker, [data-console="updates"] .con-ticker').forEach((t) => {
    // The ring counts down to the next check; the preview never checks, so it has none.
    t.innerHTML = ticker + (t.closest('[data-console="home"]') && !SITE.preview && L.online !== null ? RING : "");
  });
  paintFollowConsole();
  $$("[data-cadence]").forEach((el) => (el.innerHTML = off
    ? (SITE.preview
      ? `This preview can’t reach ClinicalTrials.gov, so it shows the copy saved on ${fmtDate(SNAPSHOT_DATE)}. The published site checks the registry every 60 seconds.`
      : `TrialSignal can’t reach ClinicalTrials.gov right now, so this panel shows the saved copy from ${fmtDate(SNAPSHOT_DATE)}. It tries again every 60 seconds.`)
    : on ? 'ClinicalTrials.gov publishes once a day, Monday to Friday; the next refresh is expected <span data-tick="next">…</span>. TrialSignal checks it every 60 seconds while this page is open.'
      : "ClinicalTrials.gov publishes once a day, Monday to Friday. TrialSignal checks it every 60 seconds while this page is open."));
  // Until the first check answers, nothing claims to be live.
  $$("[data-live-eyebrow]").forEach((el) => (el.innerHTML = off ? `Counts from the saved copy, ${saved}` : on ? '<span class="ldot"></span> Live counts' : "Registry counts"));
  $$("[data-stage-soft]").forEach((el) => (el.textContent = off ? `Here is where they were on ${saved}.` : on ? "Here is where they are right now." : "Checking the registry…"));
  $$("[data-foot-src]").forEach((el) => (el.textContent = off ? `saved copy, ${fmtDate(SNAPSHOT_DATE)}` : on ? "checked live" : "checking…"));
  start.paintHero();
  trials.renderSearchLive();
  trials.renderFollowing();
  updates.repaintUpdatesAreas();
  updates.paintLede();
  updates.paintNewsNote();
  tick();
}

// Following is live once the statuses of the followed trials have been fetched.
function paintFollowConsole() {
  const c = $('[data-console="follow"]');
  const off = L.online === false;
  const live = L.online === true && isCurrent(D.libStamp);
  c.dataset.state = off ? "offline" : live ? "live" : "loading";
  $("[data-badge-word]", c).textContent = off ? "SAVED COPY" : live ? "LIVE" : "CHECKING";
  $(".con-ticker", c).innerHTML = off ? `<span>Saved copy from ${shortDate(SNAPSHOT_DATE)}</span>` : live ? '<span>checked <b class="tk" data-ago="check">…</b></span>' : "<span>checking…</span>";
}

// ── reacting to the registry ─────────────────────────────────────────
let refreshing = false;
onLive(async (type, detail) => {
  if (type === "online") { paintChrome(); trials.refreshSearch(); }
  if (type === "offline") {
    useSaved();
    updates.resetArea();
    hideNewPill("home");
    hideNewPill("updates");
    paintChrome();
    start.paintConsole({ grow: false, stream: false });
    start.renderPicks();
    trials.renderLibrary();
    trials.renderFollowing();
    trials.refreshSearch();
    if (view === "updates") updates.renderUpdates();
    if (view === "trial") trial.renderTrial(trialId, { quiet: true });
  }
  if (type === "refresh") {
    refreshing = true;
    // Nothing saved or from an older refresh may show as live. On the first load (or when
    // the connection is back) everything is fetched again; after a daily refresh only the
    // feeds on screen are kept, so rows that really arrived can be marked NEW.
    // The Updates feed is kept only when it is on screen; otherwise it reloads when opened.
    if (detail.first) clearLive({ first: true });
    else if (detail.changed) clearLive({ keep: [feedKey("home", start.homeMetric()), ...(view === "updates" ? [updates.currentKey()] : [])] });
    if (view === "trial") trial.refreshTrial(trialId);
    start.paintHero();
    if (detail.first) {
      // Saved numbers make way for placeholders until the live ones arrive.
      $$("[data-count]").forEach((el) => { delete el.dataset.v; el.style.minWidth = ""; el.innerHTML = '<span class="skel"></span>'; });
      renderBars("home", start.homeMetric());
      renderFeedSkeleton("home");
    }
    const all = refreshAll(start.homeMetric());
    const jobs = [start.refreshHome(all)];
    if (view === "trials") jobs.push(loadTotal().catch(swallow));
    if (view === "updates") jobs.push(updates.refreshUpdates());
    await Promise.allSettled(jobs);
    start.paintHero();
    refreshing = false;
  }
  if (type === "check" && L.online === true && !refreshing) {
    // Retry whatever failed to load on an earlier check.
    if (!isCurrent(D.countsStamp)) loadCounts().catch(swallow);
    if (!isCurrent(D.libStamp)) loadStatuses().catch(swallow);
    if (view === "trials" && !isCurrent(D.totalStamp)) loadTotal().catch(swallow);
    start.retryHome();
    if (view === "updates") updates.retryUpdates();
    if (view === "trial") trial.retryTrial();
  }
});

onData((what) => {
  if (what === "counts") { start.paintCounts(); updates.paintTabCounts(); }
  if (what === "lib") {
    start.renderPicks();
    start.renderLibStrip();
    trials.renderLibrary();
    trials.renderFollowing();
    paintFollowConsole();
    tick();
  }
  if (what === "total") $$('[data-count="total"]').forEach((el) => countTo(el, D.counts.total));
});
document.addEventListener("ts:follow", () => trials.renderFollowing());

// ── theme ────────────────────────────────────────────────────────────
function initTheme() {
  const root = document.documentElement;
  const saved = store.get("ts.theme", null);
  if (saved) root.dataset.theme = saved;
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  const btn = $("#themeBtn");
  btn.setAttribute("aria-pressed", isDark());
  btn.onclick = () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    store.set("ts.theme", root.dataset.theme);
    btn.setAttribute("aria-pressed", isDark());
  };
}

// ── static text from data ────────────────────────────────────────────
function fillStatic() {
  $$("[data-fill]").forEach((el) => {
    el.textContent = {
      snapshot: fmtDate(SNAPSHOT_DATE),
      reviewed: fmtDate(LIBRARY_REVIEWED),
      news: fmtDate(NEWS_REVIEWED),
      count: String(LIBRARY.length),
    }[el.dataset.fill] ?? "";
  });
  $("#glList").innerHTML = [...GLOSSARY, ...EXTRA_TERMS]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, a, d]) => `<div><dt>${esc(t)}${a ? ` <span class="mono">${esc(a)}</span>` : ""}</dt><dd>${esc(d)}</dd></div>`).join("");
  const links = [
    SITE.github && `<a href="${esc(SITE.github)}" target="_blank" rel="noopener">Source on GitHub</a>`,
    SITE.linkedin && `<a href="${esc(SITE.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`,
  ].filter(Boolean).join(" · ");
  $$("[data-author]").forEach((el) => (el.innerHTML = `Built by <b>${esc(SITE.author)}</b>${links ? ` · ${links}` : ""}`));
}

// ── start-up ─────────────────────────────────────────────────────────
hideTip = initTips();
initTheme();
initNotes();
fillStatic();
start.bindStart();
trials.bindTrials(go);
updates.bindUpdates();

// The skip link moves focus without adding a history entry.
$(".skip").addEventListener("click", (e) => { e.preventDefault(); $("#main").focus(); });

// In sideways-scrolling rows (phones), bring the focused chip or card fully into view.
document.addEventListener("focusin", (e) => {
  const row = e.target.closest?.(".picks, [data-suggest], [data-areas], .con-filters");
  if (row && row.scrollWidth > row.clientWidth) e.target.scrollIntoView({ block: "nearest", inline: row.matches(".picks") ? "start" : "nearest" });
});

// The Start search sends trial numbers to the trial page and anything else to Trials.
$("#searchForm1").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#q1").value.trim();
  if (!v) { $("#q1").focus(); return; }
  const id = parseNCT(v);
  if (id) go(id);
  else go("trials", { q: v });
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-check-now], #livePill")) return;
  // The preview never contacts the registry, so the pill explains that instead.
  if (SITE.preview) toast(`This preview shows the saved copy from ${shortDate(SNAPSHOT_DATE)} and doesn’t contact ClinicalTrials.gov.`);
  else check("manual");
});
// Once rows and bars have landed, drop their animation classes so they are plain content.
document.addEventListener("animationend", (e) => {
  const li = e.target.closest?.(".feed li");
  if (li && (e.animationName === "rowin" || e.animationName === "rownew")) li.classList.remove("in", "is-new");
  const bar = e.target.closest?.(".bar");
  if (bar && e.animationName === "grow") bar.classList.remove("grow");
  // The scan line and logo trace play once per check, never again on a page switch.
  if (e.animationName === "sweep") e.target.classList.remove("sweep");
  if (e.animationName === "trace") e.target.closest?.("#brandMark")?.classList.remove("beat");
});

renderFeedSkeleton("home");
renderBars("home", start.homeMetric());
paintChrome();
window.addEventListener("hashchange", route);
route();
startLive();
