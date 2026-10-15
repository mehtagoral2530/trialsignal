// Unit tests for the browser-direct live-update client (app/core.js + app/live.js).
// The real files are evaluated in a node:vm context with stubbed browser globals (fetch, localStorage, timers, DOM),
// so what is tested is exactly what ships. The fake registry is the shared one from test/helpers/fixtures.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { study, fakeRegistry } from "./helpers/fixtures.mjs";

const src = (f) => readFileSync(new URL("../app/" + f, import.meta.url), "utf8");
const SOURCES = ["data.js", "core.js", "live.js"].map(src);
const plain = (x) => JSON.parse(JSON.stringify(x));
const T1 = "2026-10-09T09:00:05";
const nct = (i) => "NCT" + String(i).padStart(8, "0");
const HOUR = 3600 * 1000, MIN = 60 * 1000;

/**
 * Evaluate the shipped scripts with a fake browser. `views` mimics the few globals views.js provides.
 * signals: "native" (default, Node's AbortSignal.timeout), "stub" (AbortSignal.timeout whose firing the test controls, see
 * `aborts`), "legacy" (a browser without AbortSignal.timeout: the fallback runs on the fake setTimeout) or "none" (no abort API).
 * boot: leave LIVE as the page starts (otherwise it is forced to http / direct / on).
 */
function load({ studies = [], dataTimestamp = T1, saved = {}, store = {}, signals = "native", boot = false, apiBase = "" } = {}) {
  const reg = fakeRegistry(studies, { dataTimestamp });
  const fetchLog = [], timers = [], intervals = [], toasts = [], renders = { saved: 0, trial: 0 }, aborts = [], listeners = {};
  const quota = { failNext: 0, always: false };
  const ls = new Map(Object.entries(store).map(([k, v]) => [k, JSON.stringify(v)]));
  if (Object.keys(saved).length) ls.set("ts_saved", JSON.stringify(saved));
  const localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => {
      if (quota.always || quota.failNext > 0) { quota.failNext--; throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); }
      ls.set(k, String(v));
    },
    removeItem: (k) => ls.delete(k),
  };
  /* a bare-bones DOM: enough for the code that only reads and writes a few elements; `page` (below) fakes the study page */
  const el = { textContent: "", innerHTML: "", hidden: true, style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] };
  const toastEl = { ...el, set textContent(v) { toasts.push(v); }, get textContent() { return toasts.at(-1) || ""; } };
  const page = { out: null, input: null, log: null, details: [], scrolled: [] };
  const document = {
    hidden: false, activeElement: null, addEventListener: (n, f) => (listeners["doc:" + n] ||= []).push(f),
    querySelector: (s) => (s === "#toast" ? toastEl : s === "#trialOut" ? page.out : s === "#askInput" ? page.input : s === "#askLog" ? page.log : el), querySelectorAll: () => [],
  };
  const env = { snapshot: { generatedAt: "2026-10-10T00:00:00Z", studies: {} }, snapshotDown: false, down: false, hang: null, stallBody: null, status: null, versionStatus: null, versionHeaders: {} };
  const stall = (signal) => new Promise((_, rej) => { if (!signal) return; if (signal.aborted) return rej(signal.reason); signal.addEventListener("abort", () => rej(signal.reason)); });   // never answers; only the request's signal ends it
  const fetch = async (url, init = {}) => {
    const u = new URL(url, "https://site.test/trialsignal/");
    fetchLog.push({ u, init });
    if (u.pathname.endsWith("/data/snapshot.json")) return env.snapshotDown ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(env.snapshot), { status: 200 });
    if (env.down) throw new TypeError("Failed to fetch");
    if (env.versionStatus && u.pathname.endsWith("/version")) return new Response("{}", { status: env.versionStatus, headers: env.versionHeaders });
    if (env.status && u.pathname.endsWith("/studies") && u.searchParams.has("filter.ids")) return new Response("{}", { status: env.status });   // the batched request only
    if (env.hang && env.hang(u)) return stall(init.signal);
    if (env.stallBody && env.stallBody(u)) { const r = await reg.fetchImpl(u.href, init); return { ok: r.ok, status: r.status, headers: r.headers, json: () => stall(init.signal) }; }   // headers arrive, the body stalls
    return reg.fetchImpl(u.href, init);
  };
  const win = { TS_CONFIG: { API_BASE: apiBase }, addEventListener: (n, f) => (listeners["win:" + n] ||= []).push(f), scrollY: 0, scrollTo: (x, y) => { win.scrollY = y; page.scrolled.push(y); } };
  win.parent = win;
  const abortApi = signals === "native" ? { AbortSignal, AbortController }
    : signals === "stub" ? { AbortController, AbortSignal: { timeout: (ms) => { const c = new AbortController(); aborts.push({ ms, fired: false, fire: () => c.abort(new DOMException("The operation timed out.", "TimeoutError")) }); return c.signal; } } }
    : signals === "legacy" ? { AbortController, AbortSignal: {} } : {};
  const ctx = vm.createContext({
    window: win, document, localStorage, fetch, ...abortApi, URLSearchParams, URL, Response, console, location: { hostname: "site.test", hash: "" },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false, fired: false }; timers.push(t); return t; }, clearTimeout: (t) => { if (t) t.cleared = true; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
  });
  ctx.__now = Date.parse("2026-10-12T12:00:00Z");
  vm.runInContext("Date.now = () => globalThis.__now; Math.random = () => globalThis.__rand ?? 0.5;", ctx);
  const views = `let curView = "trials", curTrial = null; const detailState = {};
    function renderSaved(){ globalThis.__renders.saved++; } function renderTrial(){ globalThis.__renders.trial++; globalThis.__renderTrial && globalThis.__renderTrial(); }
    function renderHome(){} function renderRegLive(){} function renderLiveNote(){} function renderBadge(){}`;
  ctx.__renders = renders;
  /* a fake study page that renderTrial() "re-creates" (new elements, nothing open, nothing typed) like the real one does */
  const buildPage = () => {
    const details = ["Who took part?", "What did people get?", "Was it safe?"].map((t) => ({ open: false, summary: { textContent: t }, querySelector(q) { return q === "summary" ? this.summary : null; } }));
    const input = { value: "", selectionStart: 0, selectionEnd: 0, focus() { document.activeElement = this; }, setSelectionRange(a, z) { this.selectionStart = a; this.selectionEnd = z; } };
    const log = { childNodes: [], append(...n) { this.childNodes.push(...n); } };
    Object.assign(page, { details, input, log });
  };
  page.out = { querySelectorAll: (q) => (q === "details" ? page.details : []), querySelector: () => null };   // #trialOut itself stays; its content is replaced
  buildPage(); ctx.__renderTrial = buildPage;
  vm.runInContext(SOURCES.join("\n") + "\n" + views, ctx);
  const NAMES = ["LIVE", "REG", "WATCH", "detailState", "callLive", "probeHttp", "refreshWatch", "refreshSaved", "regCheck", "regKick", "regDelay", "regDirect", "regSchedule", "regListen", "regReprobe", "regProbeLater", "regInvalidate", "renderTrialInPlace", "startLive", "boot", "liveErr", "timeoutSignal", "cachePut", "cacheGet", "cacheRead", "fetchRegistryVersion", "loadSnapshotFallback"];
  const g = vm.runInContext("({ " + NAMES.map((n) => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ") + ", setCurView: (v) => { curView = v; }, setCurTrial: (v) => { curTrial = v; } })", ctx);   // names a version of the app does not have are simply undefined
  if (!boot) { g.LIVE.mode = "http"; g.LIVE.base = "direct"; g.LIVE.state = "on"; }
  const pending = () => timers.filter((x) => !x.cleared && !x.fired);
  const fire = (x) => { x.fired = true; return x.fn(); };
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return {
    g, ctx, reg, env, fetchLog, timers, intervals, toasts, renders, quota, ls, aborts, listeners, page, pending, fire, settle,
    now: (t) => { if (t !== undefined) ctx.__now = t; return ctx.__now; },
    advance: (ms) => (ctx.__now += ms),
    rand: (r) => { ctx.__rand = r; },
    emit: (n) => (listeners[n] || []).forEach((f) => f({})),
    setHidden: (h) => { document.hidden = h; },
    /** run the page's own start-up (boot): its three 100 ms waits for window.claude are fired by hand */
    boot: async () => { const p = g.boot(); for (let i = 0; i < 4; i++) { await settle(); pending().filter((x) => x.ms === 100).forEach(fire); } await p; await settle(); },
    batched: () => fetchLog.filter((c) => c.u.pathname.endsWith("/studies") && c.u.searchParams.has("filter.ids")),
    versions: () => fetchLog.filter((c) => c.u.pathname.endsWith("/version")),
    details: (id) => fetchLog.filter((c) => c.u.pathname.endsWith("/studies/" + id)),
    stored: (k) => JSON.parse(ls.get(k) ?? "null"),
  };
}
const fill = (n, o = {}) => Array.from({ length: n }, (_, i) => study({ id: nct(i + 1), status: "RECRUITING", lup: "2026-09-01", ...o }));
const savedIds = (ids) => Object.fromEntries(ids.map((id) => [id, { added: 1 }]));

/* ---------------- the version request ---------------- */

test("version request: no-cache revalidation, no manual If-None-Match, accept header only (no CORS preflight)", async () => {
  const t = load({ studies: fill(1) });
  assert.equal(await t.g.fetchRegistryVersion(), T1);
  const { u, init } = t.versions()[0];
  assert.equal(u.href, "https://clinicaltrials.gov/api/v2/version");
  assert.equal(init.cache, "no-cache");
  assert.deepEqual(plain(init.headers), { accept: "application/json" });
  assert.ok(init.signal, "bounded by a timeout");
});

test("probeHttp uses /version, records the dataTimestamp and sets base=direct; unreachable -> base=null", async () => {
  const t = load({ studies: fill(1) });
  t.g.LIVE.base = undefined;
  assert.equal(await t.g.probeHttp(), true);
  assert.equal(t.g.LIVE.base, "direct");
  assert.equal(t.g.REG.ts, T1);
  assert.deepEqual(t.fetchLog.map((c) => c.u.pathname), ["/api/v2/version"], "the probe is one /version request, no studies request");

  const d = load({ studies: fill(1) }); d.env.down = true;
  assert.equal(await d.g.probeHttp(), false);
  assert.equal(d.g.LIVE.base, null);

  const bad = load({ studies: fill(1), dataTimestamp: null }); // registry answers 404 for /version
  assert.equal(await bad.g.probeHttp(), false);
});

/* ---------------- saved studies: batched refresh ---------------- */

test("refresh sends one request per 100 ids with the field list, and never toasts on first fill", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => nct(i + 1));
  const t = load({ studies: fill(250), saved: savedIds(ids) });
  await t.g.refreshSaved();
  const reqs = t.batched();
  assert.equal(reqs.length, 3, "250 ids = 3 requests");
  assert.deepEqual(reqs.map((c) => c.u.searchParams.get("filter.ids").split(",").length), [100, 100, 50]);
  const q = reqs[0].u.searchParams;
  assert.equal(q.get("pageSize"), "100"); assert.equal(q.get("format"), "json");
  assert.equal(q.get("fields"), "NCTId,BriefTitle,Acronym,OverallStatus,LastUpdatePostDate,PrimaryCompletionDate,EnrollmentCount");
  assert.equal(t.g.WATCH[ids[0]].latest.status, "RECRUITING");
  assert.equal(t.g.WATCH[ids[249]].latest.lastUpdate, "2026-09-01");
  assert.deepEqual(t.toasts, [], "first fill (no previous latest) is not an update");
  assert.equal(t.stored("ts_saved")[ids[7]].latest.status, "RECRUITING", "persisted");
  assert.ok(t.renders.saved >= 1);
});

test("refresh computes the same WATCH shape as the per-study path", async () => {
  const s = study({ id: nct(1), title: "Title", acronym: "ACR", status: "COMPLETED", lup: "2026-10-05", pcd: "2027-06", enroll: 321 });
  const t = load({ studies: [s], saved: savedIds([nct(1)]) });
  await t.g.refreshSaved();
  assert.deepEqual(plain(t.g.WATCH[nct(1)].latest), { status: "COMPLETED", lastUpdate: "2026-10-05", title: "Title", pc: "2027-06", enr: "321", short: "ACR" });
  assert.deepEqual(plain(t.g.WATCH[nct(1)].seen), plain(t.g.WATCH[nct(1)].latest));
});

test("toast only when tracked fields really changed (status, lastUpdate, primary completion, enrollment)", async () => {
  const ids = [nct(1), nct(2), nct(3), nct(4)];
  const t = load({ studies: fill(4), saved: savedIds(ids) });
  await t.g.refreshSaved(); assert.deepEqual(t.toasts, []);

  await t.g.refreshSaved(); assert.deepEqual(t.toasts, [], "same data again: nothing");

  t.reg.mutate(nct(1), { status: "COMPLETED" });
  await t.g.refreshSaved();
  assert.deepEqual(t.toasts, ["A saved study has an update"]);
  assert.equal(t.g.WATCH[nct(1)].latest.status, "COMPLETED");
  assert.equal(t.g.WATCH[nct(1)].seen.status, "RECRUITING", "seen stays, so the drawer can say what changed");

  t.toasts.length = 0;
  t.reg.mutate(nct(2), { lup: "2026-10-01" }); t.reg.mutate(nct(3), { enroll: 999 });
  await t.g.refreshSaved();
  assert.deepEqual(t.toasts, ["2 saved studies have updates"], "lastUpdate-driven and enrollment changes count as updates");
});

test("ids missing from the response keep their previous state and get an error note; the rest still update", async () => {
  const t = load({ studies: fill(2), saved: savedIds([nct(1), nct(2), nct(99)]) });
  await t.g.refreshSaved();
  assert.equal(t.g.WATCH[nct(99)].latest, undefined);
  assert.match(t.g.WATCH[nct(99)].err, /no record/i);
  const before = plain(t.g.WATCH[nct(1)].latest);

  t.reg.db.delete(nct(1)); // the registry stops returning NCT1
  t.reg.mutate(nct(2), { status: "COMPLETED" });
  await t.g.refreshSaved();
  assert.deepEqual(plain(t.g.WATCH[nct(1)].latest), before, "previous state kept");
  assert.ok(t.g.WATCH[nct(1)].err);
  assert.equal(t.g.WATCH[nct(2)].latest.status, "COMPLETED");
  assert.equal(t.g.WATCH[nct(2)].err, undefined);
  assert.deepEqual(t.toasts, ["A saved study has an update"]);
});

test("HTTP 400 on the field list is retried without it; a 5xx marks studies with an error and throws", async () => {
  const t = load({ studies: fill(2), saved: savedIds([nct(1)]) });
  let first = true; const inner = t.reg.fetchImpl;
  t.reg.fetchImpl = async (url, init) => { const u = new URL(url); if (u.searchParams.has("fields") && first) { first = false; return new Response("{}", { status: 400 }); } return inner(url, init); };
  await t.g.refreshSaved();
  assert.deepEqual(t.batched().map((c) => c.u.searchParams.has("fields")), [true, false]);
  assert.equal(t.g.WATCH[nct(1)].latest.status, "RECRUITING");

  const before = plain(t.g.WATCH[nct(1)].latest);
  inner.fail = 503;
  await assert.rejects(() => t.g.refreshSaved(), /503/);
  assert.deepEqual(plain(t.g.WATCH[nct(1)].latest), before);
  assert.match(t.g.WATCH[nct(1)].err, /didn.t answer/);
});

test("ids that are not NCT numbers never reach the request", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1), "NCT1,evil=1", "x"]) });
  await t.g.refreshSaved();
  assert.equal(t.batched().length, 1);
  assert.equal(t.batched()[0].u.searchParams.get("filter.ids"), nct(1));
});

test("nothing saved: no request at all", async () => {
  const t = load({ studies: fill(1) });
  await t.g.refreshSaved();
  assert.equal(t.fetchLog.length, 0);
});

/* ---------------- the poller ---------------- */

test("poller: unchanged dataTimestamp = /version only; a new one = invalidate caches, one batched refresh, remember it; the open study is refetched quietly", async () => {
  const ids = [nct(1), nct(2)];
  const t = load({ studies: fill(2), saved: savedIds(ids), store: { ts_registry: T1 } });
  t.g.WATCH[nct(1)].latest = { status: "RECRUITING", lastUpdate: "2026-09-01", title: "", pc: "2027-06", enr: "100", short: "" };
  t.g.WATCH[nct(2)].latest = { ...plain(t.g.WATCH[nct(1)].latest) };
  await t.g.regCheck();
  assert.equal(t.versions().length, 1); assert.equal(t.batched().length, 0, "same dataTimestamp: no studies request");

  // state that must be dropped on a registry update: the cache, and the live record of every study that is NOT open
  const rec = (status) => ({ status, lastUpdate: "2026-09-01", primaryCompletion: "2027-06", enrollment: "100" });
  t.g.LIVE.cache["h:details:x"] = { payload: 1, at: t.now() };
  t.g.detailState[nct(1)] = { live: rec("RECRUITING"), at: 1 };   // the study the reader has open
  t.g.detailState[nct(2)] = { live: rec("RECRUITING") };          // one they left earlier
  t.g.setCurView("trial"); t.g.setCurTrial(nct(1));
  t.reg.mutate(nct(1), { status: "COMPLETED" }); t.reg.bump();
  const ts2 = t.reg.dataTimestamp;
  await t.g.regCheck(); await t.settle();
  assert.equal(t.batched().length, 1, "exactly one batched request");
  assert.ok(!("h:details:x" in t.g.LIVE.cache), "memory cache dropped");
  assert.deepEqual(Object.keys(t.g.detailState), [nct(1)], "only the open study keeps its record; the others are dropped");
  assert.equal(t.details(nct(1)).length, 1, "the open study is refetched (once, quietly)");
  assert.equal(t.g.detailState[nct(1)].live.status, "COMPLETED", "...and swapped in because it moved");
  assert.equal(t.g.detailState[nct(1)].loading, undefined, "never put back into the loading state");
  assert.equal(t.renders.trial, 1, "open study page re-rendered once");
  assert.deepEqual(t.toasts, ["A saved study has an update"]);
  assert.equal(t.stored("ts_registry"), ts2);
  assert.equal(t.g.WATCH[nct(1)].latest.status, "COMPLETED");

  t.g.setCurView("trials"); t.reg.bump(); t.renders.trial = 0;
  await t.g.regCheck(); await t.settle();
  assert.equal(t.renders.trial, 0, "no study page open: no re-render");
  assert.deepEqual(Object.keys(t.g.detailState), [], "...and nothing is kept");
});

test("poller: first ever check (no stored timestamp) refreshes saved studies without toasting", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]) });
  await t.g.regCheck();
  assert.equal(t.batched().length, 1);
  assert.deepEqual(t.toasts, []);
  assert.equal(t.stored("ts_registry"), T1);
});

test("poller: the timestamp is only remembered once the refresh succeeded, so a failed refresh is retried", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]), store: { ts_registry: T1 } });
  t.g.WATCH[nct(1)].latest = { status: "RECRUITING", lastUpdate: "2026-09-01", title: "", pc: "2027-06", enr: "100", short: "" };
  t.reg.bump(); const ts2 = t.reg.dataTimestamp;
  const inner = t.reg.fetchImpl;
  t.reg.fetchImpl = async (url, init) => (new URL(url).searchParams.has("filter.ids") ? new Response("{}", { status: 500 }) : inner(url, init));
  await t.g.regCheck();
  assert.equal(t.stored("ts_registry"), T1, "not advanced");
  assert.equal(t.g.REG.fails, 1);
  t.reg.fetchImpl = inner;
  await t.g.regCheck();
  assert.equal(t.stored("ts_registry"), ts2);
  assert.equal(t.g.REG.fails, 0);
  assert.equal(t.batched().length, 2);
});

test("poller: a saved study that never got live data is filled on the next check even if the timestamp is unchanged", async () => {
  const t = load({ studies: fill(2), saved: savedIds([nct(1), nct(2)]), store: { ts_registry: T1 } });
  t.g.WATCH[nct(1)].latest = { status: "RECRUITING", lastUpdate: "2026-09-01", title: "", pc: "2027-06", enr: "100", short: "" };
  await t.g.regCheck();
  assert.equal(t.batched().length, 1);
  assert.equal(t.batched()[0].u.searchParams.get("filter.ids"), nct(2));
  await t.g.regCheck();
  assert.equal(t.batched().length, 1, "and only once");
});

test("failure handling: 3 failed checks in a row load the snapshot once; recovery refreshes saved studies and resumes", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]), store: { ts_registry: T1 } });
  t.g.WATCH[nct(1)].latest = { status: "RECRUITING", lastUpdate: "2026-09-01", title: "", pc: "2027-06", enr: "100", short: "" };
  const snaps = () => t.fetchLog.filter((c) => c.u.pathname.endsWith("/data/snapshot.json")).length;
  t.env.down = true;
  await t.g.regCheck(); await t.g.regCheck();
  assert.equal(snaps(), 0, "two failures: not yet");
  await t.g.regCheck();
  assert.equal(snaps(), 1, "third failure: snapshot loaded");
  await t.g.regCheck(); await t.g.regCheck();
  assert.equal(snaps(), 1, "...once");
  assert.equal(t.g.LIVE.state, "on", "state text untouched");

  t.env.down = false; t.batched().length = 0;
  const before = t.batched().length;
  await t.g.regCheck();
  assert.equal(t.batched().length, before + 1, "registry answered again: saved studies refreshed even though the timestamp is unchanged");
  assert.equal(t.g.REG.fails, 0); assert.equal(t.g.REG.fellBack, false);
  await t.g.regCheck();
  assert.equal(t.batched().length, before + 1, "then back to /version only");
  t.env.down = true; await t.g.regCheck(); await t.g.regCheck(); await t.g.regCheck();
  assert.equal(snaps(), 2, "a second outage may fall back again");
});

test("failure handling: no snapshot fallback unless live is on", async () => {
  const t = load({ studies: fill(1) });
  t.g.LIVE.state = "connecting"; t.env.down = true;
  for (let i = 0; i < 4; i++) await t.g.regCheck();
  assert.equal(t.fetchLog.filter((c) => c.u.pathname.endsWith("/snapshot.json")).length, 0);
});

test("snapshot fallback never overwrites fresher live data with an older snapshot", async () => {
  const t = load({ studies: fill(2), saved: savedIds([nct(1), nct(2)]) });
  const snapAt = Date.parse("2026-10-10T00:00:00Z");
  t.env.snapshot = { generatedAt: "2026-10-10T00:00:00Z", studies: { [nct(1)]: { status: "TERMINATED", lup: "2026-10-09" }, [nct(2)]: { status: "TERMINATED", lup: "2026-10-09" } } };
  const live = (at) => ({ latest: { status: "RECRUITING", lastUpdate: "2026-10-11", title: "", pc: "", enr: "", short: "" }, checked: at });
  Object.assign(t.g.WATCH[nct(1)], live(snapAt + HOUR));   // checked live after the snapshot was built
  Object.assign(t.g.WATCH[nct(2)], live(snapAt - HOUR));   // older than the snapshot
  await t.g.loadSnapshotFallback();
  assert.equal(t.g.WATCH[nct(1)].latest.status, "RECRUITING");
  assert.equal(t.g.WATCH[nct(2)].latest.status, "TERMINATED");
});

test("backoff: 5 min +-20% when healthy; exponential with full jitter, floor 15 s, cap 1 h when failing", () => {
  const t = load({ studies: fill(1) });
  for (const r of [0, 0.5, 0.999]) { t.rand(r); const d = t.g.regDelay(); assert.ok(d >= 4 * MIN - 1 && d <= 6 * MIN + 1, "healthy delay " + d); }
  t.rand(0); t.g.REG.fails = 1; assert.equal(t.g.regDelay(), 15000, "never below 15 s");
  t.rand(0.999); t.g.REG.fails = 1; assert.ok(t.g.regDelay() <= 60000);
  t.g.REG.fails = 3; assert.ok(t.g.regDelay() <= 240000 && t.g.regDelay() > 15000);
  t.g.REG.fails = 40; assert.ok(t.g.regDelay() <= HOUR && t.g.regDelay() > 0.9 * HOUR, "capped at 1 h");
  t.rand(0.2); t.g.REG.fails = 5; const a = t.g.regDelay(); t.rand(0.8); const b = t.g.regDelay(); assert.ok(b > a, "jittered");
});

test("scheduling: a timer after every check while visible; none while hidden; focus/online/visibility are throttled to once per 60 s", async () => {
  const t = load({ studies: fill(1) });
  t.g.REG.started = true;
  await t.g.regCheck();
  const live = () => t.timers.filter((x) => !x.cleared);
  assert.equal(live().length, 1); assert.ok(live()[0].ms >= 4 * MIN && live()[0].ms <= 6 * MIN);

  const n = t.versions().length;
  t.g.regKick(); await Promise.resolve();
  assert.equal(t.versions().length, n, "kick right after a check: throttled");
  t.advance(59 * 1000); t.g.regKick(); await Promise.resolve();
  assert.equal(t.versions().length, n, "59 s: still throttled");
  t.advance(2 * 1000); t.g.regKick(); await t.g.REG.busy;
  assert.equal(t.versions().length, n + 1, "61 s: checks");

  t.ctx.document.hidden = true;
  await t.g.regCheck(); // a check that finishes while hidden schedules nothing
  assert.equal(live().length, 0, "no timers while hidden");
  t.g.regKick(); assert.equal(t.versions().length, n + 2, "hidden: kick does nothing");
  t.ctx.document.hidden = false; t.advance(2 * MIN); t.g.regKick(); await t.g.REG.busy;
  assert.equal(t.versions().length, n + 3);
  assert.equal(live().length, 1);

  const d = load({ studies: fill(1) }); d.g.LIVE.base = "api"; d.g.REG.started = true; d.g.regKick();
  assert.equal(d.fetchLog.length, 0, "not in direct mode: the poller stays out of the way");
});

test("refreshWatch in direct mode: first call is the start-up check (no second /version request), later calls are an explicit batched refresh", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]) });
  t.g.REG.ts = T1; t.g.REG.last = t.now();     // what probeHttp leaves behind
  await t.g.refreshWatch(true);
  assert.equal(t.versions().length, 0); assert.equal(t.batched().length, 1); assert.ok(t.g.REG.started);
  t.reg.mutate(nct(1), { status: "COMPLETED" });                          // data changed but dataTimestamp did not move
  await t.g.refreshWatch(false);
  assert.equal(t.batched().length, 2); assert.equal(t.g.WATCH[nct(1)].latest.status, "COMPLETED");
  t.reg.fetchImpl.fail = 500;
  await t.g.refreshWatch(false);                                           // swallowed
  await assert.rejects(() => t.g.refreshWatch(true), /500/);
});

test("the 15-minute interval in core.js leaves direct mode to the poller and keeps serving other modes", () => {
  const t = load({ studies: fill(1) });
  assert.equal(t.intervals.length, 1); assert.equal(t.intervals[0].ms, 15 * MIN);
  vm.runInContext("refreshWatch = () => { globalThis.__calls++; }", Object.assign(t.ctx, { __calls: 0 }));
  t.intervals[0].fn(); assert.equal(t.ctx.__calls, 0, "direct mode: skipped");
  t.g.LIVE.mode = "mcp"; t.g.LIVE.base = undefined;
  t.intervals[0].fn(); assert.equal(t.ctx.__calls, 1, "mcp mode: still refreshes");
  t.g.LIVE.mode = "http"; t.g.LIVE.base = "api";
  t.intervals[0].fn(); assert.equal(t.ctx.__calls, 2, "api mode: still refreshes");
  t.ctx.document.hidden = true; t.intervals[0].fn(); assert.equal(t.ctx.__calls, 2, "hidden: skipped");
});

/* ---------------- the 24 h cache ---------------- */

test("callLive: memory first, then localStorage for 24 h while the dataTimestamp is unchanged; fresh bypasses reads but still writes", async () => {
  const t = load({ studies: fill(3) });
  t.g.REG.ts = T1;
  const calls = () => t.fetchLog.filter((c) => c.u.pathname.endsWith("/studies/" + nct(1))).length;
  const r1 = await t.g.callLive("details", nct(1));
  assert.equal(calls(), 1);
  assert.equal(await t.g.callLive("details", nct(1)).then((r) => r.payload === r1.payload), true, "memory layer");
  assert.equal(calls(), 1);
  assert.deepEqual(Object.keys(t.stored("ts_cache_v1")), [`h:details:"${nct(1)}"`]);
  assert.equal(t.stored("ts_cache_v1")[`h:details:"${nct(1)}"`].ts, T1);

  t.g.LIVE.cache = {}; t.advance(23 * HOUR);
  const r2 = await t.g.callLive("details", nct(1));
  assert.equal(calls(), 1, "a fresh page load within 24 h is served from localStorage");
  assert.equal(r2.at, r1.at, "...and reports when the record was actually fetched");
  assert.equal(plain(r2.payload).protocolSection.identificationModule.nctId, nct(1));

  t.g.LIVE.cache = {}; t.advance(2 * HOUR);
  await t.g.callLive("details", nct(1));
  assert.equal(calls(), 2, "older than 24 h: fetched again");
  assert.equal(t.stored("ts_cache_v1")[`h:details:"${nct(1)}"`].at, t.now(), "...and rewritten");

  t.g.LIVE.cache = {}; await t.g.callLive("details", nct(1), { fresh: true });
  assert.equal(calls(), 3, "fresh:true bypasses the cache");
  t.g.LIVE.cache = {}; await t.g.callLive("details", nct(1));
  assert.equal(calls(), 3, "...but its answer was written");

  t.g.LIVE.cache = {}; t.g.REG.ts = "2026-10-10T09:00:00";
  await t.g.callLive("details", nct(1));
  assert.equal(calls(), 4, "a different registry dataTimestamp: the entry no longer applies");
});

test("callLive caches search answers too, and caches nothing without a known dataTimestamp or outside direct mode", async () => {
  const t = load({ studies: fill(3) });
  t.g.REG.ts = T1;
  await t.g.callLive("search", "obesity"); t.g.LIVE.cache = {}; await t.g.callLive("search", "obesity");
  assert.equal(t.fetchLog.filter((c) => c.u.pathname.endsWith("/studies")).length, 1);

  const n = load({ studies: fill(1) }); // REG.ts unknown
  await n.g.callLive("details", nct(1)); assert.equal(n.ls.has("ts_cache_v1"), false);
  const a = load({ studies: fill(1) }); a.g.REG.ts = T1; a.g.LIVE.base = "proxy";
  a.reg.fetchImpl = async () => new Response(JSON.stringify(study({ id: nct(1) })), { status: 200 }); // /api/ct?path=...
  await a.g.callLive("details", nct(1)); assert.equal(a.ls.has("ts_cache_v1"), false);
});

test("an answer that was in flight when the registry changed is not cached", async () => {
  const t = load({ studies: fill(1) });
  t.g.REG.ts = T1;
  const inner = t.reg.fetchImpl;
  t.reg.fetchImpl = async (url, init) => { const r = await inner(url, init); t.g.REG.ts = "2026-10-10T09:00:00"; return r; };
  await t.g.callLive("details", nct(1));
  assert.equal(t.ls.has("ts_cache_v1"), false); assert.deepEqual(Object.keys(t.g.LIVE.cache), []);
});

test("cache is bounded: max 40 entries (oldest evicted), expired and old-version entries pruned, oversized payloads skipped", () => {
  const t = load();
  for (let i = 0; i < 45; i++) { t.advance(1000); t.g.cachePut("k" + i, T1, { payload: { i }, at: t.now() }); }
  const m = t.stored("ts_cache_v1");
  assert.equal(Object.keys(m).length, 40);
  assert.ok(!("k0" in m) && !("k4" in m) && "k5" in m && "k44" in m, "oldest evicted first");

  t.g.cachePut("newer-version", "2026-10-10T09:00:00", { payload: 1, at: t.now() });
  assert.deepEqual(Object.keys(t.stored("ts_cache_v1")), ["newer-version"], "entries from another registry version are pruned");
  t.g.cachePut("big", "2026-10-10T09:00:00", { payload: { s: "x".repeat(700000) }, at: t.now() });
  assert.ok(!("big" in t.stored("ts_cache_v1")), "oversized payload not stored");
  t.g.cachePut("big", "2026-10-10T09:00:00", { payload: { s: "x".repeat(700000) }, at: t.now() });
  assert.deepEqual(Object.keys(t.stored("ts_cache_v1")), ["newer-version"]);

  t.advance(25 * HOUR); t.g.cachePut("fresh", T1, { payload: 1, at: t.now() });
  assert.deepEqual(Object.keys(t.stored("ts_cache_v1")), ["fresh"], "everything older than 24 h is pruned on write");

  const b = load();
  for (let i = 0; i < 10; i++) { b.advance(1000); b.g.cachePut("b" + i, T1, { payload: { s: "y".repeat(400000) }, at: b.now() }); }
  const total = Object.values(b.stored("ts_cache_v1")).reduce((n, e) => n + e.n, 0);
  assert.ok(total <= 1500000 && Object.keys(b.stored("ts_cache_v1")).length >= 1, "total size budget keeps clear of the localStorage quota");
});

test("QuotaExceededError: evict and retry once, then give up silently", () => {
  const t = load();
  for (let i = 0; i < 10; i++) { t.advance(1000); t.g.cachePut("k" + i, T1, { payload: { i }, at: t.now() }); }
  t.quota.failNext = 1; t.advance(1000);
  assert.doesNotThrow(() => t.g.cachePut("new", T1, { payload: { n: 1 }, at: t.now() }));
  const m = t.stored("ts_cache_v1");
  assert.ok("new" in m && !("k0" in m) && Object.keys(m).length < 11, "oldest half evicted, retry succeeded");

  t.quota.always = true; t.advance(1000);
  assert.doesNotThrow(() => t.g.cachePut("never", T1, { payload: { n: 2 }, at: t.now() }));
  assert.equal(t.g.cacheGet("never", T1), null, "gave up");
  assert.equal(t.ls.has("ts_cache_v1"), false, "...and freed what it held");
});

test("blocked or corrupt localStorage never breaks a lookup", async () => {
  const t = load({ studies: fill(1) });
  t.g.REG.ts = T1;
  t.ls.set("ts_cache_v1", "{not json");
  assert.equal(t.g.cacheGet("k", T1), null);
  const r = await t.g.callLive("details", nct(1));
  assert.equal(plain(r.payload).protocolSection.identificationModule.nctId, nct(1));
  t.ctx.localStorage.getItem = () => { throw new Error("blocked"); }; t.ctx.localStorage.setItem = () => { throw new Error("blocked"); };
  t.g.LIVE.cache = {};
  assert.equal(plain((await t.g.callLive("details", nct(1))).payload).protocolSection.identificationModule.nctId, nct(1));
});

test("setLive: the news hook is guarded, so a throwing news draw can never break a search or a study lookup", () => {
  const t = load({});
  t.g.setCurView("news");
  vm.runInContext('globalThis.__newsCalls = 0; function newsOnLiveState(){ globalThis.__newsCalls++; throw new Error("boom"); }', t.ctx);
  assert.doesNotThrow(() => vm.runInContext('setLive("on", "")', t.ctx));
  assert.equal(t.ctx.__newsCalls, 1, "the hook ran, and its failure stayed inside it");
  assert.equal(t.g.LIVE.state, "on");
  t.g.setCurView("trials");
  vm.runInContext('setLive("on", "")', t.ctx);
  assert.equal(t.ctx.__newsCalls, 1, "the hook runs only while #news is open");
});

/* ---------------- other modes are untouched ---------------- */

test("MCP (claude.ai) mode: no poller, no localStorage cache, start-up still uses the snapshot, interval still refreshes", async () => {
  const t = load({ studies: fill(2), saved: savedIds([nct(1)]) });
  t.g.LIVE.mode = "mcp"; t.g.LIVE.base = undefined; t.g.LIVE.state = "connecting";
  await t.g.refreshWatch(true);
  assert.deepEqual(t.fetchLog.map((c) => c.u.pathname), ["/trialsignal/data/snapshot.json"], "same as before: the snapshot, nothing else");
  assert.equal(t.g.REG.started, false);
  assert.equal(t.timers.filter((x) => !x.cleared && x.ms >= 4 * MIN).length, 0, "no registry timer");

  t.g.LIVE.state = "on";
  let tool = 0;
  t.g.LIVE.mcp = { describeTool: async () => ({}), callTool: async () => { tool++; return { payload: study({ id: nct(1), status: "COMPLETED" }) }; } };
  await t.g.refreshWatch(false);
  assert.equal(tool, 1, "per-study connector call as before");
  assert.equal(t.g.WATCH[nct(1)].latest.status, "COMPLETED");
  assert.equal(t.ls.has("ts_cache_v1"), false, "nothing cached in localStorage");
  assert.equal(t.fetchLog.length, 1, "no registry requests from the page in MCP mode");
});

/* ================= review fixes: stalled requests, open study page, old browsers, retries, boot recovery, backoff ================= */

/** Count calls of the page's startLive() without changing what it does. */
const countStartLive = (t) => { vm.runInContext("globalThis.__sl = 0; { const o = startLive; startLive = function(){ globalThis.__sl++; return o.apply(this, arguments); }; }", t.ctx); return () => t.ctx.__sl; };
/** the poller's listeners (live.js also keeps one always-on visibilitychange listener for the API change feed: not counted) */
const listenerCounts = (t) => ({ visibility: (t.listeners["doc:visibilitychange"] || []).length - 1, focus: (t.listeners["win:focus"] || []).length, online: (t.listeners["win:online"] || []).length });
const liveRec = (status = "RECRUITING") => ({ status, lastUpdate: "2026-09-01", primaryCompletion: "2027-06", enrollment: "100" });

/* ---- F1 / F3: every request is bounded, and that works in browsers without AbortSignal.timeout ---- */

test("timeoutSignal: AbortSignal.timeout where the browser has it, a controller on a timer where it does not, nothing without an abort API", () => {
  const s = load({ signals: "stub" });
  assert.ok(s.g.timeoutSignal(1234)); assert.equal(s.aborts.at(-1).ms, 1234, "uses AbortSignal.timeout");

  const l = load({ signals: "legacy" });
  const sig = l.g.timeoutSignal(5000);
  assert.equal(sig.aborted, false);
  const timer = l.pending().find((x) => x.ms === 5000); assert.ok(timer, "fallback runs on a timer");
  l.fire(timer);
  assert.equal(sig.aborted, true); assert.equal(sig.reason.name, "AbortError");

  const n = load({ signals: "none" });
  assert.equal(n.g.timeoutSignal(5000), undefined); assert.equal(n.pending().length, 0);
});

test("timeouts surface with the existing wording for an unanswered request, only in direct mode", () => {
  const t = load();
  const timeout = new DOMException("The operation timed out.", "TimeoutError"), aborted = new DOMException("This operation was aborted", "AbortError");
  for (const e of [timeout, aborted]) { const r = t.g.liveErr(e); assert.equal(r.st, "error"); assert.match(r.msg, /didn.t answer just now/); }
  t.g.LIVE.mode = "mcp";
  assert.doesNotMatch(t.g.liveErr(timeout).msg, /didn.t answer just now/, "other modes keep their own handling");
});

test("version and batched requests are bounded: 8 s and 20 s (the retry without the field list gets its own)", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]), signals: "stub" });
  await t.g.fetchRegistryVersion();
  assert.deepEqual(t.aborts.map((a) => a.ms), [8000]); assert.ok(t.versions()[0].init.signal);
  t.aborts.length = 0;
  let first = true; const inner = t.reg.fetchImpl;
  t.reg.fetchImpl = async (url, init) => { if (new URL(url).searchParams.has("fields") && first) { first = false; return new Response("{}", { status: 400 }); } return inner(url, init); };
  await t.g.refreshSaved();
  assert.deepEqual(t.aborts.map((a) => a.ms), [20000, 20000]);
  assert.ok(t.batched().length === 2 && t.batched().every((c) => c.init.signal), "every batched attempt carries a signal");
});

/** Make the request timeout of `ms` expire, in either flavour of browser: AbortSignal.timeout (stub) or the AbortController fallback (legacy). */
const expire = (t, ms) => {
  const a = t.aborts.find((x) => x.ms === ms && !x.fired);
  if (a) { a.fired = true; return a.fire(); }
  const x = t.pending().find((y) => y.ms === ms); assert.ok(x, `a ${ms} ms timeout is armed behind the stalled request`);
  return t.fire(x);
};

for (const signals of ["stub", "legacy"]) {
  const how = signals === "stub" ? "AbortSignal.timeout" : "no AbortSignal.timeout";

  test(`a stalled batched request times out into the failure path: busy is cleared, a retry is scheduled, nothing is queued behind it (${how})`, async () => {
    const t = load({ studies: fill(2), saved: savedIds([nct(1), nct(2)]), store: { ts_registry: T1 }, signals });
    t.g.REG.started = true; t.g.REG.ts = T1;
    t.reg.bump(); const ts2 = t.reg.dataTimestamp;
    t.env.hang = (u) => u.searchParams.has("filter.ids");
    const p = t.g.regCheck(); await t.settle();
    assert.ok(t.g.REG.busy, "waiting on the stalled batch");
    assert.equal(t.batched().length, 1);
    t.advance(20000); expire(t, 20000); await p;
    assert.equal(t.g.REG.busy, null, "busy is always cleared");
    assert.equal(t.g.REG.fails, 1);
    const next = t.pending().filter((x) => x.ms >= 15000 && x.ms !== 20000);
    assert.equal(next.length, 1, "exactly one timer is waiting"); assert.ok(next[0].ms <= 60000, "scheduled with the failure backoff");
    assert.match(t.g.WATCH[nct(1)].err, /didn.t answer just now/); assert.equal(t.g.WATCH[nct(1)].errRetry, true, "a timeout is transient");
    assert.equal(t.stored("ts_registry"), T1, "not advanced, so it is retried");

    t.env.hang = null; t.advance(60000);
    await t.g.regCheck();   // not stuck behind the stalled request
    assert.equal(t.g.REG.fails, 0); assert.equal(t.stored("ts_registry"), ts2); assert.equal(t.g.WATCH[nct(1)].latest.status, "RECRUITING");
  });

  test(`the timeout covers reading the body, not only the response headers (${how})`, async () => {
    const t = load({ studies: fill(1), saved: savedIds([nct(1)]), signals });
    t.env.stallBody = (u) => u.searchParams.has("filter.ids");
    const p = t.g.refreshSaved().catch((e) => e); await t.settle();
    expire(t, 20000);
    const e = await p;
    assert.ok(["AbortError", "TimeoutError"].includes(e.name), "rejected with " + e.name); assert.match(t.g.WATCH[nct(1)].err, /didn.t answer just now/);
  });

  test(`a stalled /version request times out too (8 s), and start-up does not stay 'connecting' when the first batch stalls (${how})`, async () => {
    const v = load({ studies: fill(1), signals });
    v.env.hang = (u) => u.pathname.endsWith("/version");
    const vp = v.g.regCheck(); await v.settle();
    expire(v, 8000); await vp;
    assert.equal(v.g.REG.busy, null); assert.equal(v.g.REG.fails, 1); assert.equal(v.pending().filter((x) => x.ms >= 15000).length, 1);

    const t = load({ studies: fill(1), saved: savedIds([nct(1)]), signals, boot: true });
    Object.assign(t.g.LIVE, { mode: "http", base: "direct", state: "checking" }); t.g.REG.ts = T1;
    t.env.hang = (u) => u.searchParams.has("filter.ids");
    const p = t.g.startLive(); await t.settle();
    assert.equal(t.g.LIVE.state, "connecting", "while the batch is outstanding");
    expire(t, 20000); await p;
    assert.equal(t.g.LIVE.state, "on", "the stall ended in the failure path, so start-up finished");
    assert.equal(t.g.REG.fails, 1);
  });
}

test("browsers without AbortSignal.timeout still go live, and no unguarded AbortSignal.timeout is left in the app", async () => {
  const uses = SOURCES.join("\n").split("\n").filter((l) => /AbortSignal\.timeout\(/.test(l) && !/^\s*\/\*/.test(l));   // code lines, not comments
  assert.equal(uses.length, 1, "only the feature-detected call inside timeoutSignal");
  assert.match(src("core.js"), /typeof AbortSignal\.timeout === "function"\) return AbortSignal\.timeout\(ms\)/);
  assert.doesNotMatch(src("live.js"), /AbortSignal\.timeout/);

  for (const signals of ["legacy", "none"]) {
    const t = load({ studies: fill(1), saved: savedIds([nct(1)]), signals });
    t.g.LIVE.base = undefined;
    assert.equal(await t.g.probeHttp(), true, signals + ": the probe works");
    assert.equal(t.g.LIVE.base, "direct"); assert.equal(t.g.REG.ts, T1);
    await t.g.refreshSaved();
    assert.equal(t.g.WATCH[nct(1)].latest.status, "RECRUITING", signals + ": the batched refresh works");
  }
});

/* ---- F2: a registry update must not wipe the study page the reader is on ---- */

test("renderTrialInPlace keeps the reader's place: open sections, the typed question with focus and selection, the answers so far, the scroll", () => {
  const t = load({ studies: fill(1) });
  const { page, ctx } = t;
  page.details[1].open = true; page.input.value = "half-typed"; page.input.selectionStart = 2; page.input.selectionEnd = 6;
  ctx.document.activeElement = page.input; page.log.childNodes.push("answer-2", "answer-1"); ctx.window.scrollY = 700;
  const old = page.input;
  t.g.renderTrialInPlace();
  assert.notEqual(page.input, old, "the page really was rebuilt");
  assert.deepEqual(page.details.map((d) => d.open), [false, true, false]);
  assert.equal(page.input.value, "half-typed"); assert.equal(ctx.document.activeElement, page.input, "focus is back");
  assert.deepEqual([page.input.selectionStart, page.input.selectionEnd], [2, 6]);
  assert.deepEqual(page.log.childNodes, ["answer-2", "answer-1"]);
  assert.equal(ctx.window.scrollY, 700);

  // typed but not focused: the text comes back, focus is not stolen
  page.input.value = "later"; ctx.document.activeElement = null;
  t.g.renderTrialInPlace();
  assert.equal(page.input.value, "later"); assert.equal(ctx.document.activeElement, null);

  // nothing typed or asked: nothing is invented
  page.input.value = ""; page.log.childNodes.length = 0; page.details.forEach((d) => (d.open = false));
  t.g.renderTrialInPlace();
  assert.equal(page.input.value, ""); assert.deepEqual(page.log.childNodes, []); assert.deepEqual(page.details.map((d) => d.open), [false, false, false]);

  // the page changed shape: never open a different section by mistake
  page.details[1].open = true;
  const build = ctx.__renderTrial; ctx.__renderTrial = () => { build(); page.details.forEach((d) => (d.summary.textContent = "Renamed " + d.summary.textContent)); };
  t.g.renderTrialInPlace();
  assert.deepEqual(page.details.map((d) => d.open), [false, false, false]);
});

test("open study: refetched quietly after a registry update; an unchanged record is not redrawn; a failed refetch leaves the page alone; no loading placeholder", async () => {
  const t = load({ studies: fill(2), saved: savedIds([nct(1)]), store: { ts_registry: T1 } });
  t.g.WATCH[nct(1)].latest = { status: "RECRUITING", lastUpdate: "2026-09-01", title: "", pc: "2027-06", enr: "100", short: "" };
  t.g.setCurView("trial"); t.g.setCurTrial(nct(2));
  const live0 = liveRec();
  t.g.detailState[nct(2)] = { live: live0, at: 5 };
  const ds = () => t.g.detailState[nct(2)];

  t.reg.bump(); await t.g.regCheck(); await t.settle();                 // the registry moved, the record did not
  assert.equal(t.details(nct(2)).length, 1, "asked once");
  assert.equal(t.renders.trial, 0, "same status / dates / enrollment: no redraw"); assert.equal(ds().live, live0);

  t.reg.mutate(nct(2), { status: "COMPLETED" }); t.reg.bump();
  const inner = t.reg.fetchImpl;
  t.reg.fetchImpl = async (url, init) => (/\/studies\/NCT/.test(url) ? new Response("{}", { status: 503 }) : inner(url, init));
  await t.g.regCheck(); await t.settle();                                // the quiet refetch fails
  assert.equal(t.renders.trial, 0, "page left as it is"); assert.equal(ds().live, live0);
  assert.equal(ds().err, undefined); assert.equal(ds().loading, undefined, "never 'Opening this study…'");

  t.reg.fetchImpl = inner; t.reg.bump(); t.reg.mutate(nct(2), { lup: "2026-10-09" });
  await t.g.regCheck(); await t.settle();                                // and works the next time
  assert.equal(t.renders.trial, 1); assert.equal(ds().live.status, "COMPLETED"); assert.equal(ds().live.lastUpdate, "2026-10-09"); assert.equal(ds().loading, undefined);

  // not on a study page, or live not on yet (start-up): nothing is kept, nothing is asked
  const n = t.details(nct(2)).length;
  t.g.setCurView("trials"); t.g.detailState[nct(2)] = { live: live0 }; t.g.regInvalidate();
  assert.deepEqual(Object.keys(t.g.detailState), []);
  t.g.setCurView("trial"); t.g.LIVE.state = "connecting"; t.g.detailState[nct(2)] = { live: live0 }; t.g.regInvalidate(); await t.settle();
  assert.deepEqual(Object.keys(t.g.detailState), []); assert.equal(t.details(nct(2)).length, n);
});

/* ---- F4: transient failures are retried, "not found" waits for the registry ---- */

test("a saved study left empty by a transient failure is filled on the next good check; one that was not found waits for the registry to move", async () => {
  const t = load({ studies: fill(2), saved: savedIds([nct(1), nct(2), nct(99)]), store: { ts_registry: T1 } });
  t.env.status = 503;                                                    // ts == applied: only the "missing" branch can fill them
  await t.g.regCheck();
  assert.equal(t.g.REG.fails, 1);
  for (const id of [nct(1), nct(2), nct(99)]) { assert.ok(t.g.WATCH[id].err, id + " has an error note"); assert.equal(t.g.WATCH[id].errRetry, true, id + " is marked transient"); }

  t.env.status = null; t.advance(2 * MIN);
  await t.g.regCheck();
  assert.equal(t.batched().length, 2, "retried although the dataTimestamp did not move");
  assert.equal(t.g.WATCH[nct(1)].latest.status, "RECRUITING"); assert.equal(t.g.WATCH[nct(1)].err, undefined); assert.equal(t.g.WATCH[nct(1)].errRetry, undefined);
  assert.match(t.g.WATCH[nct(99)].err, /no record/i, "absent from the response = not found"); assert.equal(t.g.WATCH[nct(99)].errRetry, undefined);

  await t.g.regCheck();
  assert.equal(t.batched().length, 2, "not found is not asked for again");
  assert.equal(t.stored("ts_saved")[nct(99)].errRetry, undefined);
  t.reg.bump(); await t.g.regCheck();
  assert.equal(t.batched().length, 3, "...until the registry moves");
  assert.ok(t.batched().at(-1).u.searchParams.get("filter.ids").split(",").includes(nct(99)));
});

test("transient means network, timeout, 5xx or 429; a 400 or 403 is not retried on every check", async () => {
  for (const [status, retry] of [[500, true], [429, true], [408, true], [400, false], [403, false]]) {
    const t = load({ studies: fill(1), saved: savedIds([nct(1)]), store: { ts_registry: T1 } });
    t.env.status = status;
    await t.g.regCheck();
    assert.equal(!!t.g.WATCH[nct(1)].errRetry, retry, "status " + status);
  }
  const v = load({ studies: fill(1), saved: savedIds([nct(1)]), store: { ts_registry: T1 } });
  const inner = v.reg.fetchImpl; v.reg.fetchImpl = async (url, init) => { if (new URL(url).searchParams.has("filter.ids")) throw new TypeError("Failed to fetch"); return inner(url, init); };
  await v.g.regCheck();
  assert.equal(v.g.WATCH[nct(1)].errRetry, true, "network error (no status)");
});

/* ---- F5: the registry's dataTimestamp never goes back ---- */

test("an older dataTimestamp than the newest seen is a successful no-op: no purge, no refresh, no toast", async () => {
  const OLD = "2026-10-08T09:00:05";
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]), store: { ts_registry: T1 } });
  t.g.WATCH[nct(1)].latest = { status: "RECRUITING", lastUpdate: "2026-09-01", title: "", pc: "2027-06", enr: "100", short: "" };
  await t.g.regCheck();
  t.g.cachePut("k", T1, { payload: { keep: 1 }, at: t.now() }); t.g.LIVE.cache.mem = { payload: 1, at: t.now() };
  t.reg.mutate(nct(1), { status: "COMPLETED" });                         // a stale replica must not be believed, nor must its data be fetched
  t.reg.dataTimestamp = OLD; t.g.REG.fails = 2;
  await t.g.regCheck(); await t.settle();
  assert.equal(t.batched().length, 0, "no refresh"); assert.deepEqual(t.toasts, []);
  assert.ok(t.g.cacheGet("k", T1), "localStorage cache kept"); assert.ok("mem" in t.g.LIVE.cache, "memory cache kept");
  assert.equal(t.g.REG.ts, T1, "REG.ts does not go back"); assert.equal(t.g.REG.applied, T1); assert.equal(t.stored("ts_registry"), T1);
  assert.equal(t.g.REG.fails, 0, "it was a successful check"); assert.equal(t.pending().filter((x) => x.ms >= 4 * MIN).length, 1, "and the normal timer is scheduled");

  t.reg.dataTimestamp = "2026-10-10T09:00:05";                           // the registry really moved
  await t.g.regCheck();
  assert.equal(t.batched().length, 1); assert.deepEqual(t.toasts, ["A saved study has an update"]);
  assert.equal(t.g.REG.ts, "2026-10-10T09:00:05");

  // at start-up the probe may have hit a stale replica while localStorage remembers a newer one
  const s = load({ studies: fill(1), saved: savedIds([nct(1)]), store: { ts_registry: T1 }, dataTimestamp: OLD });
  s.g.WATCH[nct(1)].latest = { status: "RECRUITING", lastUpdate: "2026-09-01", title: "", pc: "2027-06", enr: "100", short: "" };
  s.g.REG.ts = await s.g.fetchRegistryVersion();
  await s.g.refreshWatch(true);
  assert.equal(s.batched().length, 0); assert.equal(s.g.REG.ts, T1); assert.equal(s.g.REG.applied, T1);
  // ...and that start-up no-op must not leave the poller wedged (REG.busy stuck): the next check still runs
  await s.settle();
  assert.equal(s.g.REG.busy, null, "start-up no-op clears busy");
  assert.equal(s.pending().filter((x) => x.ms >= 4 * MIN).length, 1, "and arms the normal timer");
  s.reg.dataTimestamp = "2026-10-10T09:00:05"; s.reg.mutate(nct(1), { status: "COMPLETED" });
  await s.g.regCheck(); await s.settle();
  assert.equal(s.batched().length, 1, "a real registry move is picked up"); assert.deepEqual(s.toasts, ["A saved study has an update"]);
});

/* ---- F6: a failed boot-time probe recovers ---- */

test("boot probe failure: listeners are registered once, re-probes follow the backoff, and live updates start exactly once when /version answers", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]), boot: true });
  const starts = countStartLive(t);
  t.env.down = true;
  await t.boot();
  assert.equal(t.g.LIVE.state, "none"); assert.equal(t.g.LIVE.base, null); assert.equal(t.g.REG.reprobe, true);
  assert.deepEqual(listenerCounts(t), { visibility: 1, focus: 1, online: 1 }, "listeners are there although the probe failed");
  assert.equal(t.versions().length, 1);
  let next = t.pending().filter((x) => x.ms >= 15000); assert.equal(next.length, 1); assert.ok(next[0].ms >= 15000 && next[0].ms <= 60000, "first retry within the backoff window: " + next[0].ms);

  t.advance(next[0].ms + 1); t.fire(next[0]); await t.settle();          // still down
  assert.equal(t.versions().length, 2); assert.equal(t.g.REG.fails, 2); assert.equal(starts(), 0);
  next = t.pending().filter((x) => x.ms >= 15000); assert.equal(next.length, 1, "one timer, not two");
  assert.equal(t.g.LIVE.base, null);

  t.emit("win:online"); await t.settle();                                // too early: backoff and throttle still apply
  assert.equal(t.versions().length, 2);

  t.env.down = false; t.advance(next[0].ms + 1); t.fire(next[0]); await t.settle();
  assert.equal(starts(), 1, "startLive ran"); assert.equal(t.g.REG.reprobe, false);
  assert.equal(t.g.LIVE.state, "on"); assert.equal(t.g.LIVE.base, "direct"); assert.equal(t.g.REG.started, true);
  assert.equal(t.batched().length, 1, "saved studies refreshed once (the snapshot is all they had)"); assert.equal(t.g.WATCH[nct(1)].latest.status, "RECRUITING");
  assert.equal(t.stored("ts_registry"), T1);
  assert.deepEqual(listenerCounts(t), { visibility: 1, focus: 1, online: 1 }, "no listener registered twice");
  assert.equal(t.pending().filter((x) => x.ms >= 4 * MIN).length, 1, "and the regular 5 min poller is running (one timer)");

  const v = t.versions().length; t.advance(2 * MIN);
  t.emit("win:focus"); t.emit("win:online"); t.emit("doc:visibilitychange"); await t.settle();
  assert.equal(starts(), 1, "never started again"); assert.equal(t.versions().length, v + 1, "events are ordinary throttled checks now");
});

test("boot probe failure: focus / online / visible re-probe once the backoff and the 60 s throttle allow, and a hidden tab waits", async () => {
  const t = load({ studies: fill(1), boot: true });
  const starts = countStartLive(t);
  t.env.down = true; t.setHidden(true);
  await t.boot();
  assert.equal(t.g.REG.reprobe, true); assert.equal(t.pending().filter((x) => x.ms >= 15000).length, 0, "no timer while the tab is hidden");
  assert.deepEqual(listenerCounts(t), { visibility: 1, focus: 1, online: 1 });
  t.env.down = false; t.advance(5 * MIN);
  t.emit("win:focus"); await t.settle();
  assert.equal(t.versions().length, 1, "hidden: nothing"); assert.equal(starts(), 0);
  t.setHidden(false); t.emit("doc:visibilitychange"); await t.settle();
  assert.equal(starts(), 1, "visible again: the probe succeeds and live starts"); assert.equal(t.g.LIVE.state, "on");
  t.emit("win:online"); t.emit("win:focus"); await t.settle();
  assert.equal(starts(), 1);
});

test("boot probe failure: never started twice when several triggers race the re-probe", async () => {
  const t = load({ studies: fill(1), saved: savedIds([nct(1)]), boot: true });
  const starts = countStartLive(t);
  t.env.down = true; await t.boot();
  t.env.down = false; t.advance(10 * MIN);
  const timer = t.pending().find((x) => x.ms >= 15000);
  t.fire(timer); t.emit("win:focus"); t.emit("win:online"); t.emit("doc:visibilitychange"); t.g.regKick(); t.g.regReprobe();
  await t.settle();
  assert.equal(starts(), 1); assert.equal(t.versions().length, 2, "boot probe + one re-probe"); assert.equal(t.batched().length, 1);
});

test("boot probe failure: a build with an API keeps its behaviour (no re-probe loop), and a working probe registers nothing extra", async () => {
  const a = load({ studies: fill(1), boot: true, apiBase: "https://api.test" });
  a.env.down = true; await a.boot();
  assert.equal(a.g.LIVE.state, "none"); assert.equal(a.g.REG.reprobe, false);
  assert.deepEqual(listenerCounts(a), { visibility: 0, focus: 0, online: 0 }); assert.equal(a.pending().filter((x) => x.ms >= 15000).length, 0);

  const ok = load({ studies: fill(1), saved: savedIds([nct(1)]), boot: true });
  const starts = countStartLive(ok);
  await ok.boot();
  assert.equal(starts(), 1); assert.equal(ok.g.LIVE.state, "on"); assert.equal(ok.g.REG.reprobe, false);
  assert.deepEqual(listenerCounts(ok), { visibility: 1, focus: 1, online: 1 });
});

/* ---- F7: focus / online / visible never skip the error backoff ---- */

test("during an outage regKick waits for the backoff; when healthy only the 60 s throttle applies", async () => {
  const t = load({ studies: fill(1) });
  t.g.REG.started = true; t.g.regListen();
  t.env.down = true;
  for (let i = 0; i < 4; i++) { await t.g.regCheck(); if (i < 3) t.advance(MIN); }   // 4 failures; jitter 0.5 -> the next attempt is 4 min out
  const wait = t.pending().find((x) => x.ms >= 15000).ms, failedAt = t.now(), n = t.versions().length;
  assert.equal(wait, 240000, "backoff grew with each failure");
  t.advance(3 * MIN);                                                    // past the 60 s throttle, inside the backoff
  t.emit("win:focus"); t.emit("win:online"); t.emit("doc:visibilitychange"); await t.settle();
  assert.equal(t.versions().length, n, "no check before the backoff allows");
  assert.equal(t.pending().filter((x) => x.ms >= 15000).length, 1, "the timer that will run it is still armed");
  t.advance(failedAt + wait - t.now() + 1); t.emit("win:focus"); await t.settle();
  assert.equal(t.versions().length, n + 1, "after the backoff: a focus triggers the check");

  // healthy again: throttle only
  t.env.down = false; t.advance(5 * MIN); await t.g.regCheck(); assert.equal(t.g.REG.fails, 0);
  const m = t.versions().length;
  t.advance(30 * 1000); t.emit("win:focus"); await t.settle(); assert.equal(t.versions().length, m, "30 s: throttled");
  t.advance(31 * 1000); t.emit("win:focus"); await t.settle(); assert.equal(t.versions().length, m + 1, "61 s: allowed");
});

test("a tab that was hidden through an outage still honours the backoff when it comes back", async () => {
  const t = load({ studies: fill(1) });
  t.g.REG.started = true; t.g.regListen(); t.env.down = true;
  for (let i = 0; i < 3; i++) { await t.g.regCheck(); t.advance(MIN); }
  t.setHidden(true); await t.g.regCheck();                               // the 4th failure lands while hidden: no timer is armed, but the 4 min backoff starts now
  const failedAt = t.now();
  assert.equal(t.pending().filter((x) => x.ms >= 15000).length, 0);
  const n = t.versions().length;
  t.advance(2 * MIN); t.setHidden(false); t.emit("doc:visibilitychange"); await t.settle();
  assert.equal(t.versions().length, n, "visible again inside the window: not yet");
  const timer = t.pending().find((x) => x.ms >= 15000);
  assert.ok(timer && Math.abs(timer.ms - (failedAt + 240000 - t.now())) < 2, "armed for what is left of the window: " + (timer && timer.ms));
  t.advance(timer.ms + 1); t.fire(timer); await t.settle();
  assert.equal(t.versions().length, n + 1);
});

test("Retry-After (seconds) on a failed /version stretches the wait; capped at 1 h; ignored when not a number of seconds", async () => {
  const t = load({ studies: fill(1) });
  t.g.REG.started = true; t.g.regListen(); t.rand(0);                    // jitter alone would give the 15 s floor
  t.env.versionStatus = 429; t.env.versionHeaders = { "retry-after": "600" };
  await t.g.regCheck();
  assert.equal(t.g.REG.fails, 1);
  assert.equal(t.pending().find((x) => x.ms >= 15000).ms, 600000, "waits what the registry asked for");
  t.advance(2 * MIN); const n = t.versions().length; t.emit("win:online"); await t.settle();
  assert.equal(t.versions().length, n, "even when the tab is nudged");

  const c = load({ studies: fill(1) }); c.g.REG.started = true; c.rand(0);
  c.env.versionStatus = 503; c.env.versionHeaders = { "retry-after": "999999" };
  await c.g.regCheck(); assert.equal(c.pending().find((x) => x.ms >= 15000).ms, 3600000, "capped");

  const d = load({ studies: fill(1) }); d.g.REG.started = true; d.rand(0);
  d.env.versionStatus = 503; d.env.versionHeaders = { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" };
  await d.g.regCheck(); assert.equal(d.pending().find((x) => x.ms >= 15000).ms, 15000, "an HTTP date is ignored");

  t.env.versionStatus = null; t.advance(11 * MIN);
  await t.g.regCheck();
  assert.equal(t.g.REG.retryAfter, 0, "forgotten once the registry answers");
});
