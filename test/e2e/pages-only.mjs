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
import * as N from "../../shared/news.js";
import { loadNewsData } from "../../scripts/lib-appdata.mjs";
import { fakeNews, world, fdaRecord, regStudy, NEWS_NOW } from "../helpers/news-fixtures.mjs";
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

/* ================= live "What's new" (#news) =================
   Every source is faked: ClinicalTrials.gov's news queries, openFDA, RxNorm, PubMed, Europe PMC, and the saved copy (data/news.json).
   The page runs on Playwright's clock, set to 14 Oct 2026 12:00 UTC, so dates, windows and "x min ago" are exact.
   The expected page is computed by running the same shared rules in Node over the same fake world, so these checks prove the
   browser wiring (what is fetched, cached, shown, when) while test/news.test.mjs proves the rules. */
const REAL = loadNewsData();
const HAND = N.newsHandItems(Array.from(REAL.NEWS), REAL.NEWS_PLAIN, N.newsHandLevel);
const savedDoc = () => {
  const one = (o) => N.newsParseRegistry({ studies: [regStudy(o)] })[0];
  const items = [
    N.newsResultItem(one({ nct: "NCT90000001", resultsDate: "2026-10-05", conditions: ["Saved Results Condition"] }), N.newsJournal({ ok: true, n: 0 }, { ok: true, n: 0 })),
    N.newsStoppedItems([one({ nct: "NCT90000002", status: "TERMINATED", updated: "2026-10-05", cd: "2026-09-01", conditions: ["Saved Stopped Condition"] })], NEWS_NOW)[0],
    N.newsApprovalItem({ app: "NDA390001", date: "2026-09-10", cls: "TYPE 1", brand: "SAVEDX", generics: ["savedine"], dosageForms: [] }, { dm: { setid: "99999999-2222-3333-4444-555555555555", title: "SAVEDX (SAVEDINE) TABLET" } }),
  ];
  return { version: 1, generatedAt: "2026-10-13T10:00:00.000Z", dataTimestamp: "2026-10-13T09:00:05", fdaUpdated: "2026-10-13", windows: { registryDays: 30, fdaDays: 90 }, contentHash: "x".repeat(32), items, dailymed: world().dailymed };
};
const BADGE = { 0: "Didn’t work or stopped", 4: "Proven and approved", 6: "Results posted, no article found", 7: "Results posted" };
const NEWS_HOSTS = ["api.fda.gov", "eutils.ncbi.nlm.nih.gov", "www.ebi.ac.uk", "rxnav.nlm.nih.gov"];

const newsScenario = async ({ down = {}, saved = true, registryUp = true, spec = world(), viewport = { width: 1280, height: 900 } } = {}) => {
  const fk = fakeNews(spec); Object.assign(fk.down, down);
  const reg = fakeRegistry(CURATED.map((id) => study({ id })), { dataTimestamp: "2026-10-09T09:00:05" });
  const sc = { fk, reg, savedUp: saved, registryUp, saved: savedDoc(), dialogs: 0, savedFetches: 0 };
  sc.ctx = await b.newContext({ viewport });
  await sc.ctx.clock.install({ time: new Date(NEWS_NOW) });
  await sc.ctx.addInitScript(() => { window.__pm = []; const f = window.fetch; window.fetch = function (u, ...a) { if (String(u).includes("eutils.ncbi")) window.__pm.push(Date.now()); return f.call(this, u, ...a); }; });
  const reply = (route, r) => r.abort ? route.abort("connectionfailed")
    : route.fulfill({ status: r.status, headers: { "content-type": "application/json", ...(r.noCors ? {} : { "access-control-allow-origin": "*" }) }, body: JSON.stringify(r.json) });   // a rate-limited PubMed reply has no CORS header
  await sc.ctx.route("https://clinicaltrials.gov/api/v2/**", async (route) => {
    const url = route.request().url(), r = fk.handle(url);
    if (r) return reply(route, r);
    if (!sc.registryUp) return route.abort("connectionfailed");
    const res = await reg.fetchImpl(url);
    route.fulfill({ status: res.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await res.text() });
  });
  for (const h of NEWS_HOSTS) await sc.ctx.route(`https://${h}/**`, (route) => { const r = fk.handle(route.request().url()); return r ? reply(route, r) : route.abort(); });
  await sc.ctx.route("**/data/news.json", (route) => { sc.savedFetches++; return sc.savedUp ? route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(sc.saved) }) : route.fulfill({ status: 404, body: "" }); });
  sc.open = async (hash = "#news") => { const p = await sc.ctx.newPage(); watch(p); p.on("dialog", (d) => { sc.dialogs++; d.dismiss(); }); await p.goto(base + hash); return p; };
  return sc;
};
const newsIdle = () => !NEWSLIVE.busy && (["live", "partial", "paused"].includes(NEWSLIVE.status) || (NEWSLIVE.savedLoaded && newsMode() === "saved"));
const settle = async (p, steps = 400) => {   // the page waits on fake timers (PubMed spacing, retries): move the clock along until it has finished
  for (let i = 0; i < steps; i++) { if (await p.evaluate(newsIdle)) { await p.waitForTimeout(30); return; } await p.clock.runFor(500); await p.waitForTimeout(20); }
  throw new Error("FAIL: the news page never settled");
};
const rowsOf = (p) => p.evaluate(() => [...document.querySelectorAll("#newsList .news-item")].map((a) => ({
  badge: a.querySelector(".verdict").textContent.trim(), top: a.querySelector(".top span:last-child").textContent, h3: a.querySelector("h3").textContent, text: a.querySelector("p.muted").textContent,
  links: [...a.querySelectorAll(".links a")].map((l) => [l.textContent, l.getAttribute("href"), l.getAttribute("target")]) })));
const introOf = (p) => p.evaluate(() => document.querySelector('[data-view="news"] .t-head p').innerText);   // innerText: the <br> before "Checked ..." is a line break
/** What the page must show: the shared rules run in Node over the same fake world, with the same sources down and the same saved copy. */
const expectedNews = async ({ down = {}, saved = true, spec = world() } = {}) => {
  const fk = fakeNews(spec); Object.assign(fk.down, down);
  const doc = saved ? N.newsCheckSaved(savedDoc()) : null;
  const r = await N.newsRun(fk.io({ memory: true }), { nowMs: NEWS_NOW, hand: HAND, getSaved: async () => doc, pubmedRetryMs: 1 });
  const items = r.anyLive ? r.items : N.newsMerge({ hand: HAND, results: doc ? doc.items.filter((i) => i.kind === "results") : [], stopped: doc ? doc.items.filter((i) => i.kind === "stopped") : [], approvals: doc ? doc.items.filter((i) => i.kind === "approval") : [], nowMs: NEWS_NOW });
  return { r, items };
};
/** Compare the page, row by row, with the expected items. Returns a list of differences (empty = identical). */
const diffNews = (rows, items) => {
  const bad = [];
  if (rows.length !== items.length) bad.push(`row count ${rows.length} != ${items.length}`);
  items.forEach((it, i) => {
    const row = rows[i]; if (!row) return;
    if (it.hand) { if (row.h3 !== it.title || !row.top.endsWith(" · Picked by hand")) bad.push(`hand row ${i}: ${row.h3} | ${row.top}`); return; }
    const top = `${it.datePrefix || ""}${N.newsFmtDate(it.date)} · ${it.sourcesLabel}`;
    if (row.h3 !== it.title) bad.push(`row ${i} title: ${row.h3} != ${it.title}`);
    if (row.text !== it.summary) bad.push(`row ${i} text: ${row.text} != ${it.summary}`);
    if (row.top !== top) bad.push(`row ${i} top: ${row.top} != ${top}`);
    if (row.badge !== BADGE[it.level]) bad.push(`row ${i} badge: ${row.badge}`);
    const links = row.links.filter((l) => l[0] !== "Read our plain-English summary");
    if (JSON.stringify(links.map((l) => l.slice(0, 2))) !== JSON.stringify(it.links)) bad.push(`row ${i} links: ${JSON.stringify(links)}`);
    if (!links.every((l) => l[2] === "_blank")) bad.push(`row ${i} links open in a new tab`);
  });
  return bad;
};
const INTRO_HEAD = "Recent results, approvals and setbacks, each labelled with how sure we can be. Stories marked “Picked by hand” were chosen and written by a person. ";
/** The live part of the intro: only sources that answered are named, and the time is always the last line. */
const LIVE_SENTENCE = (ago, { primary = "ClinicalTrials.gov and FDA", cross = "PubMed, Europe PMC and RxNorm", note = "" } = {}) => `The rest are written automatically from live ${primary} records${cross ? `, cross-checked with ${cross}` : ""}.${note}\nChecked ${ago}.`;
const SAVED_FROM = "13 Oct 2026";

/* ---- 16. everything up ---- */
{
  const S = await newsScenario();
  const p = await S.open("#news");
  check((await introOf(p)) === INTRO_HEAD + "Checking ClinicalTrials.gov and the FDA…", "news: the intro first says it is checking (never 'just now' before anything was checked)");
  await settle(p);
  const exp = await expectedNews();
  const rows = await rowsOf(p);
  const d = diffNews(rows, exp.items);
  check(d.length === 0, "news: the page shows exactly what the shared rules produce for this world " + d.slice(0, 3).join(" || "));
  check(await p.evaluate(() => Object.values(NEWSLIVE.sources).filter((v) => v !== "off").every((v) => v === "ok") && NEWSLIVE.sources.pubmed === "ok" && NEWSLIVE.status === "live"), "news: every source answered through the page's own Content-Security-Policy");
  const kinds = (k) => exp.r.live[k].length;
  check(kinds("results") === 8 && kinds("stopped") === 5 && kinds("approvals") === 5 && rows.length === 14 + 18, "news: 8 results, 5 stopped and 5 approvals are shown beside the 14 hand-picked stories");
  check((await introOf(p)) === INTRO_HEAD + LIVE_SENTENCE("just now"), "news: the intro says it is live, names the sources that answered, and ends with when it was checked");
  { const live = await introOf(p); check(live.includes("The rest are written automatically from live ") && !live.includes("DailyMed") && !live.includes("come live"), "news: the live intro says the stories are written automatically and never names DailyMed (the browser never asks it)"); }
  check(!(await introOf(p)).includes("12 October 2026") && (await p.evaluate(() => document.querySelectorAll('[data-view="news"] [aria-live]').length)) === 0, "news: the fixed 'last checked' text is gone and nothing in the news view is aria-live");
  check(rows.filter((r) => r.top.endsWith("Picked by hand")).length === 14 && rows.filter((r) => r.top.includes("Picked by hand")).every((r) => r.links.every((l) => l[2] === "_blank" || l[1].startsWith("#"))), "news: the hand-picked stories are all still there, now labelled 'Picked by hand'");
  const tops = rows.filter((r) => !r.top.includes("Picked by hand")).map((r) => r.top);
  check(tops.every((t) => /^(Registry record updated )?\d{1,2} \w{3} 2026 · (Sources?: ClinicalTrials\.gov( \+ [\w ]+)*|Confirmed by Drugs@FDA( \+ \w+)+)$/.test(t)), "news: every live story shows the date and its sources (" + tops.slice(0, 2).join(" / ") + ")");
  check(rows[0].top === "13 Oct 2026 · Sources: ClinicalTrials.gov + PubMed + Europe PMC" && rows[0].badge === "Results posted" && rows[0].links.map((l) => l[0]).join("|") === "Official study record|Journal article on PubMed|Journal article on Europe PMC", "news: the newest story names both journal sources and links each");
  check(rows.some((r) => r.h3 === "Results posted for a study of Semaglutide for Obesity" && r.links[0][0] === "Read our plain-English summary" && r.links[0][1] === "#NCT03548935"), "news: a live story about a study in our library links to our plain-English summary");
  check(await p.evaluate(() => document.querySelector("#newsList .news-item .verdict").className.includes("v-early")), "news: 'Results posted' uses the existing grey style");
  check(await p.evaluate(() => LIVE.state === "on"), "news: the global Live badge is untouched");
  // hostile registry text stays text
  check((await p.evaluate(() => document.querySelectorAll("#newsList img, #newsList script, #newsList [onerror]").length)) === 0 && S.dialogs === 0 && rows.some((r) => r.text.includes("Funding <img src=x onerror=alert(1)> was withdrawn")), "news: markup in a registry reason is shown as text and nothing runs");
  // one request per feed, journal lookups only for what is shown, PubMed paced
  check(S.fk.count("ctgovResults") === 1 && S.fk.count("ctgovStopped") === 1 && S.fk.count("openfda") === 1 && S.fk.count("pubmed") === 8 && S.fk.count("epmc") === 8 && S.fk.count("rxnorm") >= 4 && S.fk.count("rxnorm") <= 12 && S.fk.count("dailymed") === 0 && S.savedFetches === 1, "news: one request per feed, journal lookups only for the 8 shown, RxNorm at most 12, DailyMed never from the browser, the saved copy once");
  const pm = await p.evaluate(() => window.__pm);
  check(pm.length === 8 && pm.slice(1).every((t, i) => t - pm[i] >= 400), "news: PubMed requests start at least 400 ms apart (the code aims for 450; the page records the moment each fetch was called, which jitters a few ms on a busy machine; the limit is 3 a second) (" + pm.slice(1).map((t, i) => t - pm[i]).join(",") + ")");
  const reqs = S.fk.calls.map((c) => c.url);
  check(reqs.every((u) => !/@/.test(u) && !/email/.test(u)) && S.fk.calls.filter((c) => c.source === "pubmed").every((c) => new URL(c.url).searchParams.get("tool") === "trialsignal"), "news: PubMed requests carry tool=trialsignal and no e-mail address");

  // the relative time ticks by itself, only while the page is looked at, and replaces just that text
  const checkedAt = await p.evaluate(() => NEWSLIVE.checkedAt);
  await p.evaluate(() => { window.__mut = 0; new MutationObserver((m) => { window.__mut += m.length; }).observe(document.querySelector("#newsList"), { childList: true, subtree: true, characterData: true }); });
  await p.clock.runFor(35 * 1000); await p.waitForTimeout(60);
  check((await p.textContent("#newsChecked")) === "just now", "news: under a minute it still says 'just now'");
  await p.clock.runFor(60 * 1000); await p.waitForTimeout(60);
  check((await p.textContent("#newsChecked")) === "1 min ago" && (await p.evaluate(() => window.__mut)) === 0, "news: after a minute it says '1 min ago' without redrawing the list");
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });   // as a real browser does: the registry poller stops its timer too
  await p.clock.runFor(3 * 60 * 1000); await p.waitForTimeout(60);
  check((await p.textContent("#newsChecked")) === "1 min ago", "news: a hidden tab does not tick");
  await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await p.clock.runFor(31 * 1000); await p.waitForTimeout(60);
  check(/^[2-9] min ago$/.test(await p.textContent("#newsChecked")) && checkedAt === (await p.evaluate(() => NEWSLIVE.checkedAt)), "news: back in view it catches up (" + (await p.textContent("#newsChecked")) + ")");

  // 60-second throttle: opening #news again within a minute asks for nothing
  await p.evaluate(() => { NEWSLIVE.lastStart = Date.now(); });
  let n0 = S.fk.calls.length;
  await p.evaluate(() => { location.hash = "#home"; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#news"; }); await p.waitForTimeout(300);
  check(S.fk.calls.length === n0 && await p.evaluate(() => !NEWSLIVE.busy), "news: reopening #news within 60 s makes no request");
  check(await p.evaluate(() => { const l = document.querySelector("#newsList .links a"); l.focus(); renderNews(); return document.activeElement === l; }), "news: redrawing an unchanged list leaves keyboard focus where it was");
  // after 61 s: a refresh runs, but everything is cached for 24 h, so nothing is asked again
  await p.evaluate(() => { location.hash = "#home"; });
  await p.clock.runFor(61 * 1000);
  const started = await p.evaluate(() => NEWSLIVE.lastStart);
  await p.evaluate(() => { location.hash = "#news"; }); await settle(p);
  check((await p.evaluate(() => NEWSLIVE.lastStart)) > started && S.fk.calls.length === n0, "news: after 61 s a refresh runs, and every answer comes from the 24 h cache (no request)");

  // the registry moves while #news is open: refetch at once (the cache was tied to the old version)
  n0 = S.fk.calls.length;
  S.reg.bump();
  await p.clock.runFor(7 * MIN);
  await waitFor(() => S.fk.count("ctgovResults") === 2 && S.fk.count("ctgovStopped") === 2, "the refetch after the registry moved");
  await settle(p);
  check(S.fk.calls.length - n0 === 2 && S.fk.count("openfda") === 1 && S.fk.count("pubmed") === 8, "news: a new registry version refetches the two registry lists immediately; FDA and journal answers (24 h cache) are reused");
  // ...and while #news is closed: stale, refetched when it is next opened
  await p.evaluate(() => { location.hash = "#home"; }); await p.waitForTimeout(100);
  n0 = S.fk.calls.length; S.reg.bump();
  await p.clock.runFor(7 * MIN); await p.waitForTimeout(300);
  check(S.fk.calls.length === n0 && (await p.evaluate(() => NEWSLIVE.stale)), "news: a registry change while #news is closed asks for nothing yet, it only marks the list stale");
  await p.evaluate(() => { location.hash = "#news"; }); await waitFor(() => S.fk.count("ctgovResults") === 3, "the refetch on the next open"); await settle(p);
  check(S.fk.count("ctgovStopped") === 3 && !(await p.evaluate(() => NEWSLIVE.stale)), "news: ...and opening #news fetches the new lists");

  // 24 h cache survives a reload
  n0 = S.fk.calls.length;
  await p.reload(); await settle(p);
  check(S.fk.calls.length === n0 && (await rowsOf(p)).length === 14 + 18, "news: after a reload the lookups come from the 24 h cache: no request to any source");
  check((await introOf(p)) === INTRO_HEAD + LIVE_SENTENCE("just now"), "news: a fully cached run still names the sources that answered (the cache counts as an answer)");
  const cached = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ts_news_v1"))).sort());
  check(cached.filter((k) => k.startsWith("pm:")).length === 8 && cached.filter((k) => k.startsWith("ep:")).length === 8 && cached.some((k) => k.startsWith("fda:")) && cached.some((k) => k.startsWith("rx:")) && cached.length <= 150, "news: lookups are cached in their own localStorage key");
  await S.ctx.close();
}

/* ---- 17. each source down on its own ---- */
for (const [label, opt, partial, src, check2] of [
  ["ClinicalTrials.gov results list", { down: { ctgovResults: true } }, "saved", { cross: "RxNorm" }, (rows) => rows.some((r) => r.h3.includes("Saved Results Condition"))],
  ["ClinicalTrials.gov stopped list", { down: { ctgovStopped: "500" } }, "saved", {}, (rows) => rows.some((r) => r.h3.includes("Saved Stopped Condition"))],
  ["both ClinicalTrials.gov lists", { down: { ctgovResults: true, ctgovStopped: true } }, "saved", { primary: "FDA", cross: "RxNorm" }, (rows) => rows.filter((r) => r.top.includes("Confirmed by")).length === 5],
  ["openFDA", { down: { openfda: true } }, "saved", { primary: "ClinicalTrials.gov", cross: "PubMed and Europe PMC" }, (rows) => rows.some((r) => r.h3 === "FDA approved Savedx (savedine)")],
  ["RxNorm", { down: { rxnorm: true } }, "live", { cross: "PubMed and Europe PMC" }, (rows) => rows.filter((r) => r.top.includes("Confirmed by")).length === 3 && rows.filter((r) => r.top.includes("Confirmed by")).every((r) => r.top.endsWith("Confirmed by Drugs@FDA + DailyMed"))],
  ["PubMed", { down: { pubmed: true } }, "live", { cross: "Europe PMC and RxNorm" }, (rows) => rows.filter((r) => /Sources?: ClinicalTrials/.test(r.top)).every((r) => !r.top.includes("PubMed")) && rows.some((r) => r.top.endsWith("+ Europe PMC"))],
  ["PubMed (rate limited: a 429 with no CORS header)", { down: { pubmed: "429" } }, "live", { cross: "Europe PMC and RxNorm" }, (rows) => rows.filter((r) => /Sources?: ClinicalTrials/.test(r.top)).every((r) => !r.top.includes("PubMed"))],
  ["Europe PMC", { down: { epmc: true } }, "live", { cross: "PubMed and RxNorm" }, (rows) => rows.filter((r) => /Sources?: ClinicalTrials/.test(r.top)).every((r) => !r.top.includes("Europe PMC")) && rows.some((r) => r.top.endsWith("+ PubMed"))],
  ["PubMed and Europe PMC", { down: { pubmed: true, epmc: true } }, "live", { cross: "RxNorm" }, (rows) => rows.filter((r) => r.badge.startsWith("Results posted")).length === 8 && rows.filter((r) => r.badge.startsWith("Results posted")).every((r) => r.badge === "Results posted" && r.top.endsWith("· Source: ClinicalTrials.gov") && r.text.includes(" We couldn’t search for a journal article just now.") && !/not checked|Our search/.test(r.text))],
  ["the saved copy (news.json missing)", { saved: false }, "live", { cross: "PubMed, Europe PMC and RxNorm" }, (rows) => rows.filter((r) => r.top.includes("Confirmed by")).every((r) => r.top.includes("RxNorm"))],
  ["the saved copy and the stopped list", { saved: false, down: { ctgovStopped: true } }, "missing", { cross: "PubMed, Europe PMC and RxNorm" }, (rows) => !rows.some((r) => r.top.startsWith("Registry record updated"))],
]) {
  const S = await newsScenario(opt);
  const p = await S.open("#news");
  await settle(p);
  const exp = await expectedNews(opt), rows = await rowsOf(p), d = diffNews(rows, exp.items);
  check(d.length === 0, `news: ${label} down: the page shows what the rules give with that source down ${d.slice(0, 2).join(" || ")}`);
  check(check2(rows), `news: ${label} down: the expected stories, labelled honestly`);
  const intro = await introOf(p);
  const note = partial === "saved" ? ` Some stories below come from the saved copy from ${SAVED_FROM}, because a source didn’t answer.` : partial === "missing" ? " A source didn’t answer, so some stories may be missing." : "";
  const want = INTRO_HEAD + LIVE_SENTENCE("just now", { ...src, note });
  check(intro === want, `news: ${label} down: the intro names only the sources that answered, and says which part is from the saved copy (${JSON.stringify(intro.slice(INTRO_HEAD.length))})`);
  check(await p.evaluate(() => LIVE.state === "on"), `news: ${label} down: the global Live badge is untouched`);
  if (label === "RxNorm") check(!intro.includes("DailyMed") && (await rowsOf(p)).filter((r) => r.top.includes("Confirmed by")).length === 3 && (await rowsOf(p)).filter((r) => r.top.includes("Confirmed by")).every((r) => r.top.endsWith("Confirmed by Drugs@FDA + DailyMed")), "news: RxNorm down: the intro never names DailyMed, yet each approval it confirmed still ends 'Confirmed by Drugs@FDA + DailyMed'");
  if (label === "PubMed") check(S.fk.count("pubmed") <= 5, "news: a failing lookup source is not asked again for every study in the same refresh (" + S.fk.count("pubmed") + " requests)");
  await S.ctx.close();
}

/* ---- 18. nothing live answers, or live is not possible: the saved copy ---- */
{
  const down = { ctgovResults: true, ctgovStopped: true, openfda: true, pubmed: true, epmc: true, rxnorm: true };
  let S = await newsScenario({ down });
  let p = await S.open("#news"); await settle(p);
  let exp = await expectedNews({ down }), rows = await rowsOf(p);
  check(diffNews(rows, exp.items).length === 0 && rows.length === 14 + 3, "news: everything down: the hand-picked stories plus the saved copy");
  check((await introOf(p)) === INTRO_HEAD + `Live updates are paused, so you’re seeing the saved copy from ${SAVED_FROM}.`, "news: everything down: 'Live updates are paused, so you’re seeing the saved copy from 13 Oct 2026.'");
  check(!(await p.textContent("[data-view=news]")).includes("Checked"), "news: everything down: no 'Checked …' claim");
  check(await p.evaluate(() => LIVE.state === "on"), "news: everything down: the registry itself is fine, so the Live badge says so");
  await S.ctx.close();

  S = await newsScenario({ down, saved: false });
  p = await S.open("#news"); await settle(p);
  rows = await rowsOf(p);
  check(rows.length === 14 && (await introOf(p)) === INTRO_HEAD + "Live updates are paused, so you’re seeing only the stories picked by hand.", "news: everything down and no saved copy: only the hand-picked stories, and it says so");
  await S.ctx.close();

  // the registry is unreachable at load: not live at all, no request to any news source, the saved copy
  S = await newsScenario({ registryUp: false });
  p = await S.open("#news"); await settle(p);
  rows = await rowsOf(p);
  check(S.fk.calls.length === 0 && rows.length === 14 + 3 && (await introOf(p)) === INTRO_HEAD + `Live updates are paused, so you’re seeing the saved copy from ${SAVED_FROM}.`, "news: not in live mode: no request to any news source, the saved copy and the paused sentence");
  check((await p.evaluate(() => LIVE.state)) === "none", "news: (the registry is down, so the page itself is in 'saved copy' mode)");
  S.registryUp = true;
  await p.clock.runFor(61 * 1000);   // the poller's re-probe succeeds: live starts, and #news (open) fetches
  await p.waitForFunction(() => LIVE.state === "on", null, { timeout: 8000 }); await settle(p);
  check((await p.evaluate(() => NEWSLIVE.status)) === "live" && (await rowsOf(p)).length === 14 + 18, "news: when the registry comes back while #news is open, it goes live by itself");
  await S.ctx.close();
}

/* ---- 19. one failed list does not swap fresh stories for an older saved copy ---- */
{
  const S = await newsScenario();
  const p = await S.open("#news"); await settle(p);
  const h3s = async () => (await rowsOf(p)).filter((r) => r.badge.startsWith("Results posted")).map((r) => r.h3);
  const before = await h3s();
  check(before.length === 8 && !before.some((h) => h.includes("Saved Results Condition")), "news: (setup) eight live results on screen");
  S.fk.down.ctgovResults = "500";
  S.reg.bump();                                    // as when the registry moves: the registry lists are asked again, the results feed fails
  await p.clock.runFor(7 * MIN);
  await waitFor(() => S.fk.count("ctgovResults") >= 2 && S.fk.count("ctgovStopped") >= 2, "the refetch after the registry moved");
  await settle(p);
  const after = await h3s();
  check(JSON.stringify(after) === JSON.stringify(before) && (await p.evaluate(() => NEWSLIVE.status === "live" && NEWSLIVE.liveFrom.results === "live" && NEWSLIVE.liveFrom.stopped === "live")), "news: a results feed that fails on a later refresh keeps the eight live stories already drawn");
  const intro = await introOf(p);
  check(!intro.includes("saved copy") && /\nChecked \d+ min ago\.$/.test(intro), "news: ...with no saved-copy sentence, and 'Checked' shows the OLDEST answer on screen (" + intro.slice(-26).replace("\n", "|") + ")");
  // the same failure after the live results are a day old: now they are not shown any more, the saved copy takes over and says so
  await p.evaluate(() => { NEWSLIVE.liveAt.results = Date.now() - 25 * 3600 * 1000; NEWSLIVE.lastStart = 0; newsRefresh(); });
  await settle(p);
  const later = await h3s();
  check(later.length === 1 && later[0].includes("Saved Results Condition") && (await p.evaluate(() => NEWSLIVE.status === "partial" && NEWSLIVE.liveFrom.results === "saved")), "news: live results older than a day are not kept; the saved copy is shown for that list");
  check((await introOf(p)).includes(`Some stories below come from the saved copy from ${SAVED_FROM}, because a source didn’t answer.`), "news: ...and the intro says so");
  await S.ctx.close();
}

/* ---- 20. storage that refuses everything must not cost the page its answers ---- */
{
  const S = await newsScenario();
  await S.ctx.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } }); });
  const p = await S.open("#news"); await settle(p);
  const n0 = S.fk.calls.length;
  check(n0 > 0 && (await rowsOf(p)).length === 14 + 18 && (await p.evaluate(() => NEWSLIVE.status)) === "live", "news: with localStorage blocked the page still goes live (" + n0 + " requests)");
  await p.evaluate(() => { NEWSLIVE.lastStart = 0; newsRefresh(); });
  await settle(p); await p.waitForTimeout(100);
  check(S.fk.calls.length === n0, "news: ...and a second refresh in the same page view makes no request at all (registry lists, openFDA, RxNorm, PubMed and Europe PMC come from memory) " + (S.fk.calls.length - n0));
  check((await p.evaluate(() => Object.keys(newsLsMem || {}).length)) >= 20, "news: the in-memory cache was not shrunk by the failing writes");
  await S.ctx.close();
}
{
  // a quota error on every write: the same promise
  const S = await newsScenario();
  await S.ctx.addInitScript(() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).startsWith("ts_news")) throw new DOMException("quota", "QuotaExceededError"); return orig.call(this, k, v); }; });
  const p = await S.open("#news"); await settle(p);
  const n0 = S.fk.calls.length;
  await p.evaluate(() => { NEWSLIVE.lastStart = 0; newsRefresh(); });
  await settle(p); await p.waitForTimeout(100);
  check(S.fk.calls.length === n0, "news: a full localStorage (every write refused) does not make the next refresh ask again " + (S.fk.calls.length - n0));
  await S.ctx.close();
}

/* ---- 21. openFDA's two kinds of 404 ---- */
{
  let S = await newsScenario({ spec: { ...world(), fda: [] } });   // the fake answers like openFDA: 404 with error.code NOT_FOUND
  let p = await S.open("#news"); await settle(p);
  let rows = await rowsOf(p);
  check((await p.evaluate(() => NEWSLIVE.status)) === "live" && !rows.some((r) => r.top.includes("Confirmed by")), "news: openFDA's own 'No matches found' 404 is an empty answer: live, no approvals, no saved copy needed");
  check(!(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ts_news_v1"))))).some((k) => k.startsWith("fda:")), "news: ...and the empty list is not cached");
  await S.ctx.close();
  S = await newsScenario({ down: { openfda: "404" } });          // a 404 from anything else (a proxy, a moved URL)
  p = await S.open("#news"); await settle(p);
  rows = await rowsOf(p);
  check((await p.evaluate(() => NEWSLIVE.status)) === "partial" && rows.some((r) => r.h3 === "FDA approved Savedx (savedine)"), "news: any other 404 from openFDA is a failure: the saved copy fills in the approvals");
  check((await introOf(p)).includes(`Some stories below come from the saved copy from ${SAVED_FROM}`), "news: ...and the intro says so");
  await S.ctx.close();
}

/* ---- 22. the ticking time never moves the list ---- */
{
  const S = await newsScenario();
  const p = await S.open("#news"); await settle(p);
  const texts = ["just now", ...Array.from({ length: 59 }, (_, i) => `${i + 1} min ago`), ...Array.from({ length: 23 }, (_, i) => `${i + 1} h ago`)];
  for (const w of [320, 360, 375, 390, 414]) {
    await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(80);
    const shifts = await p.evaluate((texts) => {
      const el = document.querySelector("#newsChecked"), list = document.querySelector("#newsList"), first = list.getBoundingClientRect().top, bad = [];
      for (const t of texts) { el.textContent = t; const d = Math.round(list.getBoundingClientRect().top - first); if (d) bad.push(t + ":" + d); }
      el.textContent = "just now";
      return bad;
    }, texts);
    check(shifts.length === 0, `news: at ${w}px none of the ${texts.length} possible 'Checked ... ago' texts moves the list (${shifts.slice(0, 3).join(", ")})`);
  }
  check((await p.evaluate(() => document.querySelectorAll('[data-view="news"] [aria-live]').length)) === 0, "news: still no aria-live");
  await S.ctx.close();
}

/* ---- 23. long unbroken text in a registry record never makes the page scroll sideways ---- */
{
  const w = world(), LONG = "https://example.org/" + "x".repeat(110);
  w.stopped[1] = regStudy({ nct: "NCT20000002", status: "WITHDRAWN", whyStopped: "See " + LONG + " for the full notice", updated: "2026-10-12", enrollment: 0, interventions: [["Drug: " + "Polyethylene".repeat(7), "DRUG"]], conditions: ["Hyper" + "tension".repeat(12)], sponsor: "Mega" + "pharma".repeat(14) + " Inc", cd: "2028-01", cdType: "ESTIMATED" });
  w.stopped[2] = regStudy({ nct: "NCT20000003", status: "SUSPENDED", whyStopped: "Paused: " + "A".repeat(150), updated: "2026-10-11", interventions: [["B".repeat(70), "DRUG"]], conditions: ["C".repeat(90)], cd: "2027-08", cdType: "ESTIMATED" });
  w.results[1] = regStudy({ nct: "NCT10000002", resultsDate: "2026-10-12", enrollment: 900, interventions: [["Itepekimab".repeat(8), "BIOLOGICAL"]], conditions: ["Chronic" + "Obstructive".repeat(9)], sponsor: "Sanofi" + "X".repeat(70) });
  const S = await newsScenario({ spec: w, viewport: { width: 390, height: 844 } });
  const p = await S.open("#news"); await settle(p);
  for (const width of [390, 320]) {
    await p.setViewportSize({ width, height: 800 }); await p.waitForTimeout(100);
    const r = await p.evaluate(() => ({ doc: [document.documentElement.scrollWidth, innerWidth], wide: [...document.querySelectorAll("#newsList .news-item")].filter((a) => a.scrollWidth > a.clientWidth).map((a) => a.querySelector("h3").textContent.slice(0, 40)), long: document.querySelector("#newsList").textContent.includes("x".repeat(110)) && document.querySelector("#newsList").textContent.includes("A".repeat(150)) }));
    check(r.long, `news: (setup, ${width}px) the long tokens are really on the page`);
    check(r.doc[0] <= r.doc[1] && r.wide.length === 0, `news: ${width}px with a 110-character URL and very long drug, condition and sponsor names: no sideways scroll (document ${r.doc.join("/")}, cards wider than themselves: ${r.wide.join("; ") || "none"})`);
  }
  check((await p.evaluate(() => document.querySelectorAll("#newsList wbr").length)) > 5, "news: break points exist inside the long live text");
  check((await p.evaluate(() => [...document.querySelectorAll("#newsList .news-item")].filter((a) => a.textContent.includes("Picked by hand")).every((a) => a.querySelectorAll("wbr").length === 0))), "news: hand-picked stories are drawn exactly as before (no break points)");
  await S.ctx.close();
}

check(errors.length === 0, "no page errors " + errors.join("|"));
await b.close(); site.close();
console.log("PAGES-ONLY E2E PASS");
