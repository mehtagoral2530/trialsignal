// Saved copy of the live "What's new" page: site/data/news.json. Runs in GitHub Actions after the study snapshot.
// It uses the same rules as the browser (shared/news.js) and adds the one check a browser cannot make: DailyMed sends no
// CORS header, so only this job can ask it whether a label exists for each FDA application. The answers are saved in
// news.json (`dailymed`) and the browser uses them as the second source for approvals.
//
// Guards, in order:
//   1. Gate: one tiny openFDA request (limit=1) reads meta.last_updated. Rebuild only if there is no previous file, the
//      registry's dataTimestamp moved, openFDA's last_updated moved, the file is older than 24 h, or `force`.
//   2. Failures: if a registry feed or openFDA fails, the previous file stays (a half-empty saved copy is worse than an old one).
//      A single journal / RxNorm / DailyMed lookup that still fails after retries only drops that item. A source that keeps failing
//      is left alone for the rest of the run (DailyMed after two lookups in a row).
//   3. Deadline: the whole news step stops after 4 minutes (DEADLINE_MS). Every request is bounded by the time left, retries and
//      pauses past the deadline are skipped, and the previous file stays. The caller (snapshot.mjs) adds a second, outer limit.
//   4. Content hash: when only the clock changed, the file is re-stamped (committed, not deployed).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { canonical, sha256Hex } from "../shared/core.js";
import { NEWS_HOSTS, NEWS_WINDOWS, newsRun, newsFdaParams, newsUrl, newsHandItems, newsHandLevel, newsMerge } from "../shared/news.js";
import { loadNewsData } from "./lib-appdata.mjs";

const HEADERS = { accept: "application/json", "user-agent": "TrialSignal-news/1.0 (+https://github.com/mehtagoral2530/trialsignal)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p, fallback) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback; } catch { return fallback; } };
const DAY = 864e5;
// Polite gaps between requests to the same service (PubMed allows 3 per second without a key).
const GAP_MS = { pubmed: 500, dailymed: 700, rxnorm: 150, epmc: 150 };
export const DEADLINE_MS = 4 * 60 * 1000;

/**
 * The Node side of newsRun(): paced, with up to 3 retries on 429, 5xx and network errors (honouring retry-after), and a deadline.
 * Once `deadlineMs` have passed since this was made, every call throws "news deadline"; before that, each attempt's timeout is cut to
 * the time left and a pause that would run past the deadline is not taken. io.expired() says whether the deadline has passed.
 */
export function makeIo(fetchImpl, pauseMs, { deadlineMs = DEADLINE_MS } = {}) {
  const last = {}, deadline = Date.now() + deadlineMs;
  const left = () => deadline - Date.now();
  const expired = () => left() <= 0;
  const gap = (source) => (pauseMs === undefined ? GAP_MS[source] || 0 : pauseMs);
  const late = () => Object.assign(new Error("news deadline"), { deadline: true });
  async function fetchJson(source, url, { timeoutMs = 15000 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const wait = (last[source] || 0) + gap(source) - Date.now();
      if (wait > 0) { if (wait >= left()) throw late(); await sleep(wait); }
      if (expired()) throw late();
      last[source] = Date.now();
      let retryAfterMs = 0;
      try {
        const res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, left()))) });
        if (res.ok) return await res.json();
        let code;
        try { const c = ((await res.json()) || {}).error; if (c && typeof c.code === "string" && /^[A-Z_]{1,40}$/.test(c.code)) code = c.code; } catch { /* no JSON body */ }   // openFDA's own "no matches" 404 says NOT_FOUND
        const err = Object.assign(new Error(`${source} ${res.status}`), { status: res.status }, code ? { code } : {});
        const ra = Number(res.headers && res.headers.get && res.headers.get("retry-after"));
        if (ra > 0) retryAfterMs = Math.min(ra * 1000, 30_000);
        if (!((res.status === 429 || res.status >= 500) && attempt < 3)) throw err;
      } catch (e) {
        if (e && e.status && !(e.status === 429 || e.status >= 500)) throw e;   // 404 and friends: an answer, not an outage
        if (e && e.deadline) throw e;
        if (expired()) throw late();
        if (attempt >= 3) throw e;
      }
      const nap = pauseMs === 0 ? 0 : Math.max(retryAfterMs, 1000 * 2 ** attempt);
      if (nap >= left()) throw late();
      await sleep(nap);
    }
  }
  return { fetchJson, sleep, expired };
}

/**
 * @returns {Promise<{changed: boolean, stamped?: boolean, reason?: string}>}
 *   changed=true  : news.json has new content, so commit and deploy.
 *   stamped=true  : same content, only the clock / source timestamps moved: commit, nothing to deploy.
 */
export async function runNewsSnapshot({ dataDir, fetchImpl = (...a) => fetch(...a), now = new Date(), pauseMs, dataTimestamp = null, force = false, hand, deadlineMs } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = `${dataDir}/news.json`, prev = readJson(file, null), nowMs = now.getTime();
  const io = makeIo(fetchImpl, pauseMs, deadlineMs === undefined ? {} : { deadlineMs });

  // 1) gate
  let fdaUpdated = null;
  try {
    const j = await io.fetchJson("openfda", newsUrl(NEWS_HOSTS.fda, newsFdaParams(nowMs, 0, 1)), { timeoutMs: 15000 });
    fdaUpdated = (j && j.meta && typeof j.meta.last_updated === "string" && j.meta.last_updated) || null;
  } catch (e) {
    if (!(e && e.status === 404 && e.code === "NOT_FOUND")) return { changed: false, reason: e && e.deadline ? "deadline" : "source-failed" };   // openFDA is down (a bare 404 counts as down): nothing to compare, nothing to rebuild with
  }
  const age = prev && prev.generatedAt ? nowMs - Date.parse(prev.generatedAt) : Infinity;
  if (!force && prev && prev.version === 1 && prev.dataTimestamp === dataTimestamp && prev.fdaUpdated === fdaUpdated && age >= 0 && age < DAY) return { changed: false, reason: "news-unchanged" };

  // 2) rebuild with the shared rules
  const data = hand ? null : loadNewsData();
  const handItems = hand || newsHandItems(data.NEWS, data.NEWS_PLAIN, newsHandLevel);
  const r = await newsRun(io, { nowMs, hand: handItems, concurrency: 1, dailymedAll: true, dropUnknown: true });
  if (io.expired()) return { changed: false, reason: "deadline" };   // whatever was gathered may be short: keep the previous file
  if (r.failedKinds.length) return { changed: false, reason: "source-failed" };

  // 3) write
  const items = newsMerge({ hand: [], ...r.live, nowMs });
  const dailymed = r.dailymed;
  const contentHash = (await sha256Hex(canonical({ items, dailymed }))).slice(0, 32);
  const doc = { version: 1, generatedAt: now.toISOString(), dataTimestamp, fdaUpdated, windows: { registryDays: NEWS_WINDOWS.registryDays, fdaDays: NEWS_WINDOWS.fdaDays }, contentHash, items, dailymed };
  const same = prev && prev.contentHash === contentHash;
  writeFileSync(file, JSON.stringify(doc, null, 1) + "\n");
  return same ? { changed: false, stamped: true, reason: "content-unchanged", items: items.length } : { changed: true, items: items.length, dailymed: Object.keys(dailymed).length };
}

/** The version the workflow calls: it can never fail the job, and (with the deadline above) cannot hold it up either. */
export async function runNewsStep(opts) {
  try { return await runNewsSnapshot(opts); }
  catch (e) { console.error(`news: skipped (${e && e.message})`); return { changed: false, stamped: false, reason: "error" }; }
}
