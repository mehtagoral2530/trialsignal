// End-to-end for the simplest deployment: GitHub Pages only (no Worker, no Redis).
// The built site is served under /trialsignal/ (like a GitHub project page) and the browser talks to
// ClinicalTrials.gov directly; the registry is faked with Playwright routing.
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

const reg = fakeRegistry([...CURATED.map((id) => study({ id, status: "RECRUITING" })), study({ id: "NCT55555555", title: "Etentamig for multiple myeloma", conditions: ["Multiple Myeloma"], interventions: ["Etentamig"] })]);
let registryUp = true;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("https://clinicaltrials.gov/api/v2/**", async (route) => {
  if (!registryUp) return route.abort("connectionfailed");
  const r = await reg.fetchImpl(route.request().url());
  route.fulfill({ status: r.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await r.text() });
});
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const check = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };

await page.goto(base + "#home"); await page.waitForTimeout(900);
await page.fill("#searchInput", "myeloma"); await page.click("#searchForm .btn"); await page.waitForTimeout(900);
check((await page.textContent("#studyList")).includes("Etentamig"), "search reaches ClinicalTrials.gov directly from the browser");
await page.goto(base + "#NCT03548935"); await page.waitForTimeout(900);
check((await page.textContent("#trialOut")).includes("Status is live"), "study page shows live registry status");
await page.click("#saveBtn"); await page.waitForTimeout(400);

reg.set(study({ id: "NCT03548935", status: "COMPLETED", lup: "2026-10-05" }));
await page.evaluate(() => refreshWatch(false)); await page.waitForTimeout(900);
await page.click("#savedBtn"); await page.waitForTimeout(300);
check((await page.textContent("#savedList")).includes("Finished"), "saved study picks up a registry change on the next check");
await page.keyboard.press("Escape");

registryUp = false;
const p2 = await ctx.newPage(); p2.on("pageerror", (e) => errors.push(e.message));
await p2.goto(base + "#NCT03548935"); await p2.waitForTimeout(1500);
check(!(await p2.textContent("#trialOut")).includes("Status is live") && (await p2.evaluate(() => LIVE.state)) === "none" && /saved copy/.test(await p2.evaluate(() => LIVE.msg)), "registry unreachable: no live claim, falls back to the saved copy");
check((await p2.textContent("#trialOut")).length > 200, "registry unreachable: the study page still renders from bundled data");
check(errors.length === 0, "no page errors " + errors.join("|"));
await b.close(); site.close();
console.log("PAGES-ONLY E2E PASS");
