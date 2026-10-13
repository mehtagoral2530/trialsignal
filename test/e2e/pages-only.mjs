// End-to-end for the simplest deployment: GitHub Pages only (no Worker, no Redis).
// The built site is served under /trialsignal/ (like a GitHub project page) and the browser talks to
// ClinicalTrials.gov directly; the registry is faked with Playwright routing, including GET /version.
// Time is driven with Playwright's clock (page.clock.runFor / fastForward): nothing is exposed in the production code.
// Run: node test/e2e/pages-only.mjs
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { study, fakeRegistry } from "../helpers/fixtures.mjs";
import { CURATED } from "../../shared/curated.js";
const require = createRequire(import.meta.url);
const { chromium } = require(execSync("npm root -g").toString().trim() + "/playwright");

execSync("node scripts/build-site.mjs"); // no TS_API_BASE => Pages-only build
const root = new URL("../../site/", import.meta.url).pathname;
const types = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", woff2: "font/woff2" };
const site = http.createServer((req, res) => {
  let u = req.url.split("?")[0];
  if (!u.startsWith("/trialsignal/")) { res.writeHead(404); return res.end(); }
  u = u.slice("/trialsignal/".length) || "index.html";
  const p = root + u;
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[p.split(".").pop()] || "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}/trialsignal/`;

const ID = "NCT03548935";
const reg = fakeRegistry([...CURATED.map((id) => study({ id, status: "RECRUITING" })), study({ id: "NCT55555555", title: "Etentamig for multiple myeloma", conditions: ["Multiple Myeloma"], interventions: ["Etentamig"] })], { dataTimestamp: "2026-10-09T09:00:05" });
let registryUp = true;
const attempts = []; // every request the browser sent to the registry, including the ones that failed
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.clock.install(); // fake timers + Date, still ticking in real time until we jump
await ctx.route("https://clinicaltrials.gov/api/v2/**", async (route) => {
  attempts.push(new URL(route.request().url()));
  if (!registryUp) return route.abort("connectionfailed");
  const r = await reg.fetchImpl(route.request().url());
  route.fulfill({ status: r.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await r.text() });
});
const errors = [];
const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
const check = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };
const waitFor = async (cond, what, ms = 6000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("FAIL: timed out waiting for " + what); await new Promise((r) => setTimeout(r, 40)); } };

// what the fake registry actually received
const versions = () => reg.calls.filter((u) => u.pathname.endsWith("/version"));
const batched = () => reg.calls.filter((u) => u.pathname.endsWith("/studies") && u.searchParams.has("filter.ids"));
const details = () => reg.calls.filter((u) => u.pathname.endsWith("/studies/" + ID));
const failedVersions = () => attempts.filter((u) => u.pathname.endsWith("/version")).length - versions().length;
const MIN = 60 * 1000;

const page = await ctx.newPage(); watch(page);
let snapshotFetches = 0; page.on("request", (r) => { if (r.url().endsWith("/data/snapshot.json")) snapshotFetches++; });
const live = () => page.waitForFunction(() => LIVE.state === "on");
const ls = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), k);
const cacheKeys = async () => Object.keys((await ls("ts_cache_v1")) || {});

/* ---- 1. initial load reaches live; the cheap /version probe is the only request ---- */
await page.goto(base + "#home"); await live();
check(await page.evaluate(() => LIVE.base === "direct" && LIVE.mode === "http"), "initial load goes live, talking to ClinicalTrials.gov directly");
check(versions().length === 1 && batched().length === 0, "start-up costs one /version request and no studies request (nothing saved yet)");
check((await ls("ts_registry")) === reg.dataTimestamp, "the registry's dataTimestamp is remembered in localStorage");

/* ---- 2. search + study page + save ---- */
await page.fill("#searchInput", "myeloma"); await page.click("#searchForm .btn"); await page.waitForTimeout(700);
check((await page.textContent("#studyList")).includes("Etentamig"), "search reaches ClinicalTrials.gov directly from the browser");
check((await cacheKeys()).some((k) => k.startsWith("h:search:")), "the search answer is cached in localStorage");
await page.goto(base + "#" + ID); await page.waitForTimeout(700);
check((await page.textContent("#trialOut")).includes("Status is live"), "study page shows live registry status");
await page.click("#saveBtn"); await page.waitForTimeout(300);
check((await ls("ts_saved"))[ID].latest.status === "RECRUITING", "saving a study records its live state");

/* ---- 3. dataTimestamp moves + the study changed: exactly one batched request, drawer + toast ---- */
const b0 = batched().length, d0 = details().length;
reg.mutate(ID, { status: "COMPLETED", lup: "2026-10-05" }); reg.bump();
await page.clock.runFor(7 * MIN); // the 5 min (+-20%) poll fires once
await waitFor(() => batched().length > b0, "the batched refresh");
await page.waitForTimeout(500);
check(batched().length === b0 + 1, "a registry update triggers exactly one batched studies request");
const u = batched().at(-1);
check(u.searchParams.get("filter.ids") === ID && u.searchParams.get("pageSize") === "100" && /OverallStatus/.test(u.searchParams.get("fields")) && u.searchParams.get("format") === "json", "...for all saved ids, with a field list and pageSize=100");
check(/A saved study has an update/.test(await page.textContent("#toast")) && (await page.isVisible("#toast")), "a toast announces the update");
await page.click("#savedBtn"); await page.waitForTimeout(250);
const drawer = await page.textContent("#savedList");
check(drawer.includes("Finished") && drawer.includes("Status changed to"), "the saved drawer shows the new status");
await page.keyboard.press("Escape");
check(details().length === d0 + 1 && (await page.textContent("#trialOut")).includes("Finished"), "the open study page re-fetched its live record and shows the new status");
check((await ls("ts_registry")) === reg.dataTimestamp, "the new dataTimestamp is remembered");

/* ---- 4. unchanged dataTimestamp: the check costs one /version and no studies request ---- */
let v = versions().length, b1 = batched().length, d1 = details().length;
await page.clock.runFor(7 * MIN);
await waitFor(() => versions().length > v, "the next poll");
await page.waitForTimeout(400);
check(versions().length === v + 1 && batched().length === b1 && details().length === d1, "an unchanged dataTimestamp triggers no studies request on the next check");

/* ---- 5. extra triggers are throttled to once per 60 s; hidden tabs have no timers ---- */
const fire = (...names) => page.evaluate((names) => names.forEach((n) => (n === "focus" || n === "online" ? window : document).dispatchEvent(new Event(n))), names);
await page.clock.runFor(61 * 1000);
v = versions().length;
await fire("focus"); await waitFor(() => versions().length > v, "a check on focus");
await fire("focus", "online", "visibilitychange"); await page.waitForTimeout(300);
check(versions().length === v + 1, "focus / online / visibilitychange within 60 s of a check do not re-check");
await page.clock.runFor(61 * 1000);
await fire("online"); await waitFor(() => versions().length > v + 1, "a check on online");
check(versions().length === v + 2, "...but a later focus / online does");
await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
await fire("visibilitychange");
v = versions().length;
await page.clock.runFor(15 * MIN); await page.waitForTimeout(300);
check(versions().length === v, "no polling while the tab is hidden");
await page.evaluate(() => delete document.hidden);
await fire("visibilitychange"); await waitFor(() => versions().length > v, "a check when the tab is visible again");
check(versions().length === v + 1, "...and it checks right away when the tab comes back");

/* ---- 6. 24 h cache: served across a reload while dataTimestamp is unchanged ---- */
check((await cacheKeys()).includes(`h:details:"${ID}"`), "the study record is cached in localStorage");
let d2 = details().length, b2 = batched().length;
await page.reload(); await live(); await page.waitForFunction(() => document.querySelector("#trialOut").textContent.includes("Status is live"));
check(details().length === d2 && batched().length === b2, "after a reload the cached record is served without asking the registry again");

/* ---- 7. ...and dropped as soon as dataTimestamp changes ---- */
const oldTs = reg.dataTimestamp, taggedBefore = (await ls("ts_cache_v1"))[`h:details:"${ID}"`].ts;
reg.bump();
await page.reload(); await live(); await page.waitForFunction(() => document.querySelector("#trialOut").textContent.includes("Status is live"));
check(details().length === d2 + 1, "a new dataTimestamp drops the cache: the study record is fetched again");
check(batched().length === b2 + 1, "...and the saved studies are refreshed in one batched request");
check(!/update/i.test(await page.evaluate(() => (document.querySelector("#toast").hidden ? "" : document.querySelector("#toast").textContent))), "...with no toast when nothing the app tracks changed");
const ck = await ls("ts_cache_v1");
check(taggedBefore === oldTs && Object.values(ck).length > 0 && Object.values(ck).every((e) => e.ts === reg.dataTimestamp), "...and every entry in the cache now belongs to the new dataTimestamp");

/* ---- 8. 24 h expiry ---- */
const callDetails = () => page.evaluate((id) => callLive("details", id).then((r) => r.at), ID);
d2 = details().length;
await page.clock.fastForward(23 * 60 * MIN);
await callDetails(); await page.waitForTimeout(200);
check(details().length === d2, "an entry younger than 24 h is still served from the cache");
await page.clock.fastForward(2 * 60 * MIN);
await callDetails(); await page.waitForTimeout(200);
check(details().length === d2 + 1, "an entry older than 24 h is fetched again");

/* ---- 9. registry down: snapshot fallback, once, no page errors ---- */
registryUp = false;
const f0 = failedVersions(), s0 = snapshotFetches;
await page.clock.runFor(7 * MIN); await page.waitForTimeout(250); // failure 1
for (let i = 0; i < 6 && snapshotFetches === s0; i++) { await page.clock.runFor(5 * MIN); await page.waitForTimeout(250); } // failures 2, 3 -> snapshot
check(failedVersions() - f0 >= 3 && snapshotFetches === s0 + 1, "after 3 failed checks in a row the saved snapshot is loaded");
await page.clock.runFor(20 * MIN); await page.waitForTimeout(250);
await page.clock.runFor(20 * MIN); await page.waitForTimeout(250);
check(snapshotFetches === s0 + 1 && failedVersions() - f0 >= 5, "...only once, however long the outage lasts (checks keep backing off)");
check(await page.evaluate(() => LIVE.state === "on" && REG.fails >= 5), "...and the page keeps its state (no new status text)");

/* ---- 10. registry back: resumes normally ---- */
registryUp = true;
b2 = batched().length; v = versions().length;
await page.clock.runFor(20 * MIN); await waitFor(() => versions().length > v, "a check after the outage"); await page.waitForTimeout(400);
check(batched().length === b2 + 1 && (await page.evaluate(() => REG.fails === 0 && !REG.fellBack)), "when the registry answers again the saved studies are refreshed once");
v = versions().length; b2 = batched().length;
await page.clock.runFor(7 * MIN); await waitFor(() => versions().length > v, "the next poll"); await page.waitForTimeout(300);
check(batched().length === b2, "...and then it is back to cheap /version checks");

/* ---- 11. registry unreachable at load: falls back to the saved copy ---- */
registryUp = false;
const p2 = await ctx.newPage(); watch(p2);
let p2Snapshot = 0; p2.on("request", (r) => { if (r.url().endsWith("/data/snapshot.json")) p2Snapshot++; });
await p2.goto(base + "#" + ID); await p2.waitForTimeout(1500);
check(!(await p2.textContent("#trialOut")).includes("Status is live") && (await p2.evaluate(() => LIVE.state)) === "none" && /saved copy/.test(await p2.evaluate(() => LIVE.msg)), "registry unreachable: no live claim, falls back to the saved copy");
check(p2Snapshot === 1, "registry unreachable: the snapshot is fetched");
check((await p2.textContent("#trialOut")).length > 200, "registry unreachable: the study page still renders from bundled data");

/* ================= scenarios with their own browser context and fake registry ================= */
const OTHER = "NCT55555555";
const scenario = async ({ init, saved = [], viewport = { width: 1280, height: 600 } } = {}) => {
  const r = fakeRegistry([...CURATED.map((id) => study({ id })), study({ id: OTHER, title: "Etentamig for multiple myeloma", conditions: ["Multiple Myeloma"], interventions: ["Etentamig"], summary: "A long description of the study. ".repeat(120) })], { dataTimestamp: "2026-10-09T09:00:05" });
  const sc = { reg: r, up: true, hangBatch: false, log: [] };
  sc.ctx = await b.newContext({ viewport });
  await sc.ctx.clock.install();
  if (init) await sc.ctx.addInitScript(init);
  if (saved.length) await sc.ctx.addInitScript((ids) => { try { if (!localStorage.getItem("ts_saved")) localStorage.setItem("ts_saved", JSON.stringify(Object.fromEntries(ids.map((i) => [i, { added: 1 }])))); } catch (e) {} }, saved);
  await sc.ctx.route("https://clinicaltrials.gov/api/v2/**", async (route) => {
    const u = new URL(route.request().url());
    sc.log.push(u.pathname.endsWith("/version") ? "version" : u.searchParams.has("filter.ids") ? "batch" : /\/studies\/NCT/.test(u.pathname) ? "detail:" + u.pathname.split("/").pop() : "other");
    if (!sc.up) return route.abort("connectionfailed");
    if (sc.hangBatch && u.searchParams.has("filter.ids")) return;   // headers never arrive
    const res = await r.fetchImpl(route.request().url());
    route.fulfill({ status: res.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await res.text() });
  });
  sc.count = (kind) => sc.log.filter((k) => k === kind).length;
  sc.open = async (hash) => { const p = await sc.ctx.newPage(); watch(p); await p.goto(base + hash); return p; };
  return sc;
};

/* ---- 12. a registry update must not wipe the study page the reader is on ---- */
{
  const R = await scenario();
  const p = await R.open("#" + OTHER);   // a study with no bundled summary: the "Opening this study…" placeholder is what a rebuilt page would show
  await p.waitForFunction(() => LIVE.state === "on");
  await p.waitForFunction(() => document.querySelector("#trialOut").textContent.includes("Status is live"));
  await p.click("#acc > details:nth-of-type(2) > summary");
  await p.fill("#askInput", "who can take part"); await p.press("#askInput", "Enter");
  await p.fill("#askInput", "half-typed second question");
  await p.evaluate(() => { const i = document.querySelector("#askInput"); i.focus(); i.setSelectionRange(5, 9); window.scrollTo(0, 420); });
  await p.waitForTimeout(300);
  const snap = () => p.evaluate(() => ({
    open: [...document.querySelectorAll("#trialOut details")].map((d) => d.open), typed: document.querySelector("#askInput").value, focused: document.activeElement.id,
    sel: [document.querySelector("#askInput").selectionStart, document.querySelector("#askInput").selectionEnd], answers: document.querySelectorAll("#askLog .qa").length, y: Math.round(scrollY), text: document.querySelector("#trialOut").textContent }));
  const before = await snap();
  check(before.open[1] && before.answers === 1 && before.focused === "askInput" && before.y > 300, "set-up: a section is open, one question was asked, another is half typed, the page is scrolled");
  await p.evaluate(() => { window.__renders = 0; window.__placeholder = false; new MutationObserver(() => { window.__renders++; if (document.querySelector("#trialOut").textContent.includes("Opening this study")) window.__placeholder = true; }).observe(document.querySelector("#trialOut"), { childList: true, subtree: true }); });

  let d = R.count("detail:" + OTHER);
  R.reg.bump();                                              // the registry republished, but nothing this study shows moved
  await p.clock.runFor(7 * MIN); await waitFor(() => R.count("detail:" + OTHER) > d, "the quiet refetch of the open study"); await p.waitForTimeout(400);
  check(R.count("detail:" + OTHER) === d + 1 && (await p.evaluate(() => window.__renders)) === 0, "registry moved, record unchanged: the open study is re-requested quietly and the page is not touched");

  d = R.count("detail:" + OTHER);
  R.reg.mutate(OTHER, { status: "COMPLETED", lup: "2026-10-05" }); R.reg.bump();
  await p.clock.runFor(7 * MIN); await waitFor(() => R.count("detail:" + OTHER) > d, "the refetch after the change"); await p.waitForTimeout(500);
  const after = await snap();
  check(after.text.includes("Finished") && !before.text.includes("Finished"), "...and when the study itself changed, the page shows the new status");
  check(JSON.stringify(after.open) === JSON.stringify(before.open), "...with the same section still open");
  check(after.typed === before.typed && after.focused === "askInput" && after.sel[0] === 5 && after.sel[1] === 9, "...the half-typed question, its focus and its selection are kept");
  check(after.answers === 1, "...the answer already shown is kept");
  check(Math.abs(after.y - before.y) <= 2, "...and so is the scroll position (" + before.y + " -> " + after.y + ")");
  check(!(await p.evaluate(() => window.__placeholder)) && (await p.evaluate(() => window.__renders)) > 0, "...and the page was redrawn without ever showing 'Opening this study…'");

  // a failed quiet refetch leaves the page exactly as it is
  d = R.count("detail:" + OTHER);
  await R.ctx.unroute("https://clinicaltrials.gov/api/v2/**");
  await R.ctx.route("https://clinicaltrials.gov/api/v2/**", async (route) => {
    const u = new URL(route.request().url());
    if (/\/studies\/NCT/.test(u.pathname)) { R.log.push("detail:" + u.pathname.split("/").pop()); return route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, body: "down" }); }
    const res = await R.reg.fetchImpl(route.request().url());
    route.fulfill({ status: res.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await res.text() });
  });
  R.reg.mutate(OTHER, { status: "TERMINATED" }); R.reg.bump();
  await p.evaluate(() => { window.__renders = 0; });
  await p.clock.runFor(7 * MIN); await waitFor(() => R.count("detail:" + OTHER) > d, "the failing refetch"); await p.waitForTimeout(400);
  const kept = await snap();
  check((await p.evaluate(() => window.__renders)) === 0 && kept.text === after.text && kept.typed === after.typed, "a failed quiet refetch leaves the page as it is");
  await R.ctx.close();
}

/* ---- 13. browsers without AbortSignal.timeout: still live; a stalled batched request times out instead of wedging the poller ---- */
// Here the timeout runs on the page's (fake) timers, so the clock is advanced in small steps with a real pause in between:
// a single big jump would also expire the 8 s timeout of a request that has simply not been answered yet in real time.
const tick = async (pg, ms, step = 3000) => { for (let t = 0; t < ms; t += step) { await pg.clock.runFor(Math.min(step, ms - t)); await pg.waitForTimeout(30); } };
{
  const L = await scenario({ init: () => { delete AbortSignal.timeout; }, saved: [ID] });
  L.hangBatch = true;
  const p = await L.open("#home");
  check(await p.evaluate(() => typeof AbortSignal.timeout === "undefined"), "set-up: this browser has no AbortSignal.timeout");
  await waitFor(() => L.count("batch") === 1, "the first batched request");
  await p.waitForTimeout(600);
  check(await p.evaluate(() => LIVE.state === "connecting" && LIVE.base === "direct" && !!REG.busy), "without AbortSignal.timeout the registry probe works; the stalled first batch keeps start-up 'connecting' for now");
  await tick(p, 21 * 1000);
  await p.waitForFunction(() => LIVE.state === "on", null, { timeout: 6000 });
  check(await p.evaluate(() => REG.busy === null && REG.fails === 1 && REG.timer !== null), "the stalled batch times out: start-up finishes, the failure is counted and a retry is scheduled");
  L.hangBatch = false;
  await tick(p, 61 * 1000); await waitFor(() => L.count("batch") === 2, "the retry");
  await p.waitForFunction(() => REG.fails === 0 && !REG.busy);
  check(await p.evaluate(() => !!JSON.parse(localStorage.getItem("ts_saved"))["NCT03548935"].latest) && (await p.evaluate(() => localStorage.getItem("ts_registry"))) !== "null", "...and the next attempt refreshes the saved study and remembers the registry version");

  // the same stall during a later poll
  L.reg.bump(); L.hangBatch = true;
  const b0 = L.count("batch");
  for (let t = 0; t < 8 * MIN && L.count("batch") === b0; t += 5000) await tick(p, 5000, 5000);   // until the poll's batched request is out
  await waitFor(() => L.count("batch") === b0 + 1, "the stalled poll batch");
  check(await p.evaluate(() => !!REG.busy), "a poll's batched request is outstanding");
  await tick(p, 21 * 1000); await p.waitForFunction(() => REG.busy === null && REG.fails === 1, null, { timeout: 6000 });
  await p.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  L.hangBatch = false;
  await tick(p, 70 * 1000); await waitFor(() => L.count("batch") === b0 + 2, "the retry after the stalled poll");
  check(await p.evaluate(() => REG.fails === 0 && REG.busy === null && REG.timer !== null), "the poller carries on after a stalled poll: busy cleared, next check scheduled");
  await L.ctx.close();
}

/* ---- 14. the boot-time probe fails (registry blinks at load): it recovers by itself, starting live updates once ---- */
{
  const B = await scenario({ saved: [ID], init: () => {
    window.__ev = {}; const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (t, ...r) { if (t === "visibilitychange" || t === "focus" || t === "online") window.__ev[t] = (window.__ev[t] || 0) + 1; return add.call(this, t, ...r); };
  } });
  B.up = false;
  const p = await B.open("#" + ID);
  let snapshots = 0; p.on("request", (r) => { if (r.url().endsWith("/data/snapshot.json")) snapshots++; });
  await p.waitForFunction(() => LIVE.state === "none"); await p.waitForTimeout(500);
  check(await p.evaluate(() => /saved copy/.test(LIVE.msg) && REG.reprobe === true), "set-up: the first probe failed, the page shows the saved copy");
  const ev = () => p.evaluate(() => JSON.stringify(window.__ev));
  // focus and online each once; visibilitychange twice: the API change feed's own listener plus the registry poller's
  check((await ev()) === JSON.stringify({ visibilitychange: 2, focus: 1, online: 1 }), "the poller's listeners are registered although the probe failed (and only once)");
  const v0 = B.count("version");
  await p.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); });
  await p.waitForTimeout(300);
  check(B.count("version") === v0, "focus / online right after the failure do not hammer the registry");
  B.up = true;
  await p.clock.runFor(61 * 1000);
  await p.waitForFunction(() => LIVE.state === "on", null, { timeout: 6000 });
  await p.waitForFunction(() => document.querySelector("#trialOut").textContent.includes("Status is live"));
  check(await p.evaluate(() => LIVE.base === "direct" && REG.started && REG.reprobe === false && REG.fails === 0), "the registry answers again: the re-probe succeeds and live updates start");
  check(B.count("version") === v0 + 1 && B.count("batch") === 1, "...with one more /version request and one batched refresh of the saved studies");
  check((await ev()) === JSON.stringify({ visibilitychange: 2, focus: 1, online: 1 }) && snapshots === 1, "...no listener is registered twice, and the snapshot was loaded only at boot");
  const v1 = B.count("version"), b1 = B.count("batch");
  await p.clock.runFor(6 * MIN + 1000); await p.waitForTimeout(400);
  check(B.count("version") === v1 + 1 && B.count("batch") === b1, "...and exactly one poller is running: one /version per 5 minutes, no studies request");
  await B.ctx.close();
}

/* ---- 15. focus / online / visible do not skip the error backoff ---- */
{
  const D = await scenario({ init: () => { Math.random = () => 0.99; } });   // fixed jitter: backoff after the 2nd failure is 118.8 s
  const p = await D.open("#home");
  await p.waitForFunction(() => LIVE.state === "on");
  D.up = false;
  await p.clock.runFor(6.1 * MIN); await waitFor(() => D.count("version") === 2, "failure 1");
  await p.waitForFunction(() => REG.fails === 1 && !REG.busy);
  await p.clock.runFor(61 * 1000); await waitFor(() => D.count("version") === 3, "failure 2");
  await p.waitForFunction(() => REG.fails === 2 && !REG.busy);
  const v = D.count("version");
  await p.clock.runFor(65 * 1000);   // past the 60 s throttle, inside the 118.8 s backoff
  await p.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); });
  await p.waitForTimeout(400);
  check(D.count("version") === v, "during an outage, focus / online / visibilitychange do not check before the backoff has passed");
  await p.clock.runFor(60 * 1000); await waitFor(() => D.count("version") === v + 1, "the scheduled retry");
  check(D.count("version") === v + 1, "...and the scheduled retry still runs when the backoff is over");
  await D.ctx.close();
}

check(errors.length === 0, "no page errors " + errors.join("|"));
await b.close(); site.close();
console.log("PAGES-ONLY E2E PASS");
