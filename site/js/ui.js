// Shared pieces of markup and the glossary hint popover.

import { $, esc, fmtDate } from "./util.js";
import { statusLabel, statusTone } from "./normalize.js";
import { TERMS, AUTO_TERMS } from "../data/glossary.js";

// ── glossary hints ───────────────────────────────────────────────────
export function term(text, key) {
  const k = String(key || text).toLowerCase();
  return TERMS[k] ? `<button type="button" class="term" data-term="${esc(k)}">${esc(text)}</button>` : esc(text);
}

const AUTO = AUTO_TERMS.map((t) => ({ key: t.toLowerCase(), re: new RegExp(`(^|[^\\w-])(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w-])`, "i") }))
  .sort((a, b) => b.key.length - a.key.length);

// Escapes text and underlines the first mention of a few glossary terms.
export function linkTerms(text, { max = 3, used = new Set() } = {}) {
  const s = String(text || "");
  const hits = [];
  for (const { key, re } of AUTO) {
    if (hits.length >= max || used.has(key)) continue;
    const m = re.exec(s);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    hits.push({ start, end, key });
    used.add(key);
  }
  hits.sort((a, b) => a.start - b.start);
  let out = "";
  let i = 0;
  for (const h of hits) {
    out += esc(s.slice(i, h.start)) + term(s.slice(h.start, h.end), h.key);
    i = h.end;
  }
  return out + esc(s.slice(i));
}

export function initTips() {
  const tip = $("#tip");
  const show = (el) => {
    const t = TERMS[el.dataset.term];
    if (!t) return;
    tip.innerHTML = `<b>${esc(t.term)}</b>${esc(t.def)}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, innerWidth - 32);
    tip.style.maxWidth = `${w}px`;
    const x = Math.max(16, Math.min(r.left + scrollX, scrollX + innerWidth - w - 16));
    tip.style.left = `${x}px`;
    tip.style.top = `${r.bottom + scrollY + 8}px`;
  };
  const hide = () => (tip.hidden = true);
  document.addEventListener("mouseover", (e) => { const t = e.target.closest(".term"); if (t) show(t); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest(".term")) hide(); });
  document.addEventListener("focusin", (e) => { const t = e.target.closest(".term"); if (t) show(t); });
  document.addEventListener("focusout", (e) => { if (e.target.closest(".term")) hide(); });
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".term");
    if (!t) return hide();
    e.preventDefault();
    if (tip.hidden) show(t); else hide();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  return hide;
}

// ── pills ────────────────────────────────────────────────────────────
export function statusPill(code) {
  if (!code) return "";
  const tone = statusTone(code);
  return `<span class="pill dot${tone ? ` p-${tone}` : ""}">${esc(statusLabel(code))}</span>`;
}

const EVIDENCE = {
  published: ["p-brand", "Peer-reviewed paper"],
  topline: ["p-sun", "Company announcement only"],
  registry: ["", "Registry record only"],
};
export const evidenceLabel = (k) => (EVIDENCE[k] || EVIDENCE.registry)[1];
export function evidencePill(k) {
  const [c, l] = EVIDENCE[k] || EVIDENCE.registry;
  return `<span class="pill ${c}">${l}</span>`;
}

// ── trial rows ───────────────────────────────────────────────────────
// s: { id, short, title, status, phase, sponsor, lastUpdate }
export function trialRow(s, extra = "") {
  const name = s.short
    ? `${esc(s.short)} <small>${esc(s.title)}</small>`
    : esc(s.title || "Untitled study");
  return `<a class="trow" href="#${s.id}">
    <span class="trow-main">
      <span class="trow-t">${name}</span>
      <span class="trow-meta"><span class="nct">${s.id}</span>${statusPill(s.status)}${s.phase ? `<span>${esc(s.phase)}</span>` : ""}${s.sponsor ? `<span class="trow-sp">${esc(s.sponsor)}</span>` : ""}${s.lastUpdate ? `<span>Updated ${esc(fmtDate(s.lastUpdate))}</span>` : ""}</span>
      ${extra}
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </a>`;
}

export const rowFromModel = (m, short = "") => ({
  id: m.id,
  short: short || m.acronym,
  title: m.title,
  status: m.status,
  phase: m.phase,
  sponsor: m.sponsor,
  lastUpdate: m.dates && m.dates.lastUpdate,
});

export const spinner = '<span class="spinner" aria-hidden="true"></span>';
export const empty = (html) => `<div class="empty">${html}</div>`;
