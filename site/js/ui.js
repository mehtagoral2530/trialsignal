// Glossary hints: a dotted underline on a term opens a short plain definition.

import { $, esc } from "./util.js";
import { TERMS, AUTO_TERMS } from "../data/glossary.js";

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
  const tip = $("#gtip");
  const show = (el) => {
    const t = TERMS[el.dataset.term];
    if (!t) return;
    tip.innerHTML = `<b>${esc(t.term)}</b>${esc(t.def)}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, innerWidth - 32);
    tip.style.maxWidth = `${w}px`;
    tip.style.left = `${Math.max(16, Math.min(r.left + scrollX, scrollX + innerWidth - w - 16))}px`;
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
