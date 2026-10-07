// Entry point: routing, the live chrome (header pill, panel badges, tickers), theme and start-up.

import { $, $$, esc, fmtDate, shortDate, store } from "./util.js";
import { SITE } from "./config.js";
import { L, onLive, start as startLive, check, tick, countTo } from "./live.js";
import { D, onData, useSaved, refreshAll, loadTotal, SNAPSHOT_DATE, swallow } from "./data.js";
import { initTips } from "./ui.js";
import { initNotes } from "./notes.js";
import { LIBRARY, LIBRARY_REVIEWED, lib } from "../data/library.js";
import { NEWS_REVIEWED } from "../data/news.js";
import { GLOSSARY, EXTRA_TERMS } from "../data/glossary.js";
import * as start from "./views/start.js";
import * as trials from "./views/trials.js";
import * as trial from "./views/trial.js";
import * as updates from "./views/updates.js";
import { renderFeedSkeleton, renderBars } from "./console.js";

const VIEWS = ["start", "trials", "updates", "about"];
let view = "";
let trialId = null;
let pending = {};
let hideTip = () => {};

// ── routing: bare hash tokens (#trials, #NCT04184622) work on any static host ──
function route() {
  let h = decodeURIComponent(location.hash.slice(1)) || "start";
  if (h === "story") {
    history.replaceState(null, "", "#about");
    h = "about";
    const s = $("#story");
    if (s) { s.open = true; setTimeout(() => s.scrollIntoView(), 50); }
  }
  if (h === "trial") h = "NCT04184622";
  let v = VIEWS.includes(h) ? h : "start";
  let id = null;
  if (/^NCT\d{8}$/i.test(h)) { v = "trial"; id = h.toUpperCase(); }
  const same = v === view && id === trialId;
  view = v;
  trialId = id;
  $$(".view").forEach((s) => s.classList.toggle("on", s.dataset.view === v));
  const navKey = v === "trial" ? "trials" : v;
  $$("[data-nav]").forEach((a) => (a.dataset.nav === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  hideTip();
  if (!same && h !== "about") window.scrollTo(0, 0);
  if (v === "start") start.renderStart();
  if (v === "trials") trials.renderTrials(pending);
  if (v === "updates") updates.renderUpdates();
  if (v === "trial") trial.renderTrial(id);
  pending = {};
  document.title = v === "trial" ? `${(lib(id) && lib(id).short) || id} · ${SITE.name}` : v === "start" ? SITE.name : `${v[0].toUpperCase()}${v.slice(1)} · ${SITE.name}`;
  tick();
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
  document.body.dataset.online = String(L.online);
  const pill = $("#livePill");
  pill.dataset.state = on ? "live" : off ? "offline" : "loading";
  $(".lp-word", pill).textContent = off ? (SITE.preview ? "Preview" : "Offline") : "Live";
  $(".lp-long", pill).textContent = off ? "" : "checked ";
  $('[data-ago="pill"]', pill).textContent = off ? `saved ${shortDate(SNAPSHOT_DATE)}` : "…";
  pill.title = off ? (SITE.preview ? "Preview: showing the saved copy" : "Try ClinicalTrials.gov again now") : "Check ClinicalTrials.gov now";
  $$(".console:not(.rec-con)").forEach((c) => (c.dataset.state = on ? "live" : off ? "offline" : "loading"));
  $$(".console:not(.rec-con) [data-badge-word]").forEach((w) => (w.textContent = off ? "SAVED COPY" : "LIVE"));
  const tickerLive = '<span>Refreshed <b class="tk" data-tick="refreshed">…</b></span><span>checked <b class="tk" data-ago="check">…</b></span>';
  const tickerOff = SITE.preview
    ? `<span>Preview · saved copy from ${shortDate(SNAPSHOT_DATE)}</span>`
    : `<span>Saved copy from ${shortDate(SNAPSHOT_DATE)}</span><span>offline, retrying in <b class="tk" data-tick="retry">…</b></span>`;
  $$('[data-console="home"] .con-ticker, [data-console="updates"] .con-ticker').forEach((t) => {
    t.innerHTML = (off ? tickerOff : tickerLive) + (t.closest('[data-console="home"]') ? RING : "");
  });
  $('[data-console="follow"] .con-ticker').innerHTML = off ? `<span>Saved copy from ${shortDate(SNAPSHOT_DATE)}</span>` : '<span>checked <b class="tk" data-ago="check">…</b></span>';
  $$("[data-cadence]").forEach((el) => (el.innerHTML = off
    ? (SITE.preview
      ? `This preview can’t reach ClinicalTrials.gov, so it shows the copy saved on ${fmtDate(SNAPSHOT_DATE)}. The published site checks the registry every 60 seconds.`
      : `TrialSignal can’t reach ClinicalTrials.gov right now, so this panel shows the saved copy from ${fmtDate(SNAPSHOT_DATE)}. It tries again every 60 seconds.`)
    : 'ClinicalTrials.gov publishes once a day, Monday to Friday; the next refresh is expected <span data-tick="next">…</span>. TrialSignal checks it every 60 seconds while this page is open.'));
  start.paintHero();
  trials.renderSearchLive();
  updates.repaintUpdatesAreas();
  tick();
}

// ── reacting to the registry ─────────────────────────────────────────
onLive(async (type, detail) => {
  if (type === "online") paintChrome();
  if (type === "offline") {
    useSaved();
    paintChrome();
    start.paintConsole({ grow: false, stream: false });
    start.renderPicks();
    trials.renderLibrary();
    trials.renderFollowing();
    if (view === "updates") updates.renderUpdates();
    if (view === "trial") trial.renderTrial(trialId);
  }
  if (type === "refresh") {
    start.paintHero();
    await refreshAll(start.homeMetric());
    await start.refreshHome();
    start.paintHero();
    if (view === "trials") loadTotal().catch(swallow);
    if (view === "updates") updates.refreshUpdates();
    if (view === "trial" && !detail.first) trial.refreshTrial(trialId);
    else if (view === "trial") trial.renderTrial(trialId);
  }
});

onData((what) => {
  if (what === "lib") {
    start.renderPicks();
    start.renderLibStrip();
    trials.renderLibrary();
    trials.renderFollowing();
  }
  if (what === "total") $$('[data-count="total"]').forEach((el) => countTo(el, D.counts.total));
});
document.addEventListener("ts:follow", () => trials.renderFollowing());

// ── theme ────────────────────────────────────────────────────────────
function initTheme() {
  const root = document.documentElement;
  const saved = store.get("ts.theme", null);
  if (saved) root.dataset.theme = saved;
  $("#themeBtn").onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    store.set("ts.theme", root.dataset.theme);
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

// The Start search sends trial numbers to the trial page and anything else to Trials.
$("#searchForm1").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#q1").value.trim();
  if (!v) { $("#q1").focus(); return; }
  if (/^NCT\d{8}$/i.test(v)) go(v.toUpperCase());
  else go("trials", { q: v });
});
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-check-now], #livePill")) check("manual");
});
// Once rows and bars have landed, drop their animation classes so they are plain content.
document.addEventListener("animationend", (e) => {
  const li = e.target.closest?.(".feed li");
  if (li && (e.animationName === "rowin" || e.animationName === "rownew")) li.classList.remove("in", "is-new");
  const bar = e.target.closest?.(".bar");
  if (bar && e.animationName === "grow") bar.classList.remove("grow");
});

renderFeedSkeleton("home");
renderBars("home", start.homeMetric());
trials.renderFollowing();
window.addEventListener("hashchange", route);
route();
startLive();
