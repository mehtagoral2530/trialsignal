import { $, esc, num, parseNCT } from "../util.js";
import { statusPill } from "../ui.js";
import { lib, PICKS } from "../../data/library.js";
import { known } from "../state.js";
import * as api from "../api.js";

let count = null;

export function renderStart() {
  $("#picks").innerHTML = PICKS.map(([id, topic]) => {
    const t = lib(id);
    const m = known(id).model;
    return `<a class="pick" href="#${id}">
      <span class="eyebrow">${esc(topic)}</span>
      <h3>${esc(t.short)}</h3>
      <p class="q">${esc(t.question)}</p>
      <span class="row">${statusPill(m && m.status)}${m && m.phase ? `<span class="pill">${esc(m.phase)}</span>` : ""}</span>
      <span class="go">Read it step by step <span aria-hidden="true">→</span></span>
    </a>`;
  }).join("");
  renderCount();
  if (count === null) {
    count = "loading";
    api.recruitingCount().then((n) => { count = n; renderCount(); }).catch(() => { count = "off"; renderCount(); });
  }
}

function renderCount() {
  const el = $("#liveCount");
  if (typeof count === "number") {
    el.innerHTML = `<span class="live-dot" aria-hidden="true"></span><span><b class="num">${num(count)}</b> treatment trials are recruiting on ClinicalTrials.gov right now.</span>`;
    el.hidden = false;
  } else el.hidden = true;
}

export function bindStart(go) {
  $("#startForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("#startInput").value.trim();
    const help = $("#startHelp");
    if (!raw) {
      help.textContent = "Type a trial number, a condition or a medicine first.";
      help.classList.add("err");
      return;
    }
    help.classList.remove("err");
    const id = parseNCT(raw);
    if (id) go(id);
    else go("trials", { q: raw });
  });
}
