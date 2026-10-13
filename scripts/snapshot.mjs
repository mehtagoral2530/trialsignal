// Static snapshot job (runs in GitHub Actions on a schedule). Zero dependencies.
// Writes site/data/{snapshot,changes,index}.json so GitHub Pages keeps working even if the Worker
// or Redis is down. Idempotent: if no tracked state changed, nothing is written (and nothing deploys).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { trackedState, stateHash, summarize, lastUpdate, canonical, sha256Hex, TRACKED_FIELDS } from "../shared/core.js";
import { CURATED, TOPICS } from "../shared/curated.js";
import { SEED_DOCS } from "../shared/index-seed.js";

const CT = "https://clinicaltrials.gov/api/v2/";
const CHANGES_CAP = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctGet(path, params, fetchImpl, { retries = 3, pauseMs = 1000 } = {}) {
  const url = `${CT}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "TrialSignal-snapshot/2.0" } });
    if (res.ok) { if (pauseMs) await sleep(pauseMs); return res.json(); }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(pauseMs * 2 ** (attempt + 1) + Math.random() * 500); continue; }
    throw new Error(`ClinicalTrials.gov ${res.status} for ${path}`);
  }
}
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1) + "\n");

export async function runSnapshot({ dataDir, fetchImpl = (...a) => fetch(...a), now = new Date(), pauseMs = 1000 } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const prev = readJson(`${dataDir}/snapshot.json`, { studies: {}, contentHash: null });
  const prevChanges = readJson(`${dataDir}/changes.json`, { seq: 0, entries: [] });

  const studies = new Map();
  // 1) curated studies in one batch request
  const cur = await ctGet("studies", { "filter.ids": CURATED.join(","), fields: TRACKED_FIELDS + ",BriefSummary", pageSize: 100, format: "json" }, fetchImpl, { pauseMs });
  for (const s of cur.studies || []) studies.set(s.protocolSection.identificationModule.nctId, s);
  // 2) topic queries: recently updated phase 2/3 interventional studies (for search + "recently changed")
  const since = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const topicIds = {};
  for (const t of TOPICS) {
    const j = await ctGet("studies", {
      "query.term": t.q, pageSize: 20, format: "json", sort: "LastUpdatePostDate:desc", fields: TRACKED_FIELDS + ",BriefSummary",
      "filter.advanced": `AREA[LastUpdatePostDate]RANGE[${since},MAX] AND AREA[StudyType]INTERVENTIONAL AND (AREA[Phase]PHASE2 OR AREA[Phase]PHASE3)`,
    }, fetchImpl, { pauseMs });
    topicIds[t.id] = (j.studies || []).map((s) => s.protocolSection.identificationModule.nctId);
    for (const s of j.studies || []) studies.set(s.protocolSection.identificationModule.nctId, s);
  }

  // Tracked state per study, sorted for determinism.
  const next = {};
  for (const id of [...studies.keys()].sort()) {
    const s = studies.get(id), state = trackedState(s), sum = summarize(s);
    next[id] = { hash: await stateHash(state), lup: lastUpdate(s), ...state, title: sum.title, acronym: sum.acronym, phase: sum.phase, curated: CURATED.includes(id) };
  }
  const contentHash = (await sha256Hex(canonical({ next, topicIds }))).slice(0, 32);
  if (contentHash === prev.contentHash) return { changed: false, contentHash, studies: Object.keys(next).length };

  // Diff (only studies present in both runs can "change"; new ones just join the baseline).
  let seq = prevChanges.seq || 0;
  const fresh = [];
  for (const [id, n] of Object.entries(next)) {
    const p = prev.studies?.[id];
    if (!p || p.hash === n.hash) continue;
    if (p.lup && n.lup && n.lup < p.lup) continue; // never roll back
    const fields = ["status", "start", "pcd", "cd", "enroll", "enrollType"].filter((f) => String(p[f]) !== String(n[f]));
    fresh.push({ seq: ++seq, nct: id, hash: n.hash, prev: p.hash, lup: n.lup, at: now.toISOString(), fields, state: { status: n.status, start: n.start, pcd: n.pcd, cd: n.cd, enroll: n.enroll, enrollType: n.enrollType } });
  }
  const changes = { seq, entries: [...prevChanges.entries, ...fresh].slice(-CHANGES_CAP) };

  // Search index: bundled curated docs + everything fetched this run.
  const docs = new Map(SEED_DOCS.map((d) => [d.nct, d]));
  for (const [id, s] of studies) docs.set(id, { ...docs.get(id), ...summarize(s) });
  const index = { generatedAt: now.toISOString(), docs: [...docs.values()].sort((a, b) => (a.nct < b.nct ? -1 : 1)) };

  writeJson(`${dataDir}/snapshot.json`, { version: 1, generatedAt: now.toISOString(), contentHash, topics: topicIds, studies: next });
  writeJson(`${dataDir}/changes.json`, changes);
  writeJson(`${dataDir}/index.json`, index);
  return { changed: true, contentHash, studies: Object.keys(next).length, newChanges: fresh.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = new URL("../site/data", import.meta.url).pathname;
  runSnapshot({ dataDir }).then((r) => { console.log(JSON.stringify(r)); if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${r.changed}\n`, { flag: "a" }); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
