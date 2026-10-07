// Notes drawer. Notes stay in this browser; they can be copied or downloaded as Markdown.

import { $, $$, esc, store, toast } from "./util.js";
import { SITE } from "./config.js";

const KEY = "ts.notes.v1";
const today = () => new Date().toISOString().slice(0, 10);
const SEED = {
  id: "seed", title: "Example note", updated: "2026-10-07",
  body: "This is an example. Edit or delete it.\n\n- TRIUMPH-1 results are a company announcement only. Watch for the full paper.\n- STEP 1 ran 68 weeks and SURMOUNT-1 ran 72 weeks, so check before comparing.",
};

let notes = store.get(KEY, null) || [SEED];
let open = null; // id of the note being edited
let lastFocus = null;

const save = () => {
  store.set(KEY, notes);
  const c = $("#notesCount");
  if (c) c.textContent = notes.length ? String(notes.length) : "";
};

const asMarkdown = () =>
  "# TrialSignal notes\n\nVerify all data against the official IRB-approved protocol and investigator brochure before clinical application.\n\n" +
  notes.map((n) => `## ${n.title || "Untitled"}\nUpdated ${n.updated}\n\n${n.body}`).join("\n\n---\n\n");

export function initNotes() {
  save();
  $("#notesBtn").onclick = openDrawer;
  $("#drawerClose").onclick = closeDrawer;
  $("#scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
}

function openDrawer() {
  lastFocus = document.activeElement;
  $("#drawer").hidden = false;
  $("#scrim").hidden = false;
  document.body.classList.add("locked");
  render();
  $("#drawerClose").focus();
}

function closeDrawer() {
  $("#drawer").hidden = true;
  $("#scrim").hidden = true;
  document.body.classList.remove("locked");
  if (lastFocus) lastFocus.focus();
}

export function addNote(title, body) {
  const n = { id: `n${Date.now()}`, title, body, updated: today() };
  notes.unshift(n);
  save();
  open = n.id;
  openDrawer();
  toast("Added to notes");
}

function render() {
  const B = $("#drawerBody");
  const n = notes.find((x) => x.id === open);
  if (!n) {
    B.innerHTML = `<div class="row">
        <button class="btn btn-primary btn-sm" type="button" id="nNew">New note</button>
        <button class="btn btn-sm" type="button" id="nCopy">Copy all</button>
        ${SITE.preview ? "" : `<button class="btn btn-sm" type="button" id="nDown">Download .md</button>`}
      </div>
      <p class="xs faint">Saved in this browser only.</p>
      <div class="nlist">${notes.length
        ? notes.map((x) => `<button class="nitem" type="button" data-nid="${x.id}"><b>${esc(x.title || "Untitled")}</b><span>${esc(x.updated)} · ${esc((x.body || "").slice(0, 70))}</span></button>`).join("")
        : '<div class="empty">No notes yet. Use “Add to notes” on any trial.</div>'}</div>`;
    $("#nNew").onclick = () => {
      const x = { id: `n${Date.now()}`, title: "", body: "", updated: today() };
      notes.unshift(x);
      save();
      open = x.id;
      render();
      $("#nTitle").focus();
    };
    $("#nCopy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(asMarkdown());
        toast("Copied all notes");
      } catch {
        toast("Copying was blocked. Open a note and copy its text instead.");
      }
    };
    const d = $("#nDown");
    if (d) d.onclick = () => {
      const url = URL.createObjectURL(new Blob([asMarkdown()], { type: "text/markdown" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "trialsignal-notes.md" });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $$("[data-nid]").forEach((b) => (b.onclick = () => { open = b.dataset.nid; render(); }));
    return;
  }
  B.innerHTML = `<button class="linkbtn small" type="button" id="nBack">← All notes</button>
    <label class="sr" for="nTitle">Note title</label><input type="text" id="nTitle" value="${esc(n.title)}" placeholder="Title">
    <label class="sr" for="nBody">Note text</label><textarea id="nBody" placeholder="Write your observations…">${esc(n.body)}</textarea>
    <div class="row between"><span class="xs faint">Saved automatically</span><span class="row" id="nDelWrap"><button class="btn btn-sm" type="button" id="nDel">Delete</button></span></div>`;
  const update = () => { n.title = $("#nTitle").value; n.body = $("#nBody").value; n.updated = today(); save(); };
  $("#nTitle").oninput = update;
  $("#nBody").oninput = update;
  $("#nBack").onclick = () => { open = null; render(); };
  $("#nDel").onclick = () => {
    $("#nDelWrap").innerHTML = `<span class="small">Delete this note?</span><button class="btn btn-sm btn-danger" type="button" id="nYes">Delete</button><button class="btn btn-sm" type="button" id="nNo">Keep</button>`;
    $("#nYes").onclick = () => { notes = notes.filter((x) => x.id !== n.id); save(); open = null; render(); };
    $("#nNo").onclick = render;
  };
}
