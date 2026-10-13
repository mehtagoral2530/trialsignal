// End-to-end: built site (static server) + Worker handler (Node HTTP) + real Redis + fake registry.
// Verifies: search via API, study page via API, Save -> POST /v1/watch (idempotent), cron poll detects
// a status change, and the browser's change-feed poll surfaces it. Run: node test/e2e/run.mjs
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { startRedis } from "../helpers/redis.mjs";
import { study, fakeRegistry } from "../helpers/fixtures.mjs";
import { handle } from "../../worker/src/index.js";
import { poll, SLOT_MS } from "../../worker/src/poll.js";
import { CURATED } from "../../shared/curated.js";
const require = createRequire(import.meta.url);
const { chromium } = require(execSync("npm root -g").toString().trim() + "/playwright");

const R = await startRedis(); if (!R) { console.log("SKIP: no redis"); process.exit(0); }
const reg = fakeRegistry([...CURATED.map((id) => study({ id, status: "RECRUITING", lup: "2026-09-01" })), study({ id: "NCT55555555", title: "Etentamig for multiple myeloma", conditions: ["Multiple Myeloma"], interventions: ["Etentamig"] })]);
const api = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const r = await handle(new Request("http://x" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : body }), { ALLOWED_ORIGIN: "*" }, {}, { redis: R.client, fetchImpl: reg.fetchImpl });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(r.status === 304 || r.status === 204 ? undefined : Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiBase = `http://127.0.0.1:${api.address().port}`;
execSync(`node scripts/build-site.mjs`, { env: { ...process.env, TS_API_BASE: apiBase } });
const root = new URL("../../site/", import.meta.url).pathname;
const types = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", woff2: "font/woff2" };
const site = http.createServer((req, res) => { const p = root + (req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0].slice(1)); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": types[p.split(".").pop()] || "application/octet-stream" }); res.end(readFileSync(p)); });
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const siteBase = `http://127.0.0.1:${site.address().port}`;

let t = Date.now();
await poll({ redis: R.client, fetchImpl: reg.fetchImpl, scheduledTime: t, now: t }); // baseline

const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const check = (c, m) => { if (!c) { throw new Error("FAIL: " + m); } console.log("ok -", m); };

await page.goto(siteBase + "/#home"); await page.waitForTimeout(800);
await page.fill("#searchInput", "myeloma"); await page.click("#searchForm .btn"); await page.waitForTimeout(800);
check((await page.textContent("#studyList")).includes("Etentamig"), "live search through the API returns a registry study");
await page.goto(siteBase + "/#NCT03548935"); await page.waitForTimeout(800);
check((await page.textContent("#trialOut")).includes("Status is live"), "study page loads live status via the API");
await page.click("#saveBtn"); await page.waitForTimeout(600);
check(Number(await R.client.cmd("ZCARD", "ts:v1:watch")) === 1, "Save registered the study for server polling (POST /v1/watch)");
check((await page.evaluate(() => (JSON.parse(localStorage.getItem("ts_watch_pending")) || []).length)) === 0, "pending idempotent request was acknowledged and cleared");

reg.set(study({ id: "NCT03548935", status: "COMPLETED", lup: "2026-10-05" }));
t += SLOT_MS; await poll({ redis: R.client, fetchImpl: reg.fetchImpl, scheduledTime: t, now: t });
await page.evaluate(() => pollChanges()); await page.waitForTimeout(800);
const toast = await page.textContent("#toast");
check(/update/i.test(toast || ""), `browser change-feed poll surfaced the change (toast: "${toast}")`);
await page.click("#savedBtn"); await page.waitForTimeout(300);
check((await page.textContent("#savedList")).includes("Finished"), "Saved drawer shows the new status");
await page.screenshot({ path: "test/e2e/saved-update.png" });
check(errors.length === 0, "no page errors " + errors.join("|"));
await b.close(); api.close(); site.close(); await R.close();
execSync(`node scripts/build-site.mjs`); // restore a build without the dev API base
console.log("E2E PASS");
