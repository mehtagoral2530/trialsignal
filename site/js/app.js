// Entry point: routing, header status, theme and start-up.

import { $, $$, esc, fmtDate, store } from "./util.js";
import { SITE } from "./config.js";
import * as api from "./api.js";
import { initTips } from "./ui.js";
import { initNotes } from "./notes.js";
import { events, follow, startTracking, SNAPSHOT_DATE } from "./state.js";
import { LIBRARY, LIBRARY_REVIEWED } from "../data/library.js";
import { NEWS_REVIEWED } from "../data/news.js";
import { GLOSSARY, EXTRA_TERMS } from "../data/glossary.js";
import { renderStart, bindStart } from "./views/start.js";
import { renderTrials, bindTrials, renderFollow, renderBanner } from "./views/trials.js";
import { renderTrial } from "./views/trial.js";
import { renderUpdates, bindUpdates } from "./views/updates.js";

const VIEWS = ["start", "trials", "updates", "about", "story"];
const NAV_OF = { trial: "trials", story: "about" };
let view = "start";
let pending = {};
let hideTip = () => {};

// Routes are bare hash tokens (#trials, #NCT04184622) so links work on any static host.
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  let v = VIEWS.includes(h) ? h : "start";
  let id = null;
  if (/^NCT\d{8}$/i.test(h)) { v = "trial"; id = h.toUpperCase(); }
  const changed = v !== view || v === "trial";
  view = v;
  $$(".view").forEach((s) => (s.hidden = s.dataset.view !== v));
  const nav = NAV_OF[v] || v;
  $$(".nav a").forEach((a) => (a.getAttribute("href") === `#${nav}` ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  hideTip();
  if (v === "start") renderStart();
  if (v === "trials") renderTrials(pending);
  if (v === "trial") renderTrial(id);
  if (v === "updates") renderUpdates();
  pending = {};
  document.title = v === "trial" ? `${id} · ${SITE.name}` : v === "start" ? SITE.name : `${$(`[data-view="${v}"] h1`).textContent} · ${SITE.name}`;
  if (changed) window.scrollTo(0, 0);
}

function go(target, params = {}) {
  pending = params;
  if (location.hash === `#${target}`) route();
  else location.hash = target;
}

// ── header ───────────────────────────────────────────────────────────
function renderLive() {
  const b = $("#liveBadge");
  const s = api.live.state;
  b.dataset.state = s;
  $("#liveText").textContent = s === "live" ? "Live" : s === "checking" ? "Connecting" : "Saved copy";
  b.title = s === "live"
    ? "Connected to ClinicalTrials.gov"
    : SITE.preview
      ? `Preview: showing the copy saved ${fmtDate(SNAPSHOT_DATE)}`
      : `Can’t reach ClinicalTrials.gov. Showing the copy saved ${fmtDate(SNAPSHOT_DATE)}.`;
}

function renderNavBadge() {
  const n = follow.changedCount();
  const el = $("#navBadge");
  el.hidden = !n;
  el.textContent = n;
  el.title = n ? `${n} followed ${n === 1 ? "trial has" : "trials have"} changed` : "";
}

// ── theme ────────────────────────────────────────────────────────────
function initTheme() {
  const root = document.documentElement;
  const saved = store.get("ts.theme", null);
  if (saved) root.dataset.theme = saved;
  const btn = $("#themeBtn");
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const label = () => btn.setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme");
  label();
  btn.onclick = () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    store.set("ts.theme", next);
    label();
  };
}

// ── static text filled from data ─────────────────────────────────────
function fillStatic() {
  $$("[data-fill]").forEach((el) => {
    const k = el.dataset.fill;
    el.textContent = {
      snapshot: fmtDate(SNAPSHOT_DATE),
      reviewed: fmtDate(LIBRARY_REVIEWED),
      news: fmtDate(NEWS_REVIEWED),
      count: String(LIBRARY.length),
      refresh: String(SITE.refreshMinutes),
    }[k] ?? "";
  });
  $("#glList").innerHTML = [...GLOSSARY, ...EXTRA_TERMS]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, a, d]) => `<div><dt>${esc(t)}${a ? ` <span class="mono faint">${esc(a)}</span>` : ""}</dt><dd>${esc(d)}</dd></div>`).join("");
  const links = [
    SITE.github && `<a href="${esc(SITE.github)}" target="_blank" rel="noopener">Source on GitHub ↗</a>`,
    SITE.linkedin && `<a href="${esc(SITE.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>`,
  ].filter(Boolean).join(" · ");
  $$("[data-author]").forEach((el) => (el.innerHTML = `Built by <b>${esc(SITE.author)}</b>${links ? ` · ${links}` : ""}`));
}

// ── start-up ─────────────────────────────────────────────────────────
hideTip = initTips();
initTheme();
initNotes();
fillStatic();
bindStart(go);
bindTrials(go);
bindUpdates();
api.onLiveChange(() => {
  renderLive();
  if (view === "trials") renderBanner();
});
events.addEventListener("follow", () => {
  renderNavBadge();
  if (view === "trials") renderFollow();
});
window.addEventListener("hashchange", route);
renderLive();
renderNavBadge();
route();
startTracking();
