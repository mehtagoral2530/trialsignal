// Glossary hints: a dotted underline on a term opens a short plain definition.

import { $, esc } from "./util.js";
import { TERMS, AUTO_TERMS } from "../data/glossary.js";

export function term(text, key) {
  const k = String(key || text).toLowerCase();
  return TERMS[k] ? `<button type="button" class="term" data-term="${esc(k)}" aria-expanded="false">${esc(text)}</button>` : esc(text);
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
  let openFor = null;
  let openedAt = 0;
  let hideTimer = 0;
  const show = (el) => {
    const t = TERMS[el.dataset.term];
    if (!t) return;
    clearTimeout(hideTimer);
    if (openFor && openFor !== el) release(openFor);
    tip.innerHTML = `<b>${esc(t.term)}</b>${esc(t.def)}`;
    tip.hidden = false;
    if (openFor !== el) openedAt = Date.now();
    openFor = el;
    el.setAttribute("aria-describedby", "gtip");
    el.setAttribute("aria-expanded", "true");
    const r = el.getBoundingClientRect();
    const w = Math.min(300, innerWidth - 32);
    tip.style.maxWidth = `${w}px`;
    tip.style.left = `${Math.max(16, Math.min(r.left + scrollX, scrollX + innerWidth - w - 16))}px`;
    // Above the term when there isn't room below it.
    const h = tip.offsetHeight;
    const below = r.bottom + 8 + h <= innerHeight || r.top - 8 - h < 0;
    tip.style.top = `${(below ? r.bottom + 8 : r.top - 8 - h) + scrollY}px`;
  };
  const release = (el) => { el.removeAttribute("aria-describedby"); el.setAttribute("aria-expanded", "false"); };
  const hide = () => {
    clearTimeout(hideTimer);
    tip.hidden = true;
    if (openFor) release(openFor);
    openFor = null;
  };
  const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 150); };
  // Hover is for a mouse only: touch browsers send their own pointer-out events after a
  // tap, which would close the hint the tap just opened.
  const mouse = (e) => e.pointerType === "mouse" || e.pointerType === "pen";
  document.addEventListener("pointerover", (e) => { const t = mouse(e) && e.target.closest?.(".term"); if (t) show(t); });
  document.addEventListener("pointerout", (e) => { if (mouse(e) && e.target.closest?.(".term")) hideSoon(); });
  tip.addEventListener("pointerenter", (e) => { if (mouse(e)) clearTimeout(hideTimer); });
  tip.addEventListener("pointerleave", (e) => { if (mouse(e)) hideSoon(); });
  document.addEventListener("focusin", (e) => { const t = e.target.closest?.(".term"); if (t) show(t); });
  document.addEventListener("focusout", (e) => { if (e.target.closest?.(".term")) hideSoon(); });
  // A tap or click opens the hint (if hover or focus just opened it, it stays open); a
  // second tap or a click elsewhere closes it.
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".term");
    if (!t) { if (!e.target.closest("#gtip")) hide(); return; }
    e.preventDefault();
    if (openFor === t && !tip.hidden && Date.now() - openedAt > 400) hide();
    else show(t);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  return hide;
}
