// Notes drawer. Notes stay in this browser; they can be copied or downloaded as Markdown.

import { $, $$, esc, store, toast, localDay, clip } from "./util.js";
import { SITE } from "./config.js";

const KEY = "ts.notes.v1";
const SEED = {
  id: "seed", title: "Example note", updated: "2026-10-07",
  body: "This is an example. Edit or delete it.\n\n- TRIUMPH-1 results are a company announcement only. Watch for the full paper.\n- STEP 1 ran 68 weeks and SURMOUNT-1 ran 72 weeks, so check before comparing.",
};

let notes = store.get(KEY, null) || [SEED];
let open = null; // id of the note being edited
let lastFocus = null;

// The example note doesn't count as one of yours.
const mine = () => notes.filter((n) => n.id !== "seed").length;

const save = () => {
  store.set(KEY, notes);
  const c = $("#notesCount");
  const n = mine();
  if (c) c.textContent = n ? String(n) : "";
  $("#notesBtn")?.setAttribute("aria-label", n ? `Your notes, ${n}` : "Your notes");
};

const isEmpty = (n) => !String(n.title || "").trim() && !String(n.body || "").trim();
// A note opened and left blank is not kept.
function dropEmpty() {
  const before = notes.length;
  notes = notes.filter((n) => !isEmpty(n));
  if (notes.length !== before) save();
}

const asMarkdown = () =>
  "# TrialSignal notes\n\nVerify all data against the official IRB-approved protocol and investigator brochure before clinical application.\n\n" +
  notes.map((n) => `## ${n.title || "Untitled"}\nUpdated ${n.updated}\n\n${n.body}`).join("\n\n---\n\n");

// Everything behind the drawer is made inert, so focus stays inside it.
const behind = () => $$("header.top, main#main, footer.site, nav.tabbar, a.skip");

export function initNotes() {
  save();
  $("#notesBtn").onclick = () => { open = null; openDrawer(); };
  $("#drawerClose").onclick = closeDrawer;
  $("#scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
}

function openDrawer() {
  if ($("#drawer").hidden) lastFocus = document.activeElement;
  $("#drawer").hidden = false;
  $("#scrim").hidden = false;
  document.documentElement.classList.add("locked");
  behind().forEach((el) => (el.inert = true));
  render();
  if (!open) $("#drawerClose").focus();
}

function closeDrawer() {
  dropEmpty();
  $("#drawer").hidden = true;
  $("#scrim").hidden = true;
  document.documentElement.classList.remove("locked");
  behind().forEach((el) => (el.inert = false));
  open = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

export function addNote(title, body) {
  const n = { id: `n${Date.now()}`, title, body, updated: localDay() };
  notes.unshift(n);
  save();
  open = n.id;
  openDrawer();
  const t = $("#nBody");
  if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  toast("Note saved. Add your observations.");
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
      <div class="notes-list">${notes.length
        ? notes.map((x) => `<button class="nitem" type="button" data-nid="${esc(x.id)}"><b>${esc(x.title || "Untitled")}</b><span>${esc(x.updated)} · ${esc(clip(x.body, 70))}</span></button>`).join("")
        : '<div class="empty">No notes yet. Use “Save a note” on any trial.</div>'}</div>`;
    $("#nNew").onclick = () => {
      const x = { id: `n${Date.now()}`, title: "", body: "", updated: localDay() };
      notes.unshift(x);
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
    $$("[data-nid]").forEach((b) => (b.onclick = () => { open = b.dataset.nid; render(); $("#nBack")?.focus(); }));
    return;
  }
  B.innerHTML = `<button class="linkbtn small" type="button" id="nBack">← All notes</button>
    <label class="sr" for="nTitle">Note title</label><input type="text" id="nTitle" value="${esc(n.title)}" placeholder="Title">
    <label class="sr" for="nBody">Note text</label><textarea id="nBody" placeholder="Write your observations…">${esc(n.body)}</textarea>
    <div class="row between"><span class="xs faint">Saved automatically</span><span class="row" id="nDelWrap"><button class="btn btn-sm" type="button" id="nDel">Delete</button></span></div>`;
  const update = () => { n.title = $("#nTitle").value; n.body = $("#nBody").value; n.updated = localDay(); save(); };
  $("#nTitle").oninput = update;
  $("#nBody").oninput = update;
  $("#nBack").onclick = () => {
    const id = n.id;
    dropEmpty();
    open = null;
    render();
    ($(`[data-nid="${CSS.escape(id)}"]`) || $("#nNew")).focus();
  };
  $("#nDel").onclick = () => {
    $("#nDelWrap").innerHTML = `<span class="small">Delete this note?</span><button class="btn btn-sm btn-danger" type="button" id="nYes">Delete</button><button class="btn btn-sm" type="button" id="nNo">Keep</button>`;
    $("#nNo").focus();
    $("#nYes").onclick = () => { notes = notes.filter((x) => x.id !== n.id); save(); open = null; render(); $("#nNew").focus(); toast("Note deleted"); };
    $("#nNo").onclick = () => { render(); $("#nDel").focus(); };
  };
}
