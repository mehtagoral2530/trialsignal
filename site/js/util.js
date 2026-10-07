// Small helpers shared by every view. Nothing here touches the DOM at import time,
// so the pure functions can be tested in Node.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2019-12-04" → "4 Dec 2019", "2019-12" → "Dec 2019", "2025-Q4" → "Q4 2025".
export function fmtDate(d) {
  if (!d) return "";
  d = String(d);
  const q = d.match(/^(\d{4})-Q(\d)$/);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return d;
  return (m[3] ? `${+m[3]} ` : "") + `${MON[+m[2] - 1]} ${m[1]}`;
}

// Pulls the first NCT number out of free text or a ClinicalTrials.gov link.
export function parseNCT(s) {
  const m = String(s || "").toUpperCase().match(/NCT\d{8}/);
  return m ? m[0] : null;
}

export const ctUrl = (id) => `https://clinicaltrials.gov/study/${id}`;
export const doiUrl = (doi) => `https://doi.org/${doi}`;
export const pubmedUrl = (q) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`;

export function ago(ms, now = Date.now()) {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export const num = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("en-US"));
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

// localStorage can be missing or throw (private windows, blocked storage).
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: the page keeps working for this visit */
    }
  },
};

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
