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
  if (!m) return esc(d);
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

// Today's date in the reader's own time zone, YYYY-MM-DD.
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Cut text at a word boundary and add an ellipsis.
export function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > n * 0.6 ? cut.slice(0, at) : s.slice(0, n)).replace(/[\s,.;:–—-]+$/, "")}…`;
}

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

// The toast stays in the page (role="status"); the text is set on the next frame so
// screen readers announce it, and it fades rather than being removed.
let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = "";
  requestAnimationFrame(() => {
    t.textContent = msg;
    t.classList.add("show");
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ── calendar helpers (YYYY-MM-DD strings, no time zones) ─────────────
const fromYmd = (s) => new Date(`${s}T00:00:00Z`);
export function addDays(ymd, n) {
  const d = fromYmd(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dayDiff = (a, b) => Math.round((fromYmd(a) - fromYmd(b)) / 864e5);
export const weekday = (ymd, long = false) =>
  (long ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])[fromYmd(ymd).getUTCDay()];
// "7 Oct" (no year).
export function shortDate(d) {
  const m = String(d || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return esc(d || "");
  return m[3] ? `${+m[3]} ${MON[+m[2] - 1]}` : `${MON[+m[2] - 1]} ${m[1]}`;
}
// "14 months ago", "yesterday", relative to a reference day.
export function sinceDay(ymd, ref) {
  if (!ymd || !ref) return "";
  const d = dayDiff(ref, ymd);
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 45) return `${d} days ago`;
  const m = Math.round(d / 30.4);
  return m < 24 ? `${m} months ago` : `${Math.round(m / 12)} years ago`;
}
export const ico = (id, cls = "ico") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
