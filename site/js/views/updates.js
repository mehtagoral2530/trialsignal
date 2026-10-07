// "What changed" (live registry changes + hand-picked headlines) and "Side by side".

import { $, $$, esc, fmtDate, ago, plural, doiUrl } from "../util.js";
import { trialRow, rowFromModel, statusPill, evidencePill, linkTerms, spinner, empty } from "../ui.js";
import { lib, AREAS, PRESETS } from "../../data/library.js";
import { NEWS, NEWS_TYPES, NEWS_REVIEWED } from "../../data/news.js";
import { SITE } from "../config.js";
import * as api from "../api.js";
import { known, SNAPSHOT_DATE } from "../state.js";

let mode = "feed";
let newsType = "All";
let newsAll = false;
const NEWS_FIRST = 6;
let preset = PRESETS[0].key;
let regArea = AREAS[0].key;
const reg = {}; // area key → { list, total, at, err, loading }

// Registry search term for each library area.
const AREA_QUERY = {
  metabolic: "obesity OR type 2 diabetes",
  heart: "heart failure OR chronic kidney disease",
  brain: "Alzheimer disease OR multiple sclerosis OR migraine",
  cancer: "breast cancer OR lung cancer OR melanoma",
  infection: "vaccine OR HIV prevention",
};

export function bindUpdates() {
  $("#modeChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (b) { mode = b.dataset.mode; renderUpdates(); }
  });
  $("#newsTypes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]");
    if (b) { newsType = b.dataset.type; renderNews(); }
  });
  $("#newsList").addEventListener("click", (e) => {
    if (e.target.closest("#moreNews")) { newsAll = true; renderNews(); }
  });
  $("#regAreas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-reg]");
    if (b) { regArea = b.dataset.reg; renderRegistry(); }
  });
  $("#presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) { preset = b.dataset.preset; renderSide(); }
  });
}

export function renderUpdates() {
  $$("#modeChips [data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  $("#uFeed").hidden = mode !== "feed";
  $("#uSide").hidden = mode !== "side";
  if (mode === "feed") { renderRegistry(); renderNews(); } else renderSide();
}

// ── live registry changes ────────────────────────────────────────────
function renderRegistry() {
  $("#regAreas").innerHTML = AREAS.map((a) => `<button class="chip" type="button" data-reg="${a.key}" aria-pressed="${a.key === regArea}">${esc(a.label)}</button>`).join("");
  const out = $("#regOut");
  const meta = $("#regMeta");
  if (SITE.preview || api.live.state === "offline") {
    meta.textContent = "";
    out.innerHTML = `<div class="banner"><p>${SITE.preview
      ? "This list loads live from ClinicalTrials.gov on the hosted site. The preview can’t reach the registry."
      : "Couldn’t reach ClinicalTrials.gov. This list will load when the connection is back."}</p>${SITE.preview ? "" : `<button class="btn quiet sm" type="button" id="regRetry">Try again</button>`}</div>`;
    const r = $("#regRetry");
    if (r) r.onclick = () => { delete reg[regArea]; api.live.state = "checking"; renderRegistry(); };
    return;
  }
  const st = reg[regArea] || (reg[regArea] = {});
  if (!st.list && !st.err && !st.loading) {
    st.loading = true;
    api.recentChanges({ cond: AREA_QUERY[regArea], days: 30, size: 8 })
      .then((r) => Object.assign(st, { list: r.studies, total: r.total, at: Date.now() }))
      .catch((e) => (st.err = e.message))
      .finally(() => { st.loading = false; if (mode === "feed") renderRegistry(); });
  }
  if (st.list) {
    meta.textContent = `${st.total != null ? `${plural(st.total, "trial")} changed in 30 days · ` : ""}fetched ${ago(st.at)}`;
    out.innerHTML = st.list.length
      ? `<div class="rows">${st.list.map((m) => trialRow(rowFromModel(m))).join("")}</div>
         <p class="xs faint">Phase 2 and 3 trials, newest change first. A change can be a new status, a date, enrollment or any other detail. Open a trial to read it.</p>`
      : empty("No phase 2 or 3 trials in this area changed in the last 30 days.");
  } else if (st.err) {
    meta.textContent = "";
    out.innerHTML = empty(esc(st.err));
  } else {
    meta.textContent = "";
    out.innerHTML = empty(`${spinner} Loading recent registry changes…`);
  }
}

// ── headlines ────────────────────────────────────────────────────────
function renderNews() {
  $("#newsMeta").textContent = `Hand-picked · last reviewed ${fmtDate(NEWS_REVIEWED)}`;
  $("#newsTypes").innerHTML = ["All", ...Object.keys(NEWS_TYPES)]
    .map((t) => `<button class="chip" type="button" data-type="${t}" aria-pressed="${newsType === t}">${t === "All" ? "All" : NEWS_TYPES[t].label}</button>`).join("");
  const all = NEWS.filter((n) => newsType === "All" || n.type === newsType);
  const rows = newsAll ? all : all.slice(0, NEWS_FIRST);
  const areaLabel = (k) => (AREAS.find((a) => a.key === k) || {}).label || "";
  $("#newsList").innerHTML = rows.map((n) => {
    const t = n.trial && lib(n.trial);
    const ty = NEWS_TYPES[n.type];
    return `<article class="ev">
      <time class="ev-date" datetime="${esc(n.date)}">${esc(fmtDate(n.date))}</time>
      <div class="ev-b">
        <div class="row"><span class="pill dot p-${ty.tone}">${ty.label}</span><span class="small faint">${esc(n.company)} · ${esc(areaLabel(n.area))}</span></div>
        <h3 class="ev-t">${esc(n.title)}</h3>
        <p class="muted">${esc(n.summary)}</p>
        <p class="small"><b>How firm is this?</b> <span class="muted">${esc(n.evidence)}</span></p>
        <div class="ev-links">${t ? `<a href="#${t.id}">Read ${esc(t.short)} step by step</a>` : ""}${n.links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join("")}</div>
      </div>
    </article>`;
  }).join("") + (rows.length < all.length ? `<button class="btn quiet more-news" type="button" id="moreNews">Show ${all.length - rows.length} older headlines</button>` : "");
}

// ── side by side ─────────────────────────────────────────────────────
function renderSide() {
  $("#presets").innerHTML = PRESETS.map((p) => `<button class="chip" type="button" data-preset="${p.key}" aria-pressed="${p.key === preset}">${esc(p.label)}</button>`).join("");
  const P = PRESETS.find((p) => p.key === preset);
  const ts = P.ids.map((id) => ({ L: lib(id), M: known(id).model }));
  const gapTxt = '<span class="gap">Not captured. Check the record.</span>';
  const v = (x) => (x ? esc(x) : gapTxt);
  const rows = [
    ["Condition", ({ L }) => v(L.condition)],
    ["Stage", ({ M }) => `${esc(M.phase)}<br>${statusPill(M.status)}`],
    ["Who took part", ({ L }) => v(L.plainPop)],
    ["Treatment", ({ L }) => v(L.intervention)],
    ["Compared with", ({ L }) => v(L.comparator)],
    ["Main measure", ({ M }) => (M.primaryOutcomes[0] ? `${esc(M.primaryOutcomes[0].measure)}${M.primaryOutcomes[0].timeFrame ? ` <span class="faint small">(${esc(M.primaryOutcomes[0].timeFrame)})</span>` : ""}${M.primaryOutcomes.length > 1 ? `<br><span class="faint small">+${M.primaryOutcomes.length - 1} more</span>` : ""}` : gapTxt)],
    ["What was found", ({ L }) => linkTerms(L.result, { max: 1 })],
    ["How firm", ({ L }) => evidencePill(L.evidence)],
    ["Safety", ({ L }) => v(L.safety)],
    ["Sources", ({ L }) => `<a href="#${L.id}">Read step by step</a><br>` + (L.pub
      ? `<a class="small" href="${doiUrl(L.pub.doi)}" target="_blank" rel="noopener">${esc(L.pub.journal)} ${L.pub.year} ↗</a>`
      : `<a class="small" href="${esc(L.topline.url)}" target="_blank" rel="noopener">Company report ↗</a>`)],
  ];
  $("#cmpTable").innerHTML = `<caption class="sr">${esc(P.label)}, compared side by side</caption>
    <thead><tr><th scope="col"><span class="sr">Detail</span></th>${ts.map(({ L }) => `<th scope="col">${esc(L.short)}<span class="th-sub">${esc(L.company)}</span></th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, f]) => `<tr><th scope="row">${label}</th>${ts.map((t) => `<td>${f(t)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("#chartOut").innerHTML = P.chart ? weightChart(ts.map((t) => t.L).filter((L) => L.chart)) : "";
  $("#sideNote").textContent = `Registry details as of ${known(P.ids[0]).source === "live" ? "today" : fmtDate(SNAPSHOT_DATE)}.`;
}

// Horizontal bars: treatment vs placebo, one scale from 0 to 35%.
function weightChart(list) {
  const MAX = 35;
  const pct = (x) => `${((x / MAX) * 100).toFixed(2)}%`;
  const ticks = [0, 5, 10, 15, 20, 25, 30, 35];
  return `<figure class="chart">
    <figcaption><h3>Average weight lost on the highest dose</h3><p class="small muted">Percent of starting body weight, as each trial reported it</p></figcaption>
    <div class="legend" aria-hidden="true"><span><i class="sw sw-1"></i>Treatment</span><span><i class="sw sw-2"></i>Placebo, where reported</span></div>
    <div class="bars">${list.map((L) => {
      const d = L.chart;
      return `<div class="bar">
        <div class="bar-l">${esc(L.short)}<small>${d.weeks} weeks${d.note ? ` · ${esc(d.note)}` : ""}</small></div>
        <div class="track">
          <div class="mark m-1" style="width:${pct(d.tx)}" tabindex="0" aria-label="${esc(L.short)}, ${esc(d.label)}: ${d.tx}% at ${d.weeks} weeks"><span class="tipbox">${esc(d.label)}: −${d.tx}% at ${d.weeks} weeks</span></div>
          <span class="val" style="left:calc(${pct(d.tx)} + 8px)">${d.tx}%</span>
          ${d.pbo != null
            ? `<div class="mark m-2" style="width:${pct(d.pbo)}" tabindex="0" aria-label="${esc(L.short)}, placebo: ${d.pbo}%"><span class="tipbox">Placebo: −${d.pbo}%</span></div><span class="val val-2" style="left:calc(${pct(d.pbo)} + 8px)">${d.pbo}%</span>`
            : `<span class="val val-2 val-note faint">placebo figure not in the announcement</span>`}
        </div>
      </div>`;
    }).join("")}</div>
    <div class="axis" aria-hidden="true">${ticks.map((x) => `<span style="left:${pct(x)}">${x}%</span>`).join("")}</div>
    <p class="small faint">The trials ran for different lengths (48 to 80 weeks) and enrolled different people, so the bars are not a ranking. TRIUMPH-1 is a company announcement.</p>
  </figure>`;
}
