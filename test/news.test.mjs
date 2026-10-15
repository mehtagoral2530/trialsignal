// Live "What's new": the rules (shared/news.js), the pipeline (newsRun), the saved copy (scripts/news-snapshot.mjs) and the build.
// Registry and openFDA replies in test/fixtures/news are real responses from 14 Oct 2026, trimmed. Variants the real feeds did not
// happen to contain are built with the helpers in test/helpers/news-fixtures.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, cpSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import * as N from "../shared/news.js";
import { runNewsSnapshot, runNewsStep, makeIo, DEADLINE_MS } from "../scripts/news-snapshot.mjs";
import { loadNewsData } from "../scripts/lib-appdata.mjs";
import { fixture, regStudy, fdaRecord, rxJson, fakeNews, world, NEWS_NOW, day } from "./helpers/news-fixtures.mjs";

const parse = (studies) => N.newsParseRegistry({ studies });
const one = (o) => parse([regStudy(o)])[0];
const FDA_WIN = N.newsFdaWindow(NEWS_NOW);
const cand = (o = {}) => ({ app: "NDA300001", date: "2026-09-25", cls: "TYPE 1", brand: "ALPHAXA", generics: ["alphaxine"], dosageForms: ["tablet"], ...o });
const dm = (title, setid = "11111111-2222-3333-4444-555555555555") => ({ setid, title });
const pmHit = { ok: true, n: 2, id: "41111111" }, none = { ok: true, n: 0, id: null };
const root = new URL("..", import.meta.url).pathname;

/* ================= requests ================= */
test("golden requests: registry results and stopped feeds (14 Oct 2026)", () => {
  assert.deepEqual(N.newsRegistryParams("results", NEWS_NOW), {
    format: "json", pageSize: "20", sort: "ResultsFirstPostDate:desc,EnrollmentCount:desc",
    fields: "NCTId,BriefTitle,OverallStatus,WhyStopped,Phase,LeadSponsorName,ResultsFirstPostDate,LastUpdatePostDate,PrimaryCompletionDate,CompletionDate,CompletionDateType,EnrollmentCount,EnrollmentType,Condition,InterventionName,InterventionType",
    "filter.advanced": "AREA[ResultsFirstPostDate]RANGE[2026-09-14,MAX] AND AREA[StudyType]INTERVENTIONAL AND AREA[Phase]PHASE3",
  });
  assert.deepEqual(N.newsRegistryParams("stopped", NEWS_NOW), {
    format: "json", pageSize: "25", sort: "LastUpdatePostDate:desc",
    fields: "NCTId,BriefTitle,OverallStatus,WhyStopped,Phase,LeadSponsorName,ResultsFirstPostDate,LastUpdatePostDate,PrimaryCompletionDate,CompletionDate,CompletionDateType,EnrollmentCount,EnrollmentType,Condition,InterventionName,InterventionType,StatusVerifiedDate",
    "filter.overallStatus": "TERMINATED,SUSPENDED,WITHDRAWN",
    "filter.advanced": "AREA[LastUpdatePostDate]RANGE[2026-09-14,MAX] AND AREA[StatusVerifiedDate]RANGE[2026-07,MAX] AND AREA[CompletionDate]RANGE[2026-04-15,MAX] AND AREA[StudyType]INTERVENTIONAL AND AREA[Phase]PHASE3 AND AREA[LeadSponsorClass]INDUSTRY",
  });
  assert.throws(() => N.newsRegistryParams("nope", NEWS_NOW));
});
test("golden requests: openFDA, RxNorm, PubMed, Europe PMC, DailyMed", () => {
  assert.deepEqual(N.newsFdaParams(NEWS_NOW, 200), { limit: "200", skip: "200",
    search: 'submissions.submission_type:"ORIG" AND submissions.submission_status:"AP" AND submissions.submission_status_date:[20260716 TO 20261014] AND ((application_number:NDA* AND (submissions.submission_class_code:"TYPE 1" OR submissions.submission_class_code:"TYPE 1/4" OR submissions.submission_class_code:"TYPE 2")) OR (application_number:BLA* AND (submissions.submission_class_code:"TYPE 1" OR submissions.submission_class_code:"TYPE 1/4")))' });
  assert.equal(N.newsFdaParams(NEWS_NOW, 0, 1).limit, "1");
  assert.deepEqual(N.newsRxnormParams("ETCAMAH"), { name: "ETCAMAH" });
  assert.deepEqual(N.newsPubmedParams("NCT05627557", "2025-09-04"), { db: "pubmed", term: "NCT05627557[si]", retmode: "json", retmax: "1", sort: "pub_date", tool: "trialsignal", datetype: "pdat", mindate: "2025/09/04", maxdate: "3000" });
  assert.equal(N.newsPubmedParams("NCT05627557", "2025-09").mindate, "2025/09", "a month-only floor works");
  assert.equal(N.newsPubmedParams("NCT05627557", null).mindate, undefined, "no floor when both dates are missing");
  assert.ok(!JSON.stringify(N.newsPubmedParams("NCT05627557", "2025-09-04")).includes("@"), "no e-mail address is ever sent: the tool name only");
  assert.deepEqual(N.newsEpmcParams("NCT05627557", "2025-09-04"), { format: "json", resultType: "lite", pageSize: "1", sort: "P_PDATE_D desc", query: 'TITLE_ABS:"NCT05627557" AND SRC:MED AND FIRST_PDATE:[2025-09-04 TO 3000-12-31]' });
  assert.equal(N.newsEpmcParams("NCT05627557", "2025-09").query, 'TITLE_ABS:"NCT05627557" AND SRC:MED AND FIRST_PDATE:[2025-09 TO 3000-12-31]');
  assert.equal(N.newsEpmcParams("NCT05627557", null).query, 'TITLE_ABS:"NCT05627557" AND SRC:MED');
  assert.deepEqual(N.newsDailymedParams("NDA220359"), { application_number: "NDA220359" });
  const u = new URL(N.newsUrl(N.NEWS_HOSTS.pubmed, N.newsPubmedParams("NCT05627557", "2025-09-04")));
  assert.equal(u.host, "eutils.ncbi.nlm.nih.gov"); assert.equal(u.searchParams.get("term"), "NCT05627557[si]");
});
test("CSP hosts: exactly the four browser hosts; DailyMed is absent because it sends no CORS header", () => {
  assert.deepEqual(N.NEWS_CONNECT_HOSTS, ["https://api.fda.gov", "https://eutils.ncbi.nlm.nih.gov", "https://www.ebi.ac.uk", "https://rxnav.nlm.nih.gov"]);
});

/* ================= dates ================= */
test("date helpers work on strings and never parse them as Date", () => {
  assert.equal(N.newsIso(NEWS_NOW), "2026-10-14");
  assert.equal(N.newsDaysAgo(NEWS_NOW, 30), "2026-09-14");
  assert.equal(N.newsMonthsAgo(NEWS_NOW, 3), "2026-07");
  assert.equal(N.newsMonthsAgo(Date.UTC(2026, 1, 10), 3), "2025-11", "across a year boundary");
  assert.equal(N.newsCompact("2026-09-25"), "20260925"); assert.equal(N.newsUncompact("20260925"), "2026-09-25"); assert.equal(N.newsUncompact("2026"), null);
  assert.equal(N.newsPubmedDate("2025-09-04"), "2025/09/04"); assert.equal(N.newsPubmedDate("2025-09"), "2025/09"); assert.equal(N.newsPubmedDate("2025"), null); assert.equal(N.newsPubmedDate("junk"), null); assert.equal(N.newsPubmedDate(undefined), null);
  assert.equal(N.newsEpmcDate("2025"), "2025"); assert.equal(N.newsEpmcDate("2025-09"), "2025-09"); assert.equal(N.newsEpmcDate("2025-9"), null);
  assert.equal(N.newsFmtDate("2026-08-27"), "27 Aug 2026"); assert.equal(N.newsFmtDate("2026-08"), "Aug 2026"); assert.equal(N.newsFmtDate("nope"), "");
});
test("quarter dates sort against ISO dates", () => {
  assert.equal(N.newsSortKey("2025-Q4"), "2025-12-31"); assert.equal(N.newsSortKey("2025-Q1"), "2025-03-31"); assert.equal(N.newsSortKey("2026-09-04"), "2026-09-04"); assert.equal(N.newsSortKey("2026-09"), "2026-09-31");
  assert.ok(N.newsSortKey("2025-Q4") > N.newsSortKey("2025-04-14") && N.newsSortKey("2025-Q4") < N.newsSortKey("2026-01-01"));
});

/* ================= registry normaliser ================= */
test("registry normaliser on real replies", () => {
  const r = N.newsParseRegistry(fixture("registry-results.json"));
  assert.deepEqual(r.map((s) => s.nct), ["NCT05627557", "NCT05139316", "NCT04751487", "NCT07136766"]);
  assert.deepEqual({ ...r[0], title: undefined }, { nct: "NCT05627557", title: undefined, status: "COMPLETED", sponsor: "Hoffmann-La Roche", phases: ["PHASE3"], enrollment: 85, enrollmentType: "ACTUAL",
    conditions: ["Childhood Idiopathic Nephrotic Syndrome"], drugs: ["Obinutuzumab", "MMF", "Prednisone", "Methylprednisolone", "Acetaminophen/ Paracetamol", "Diphenhydramine Hydrochloride"], whyStopped: "",
    resultsDate: "2026-10-14", updated: "2026-10-14", verified: null, pcd: "2025-09-04", completionDate: "2026-08-27", completionType: "ACTUAL", hasResultsDate: true });
  const s = N.newsParseRegistry(fixture("registry-stopped.json"));
  assert.equal(s.find((x) => x.nct === "NCT07223502").drugs[0], "FDC of spironolactone and ER torsemide", "the 'Combination Product:' prefix is dropped");
  assert.equal(s.find((x) => x.nct === "NCT07265479").drugs[0], "Tapinarof cream", "cut at the first comma");
  assert.equal(s.find((x) => x.nct === "NCT07625306").verified, "2026-10");
});
test("registry normaliser: only drug-like interventions, never placebo or comparators; bad shapes give null", () => {
  assert.deepEqual(one({ nct: "NCT10000001", interventions: [["Placebo", "DRUG"], ["Sham procedure", "PROCEDURE"], ["Biospecimen Collection", "OTHER"], ["Vehicle Cream", "DRUG"], ["Standard of care", "DRUG"], ["Control Arm (Conventional Therapy)", "DRUG"], ["Gene therapy X (high dose)", "GENETIC"], ["Zed, 10 mg", "DRUG"]] }).drugs, ["Gene therapy X", "Zed"]);
  assert.deepEqual(one({ nct: "NCT10000001", interventions: [["NoType"]] }).drugs, [], "an intervention without a type is not trusted");
  assert.equal(N.newsParseRegistry(null), null); assert.equal(N.newsParseRegistry({}), null); assert.equal(N.newsParseRegistry({ studies: "x" }), null);
  assert.deepEqual(N.newsParseRegistry({ studies: [] }), []);
  assert.deepEqual(N.newsParseRegistry({ studies: [{ protocolSection: { identificationModule: { nctId: "<script>" } } }, null, 5, {}] }), [], "invalid ids and shapes are skipped");
  assert.equal(one({ nct: "NCT10000001", pcd: null, cd: null }).pcd, null, "no primary and no completion date: no floor");
  assert.equal(one({ nct: "NCT10000001", pcd: "2026-03", cd: "2026-05-01" }).pcd, "2026-03");
});

/* ================= FDA filter ================= */
test("FDA filter on the real reply: own ORIG approval in the window, NDA type 1, 1/4, 2, BLA type 1, 1/4", () => {
  const r = N.newsParseFda(fixture("fda.json"), FDA_WIN);
  assert.equal(r.ok, true); assert.equal(r.lastUpdated, "2026-10-13"); assert.equal(r.total, 15);
  assert.deepEqual(r.candidates.map((c) => `${c.app} ${c.cls} ${c.brand}`), [
    "NDA220415 TYPE 1 JUVMO", "NDA221109 TYPE 2 LAMLIQUE", "BLA761408 TYPE 1 ONSWIK", "NDA220359 TYPE 1 ETCAMAH", "NDA220910 TYPE 1 RASONQUE", "BLA761508 TYPE 1 PASATRU", "NDA220381 TYPE 2 GLYCOPHOS", "BLA761320 TYPE 1/4 LYTENAVA"]);
  const apps = r.candidates.map((c) => c.app);
  for (const [app, why] of [["NDA220613", "NDA type 5"], ["NDA221104", "NDA type 4"], ["BLA761481", "BLA type 5"], ["BLA761376", "BLA unknown (biosimilar)"], ["NDA221805", "NDA unknown (medical gas)"], ["BLA761363", "only a recent supplement"], ["ANDA091234", "a generic"]]) assert.ok(!apps.includes(app), why + " is excluded");
  assert.deepEqual(r.candidates[0], { app: "NDA220415", date: "2026-09-25", cls: "TYPE 1", brand: "JUVMO", generics: ["tavapadon"], dosageForms: r.candidates[0].dosageForms });
});
test("FDA filter edges", () => {
  const run = (recs, win = FDA_WIN) => N.newsParseFda({ meta: { results: { total: recs.length } }, results: recs }, win).candidates;
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", date: "20260716" })]).length, 1, "window start is inclusive");
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", date: "20261014" })]).length, 1, "window end is inclusive");
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", date: "20260715" })]).length, 0);
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", date: "20261015" })]).length, 0);
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", status: "TA" })]).length, 0, "tentative approvals are not approvals");
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", type: "SUPPL" })]).length, 0, "a supplement is not the original approval");
  const suppOnly = fdaRecord({ app: "NDA300001", brand: "A", date: "20240101", extra: [{ submission_type: "SUPPL", submission_status: "AP", submission_status_date: "20260901", submission_class_code: "TYPE 1" }] });
  assert.equal(run([suppOnly]).length, 0, "an old original with a recent supplement is not new");
  assert.equal(run([fdaRecord({ app: "ANDA091234", brand: "A" })]).length, 0);
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", cls: "TYPE 1/4" })]).length, 1);
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", cls: "TYPE 10" })]).length, 0, "TYPE 10 is not TYPE 1");
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "A", cls: "TYPE 2/4" })]).length, 0);
  assert.equal(run([fdaRecord({ app: "BLA760001", brand: "A", cls: "TYPE 2" })]).length, 0, "BLA type 2 is not a new biologic");
  assert.equal(run([fdaRecord({ app: "BLA760001", brand: "A", cls: "UNKNOWN" })]).length, 0);
  assert.equal(run([fdaRecord({ app: "BLA760001", brand: "A", cls: "type 1" })]).length, 1, "case does not matter");
  assert.equal(run([{ ...fdaRecord({ app: "NDA300001", brand: "A" }), products: [] }]).length, 0, "no products");
  assert.equal(run([fdaRecord({ app: "NDA3000", brand: "A" })]).length, 0, "malformed application number");
  const same = run([fdaRecord({ app: "NDA300001", brand: "ZETARIX", generics: ["zetarix"] })])[0];
  assert.equal(same.brand, "ZETARIX"); assert.equal(N.newsBrandDistinct(same), false, "brand == generic is not a distinct brand");
  const combo = run([fdaRecord({ app: "NDA300001", brand: "COMBO (COPACKAGED)", generics: ["a", "b", "c", "d"] })])[0];
  assert.equal(combo.brand, "COMBO", "parentheticals are stripped"); assert.deepEqual(combo.generics, ["a", "b", "c", "d"]);
  assert.deepEqual(run([fdaRecord({ app: "NDA300001", brand: "", generics: ["onlygeneric"] })])[0].brand, null, "no brand, only an ingredient");
  assert.equal(run([fdaRecord({ app: "NDA300001", brand: "", generics: [] })]).length, 0, "neither brand nor ingredient");
  assert.deepEqual(N.newsParseFda({}, FDA_WIN), { ok: false }); assert.deepEqual(N.newsParseFda(null, FDA_WIN), { ok: false });
});
test("FDA candidates that share a brand are merged, keeping the earliest approval", () => {
  const r = N.newsParseFda({ results: [fdaRecord({ app: "BLA761464", brand: "DATROWAY", date: "20260905" }), fdaRecord({ app: "BLA761394", brand: "DATROWAY", date: "20260801" }), fdaRecord({ app: "NDA300001", brand: "OTHER", date: "20260902" })] }, FDA_WIN).candidates;
  assert.deepEqual(r.map((c) => `${c.app} ${c.date}`), ["NDA300001 2026-09-02", "BLA761394 2026-08-01"]);
});
test("FDA 404 NOT_FOUND is an empty list, not a failure; other errors are failures", async () => {
  const f = fakeNews({ results: [], stopped: [], fda: [] });
  const r = await N.newsRun(f.io(), { nowMs: NEWS_NOW });
  assert.equal(r.sources.openfda, "ok"); assert.deepEqual(r.live.approvals, []); assert.deepEqual(r.failedKinds, []);
  f.down.openfda = "500";
  assert.equal((await N.newsRun(f.io(), { nowMs: NEWS_NOW })).sources.openfda, "failed");
});

/* ================= corroboration ================= */
test("approvals need a second source: Drugs@FDA alone is never shown", () => {
  const c = cand();
  assert.equal(N.newsApprovalItem(c, {}), null);
  assert.equal(N.newsApprovalItem(c, { rx: { ok: false }, dm: null }), null);
  const rx = N.newsRxnormMatch(N.newsRxnormParse(rxJson(["alphaxine 10 MG Oral Tablet [Alphaxa]"]), "ALPHAXA"), c);
  assert.deepEqual(rx, { ok: true, rxcui: "2752693", brand: "Alphaxa" });
  assert.equal(N.newsApprovalItem(c, { rx }).sourcesLabel, "Confirmed by Drugs@FDA + RxNorm");
  assert.equal(N.newsApprovalItem(c, { dm: dm("ALPHAXA (ALPHAXINE) TABLET [ACME]") }).sourcesLabel, "Confirmed by Drugs@FDA + DailyMed");
  assert.equal(N.newsApprovalItem(c, { rx, dm: dm("ALPHAXA (ALPHAXINE) TABLET [ACME]") }).sourcesLabel, "Confirmed by Drugs@FDA + RxNorm + DailyMed");
});
test("RxNorm must carry the exact [Brand] and the ingredient in the same product name", () => {
  const c = cand();
  const m = (names) => N.newsRxnormMatch(N.newsRxnormParse(rxJson(names), c.brand), c);
  assert.equal(m(["alphaxine 10 MG Oral Tablet [Alphaxa]"]).ok, true);
  assert.equal(m(["alphaxine 10 MG Oral Tablet [ALPHAXA]"]).ok, true, "case-insensitive");
  assert.equal(m(["alphaxine 10 MG Oral Tablet [Alphaxa XR]"]).ok, false, "[Alphaxa XR] is another brand");
  assert.equal(m(["alphaxine 10 MG Oral Tablet"]).ok, false, "no brand in the name");
  assert.equal(m(["somethingelse 10 MG Oral Tablet [Alphaxa]"]).ok, false, "the brand exists but for a different ingredient");
  assert.equal(m([]).ok, false, "unknown brand: a clean not-found");
  assert.deepEqual(N.newsRxnormParse(rxJson([]), "X"), { ok: true, names: [], rxcui: null });
  assert.deepEqual(N.newsRxnormParse({}, "X"), { ok: false }); assert.deepEqual(N.newsRxnormParse(null, "X"), { ok: false });
  assert.equal(N.newsRxnormMatch({ ok: false }, c).ok, false);
  const salt = cand({ brand: "BETARIL", generics: ["betarilol hydrochloride"] });
  assert.equal(N.newsRxnormMatch(N.newsRxnormParse(rxJson(["betarilol 5 MG Oral Tablet [Betaril]"]), "BETARIL"), salt).ok, true, "salt words are ignored");
  const bio = cand({ app: "BLA760001", brand: "PASATRU", generics: ["garetosmab-grts"] });
  assert.equal(N.newsRxnormMatch(N.newsRxnormParse(rxJson(["garetosmab-grts 100 MG/ML Injectable Solution [Pasatru]"]), "PASATRU"), bio).ok, true, "biologic suffix");
  assert.equal(N.newsRxnormMatch(N.newsRxnormParse(rxJson(["alphaxine [Alphaxa]"]), "ALPHAXA"), cand({ brand: "ALPHAXINE", generics: ["alphaxine"] })).ok, false, "a brand equal to its generic cannot be vouched for by RxNorm");
  assert.equal(N.newsRxnormParse(fixture("rxnorm-hit.json"), "ETCAMAH").rxcui, "2752693");
  assert.deepEqual(N.newsRxnormParse(fixture("rxnorm-miss.json"), "NOPE"), { ok: true, names: [], rxcui: null });
});
test("DailyMed must name the brand; with no distinct brand, every generic name in full", () => {
  const c = cand();
  assert.equal(N.newsDailymedMatch(dm("ALPHAXA (ALPHAXINE) TABLET [ACME]"), c), true);
  assert.equal(N.newsDailymedMatch(dm("ALPHAXA-LIKE (OTHER) TABLET"), c), false, "word boundaries");
  assert.equal(N.newsDailymedMatch(dm("SOMETHING ELSE TABLET"), c), false, "title brand mismatch");
  assert.equal(N.newsDailymedMatch({ setid: null, title: "ALPHAXA" }, c), false);
  assert.equal(N.newsDailymedMatch({ setid: "not-a-uuid", title: "ALPHAXA" }, c), false);
  const noBrand = cand({ brand: null, generics: ["alphaxine", "betarine"] });
  assert.equal(N.newsDailymedMatch(dm("ALPHAXINE AND BETARINE TABLET"), noBrand), true);
  assert.equal(N.newsDailymedMatch(dm("ALPHAXINE TABLET"), noBrand), false, "both generics must appear");
  const noBrandItem = N.newsApprovalItem(cand({ brand: null, generics: ["onlygeneric"] }), { rx: { ok: true, rxcui: "1", brand: "Onlygeneric" } });
  assert.equal(noBrandItem, null, "no distinct brand: RxNorm cannot confirm, only DailyMed");
  assert.equal(N.newsApprovalItem(cand({ brand: null, generics: ["onlygeneric"] }), { dm: dm("ONLYGENERIC TABLET") }).title, "FDA approved onlygeneric");
  assert.deepEqual(N.newsDailymedParse(fixture("dailymed-hit.json")), { ok: true, setid: "c54223d3-f3c7-4186-afa0-429d84805826", title: "ETCAMAH (CAMIZESTRANT) TABLET, FILM COATED [ASTRAZENECA PHARMACEUTICALS LP]" });
  assert.deepEqual(N.newsDailymedParse(fixture("dailymed-empty.json")), { ok: true, setid: null, title: "" });
  assert.deepEqual(N.newsDailymedParse({}), { ok: false });
});
test("the approval's brand casing comes from RxNorm when it confirmed, otherwise it is title-cased; parentheticals are gone", () => {
  assert.equal(N.newsApprovalItem(cand({ brand: "KEYTRUDA QLEX", generics: ["pembrolizumab"] }), { dm: dm("KEYTRUDA QLEX (PEMBROLIZUMAB) INJECTION") }).title, "FDA approved Keytruda Qlex (pembrolizumab)");
  const rx = { ok: true, rxcui: "9", brand: "KeyTruda" };
  assert.equal(N.newsApprovalItem(cand(), { rx }).title, "FDA approved KeyTruda (alphaxine)");
});

/* ================= journal articles ================= */
test("journal truth table: a hit in either source counts; none only when someone answered", () => {
  const J = N.newsJournal;
  assert.deepEqual(J(pmHit, none), { state: "found", answered: ["PubMed", "Europe PMC"], found: ["PubMed"], pubmedId: "41111111", epmcId: null });
  assert.equal(J(none, { ok: true, n: 3, id: "42" }).state, "found");
  assert.equal(J(pmHit, { ok: true, n: 1, id: "41111111" }).found.join(), "PubMed,Europe PMC");
  assert.equal(J(none, none).state, "none");
  assert.equal(J(pmHit, null).state, "found"); assert.deepEqual(J(pmHit, null).answered, ["PubMed"]);
  assert.equal(J(null, none).state, "none"); assert.deepEqual(J(null, none).answered, ["Europe PMC"]);
  assert.equal(J(null, null).state, "unknown"); assert.equal(J({ ok: false }, { ok: false }).state, "unknown");
  assert.equal(J({ ok: true, n: 5, id: null }, none).pubmedId, null, "a hit without a usable id still counts as a hit");
});
test("journal parsers reject unexpected shapes; PubMed's 429 body is a failure; zero hits with warnings is a clean zero", () => {
  assert.deepEqual(N.newsPubmedParse(fixture("pubmed-hit.json")), { ok: true, n: 19, id: "42831032" });
  assert.deepEqual(N.newsPubmedParse(fixture("pubmed-zero.json")), { ok: true, n: 0, id: null });
  assert.deepEqual(N.newsPubmedParse(fixture("pubmed-429.json")), { ok: false });
  assert.deepEqual(N.newsPubmedParse({ esearchresult: { count: "x" } }), { ok: false }); assert.deepEqual(N.newsPubmedParse(null), { ok: false });
  assert.deepEqual(N.newsPubmedParse({ esearchresult: { count: "1", idlist: ["<script>"] } }), { ok: true, n: 1, id: null });
  assert.deepEqual(N.newsEpmcParse(fixture("epmc-hit.json")), { ok: true, n: 19, id: "42348366" });
  assert.deepEqual(N.newsEpmcParse(fixture("epmc-zero.json")), { ok: true, n: 0, id: null });
  assert.deepEqual(N.newsEpmcParse({ hitCount: "nope", resultList: {} }), { ok: false }); assert.deepEqual(N.newsEpmcParse({}), { ok: false });
});
test("results items: level 6 only when a search found nothing; level 7 when found and when both searches were down", () => {
  const s = one({ nct: "NCT10000001", resultsDate: "2026-10-13" });
  const lv = (pm, ep) => N.newsResultItem(s, N.newsJournal(pm, ep)).level;
  assert.equal(lv(none, none), 6); assert.equal(lv(none, null), 6); assert.equal(lv(null, none), 6);
  assert.equal(lv(pmHit, none), 7); assert.equal(lv(null, null), 7);
  const down = N.newsResultItem(s, N.newsJournal(null, null));
  assert.equal(down.sourcesLabel, "Source: ClinicalTrials.gov");
  assert.ok(down.summary.includes(" We couldn’t search for a journal article just now."));
  assert.ok(!/not checked|found no journal|Our search/.test(down.summary), "no false 'not checked' or 'found nothing' claim when nothing could be asked");
});

/* ================= wording, byte for byte ================= */
test("results item wording", () => {
  const base = { nct: "NCT10000001", resultsDate: "2026-10-13", sponsor: "Roche", enrollment: 85, interventions: [["Obinutuzumab", "DRUG"]], conditions: ["Childhood Nephrotic Syndrome"], pcd: "2025-09-04", cd: "2026-08-27" };
  const tail = " We don’t say here whether the treatment worked. The official study record has the full results.";
  const a = N.newsResultItem(one(base), N.newsJournal(none, none));
  assert.deepEqual(a, { live: true, id: "results:NCT10000001", kind: "results", date: "2026-10-13", level: 6, nct: "NCT10000001", drug: "Obinutuzumab", title: "Results posted for a study of Obinutuzumab for Childhood Nephrotic Syndrome",
    summary: "Roche ran this final-stage test (phase 3) with 85 people. The registry lists its end date as 27 Aug 2026. The study team posted its results on ClinicalTrials.gov. Our search of PubMed and Europe PMC for this study’s number (NCT10000001) found no journal article. Searches can miss articles, so one may already exist." + tail,
    sourcesLabel: "Source: ClinicalTrials.gov", links: [["Official study record", "https://clinicaltrials.gov/study/NCT10000001"]] });
  const found = N.newsResultItem(one(base), N.newsJournal(pmHit, { ok: true, n: 1, id: "42" }));
  assert.equal(found.summary, "Roche ran this final-stage test (phase 3) with 85 people. The registry lists its end date as 27 Aug 2026. The study team posted its results on ClinicalTrials.gov. A journal article that mentions this study is listed on PubMed and Europe PMC. It may not report these results." + tail);
  assert.equal(found.sourcesLabel, "Sources: ClinicalTrials.gov + PubMed + Europe PMC");
  assert.deepEqual(found.links, [["Official study record", "https://clinicaltrials.gov/study/NCT10000001"], ["Journal article on PubMed", "https://pubmed.ncbi.nlm.nih.gov/41111111/"], ["Journal article on Europe PMC", "https://europepmc.org/article/MED/42"]]);
  const pmOnly = N.newsResultItem(one(base), N.newsJournal(pmHit, null));
  assert.equal(pmOnly.sourcesLabel, "Sources: ClinicalTrials.gov + PubMed"); assert.ok(pmOnly.summary.includes("is listed on PubMed. It may not"));
  assert.equal(N.newsResultItem(one(base), N.newsJournal(null, { ok: true, n: 1, id: "7" })).sourcesLabel, "Sources: ClinicalTrials.gov + Europe PMC");
  const one2 = N.newsResultItem(one(base), N.newsJournal(null, none));
  assert.ok(one2.summary.includes(" Our search of Europe PMC for this study’s number (NCT10000001) found no journal article. Searches can miss articles, so one may already exist."), "only the source that answered is named");
  // headline fallbacks
  assert.equal(N.newsResultItem(one({ ...base, interventions: [["Placebo", "DRUG"]] }), N.newsJournal(none, none)).title, "Results posted for a study about Childhood Nephrotic Syndrome");
  assert.equal(N.newsResultItem(one({ ...base, interventions: [], conditions: [] }), N.newsJournal(none, none)).title, "Results posted for a medical study");
  assert.equal(N.newsResultItem(one({ ...base, conditions: [] }), N.newsJournal(none, none)).title, "Results posted for a study of Obinutuzumab");
  // phase wording, people, sponsor
  assert.ok(N.newsResultItem(one({ ...base, phases: ["PHASE2", "PHASE3"] }), N.newsJournal(none, none)).summary.startsWith("Roche ran this combined mid-stage and final-stage test (phase 2/3) with 85 people."));
  assert.ok(N.newsResultItem(one({ ...base, enrollmentType: "ESTIMATED" }), N.newsJournal(none, none)).summary.startsWith("Roche ran this final-stage test (phase 3). "), "no head-count unless it is the actual enrolment");
  assert.ok(N.newsResultItem(one({ ...base, enrollment: 1234 }), N.newsJournal(none, none)).summary.includes("with 1,234 people."));
  assert.ok(N.newsResultItem(one({ ...base, sponsor: "" }), N.newsJournal(none, none)).summary.startsWith("This was a final-stage test (phase 3) with 85 people. "));
  assert.ok(!N.newsResultItem(one({ ...base, cdType: "ESTIMATED" }), N.newsJournal(none, none)).summary.includes("end date"), "an estimated end date is not stated");
  // a terminated study that stays in results
  const t = N.newsResultItem(one({ ...base, status: "TERMINATED", whyStopped: "Slow enrolment." }), N.newsJournal(none, none));
  assert.ok(t.summary.includes("with 85 people. It was stopped early. The study team’s reason: “Slow enrolment”. The registry lists its end date as 27 Aug 2026. The study team posted"), t.summary);
});
test("stopped item wording", () => {
  const base = { nct: "NCT20000002", updated: "2026-10-12", sponsor: "Novartis", interventions: [["Pelacarsen", "DRUG"]], conditions: ["ACS"], whyStopped: "Funding was withdrawn.", cd: "2026-09-17" };
  const items = (o) => N.newsStoppedItems([one({ ...base, ...o })], NEWS_NOW);
  const w = items({ status: "WITHDRAWN", enrollment: 0, cd: "2028-01", cdType: "ESTIMATED" })[0];
  assert.deepEqual(w, { live: true, id: "stopped:NCT20000002", kind: "stopped", date: "2026-10-12", datePrefix: "Registry record updated ", level: 0, nct: "NCT20000002", drug: "Pelacarsen",
    title: "A study of Pelacarsen for ACS was cancelled before it began", summary: "Novartis planned this final-stage test (phase 3). The study team’s reason: “Funding was withdrawn”. The registry doesn’t say when it was cancelled. The date above is when its record was last updated.", sourcesLabel: "Source: ClinicalTrials.gov", links: [["Official study record", "https://clinicaltrials.gov/study/NCT20000002"]] });
  const t = items({ status: "TERMINATED", enrollment: 4874 })[0];
  assert.equal(t.title, "A study of Pelacarsen for ACS was stopped early");
  assert.equal(t.summary, "Novartis ran this final-stage test (phase 3) with 4,874 people. The study team’s reason: “Funding was withdrawn”. The registry lists its end date as 17 Sep 2026.");
  const p = items({ status: "SUSPENDED", cd: "2027-08", cdType: "ESTIMATED", resultsDate: "2026-09-30" })[0];
  assert.equal(p.title, "A study of Pelacarsen for ACS is paused", "a paused study is paused now: present tense");
  assert.equal(p.summary, "Novartis leads this final-stage test (phase 3). The study team’s reason: “Funding was withdrawn”. It may start again. The registry doesn’t say when it was paused. The date above is when its record was last updated. The study team has also posted results on ClinicalTrials.gov.");
  assert.equal(items({ status: "SUSPENDED", interventions: [], conditions: [] })[0].title, "A medical study is paused");
  assert.equal(items({ status: "TERMINATED", whyStopped: "" })[0].summary, "Novartis ran this final-stage test (phase 3) with 120 people. The study team hasn’t given a reason on the registry. The registry lists its end date as 17 Sep 2026.");
  assert.equal(items({ status: "TERMINATED", sponsor: "", interventions: [], conditions: [] })[0].title, "A medical study was stopped early");
  assert.ok(items({ status: "TERMINATED", sponsor: "", interventions: [], conditions: [] })[0].summary.startsWith("This was a final-stage test (phase 3) with 120 people."));
  assert.equal(items({ status: "TERMINATED", interventions: [], conditions: ["Gout"] })[0].title, "A study about Gout was stopped early");
  assert.ok(!items({ status: "WITHDRAWN", enrollment: 0, cd: "2028-01", cdType: "ESTIMATED" })[0].summary.includes("people"), "no head-count for a study that never began");
  // the registry has no "stopped on" date: say so unless the story carries an actual end date of its own
  const caveat = (w) => ` The registry doesn’t say when it was ${w}. The date above is when its record was last updated.`;
  assert.ok(!items({ status: "TERMINATED" })[0].summary.includes("last updated"), "an actual end date is shown instead of the caveat");
  assert.ok(items({ status: "TERMINATED", cdType: "ESTIMATED" })[0].summary.endsWith(caveat("stopped")), "terminated, end date only an estimate: the caveat, with 'stopped'");
  assert.ok(items({ status: "TERMINATED", cd: null })[0].summary.endsWith(caveat("stopped")), "terminated, no end date at all: the caveat");
  assert.ok(items({ status: "WITHDRAWN", enrollment: 0 })[0].summary.endsWith(caveat("cancelled")) && items({ status: "SUSPENDED" })[0].summary.endsWith(caveat("paused")), "withdrawn and suspended always carry it");
  assert.ok(items({ status: "TERMINATED", cd: null, resultsDate: "2026-10-01" })[0].summary.endsWith(caveat("stopped") + " The study team has also posted results on ClinicalTrials.gov."), "the caveat comes before the results sentence");
});
test("stopped list: recency filters from the advisor", () => {
  const cases = [
    ["ended long ago (housekeeping edit)", { status: "TERMINATED", cd: "2014-12-02" }, 0],
    ["ended 181 days ago", { status: "TERMINATED", cd: N.newsDaysAgo(NEWS_NOW, 181) }, 1],
    ["ended 183 days ago", { status: "TERMINATED", cd: N.newsDaysAgo(NEWS_NOW, 183) }, 0],
    ["terminated with results posted in 2023", { status: "TERMINATED", cd: "2026-06-08", resultsDate: "2023-12-20" }, 0],
    ["terminated with fresh results", { status: "TERMINATED", cd: "2026-06-08", resultsDate: "2026-10-01" }, 1],
    ["not a stopped status", { status: "COMPLETED" }, 0],
    ["no update date at all", { status: "TERMINATED", updated: null }, 0],
  ];
  for (const [why, o, n] of cases) {
    const s = one({ nct: "NCT20000002", updated: "2026-10-12", ...o }); if (o.updated === null) s.updated = null;
    assert.equal(N.newsStoppedItems([s], NEWS_NOW).length, n, why);
  }
  const real = N.newsStoppedItems(N.newsParseRegistry(fixture("registry-stopped.json")), NEWS_NOW);
  assert.ok(!real.some((i) => i.nct === "NCT03834493"), "the real NCT03834493 (results posted in 2023) is dropped");
  assert.equal(real.length, 4);
});
test("approval item wording", () => {
  const rx = { ok: true, rxcui: "2752693", brand: "Etcamah" };
  const a = N.newsApprovalItem(cand({ app: "NDA220359", brand: "ETCAMAH", generics: ["camizestrant"], date: "2026-09-04" }), { rx });
  assert.deepEqual(a, { live: true, id: "approval:NDA220359", kind: "approval", date: "2026-09-04", level: 4, app: "NDA220359", brand: "Etcamah", generics: ["camizestrant"], title: "FDA approved Etcamah (camizestrant)",
    summary: "The FDA’s drug database lists it as approved. The FDA classes it as a new drug, with an active ingredient not approved in the US before. This database doesn’t say what it’s used for. The FDA drug record links to its label, which does.",
    sourcesLabel: "Confirmed by Drugs@FDA + RxNorm",
    links: [["FDA drug record", "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=220359"], ["RxNorm entry", "https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=2752693"]] });
  const t2 = N.newsApprovalItem(cand({ cls: "TYPE 2" }), { rx: { ok: true, rxcui: "1", brand: "Alphaxa" } });
  assert.ok(t2.summary.includes(" The FDA classes it as a new form of an active ingredient it had already approved. This database"));
  const t14 = N.newsApprovalItem(cand({ cls: "TYPE 1/4" }), { rx: { ok: true, rxcui: "1", brand: "Alphaxa" } });
  assert.ok(t14.summary.includes("a new drug, with an active ingredient not approved in the US before"));
  const bla = N.newsApprovalItem(cand({ app: "BLA761320", cls: "TYPE 1/4", brand: "LYTENAVA", generics: ["bevacizumab-vikg"] }), { dm: dm("LYTENAVA (BEVACIZUMAB-VIKG) INJECTION") });
  assert.equal(bla.summary, "The FDA’s drug database lists it as approved. This database doesn’t say what it’s used for. The FDA drug record links to its label, which does.", "a BLA class does not mean a new ingredient: no such sentence");
  assert.equal(bla.links[1][0], "DailyMed label");
  assert.equal(N.newsApprovalItem(cand({ generics: ["a", "b", "c", "d"] }), { rx: { ok: true, rxcui: "1", brand: "Alphaxa" } }).title, "FDA approved Alphaxa (a, b and c)");
  assert.equal(N.newsApprovalItem(cand({ generics: ["a", "b"] }), { rx: { ok: true, rxcui: "1", brand: "Alphaxa" } }).title, "FDA approved Alphaxa (a and b)");
  assert.ok(!/ACME|PHARM/i.test(JSON.stringify(a)), "the sponsor name is left out on purpose");
});
test("sources labels", () => {
  assert.equal(N.newsSourcesLabel("results", {}), "Source: ClinicalTrials.gov");
  assert.equal(N.newsSourcesLabel("results", { pubmed: true }), "Sources: ClinicalTrials.gov + PubMed");
  assert.equal(N.newsSourcesLabel("results", { epmc: true }), "Sources: ClinicalTrials.gov + Europe PMC");
  assert.equal(N.newsSourcesLabel("results", { pubmed: true, epmc: true }), "Sources: ClinicalTrials.gov + PubMed + Europe PMC");
  assert.equal(N.newsSourcesLabel("stopped"), "Source: ClinicalTrials.gov");
  assert.equal(N.newsSourcesLabel("approval", { rx: true }), "Confirmed by Drugs@FDA + RxNorm");
  assert.equal(N.newsSourcesLabel("approval", { dm: true }), "Confirmed by Drugs@FDA + DailyMed");
  assert.equal(N.newsSourcesLabel("approval", { rx: true, dm: true }), "Confirmed by Drugs@FDA + RxNorm + DailyMed");
});
test("intro line states: the sources named are exactly the ones that answered", () => {
  const all = { primary: ["ClinicalTrials.gov", "the FDA"], crossChecked: ["PubMed", "Europe PMC", "RxNorm"] };
  const time = '<br>Checked <span id="newsChecked">3 min ago</span>.';
  assert.equal(N.newsIntro("loading"), "Checking ClinicalTrials.gov and the FDA…");
  assert.equal(N.newsIntro("live", { checked: "3 min ago", ...all }), "The rest are written automatically from live ClinicalTrials.gov and FDA records, cross-checked with PubMed, Europe PMC and RxNorm." + time);
  assert.equal(N.newsIntro("live", { checked: "3 min ago", primary: ["ClinicalTrials.gov", "the FDA"], crossChecked: ["RxNorm"] }), "The rest are written automatically from live ClinicalTrials.gov and FDA records, cross-checked with RxNorm." + time, "both journal sources down: neither is named");
  assert.equal(N.newsIntro("live", { checked: "3 min ago", primary: ["ClinicalTrials.gov"], crossChecked: ["PubMed", "Europe PMC", "RxNorm"] }), "The rest are written automatically from live ClinicalTrials.gov records, cross-checked with PubMed, Europe PMC and RxNorm." + time, "openFDA down: not 'FDA'");
  assert.equal(N.newsIntro("live", { checked: "3 min ago", primary: ["the FDA"], crossChecked: [] }), "The rest are written automatically from live FDA records." + time, "nothing to cross-check with: no clause at all");
  assert.equal(N.newsIntro("partial", { checked: "3 min ago", savedDate: "13 Oct 2026", ...all }), "The rest are written automatically from live ClinicalTrials.gov and FDA records, cross-checked with PubMed, Europe PMC and RxNorm. Some stories below come from the saved copy from 13 Oct 2026, because a source didn’t answer." + time);
  assert.equal(N.newsIntro("partial", { checked: "3 min ago", ...all }), "The rest are written automatically from live ClinicalTrials.gov and FDA records, cross-checked with PubMed, Europe PMC and RxNorm. A source didn’t answer, so some stories may be missing." + time);
  assert.ok(N.newsIntro("partial", { checked: "3 min ago", savedDate: "13 Oct 2026", ...all }).endsWith(time), "the time always comes last, on its own line, so its width can never move the text above it");
  assert.equal(N.newsIntro("paused", { savedDate: "13 Oct 2026" }), "Live updates are paused, so you’re seeing the saved copy from 13 Oct 2026.");
  assert.equal(N.newsIntro("paused", {}), "Live updates are paused, so you’re seeing only the stories picked by hand.");
  assert.equal(N.newsIntro("paused", { savedDate: "13 Oct 2026", ...all }).includes("PubMed"), false, "paused names no source");
  assert.equal(N.newsIntro("live", { checked: "<b>x</b>", ...all }).includes("<b>"), false, "escaped");
  assert.equal(N.newsIntro("live", { checked: "x", primary: ["<img onerror=1>", "the FDA"], crossChecked: ["evil", "RxNorm"] }), 'The rest are written automatically from live FDA records, cross-checked with RxNorm.<br>Checked <span id="newsChecked">x</span>.', "only whitelisted names get through, in a fixed order");
  assert.equal(N.newsIntro("live", { checked: "x", primary: ["the FDA", "ClinicalTrials.gov"], crossChecked: ["DailyMed", "PubMed"] }), 'The rest are written automatically from live ClinicalTrials.gov and FDA records, cross-checked with PubMed.<br>Checked <span id="newsChecked">x</span>.', "DailyMed is not on the list: only the sources the browser itself asked are ever named");
  assert.ok(!/aria-live/.test(N.newsIntro("live", all)), "no aria-live anywhere");
});

/* ================= merge ================= */
const handItem = (date, o = {}) => ({ hand: true, kind: "hand", id: "hand:" + date + "|X", date, level: 2, type: "Readout", title: "t", summary: "s", rawTitle: "t", rawSummary: "s", trial: null, links: [], company: "X", ...o });
const liveItem = (kind, id, date, o = {}) => ({ live: true, id: `${kind}:${id}`, kind, date, level: kind === "stopped" ? 0 : kind === "approval" ? 4 : 6, title: "t", summary: "s", sourcesLabel: "x", links: [], ...(kind === "approval" ? { app: id } : { nct: id }), ...o });
test("merge: one list, newest first, quarter dates in the right place, ties deterministic", () => {
  const hand = [handItem("2026-09-04"), handItem("2025-Q4"), handItem("2025-04-14")];
  const out = N.newsMerge({ hand, results: [liveItem("results", "NCT10000001", "2026-09-04"), liveItem("results", "NCT10000002", "2025-12-31")], stopped: [liveItem("stopped", "NCT20000001", "2026-09-04")], approvals: [liveItem("approval", "NDA300001", "2026-09-04")], nowMs: NEWS_NOW });
  assert.deepEqual(out.map((i) => i.id), ["hand:2026-09-04|X", "approval:NDA300001", "results:NCT10000001", "stopped:NCT20000001", "hand:2025-Q4|X", "results:NCT10000002", "hand:2025-04-14|X"]);
  const again = N.newsMerge({ hand, results: [liveItem("results", "NCT10000002", "2025-12-31"), liveItem("results", "NCT10000001", "2026-09-04")], stopped: [liveItem("stopped", "NCT20000001", "2026-09-04")], approvals: [liveItem("approval", "NDA300001", "2026-09-04")], nowMs: NEWS_NOW });
  assert.deepEqual(again.map((i) => i.id), out.map((i) => i.id), "same input, same output");
  const ties = N.newsMerge({ results: [liveItem("results", "NCT10000009", "2026-09-04"), liveItem("results", "NCT10000008", "2026-09-04")], nowMs: NEWS_NOW });
  assert.deepEqual(ties.map((i) => i.id), ["results:NCT10000008", "results:NCT10000009"], "ties: id ascending");
});
test("merge: caps of 8 / 5 / 5 apply AFTER de-duplication", () => {
  const results = Array.from({ length: 12 }, (_, i) => liveItem("results", "NCT" + (10000100 + i), day(i + 1)));
  const stopped = Array.from({ length: 7 }, (_, i) => liveItem("stopped", "NCT" + (20000100 + i), day(i + 1)));
  const approvals = Array.from({ length: 7 }, (_, i) => liveItem("approval", "NDA" + (300100 + i), "2026-09-" + (20 - i)));
  const out = N.newsMerge({ results, stopped, approvals, nowMs: NEWS_NOW });
  const n = (k) => out.filter((i) => i.kind === k).length;
  assert.deepEqual([n("results"), n("stopped"), n("approval")], [8, 5, 5]);
  // the first results item is a hand-picked duplicate: it is removed, and the 9th takes its place in the cap
  const hand = [handItem("2026-10-01", { rawSummary: results[0].nct })];
  const out2 = N.newsMerge({ hand, results, nowMs: NEWS_NOW });
  assert.equal(out2.filter((i) => i.kind === "results").length, 8); assert.ok(!out2.some((i) => i.id === results[0].id)); assert.ok(out2.some((i) => i.id === results[8].id));
});
test("merge: hand-picked stories win over live duplicates", () => {
  const hand = [
    handItem("2026-09-04", { type: "Approval", title: "FDA approves camizestrant (Etcamah) for breast cancer", rawTitle: "FDA approves camizestrant (Etcamah) for breast cancer", summary: "SERENA-6 (NCT04964934)", rawSummary: "SERENA-6 (NCT04964934)" }),
    handItem("2026-09-06", { level: 0, type: "Discontinued", title: "Novo Nordisk stops the HERMES and ATHENA heart trials of ziltivekimab", rawTitle: "Novo Nordisk stops the HERMES and ATHENA heart trials of ziltivekimab" }),
    handItem("2026-07-23", { trial: "NCT05929066" }), handItem("2026-09-03", { links: [["Registry record", "https://clinicaltrials.gov/study/NCT06158841"]] }),
  ];
  const keep = (items) => N.newsMerge({ hand, results: items.filter((i) => i.kind === "results"), stopped: items.filter((i) => i.kind === "stopped"), approvals: items.filter((i) => i.kind === "approval"), nowMs: NEWS_NOW }).filter((i) => !i.hand).map((i) => i.id);
  assert.deepEqual(keep([liveItem("results", "NCT04964934", day(1)), liveItem("results", "NCT05929066", day(1)), liveItem("results", "NCT06158841", day(1)), liveItem("results", "NCT10000001", day(1))]), ["results:NCT10000001"], "by NCT in the summary, in trial and in a link URL");
  assert.deepEqual(keep([liveItem("approval", "NDA220359", "2026-09-04", { brand: "Etcamah", generics: ["camizestrant"] })]), [], "an approval whose full brand or generic is in a hand-picked Approval");
  assert.deepEqual(keep([liveItem("approval", "NDA300009", "2026-09-04", { brand: "Insulinix", generics: ["insulin efsitora"] })]), ["approval:NDA300009"], "no first-word matching: 'insulin' alone suppresses nothing");
  assert.deepEqual(keep([liveItem("stopped", "NCT05636176", day(1), { drug: "Ziltivekimab" })]), [], "stopped: its drug is named in a hand-picked level-0 story from the last 90 days");
  assert.deepEqual(keep([liveItem("stopped", "NCT05636177", day(1), { drug: "Zilt" })]), ["stopped:NCT05636177"], "a drug name under 5 letters is never matched");
  const old = [handItem("2025-04-14", { level: 0, title: "Pfizer stopped danuglipron", rawTitle: "Pfizer stopped danuglipron" })];
  assert.equal(N.newsMerge({ hand: old, stopped: [liveItem("stopped", "NCT05636178", day(1), { drug: "danuglipron" })], nowMs: NEWS_NOW }).filter((i) => !i.hand).length, 1, "a hand-picked story older than 90 days does not hide a new one");
  assert.deepEqual(N.newsMerge({ hand: [handItem("2026-09-04", { type: "Readout", title: "Etcamah is great", rawTitle: "Etcamah is great" })], approvals: [liveItem("approval", "NDA220359", "2026-09-04", { brand: "Etcamah", generics: ["camizestrant"] })], nowMs: NEWS_NOW }).filter((i) => !i.hand).length, 1, "approvals are only de-duplicated against hand-picked Approval stories");
});
test("merge: a study shown as stopped leaves the results list; one that is not shown stays", () => {
  const results = [liveItem("results", "NCT10000003", day(2)), liveItem("results", "NCT10000004", day(3))];
  const stopped = [liveItem("stopped", "NCT10000003", day(1))];
  assert.deepEqual(N.newsMerge({ results, stopped, nowMs: NEWS_NOW }).map((i) => i.id), ["stopped:NCT10000003", "results:NCT10000004"]);
  // capped out of the stopped list (cap 0): it must not disappear from both lists
  assert.deepEqual(N.newsMerge({ results, stopped, caps: { results: 8, stopped: 0, approvals: 5 }, nowMs: NEWS_NOW }).map((i) => i.id), ["results:NCT10000003", "results:NCT10000004"]);
});
test("hand-picked level rule keeps the page's existing answers", () => {
  const { NEWS, NEWS_PLAIN } = loadNewsData();
  assert.deepEqual(Array.from(NEWS, (n) => N.newsHandLevel(n)), [0, 0, 4, 2, 2, 2, 4, 5, 0, 4, 4, 4, 4, 4]);
  const items = N.newsHandItems(Array.from(NEWS), NEWS_PLAIN, N.newsHandLevel);
  assert.equal(items.length, 14); assert.equal(items[2].title, "FDA approved a new pill for a type of advanced breast cancer"); assert.equal(items[2].rawTitle.startsWith("FDA approves camizestrant"), true);
  assert.deepEqual(N.newsMerge({ hand: items, nowMs: NEWS_NOW }).map((i) => i.id), items.map((i) => i.id), "hand-picked stories keep their order");
});

/* ================= hostile strings ================= */
const HOSTILE = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "javascript:alert(1)", "‮evil‬", "a⁦b⁩c", "x\u0000y\u0007z", "​hidden‏"];
test("newsClean strips control and bidi characters and clips at a word boundary", () => {
  assert.equal(N.newsClean("a‮b‮c⁦d⁩e"), "abcde"); assert.equal(N.newsClean("x\u0000y\u0007z\ndone"), "x y z done"); assert.equal(N.newsClean("  a \t\n b  "), "a b");
  const long = N.newsClean("word ".repeat(2000), 200);
  assert.ok(long.length <= 200 && long.endsWith("…") && !long.slice(0, -1).endsWith(" "));
  assert.equal(N.newsClean("😀".repeat(300), 11).length <= 11, true); assert.ok(!/[\ud800-\udbff]$/.test(N.newsClean("😀".repeat(300), 10).slice(0, -1)), "no lone surrogate");
  assert.equal(N.newsClean(undefined), ""); assert.equal(N.newsClean(null), ""); assert.equal(N.newsClean(5), "5");
});
test("hostile registry strings stay text and never become links", () => {
  for (const h of HOSTILE) {
    const s = one({ nct: "NCT10000001", title: h, sponsor: h, conditions: [h], interventions: [[h, "DRUG"]], whyStopped: h, resultsDate: "2026-10-13", updated: "2026-10-12", status: "TERMINATED", cd: "2026-09-17" });
    for (const it of [N.newsResultItem(s, N.newsJournal(none, none)), ...N.newsStoppedItems([s], NEWS_NOW)]) {
      assert.ok(!/[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u0000-\u001f]/.test([it.title, it.summary, it.sourcesLabel, it.drug].join("|")), "no control or bidi character survives: " + JSON.stringify(h));
      for (const [, url] of it.links) assert.ok(N.newsSafeUrl(url), url);
      assert.equal(it.links.length, 1, "no link is ever built from registry text");
    }
  }
  for (const bad of ["NCT1<img>", "NCT123", "javascript:alert(1)", "nct10000001", "NCT100000011", "", null, 5]) assert.equal(N.newsUrls.study(bad), null, String(bad));
  for (const bad of ["1\"onerror=1", "javascript:1", "1234567890", "", null, "-1", "1.5"]) { assert.equal(N.newsUrls.pubmed(bad), null, String(bad)); assert.equal(N.newsUrls.epmc(bad), null); assert.equal(N.newsUrls.rxnorm(bad), null); }
  for (const bad of ["ANDA091234", "NDA<1>", "NDA1", "BLA1234567", "javascript:NDA123456", "NDA123456 "]) assert.equal(N.newsUrls.fda(bad), null, bad);
  for (const bad of ["x", "11111111-2222-3333-4444-55555555555", "11111111-2222-3333-4444-5555555555555", "../../x"]) assert.equal(N.newsUrls.dailymed(bad), null, bad);
  assert.equal(N.newsUrls.pubmed(12345), "https://pubmed.ncbi.nlm.nih.gov/12345/");
});
test("hostile brand, generic and DailyMed / RxNorm strings", () => {
  for (const h of HOSTILE) {
    const c = N.newsParseFda({ results: [fdaRecord({ app: "NDA300001", brand: h, generics: [h] })] }, FDA_WIN).candidates;
    for (const it of c.map((x) => N.newsApprovalItem(x, { dm: dm(h) }) || N.newsApprovalItem(x, { rx: { ok: true, rxcui: "1", brand: h } })).filter(Boolean)) {
      for (const [, url] of it.links) assert.ok(N.newsSafeUrl(url));
      assert.ok(!/[‪-‮⁦-⁩​-‏]/.test(it.title + it.summary));
    }
  }
  assert.equal(N.newsApprovalItem(cand(), { dm: { setid: "x\"><script>", title: "ALPHAXA" } }), null);
  const item = N.newsApprovalItem(cand(), { rx: { ok: true, rxcui: "1\"><b>", brand: "Alphaxa" } });
  assert.equal(item.links.length, 1, "an RxNorm id that is not digits adds no link");
});
test("a 5 000-character reason is clipped; a 250-character one is quoted whole; reasons lose trailing punctuation", () => {
  const s = one({ nct: "NCT20000002", status: "TERMINATED", updated: "2026-10-12", whyStopped: "reason ".repeat(800) + "!!!", cd: "2026-09-17" });
  const it = N.newsStoppedItems([s], NEWS_NOW)[0];
  const quoted = /reason: “(.*?)”\./.exec(it.summary)[1];
  assert.ok(quoted.length <= 260 && quoted.endsWith("…"), quoted.length);
  assert.ok(it.summary.length < 700);
  const whole = ("The sponsor ended the programme after an interim review of the whole data package, and not because of any safety concern. ".repeat(3)).slice(0, 249).replace(/\s+$/, "x") + ".";   // 249 characters and a full stop
  assert.equal(whole.length, 250);
  const q250 = /reason: “(.*?)”\./.exec(N.newsStoppedItems([one({ nct: "NCT20000002", status: "TERMINATED", updated: "2026-10-12", whyStopped: whole, cd: "2026-09-17" })], NEWS_NOW)[0].summary)[1];
  assert.equal(q250, whole.slice(0, -1).trim(), "a 250-character reason is quoted in full, with no ellipsis");
  assert.ok(!q250.includes("…"));
  const real = "Study termination was not related to participant safety.";   // the kind of sentence a clip must never cut (NCT06046820)
  assert.ok(N.newsStoppedItems([one({ nct: "NCT20000002", status: "TERMINATED", updated: "2026-10-12", whyStopped: "The sponsor made a strategic decision after reviewing the programme and the available data from the study. " + real, cd: "2026-09-17" })], NEWS_NOW)[0].summary.includes("not related to participant safety”."));
  assert.ok(N.newsStoppedItems([one({ nct: "NCT20000002", status: "TERMINATED", updated: "2026-10-12", whyStopped: "Done.  ;", cd: "2026-09-17" })], NEWS_NOW)[0].summary.includes("reason: “Done”."));
});
test("saved copy: items are re-validated; unsafe links and shapes are dropped", () => {
  const good = N.newsResultItem(one({ nct: "NCT10000001", resultsDate: "2026-10-13" }), N.newsJournal(pmHit, none));
  assert.deepEqual(N.newsCheckItem(JSON.parse(JSON.stringify(good))), { ...good, drug: good.drug });
  const evil = { ...good, links: [["x", "javascript:alert(1)"], ["Official study record", "https://clinicaltrials.gov/study/NCT10000001"], ["y", "https://evil.example/study/NCT10000001"], ["z", "https://clinicaltrials.gov/study/NCT10000001/../../x"]], title: "<img src=x onerror=1>" };
  const checked = N.newsCheckItem(evil);
  assert.deepEqual(checked.links, [["Official study record", "https://clinicaltrials.gov/study/NCT10000001"]]);
  assert.equal(checked.title, "<img src=x onerror=1>", "text stays text (escaped at render)");
  for (const bad of [null, 5, {}, { ...good, level: 3 }, { ...good, kind: "hand" }, { ...good, id: "results:<x>" }, { ...good, id: "stopped:NCT10000001" }, { ...good, date: "2026-10" }, { ...good, title: "" }, { ...good, live: false }]) assert.equal(N.newsCheckItem(bad), null, JSON.stringify(bad)?.slice(0, 60));
  assert.equal(N.newsCheckSaved(null), null); assert.equal(N.newsCheckSaved({ version: 2, generatedAt: "2026-10-13T00:00:00Z", items: [] }), null); assert.equal(N.newsCheckSaved({ version: 1, generatedAt: "yesterday", items: [] }), null);
  const s = N.newsCheckSaved({ version: 1, generatedAt: "2026-10-13T10:00:00.000Z", items: [good, { nope: 1 }], dailymed: { NDA300001: { setid: "11111111-2222-3333-4444-555555555555", title: "T" }, "<x>": { setid: "11111111-2222-3333-4444-555555555555" }, NDA300002: { setid: "bad" } } });
  assert.equal(s.items.length, 1); assert.deepEqual(Object.keys(s.dailymed), ["NDA300001"]);
});

/* ================= the pipeline ================= */
const HAND = () => N.newsHandItems([
  { date: "2026-09-04", type: "Approval", title: "FDA approves camizestrant (Etcamah)", company: "AZ", summary: "SERENA-6 (NCT04964934)", links: [], trial: null, evidence: "" },
  { date: "2026-09-06", type: "Discontinued", title: "Novo Nordisk stops two trials of ziltivekimab", company: "Novo", summary: "x", links: [], trial: null, evidence: "" },
], {}, N.newsHandLevel);
const run = (f, o = {}) => N.newsRun(f.io({ memory: o.memory }), { nowMs: NEWS_NOW, hand: HAND(), concurrency: 4, getSaved: async () => o.saved ?? null, ...o });
const savedCopy = () => N.newsCheckSaved({ version: 1, generatedAt: "2026-10-13T10:00:00.000Z", dataTimestamp: "x", items: [
  N.newsResultItem(one({ nct: "NCT90000001", resultsDate: "2026-10-05" }), N.newsJournal(none, none)), N.newsStoppedItems([one({ nct: "NCT90000002", status: "TERMINATED", updated: "2026-10-05", cd: "2026-09-01" })], NEWS_NOW)[0],
  N.newsApprovalItem(cand({ app: "NDA390001", brand: "SAVEDX", generics: ["savedine"], date: "2026-09-10" }), { dm: dm("SAVEDX (SAVEDINE) TABLET") })], dailymed: world().dailymed });
const ids = (r) => r.items.filter((i) => !i.hand).map((i) => i.id);

test("pipeline, everything up: caps, de-duplication, corroboration and sources", async () => {
  const f = fakeNews(world());
  const r = await run(f, { saved: savedCopy() });
  const live = r.items.filter((i) => !i.hand);
  assert.deepEqual([r.live.results.length, r.live.stopped.length, r.live.approvals.length], [8, 5, 5]);
  assert.equal(r.partial, false); assert.deepEqual(r.failedKinds, []); assert.equal(r.anyLive, true);
  assert.ok(!ids(r).includes("results:NCT04964934"), "a trial that a hand-picked story covers is skipped");
  assert.ok(!ids(r).includes("stopped:NCT05636176"), "ziltivekimab is covered by a hand-picked story");
  assert.ok(!ids(r).includes("approval:NDA220359"), "Etcamah is covered by a hand-picked approval");
  assert.ok(!ids(r).includes("approval:NDA300003"), "an approval no second source knows is not shown");
  assert.ok(!ids(r).includes("approval:NDA300008"), "a type 5 approval is never a candidate");
  assert.deepEqual(r.live.approvals.map((i) => i.id), ["approval:NDA300001", "approval:NDA300002", "approval:NDA300004", "approval:BLA760001", "approval:NDA300005"]);
  assert.deepEqual(r.live.approvals.map((i) => i.sourcesLabel), ["Confirmed by Drugs@FDA + RxNorm", "Confirmed by Drugs@FDA + DailyMed", "Confirmed by Drugs@FDA + RxNorm", "Confirmed by Drugs@FDA + RxNorm + DailyMed", "Confirmed by Drugs@FDA + DailyMed"]);
  const first = live.find((i) => i.id === "results:NCT10000001");
  assert.equal(first.level, 7); assert.equal(first.sourcesLabel, "Sources: ClinicalTrials.gov + PubMed + Europe PMC");
  assert.equal(live.find((i) => i.id === "results:NCT10000010").sourcesLabel, "Sources: ClinicalTrials.gov + Europe PMC");
  assert.equal(live.find((i) => i.id === "results:NCT10000002").sourcesLabel, "Sources: ClinicalTrials.gov + PubMed");
  assert.equal(r.live.stopped.some((i) => i.nct === "NCT10000003"), true, "the terminated study with posted results is in the stopped list...");
  assert.equal(r.live.results.some((i) => i.nct === "NCT10000003"), false, "...and so leaves the results list");
  const sorted = r.items.map((i) => N.newsSortKey(i.date));
  assert.deepEqual(sorted, [...sorted].sort().reverse(), "one list, newest first");
  assert.equal(f.count("ctgovResults"), 1); assert.equal(f.count("ctgovStopped"), 1); assert.equal(f.count("openfda"), 1);
  assert.equal(f.count("pubmed"), 8, "journal lookups only for the studies that will be shown"); assert.equal(f.count("epmc"), 8);
  assert.ok(f.count("rxnorm") <= 12);
  assert.ok(f.calls.every((c) => !/dailymed/.test(c.source)), "the pipeline never asks DailyMed from the browser side: its answers come from news.json");
});
test("pipeline: lookups are cached, failures are not", async () => {
  const f = fakeNews(world());
  const io = f.io({ memory: true });
  const o = { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => savedCopy() };
  await N.newsRun(io, o);
  const n1 = f.calls.length;
  await N.newsRun(io, o);
  assert.equal(f.calls.length, n1, "a second run makes no request at all");
  const g = fakeNews(world()); g.down.pubmed = true;
  const io2 = g.io({ memory: true });
  await N.newsRun(io2, o);
  g.down.pubmed = false;
  const before = g.count("pubmed");
  await N.newsRun(io2, o);
  assert.ok(g.count("pubmed") > before, "pubmed failures were not cached: they are asked again");
});
test("pipeline: each source down alone", async () => {
  const saved = savedCopy();
  // ClinicalTrials.gov results
  let f = fakeNews(world()); f.down.ctgovResults = true;
  let r = await run(f, { saved });
  assert.deepEqual(r.failedKinds, ["results"]); assert.equal(r.partial, true); assert.equal(r.anyLive, true); assert.deepEqual(r.usedSaved, ["results"]);
  assert.deepEqual(r.live.results.map((i) => i.id), ["results:NCT90000001"], "saved results for that kind only"); assert.equal(r.live.stopped.length, 5); assert.equal(r.live.approvals.length, 5);
  // stopped
  f = fakeNews(world()); f.down.ctgovStopped = "500";
  r = await run(f, { saved });
  assert.deepEqual(r.failedKinds, ["stopped"]); assert.deepEqual(r.live.stopped.map((i) => i.id), ["stopped:NCT90000002"]);
  // both registry feeds, openFDA fine
  f = fakeNews(world()); f.down.ctgovStopped = true; f.down.ctgovResults = true;
  r = await run(f, { saved });
  assert.deepEqual(r.failedKinds, ["results", "stopped"]); assert.equal(r.live.approvals.length, 5); assert.equal(r.anyLive, true);
  // openFDA
  f = fakeNews(world()); f.down.openfda = true;
  r = await run(f, { saved });
  assert.deepEqual(r.failedKinds, ["approvals"]); assert.deepEqual(r.live.approvals.map((i) => i.id), ["approval:NDA390001"]); assert.equal(r.live.results.length, 8);
  // RxNorm: approvals only through the saved DailyMed map; others hidden
  f = fakeNews(world()); f.down.rxnorm = true;
  r = await run(f, { saved });
  assert.deepEqual(r.failedKinds, []); assert.equal(r.partial, false);
  assert.deepEqual(r.live.approvals.map((i) => i.id), ["approval:NDA300002", "approval:BLA760001", "approval:NDA300005"]);
  assert.ok(r.live.approvals.every((i) => i.sourcesLabel === "Confirmed by Drugs@FDA + DailyMed"));
  assert.ok(f.count("rxnorm") <= 4, "the circuit breaker: after the first failures RxNorm is not asked again in this run");
  // RxNorm down and no DailyMed map at all: the approvals kind did not really answer
  f = fakeNews(world()); f.down.rxnorm = true;
  r = await run(f, { saved: { ...saved, dailymed: {} } });
  assert.deepEqual(r.failedKinds, ["approvals"]); assert.deepEqual(r.live.approvals.map((i) => i.id), ["approval:NDA390001"]);
  r = await run(f, { saved: null });
  assert.deepEqual(r.failedKinds, ["approvals"]); assert.deepEqual(r.live.approvals, []); assert.deepEqual(r.usedSaved, [], "no saved copy: nothing to fall back to");
  // PubMed down: Europe PMC alone decides
  f = fakeNews(world()); f.down.pubmed = true;
  r = await run(f, { saved });
  let it = r.live.results.find((i) => i.nct === "NCT10000001");
  assert.equal(it.level, 7); assert.equal(it.sourcesLabel, "Sources: ClinicalTrials.gov + Europe PMC"); assert.ok(!it.links.some((l) => /PubMed/.test(l[0])));
  it = r.live.results.find((i) => i.nct === "NCT10000002");
  assert.equal(it.level, 6, "PubMed would have found one, Europe PMC did not: with PubMed down the answer is 'none'"); assert.ok(it.summary.includes("Our search of Europe PMC for this study’s number (NCT10000002) found no journal article."));
  assert.deepEqual(r.failedKinds, []);
  assert.ok(f.count("pubmed") <= 4, "circuit breaker");
  // Europe PMC down: PubMed alone decides
  f = fakeNews(world()); f.down.epmc = "500";
  r = await run(f, { saved });
  it = r.live.results.find((i) => i.nct === "NCT10000001");
  assert.equal(it.sourcesLabel, "Sources: ClinicalTrials.gov + PubMed"); assert.equal(it.level, 7);
  // both journal searches down: neutral level 7, no 'not checked' claim
  f = fakeNews(world()); f.down.pubmed = true; f.down.epmc = true;
  r = await run(f, { saved });
  assert.ok(r.live.results.length === 8 && r.live.results.every((i) => i.level === 7 && i.sourcesLabel === "Source: ClinicalTrials.gov" && i.summary.includes(" We couldn’t search for a journal article just now.") && !/not checked/.test(i.summary)));
  assert.equal(r.partial, false);
});
test("pipeline: a failing PubMed is retried once after a pause while the other lookups wait; then it is left alone", async () => {
  const f = fakeNews(world()); f.down.pubmed = true;
  const io = f.io(), sleeps = []; io.sleep = async (ms) => { sleeps.push(ms); };
  const r = await N.newsRun(io, { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => null, pubmedRetryMs: 2000, concurrency: 4 });
  assert.deepEqual(sleeps, [2000], "one pause, not one per study");
  assert.ok(f.count("pubmed") <= 5, "4 in flight plus the one retry: " + f.count("pubmed"));
  assert.ok(r.live.results.every((i) => i.sourcesLabel === "Sources: ClinicalTrials.gov + Europe PMC" || i.sourcesLabel === "Source: ClinicalTrials.gov"));
  // a blip: the retry works, and nothing is lost
  const g = fakeNews(world()); let n = 0; const io2 = g.io(), orig = io2.fetchJson;
  io2.fetchJson = async (s, u, o) => { if (s === "pubmed" && n++ < 2) throw new TypeError("blip"); return orig(s, u, o); };
  const r2 = await N.newsRun(io2, { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => null, pubmedRetryMs: 2000, concurrency: 4 });
  assert.equal(r2.sources.pubmed, "ok", "a blip that the retry survives is not a failure");
  assert.equal(r2.live.results.find((i) => i.nct === "NCT10000001").sourcesLabel, "Sources: ClinicalTrials.gov + PubMed + Europe PMC", "the retried lookup still found its article");
});
test("pipeline: PubMed's rate limit (a 429 without CORS headers) is a failure, never 'none found'", async () => {
  const f = fakeNews(world()); f.down.pubmed = "429";
  const r = await run(f, { saved: savedCopy(), pubmedRetryMs: 2000 });
  const it = r.live.results.find((i) => i.nct === "NCT10000001");
  assert.equal(it.sourcesLabel, "Sources: ClinicalTrials.gov + Europe PMC", "Europe PMC still counts");
  const none2 = r.live.results.find((i) => i.nct === "NCT10000002");
  assert.equal(none2.level, 6); assert.ok(!none2.summary.includes("PubMed"));
});
test("pipeline: everything down, no saved copy: hand-picked only; everything down with a saved copy: the saved copy", async () => {
  const f = fakeNews(world()); for (const k of ["ctgovResults", "ctgovStopped", "openfda", "pubmed", "epmc", "rxnorm"]) f.down[k] = true;
  let r = await run(f, { saved: null });
  assert.equal(r.anyLive, false); assert.equal(r.items.length, 2); assert.ok(r.items.every((i) => i.hand));
  r = await run(f, { saved: savedCopy() });
  assert.equal(r.anyLive, false); assert.deepEqual(ids(r).sort(), ["approval:NDA390001", "results:NCT90000001", "stopped:NCT90000002"]);
});
test("pipeline: a malformed reply is a failure of that source only", async () => {
  const f = fakeNews(world());
  const io = f.io();
  const orig = io.fetchJson;
  io.fetchJson = async (s, u, o) => (s === "ctgov" && /^ResultsFirstPostDate/.test(new URL(u).searchParams.get("sort")) ? { unexpected: true } : s === "openfda" ? { results: "nope" } : orig(s, u, o));
  const r = await N.newsRun(io, { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => savedCopy() });
  assert.deepEqual(r.failedKinds, ["results", "approvals"], "the stopped feed still answered"); assert.equal(r.live.stopped.length, 5);
});
test("pipeline: a 400 on the registry retries once without the field list (same pattern as the saved-studies refresh)", async () => {
  const f = fakeNews(world()); const io = f.io(); const orig = io.fetchJson; const seen = [];
  io.fetchJson = async (s, u, o) => { if (s === "ctgov") { seen.push(new URL(u).searchParams.has("fields")); if (new URL(u).searchParams.has("fields")) throw Object.assign(new Error("bad"), { status: 400 }); } return orig(s, u, o); };
  const r = await N.newsRun(io, { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => null });
  assert.deepEqual(seen.slice(0, 4).sort(), [false, false, true, true]); assert.deepEqual(r.failedKinds, []);
});
test("pipeline: openFDA pages while total > skip + limit (at most 3 pages)", async () => {
  const many = Array.from({ length: 450 }, (_, i) => fdaRecord({ app: "NDA" + (400000 + i), brand: "B" + i, generics: ["g" + i] }));
  const f = fakeNews({ ...world(), fda: many });
  await run(f, { saved: null });
  assert.equal(f.count("openfda"), 3);
});

/* ================= snapshot job ================= */
const tmp = () => mkdtempSync(join(tmpdir(), "ts-news-"));
const fetchFor = (f) => async (url) => {
  const r = f.handle(String(url));
  if (!r || r.abort || r.noCors) throw new TypeError("fetch failed");
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json", ...(r.status === 429 ? { "retry-after": "2" } : {}) } });
};
const snap = (dir, f, o = {}) => runNewsSnapshot({ dataDir: dir, fetchImpl: fetchFor(f), pauseMs: 0, now: new Date(NEWS_NOW), dataTimestamp: "2026-10-14T09:00:05", hand: HAND(), ...o });
const rd = (dir) => JSON.parse(readFileSync(join(dir, "news.json"), "utf8"));
test("snapshot: first run writes news.json with the DailyMed confirmations", async () => {
  const dir = tmp(), f = fakeNews(world());
  const r = await snap(dir, f);
  assert.equal(r.changed, true);
  const j = rd(dir);
  assert.equal(j.version, 1); assert.equal(j.generatedAt, new Date(NEWS_NOW).toISOString()); assert.equal(j.dataTimestamp, "2026-10-14T09:00:05"); assert.equal(j.fdaUpdated, "2026-10-13"); assert.match(j.contentHash, /^[0-9a-f]{32}$/);
  assert.deepEqual(j.windows, { registryDays: 30, fdaDays: 90 });
  assert.deepEqual(Object.keys(j.dailymed).sort(), ["BLA760001", "NDA300002", "NDA300005"]);
  assert.equal(j.items.filter((i) => i.kind === "results").length, 8); assert.ok(j.items.every((i) => i.live && !i.hand));
  assert.ok(j.items.every((i) => N.newsCheckItem(i)), "every saved item passes the browser's own check");
  assert.ok(!JSON.stringify(j).includes("couldn’t search"), "the saved copy never contains an 'unknown' label");
  assert.ok(N.newsCheckSaved(j));
});
test("snapshot gate: nothing moved => one tiny openFDA request and nothing written", async () => {
  const dir = tmp(), f = fakeNews(world());
  await snap(dir, f);
  const raw = readFileSync(join(dir, "news.json"), "utf8");
  f.calls.length = 0;
  const r = await snap(dir, f, { now: new Date(NEWS_NOW + 3600e3) });
  assert.deepEqual(r, { changed: false, reason: "news-unchanged" });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].source, "openfda"); assert.equal(new URL(f.calls[0].url).searchParams.get("limit"), "1");
  assert.equal(readFileSync(join(dir, "news.json"), "utf8"), raw);
});
test("snapshot: only the clock changed => re-stamped, not deployed", async () => {
  const dir = tmp(), f = fakeNews(world());
  await snap(dir, f);
  const hash = rd(dir).contentHash;
  const r = await snap(dir, f, { now: new Date(NEWS_NOW + 25 * 3600e3) });
  assert.equal(r.changed, false); assert.equal(r.stamped, true);
  assert.equal(rd(dir).contentHash, hash); assert.equal(rd(dir).generatedAt, new Date(NEWS_NOW + 25 * 3600e3).toISOString());
  // registry moved but the content is the same: also a stamp
  const r2 = await snap(dir, f, { now: new Date(NEWS_NOW + 26 * 3600e3), dataTimestamp: "2026-10-15T09:00:05" });
  assert.equal(r2.stamped, true); assert.equal(r2.changed, false); assert.equal(rd(dir).dataTimestamp, "2026-10-15T09:00:05");
  // force
  f.calls.length = 0;
  assert.equal((await snap(dir, f, { now: new Date(NEWS_NOW + 27 * 3600e3), dataTimestamp: "2026-10-15T09:00:05", force: true })).stamped, true);
  assert.ok(f.calls.length > 1, "force skips the gate");
});
test("snapshot: new content => changed (commit and deploy)", async () => {
  const dir = tmp(), f = fakeNews(world());
  await snap(dir, f);
  f.spec.results = [regStudy({ nct: "NCT10000099", resultsDate: day(0) }), ...f.spec.results];
  const r = await snap(dir, f, { dataTimestamp: "2026-10-15T09:00:05" });
  assert.equal(r.changed, true); assert.ok(rd(dir).items.some((i) => i.id === "results:NCT10000099"));
});
test("snapshot: a failed registry feed or openFDA keeps the previous file", async () => {
  for (const src of ["ctgovResults", "ctgovStopped", "openfda"]) {
    const dir = tmp(), f = fakeNews(world());
    await snap(dir, f);
    const raw = readFileSync(join(dir, "news.json"), "utf8");
    f.down[src] = "500";
    const r = await snap(dir, f, { dataTimestamp: "2026-10-15T09:00:05", force: src !== "openfda" });
    assert.deepEqual(r, { changed: false, reason: "source-failed" }, src);
    assert.equal(readFileSync(join(dir, "news.json"), "utf8"), raw, src + ": the old file is untouched");
  }
  const dir = tmp(), f = fakeNews(world()); f.down.openfda = true;
  const r = await snap(dir, f);
  assert.deepEqual(r, { changed: false, reason: "source-failed" }); assert.ok(f.calls.length > 0 && f.calls.every((c) => c.source === "openfda"), "openFDA down at the gate: nothing else is asked");
  assert.ok(!existsSync(join(dir, "news.json")));
});
test("snapshot: a lookup that still fails only drops that item; nothing 'unknown' is ever saved", async () => {
  const dir = tmp(), f = fakeNews(world()); f.down.pubmed = true; f.down.epmc = true;
  const r = await snap(dir, f);
  assert.equal(r.changed, true);
  const j = rd(dir);
  assert.equal(j.items.filter((i) => i.kind === "results").length, 0, "no journal search could be made: no results items are saved");
  assert.ok(j.items.some((i) => i.kind === "stopped") && j.items.some((i) => i.kind === "approval"), "the rest is kept");
  // one source down: the other decides, items are kept
  const dir2 = tmp(), g = fakeNews(world()); g.down.pubmed = true;
  await snap(dir2, g);
  assert.equal(rd(dir2).items.filter((i) => i.kind === "results").length, 8);
});
test("snapshot: retries on 429 and 5xx, honouring the retry, then gives up on that item", async () => {
  const f = fakeNews(world());
  let pmCalls = 0;
  const base = fetchFor(f);
  const fetchImpl = async (url) => { if (/eutils/.test(url) && pmCalls++ === 0) return new Response("{}", { status: 429, headers: { "retry-after": "1" } }); return base(url); };
  const dir = tmp();
  await runNewsSnapshot({ dataDir: dir, fetchImpl, pauseMs: 0, now: new Date(NEWS_NOW), hand: HAND(), dataTimestamp: null });
  assert.equal(rd(dir).items.filter((i) => i.kind === "results").length, 8);
  assert.ok(pmCalls >= 9, "the first PubMed request was retried");
});
test("snapshot step can never fail the job", async () => {
  const dir = tmp(), orig = console.error; console.error = () => {};
  try {
    assert.deepEqual(await runNewsStep({ dataDir: dir, fetchImpl: fetchFor(fakeNews(world())), pauseMs: 0, hand: 5 }), { changed: false, stamped: false, reason: "error" });
    assert.deepEqual(await runNewsStep({ dataDir: dir, fetchImpl: () => { throw new Error("boom"); }, pauseMs: 0, hand: HAND() }), { changed: false, reason: "source-failed" });
    writeFileSync(join(dir, "a-file"), "x");
    assert.equal((await runNewsStep({ dataDir: join(dir, "a-file", "data"), fetchImpl: fetchFor(fakeNews(world())), pauseMs: 0, hand: HAND() })).reason, "error", "a data folder that cannot be created");
  } finally { console.error = orig; }
});
test("snapshot.mjs CLI: the news step's result is merged into GITHUB_OUTPUT, and a broken news step never fails the job", () => {
  const dir = tmp();
  for (const d of ["scripts", "shared", "app"]) cpSync(join(root, d), join(dir, d), { recursive: true });
  cpSync(join(root, "package.json"), join(dir, "package.json"));
  writeFileSync(join(dir, "preload.mjs"), `
    import { fakeNews, world } from ${JSON.stringify(join(root, "test/helpers/news-fixtures.mjs"))};
    const f = fakeNews(world());
    const later = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => later(fn, ms > 30000 || ms === Number(process.env.NEWS_STEP_LIMIT_MS) ? ms : 0, ...a);   // the job paces its requests politely; the test does not need to wait for that (the long limits stay real)
    globalThis.fetch = async (url) => {
      url = String(url);
      if (url.endsWith("/version")) return Response.json({ apiVersion: "2.0.5", dataTimestamp: "2026-10-09T09:00:05" });
      const r = f.handle(url);
      if (r) return new Response(JSON.stringify(r.json), { status: r.status });
      if (url.includes("clinicaltrials.gov")) return Response.json({ studies: [] });   // the study snapshot's own requests
      throw new Error("unexpected request " + url);
    };`);
  const out = join(dir, "out"), newsFile = join(dir, "site/data/news.json");
  const cli = () => { writeFileSync(out, ""); return spawnSync(process.execPath, ["--import", join(dir, "preload.mjs"), join(dir, "scripts/snapshot.mjs")], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out } }); };
  const a = cli();
  assert.equal(a.status, 0, a.stderr);
  assert.ok(existsSync(newsFile)); assert.match(a.stderr, /news: \{"changed":true/);
  assert.equal(readFileSync(out, "utf8"), "changed=true\nstamped=false\n");
  rmSync(newsFile);                                       // the study snapshot is gated now; only the news step has something to say
  const b = cli();
  assert.equal(b.status, 0, b.stderr); assert.deepEqual(JSON.parse(b.stdout), { changed: false, reason: "registry-unchanged" });
  assert.ok(existsSync(newsFile)); assert.equal(readFileSync(out, "utf8"), "changed=true\nstamped=false\n", "news.changed alone drives the deploy");
  rmSync(newsFile);
  writeFileSync(join(dir, "scripts/news-snapshot.mjs"), "throw new Error('broken');");
  const c = cli();
  assert.equal(c.status, 0, "the job survives a news step that cannot even load"); assert.match(c.stderr, /news: skipped \(broken\)/);
  assert.equal(readFileSync(out, "utf8"), "changed=false\nstamped=false\n");
});

/* ================= advisor fixes: one test (or more) per fix ================= */

/* ---- 1. a search that found nothing never claims more than it knows ---- */
test("fix 1: 'no article found' is a statement about OUR search, never about the world; the old 'not checked yet' wording is gone everywhere", () => {
  const s = one({ nct: "NCT05139316", resultsDate: "2026-10-13" });   // DTX401: its pivotal paper exists but never mentions the NCT id in the title or abstract
  const it = N.newsResultItem(s, N.newsJournal(none, none));
  assert.equal(it.level, 6);
  assert.ok(it.summary.includes(" Our search of PubMed and Europe PMC for this study’s number (NCT05139316) found no journal article. Searches can miss articles, so one may already exist."));
  assert.ok(!/not checked|outside experts|yet\b/.test(it.summary), "no 'not checked', no 'outside experts', no 'yet': " + it.summary);
  assert.ok(it.summary.includes("may already exist"));
  const plainSrc = readFileSync(join(root, "app/plain.js"), "utf8");
  assert.ok(plainSrc.includes('6:{key:"early", label:"Results posted, no article found", why:"The study team posted its results on the official registry. Our search found no journal article about the study, but searches can miss articles."}'));
  assert.ok(/7:\{key:"early", label:"Results posted", why:"The study team posted its results on the official registry\."\}/.test(plainSrc), "level 7 is unchanged");
  const old = "Results posted, " + "not checked yet";
  for (const f of ["README.md", "docs/ARCHITECTURE.md", "app/plain.js", "app/views.js", "app/news.js", "shared/news.js", "site/data/news.json", "test/news.test.mjs", "test/e2e/pages-only.mjs"]) assert.ok(!readFileSync(join(root, f), "utf8").includes(old), `${f} still has the old level-6 label`);
  const saved = JSON.parse(readFileSync(join(root, "site/data/news.json"), "utf8"));
  assert.ok(!JSON.stringify(saved).match(/outside experts|found no journal article about this study yet/), "the saved copy carries the new text");
});
test("fix 1: levels 6 and 7 stay off the 'how sure' ladders (the home page list and the study page rungs are exactly levels 1 to 4)", () => {
  const views = readFileSync(join(root, "app/views.js"), "utf8");
  assert.ok(views.includes('$("#scale").innerHTML = [4,3,2,1].map('), "the home page's explainer lists levels 4, 3, 2, 1");
  assert.ok(views.includes("${[1,2,3,4].map(l=>"), "the study page's ladder has rungs 1 to 4");
  assert.ok(!/\[[\d, ]*[67][\d, ]*\]\.map\(/.test(views), "no list of levels reaches 6 or 7");
});

/* ---- 2. the intro names only sources that answered ---- */
test("fix 2: newsRun reports which sources answered, from the network or from the cache", async () => {
  const names = (r) => Object.keys(r.answered).filter((k) => r.answered[k]).sort();
  const o = { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => savedCopy() };
  const f = fakeNews(world()), io = f.io({ memory: true });
  const r1 = await N.newsRun(io, o);
  assert.deepEqual(names(r1), ["ctgovResults", "ctgovStopped", "epmc", "openfda", "pubmed", "rxnorm"]);
  const n = f.calls.length;
  const r2 = await N.newsRun(io, o);
  assert.equal(f.calls.length, n, "the second run is entirely cached");
  assert.deepEqual(r2.answered, r1.answered, "a fully cached run still names its sources");
  let g = fakeNews(world()); g.down.pubmed = true; g.down.epmc = true;
  assert.deepEqual(names(await N.newsRun(g.io(), o)), ["ctgovResults", "ctgovStopped", "openfda", "rxnorm"], "both journal sources down: neither is named");
  g = fakeNews(world()); g.down.openfda = true;
  assert.deepEqual(names(await N.newsRun(g.io(), o)), ["ctgovResults", "ctgovStopped", "epmc", "pubmed"], "openFDA down: the FDA, and RxNorm (never asked), are not named");
  g = fakeNews(world()); g.down.rxnorm = true;
  assert.ok(!names(await N.newsRun(g.io(), o)).includes("rxnorm"));
  g = fakeNews(world()); g.down.ctgovResults = true;
  const r = await N.newsRun(g.io(), o);
  assert.ok(!r.answered.ctgovResults && r.answered.ctgovStopped);
});

/* ---- 3. phase wording ---- */
test("fix 3: no 'large': phase 3 is a final-stage test, phase 2/3 a combined mid-stage and final-stage test", () => {
  const base = { nct: "NCT10000001", resultsDate: "2026-10-13", enrollment: 2 };
  assert.ok(N.newsResultItem(one(base), N.newsJournal(none, none)).summary.startsWith("Acme Pharma ran this final-stage test (phase 3) with 2 people."));
  assert.ok(N.newsResultItem(one({ ...base, phases: ["PHASE2", "PHASE3"] }), N.newsJournal(none, none)).summary.startsWith("Acme Pharma ran this combined mid-stage and final-stage test (phase 2/3) with 2 people."));
  assert.ok(N.newsResultItem(one({ ...base, phases: ["PHASE2"] }), N.newsJournal(none, none)).summary.startsWith("Acme Pharma ran this study with 2 people."));
  const src = readFileSync(join(root, "shared/news.js"), "utf8");
  assert.ok(!/final large test|large test/.test(src), "the word 'large' is gone from the generated copy");
});

/* ---- 5. stopped caveat: covered in 'stopped item wording' ---- */

/* ---- 6. the news step cannot outlive its deadline ---- */
// A stalled socket keeps a real process alive; AbortSignal.timeout's own timer does not (it is unref'd), so the fake keeps one itself.
const hangUntilAborted = (init) => new Promise((_, rej) => { const keep = setInterval(() => {}, 25); init.signal.addEventListener("abort", () => { clearInterval(keep); rej(init.signal.reason); }); });
test("fix 6: a DailyMed that accepts connections and never answers is cut off by the deadline; the previous file stays", async () => {
  const dir = tmp(), f = fakeNews(world());
  await snap(dir, f);
  const raw = readFileSync(join(dir, "news.json"), "utf8"), base = fetchFor(f);
  let dm = 0;
  const fetchImpl = (url, init) => { if (/dailymed/.test(url)) { dm++; return hangUntilAborted(init); } return base(url, init); };
  const t0 = Date.now();
  const r = await snap(dir, f, { fetchImpl, dataTimestamp: "2026-10-15T09:00:05", deadlineMs: 500 });
  const took = Date.now() - t0;
  assert.deepEqual(r, { changed: false, reason: "deadline" });
  assert.ok(took >= 400 && took < 4000, `the run ends at about the deadline (took ${took} ms)`);
  assert.equal(readFileSync(join(dir, "news.json"), "utf8"), raw, "the previous news.json is untouched");
  assert.ok(dm >= 1 && dm <= 2, "after the deadline nothing more is asked: " + dm);
  assert.equal(DEADLINE_MS, 4 * 60 * 1000, "the default deadline is 4 minutes");
});
test("fix 6: a hung request is bounded by the time left, not by its own long timeout", async () => {
  const io = makeIo((url, init) => hangUntilAborted(init), 0, { deadlineMs: 300 });
  const t0 = Date.now();
  await assert.rejects(io.fetchJson("dailymed", "https://dailymed.nlm.nih.gov/x", { timeoutMs: 15000 }));
  assert.ok(Date.now() - t0 < 2500, "ended near the deadline, not after 15 s");
  assert.equal(io.expired(), true);
  await assert.rejects(io.fetchJson("pubmed", "https://x.test/"), /news deadline/, "once expired, every call throws at once");
});
test("fix 6: two DailyMed lookups in a row that still fail end the DailyMed round; one failure does not", async () => {
  const dmApps = [], f = fakeNews(world()), base = fetchFor(f);
  const dmDown = (url) => /dailymed/.test(url) && (dmApps.push(new URL(url).searchParams.get("application_number")), true);
  let dir = tmp();
  let r = await snap(dir, f, { fetchImpl: async (url, init) => (dmDown(url) ? new Response("{}", { status: 503 }) : base(url, init)) });
  assert.equal(r.changed, true, "DailyMed down never fails the news step");
  assert.equal(dmApps.length, 8, "2 lookups x (1 try + 3 retries), then nothing more: " + dmApps.length);
  assert.deepEqual(rd(dir).dailymed, {}, "nothing is saved that DailyMed did not confirm");
  assert.ok(rd(dir).items.some((i) => i.kind === "approval"), "RxNorm still vouches for the rest");
  // one failed lookup only: the next one works and resets the count
  dmApps.length = 0; let first = true; dir = tmp();
  r = await snap(dir, f, { fetchImpl: async (url, init) => (/dailymed/.test(url) ? (dmApps.push(1), first && dmApps.length <= 4 ? new Response("{}", { status: 503 }) : (first = false, base(url, init))) : base(url, init)) });
  assert.ok(dmApps.length > 8, "the round continued after a single failure: " + dmApps.length);
  assert.deepEqual(Object.keys(rd(dir).dailymed).sort(), ["BLA760001", "NDA300002", "NDA300005"]);
});
test("fix 6: retries and pauses past the deadline are not taken", async () => {
  const slept = []; let calls = 0;
  const io = makeIo(async () => { calls++; return new Response("{}", { status: 503, headers: { "retry-after": "30" } }); }, undefined, { deadlineMs: 5000 });
  const t0 = Date.now();
  await assert.rejects(io.fetchJson("rxnorm", "https://x.test/"), /news deadline/);
  assert.equal(calls, 1, "a 30 s retry-after past a 5 s deadline is not waited for");
  assert.ok(Date.now() - t0 < 1000);
  void slept;
});
test("snapshot.mjs CLI: a news step that never finishes is cut off by the outer limit and cannot hold the job open", () => {
  const dir = tmp();
  for (const d of ["scripts", "shared", "app"]) cpSync(join(root, d), join(dir, d), { recursive: true });
  cpSync(join(root, "package.json"), join(dir, "package.json"));
  writeFileSync(join(dir, "scripts/news-snapshot.mjs"), "export const runNewsStep = () => { setInterval(() => {}, 1000); return new Promise(() => {}); };");   // never resolves, and leaves a live timer behind
  writeFileSync(join(dir, "preload.mjs"), `
    const later = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => later(fn, ms === Number(process.env.NEWS_STEP_LIMIT_MS) ? ms : 0, ...a);
    globalThis.fetch = async (url) => String(url).endsWith("/version") ? Response.json({ apiVersion: "2.0.5", dataTimestamp: "2026-10-09T09:00:05" }) : Response.json({ studies: [] });`);
  const out = join(dir, "out"); writeFileSync(out, "");
  const t0 = Date.now();
  const a = spawnSync(process.execPath, ["--import", join(dir, "preload.mjs"), join(dir, "scripts/snapshot.mjs")], { encoding: "utf8", timeout: 30000, env: { ...process.env, GITHUB_OUTPUT: out, NEWS_STEP_LIMIT_MS: "400" } });
  assert.equal(a.status, 0, "exits 0 by itself (status " + a.status + ", signal " + a.signal + "): " + a.stderr);
  assert.ok(Date.now() - t0 < 20000);
  assert.match(a.stderr, /"reason":"timeout"/);
  assert.match(readFileSync(out, "utf8"), /^changed=(true|false)\nstamped=(true|false)\n$/, "both outputs are written before the job moves on");
  assert.ok(a.stdout.trim().startsWith("{") && JSON.parse(a.stdout.trim().split("\n")[0]), "the study snapshot's own line survived the exit");
});

/* ---- 8. the registry stories do not wait for openFDA, the approvals do not wait for the journal searches ---- */
test("fix 8: openFDA, the journal searches and RxNorm run side by side", async () => {
  const waitFor = (p, ms = 3000) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
  // (a) openFDA answers only after the first PubMed request has started: a pipeline that waited for openFDA first would stall
  let f = fakeNews(world()), io = f.io(), base = io.fetchJson, release, gate = new Promise((r) => (release = r)), fdaGotJournal = null;
  io.fetchJson = async (s, u, o) => { if (s === "pubmed") release(); if (s === "openfda") fdaGotJournal = await waitFor(gate); return base(s, u, o); };
  let t0 = Date.now(), r = await N.newsRun(io, { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => null });
  assert.equal(fdaGotJournal, true, "the journal lookups started while openFDA was still pending");
  assert.ok(Date.now() - t0 < 2500 && r.failedKinds.length === 0 && r.live.approvals.length > 0 && r.live.results.length === 8);
  // (b) the journal searches are slow; RxNorm must start before the first one answers
  f = fakeNews(world()); io = f.io(); base = io.fetchJson;
  let rxStarted, rxGate = new Promise((res) => (rxStarted = res)), pmWaited = null;
  io.fetchJson = async (s, u, o) => { if (s === "rxnorm") rxStarted(); if (s === "pubmed" || s === "epmc") pmWaited = pmWaited ?? await waitFor(rxGate); return base(s, u, o); };
  t0 = Date.now(); r = await N.newsRun(io, { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => null });
  assert.equal(pmWaited, true, "the approvals pipeline reached RxNorm while the journal searches were pending");
  assert.ok(Date.now() - t0 < 2500 && r.failedKinds.length === 0);
  // (c) elapsed time: openFDA takes T, each journal lookup J: the whole run takes about T, not T + journal time
  f = fakeNews(world()); io = f.io(); base = io.fetchJson;
  const T = 350, J = 150;
  io.fetchJson = async (s, u, o) => { if (s === "openfda") await new Promise((x) => setTimeout(x, T)); if (s === "pubmed" || s === "epmc") await new Promise((x) => setTimeout(x, J)); return base(s, u, o); };
  t0 = Date.now(); r = await N.newsRun(io, { nowMs: NEWS_NOW, hand: HAND(), getSaved: async () => null, concurrency: 4 });
  const took = Date.now() - t0;   // sequential: T + 2 rounds x J = 650+; side by side: about T
  assert.ok(took < T + 2 * J - 20, `finished in about T (${took} ms)`);
  assert.equal(r.live.results.length, 8);
});

/* ---- 10. openFDA 404 ---- */
test("fix 10: only openFDA's own NOT_FOUND 404 means 'no matches'; the empty list is never cached; any other 404 is a failure", async () => {
  const f = fakeNews({ results: [], stopped: [], fda: [] });
  const io = f.io({ memory: true }), puts = [], put = io.cache.put;
  io.cache.put = (k, v) => { puts.push(k); put(k, v); };
  let r = await N.newsRun(io, { nowMs: NEWS_NOW });
  assert.equal(r.sources.openfda, "ok"); assert.deepEqual(r.live.approvals, []); assert.deepEqual(r.failedKinds, []);
  assert.ok(!puts.some((k) => k.startsWith("fda:")), "an empty candidate list is not cached");
  const n = f.count("openfda");
  await N.newsRun(io, { nowMs: NEWS_NOW });
  assert.equal(f.count("openfda"), n + 1, "so it is asked again next time");
  // a bare 404 (a proxy, a gateway, a moved URL): the feed failed, the saved copy fills in
  f.down.openfda = "404";
  r = await N.newsRun(f.io(), { nowMs: NEWS_NOW, getSaved: async () => savedCopy() });
  assert.equal(r.sources.openfda, "failed"); assert.deepEqual(r.failedKinds, ["approvals"]); assert.deepEqual(r.live.approvals.map((i) => i.id), ["approval:NDA390001"]);
  // a populated list IS cached
  const g = fakeNews(world()), io2 = g.io({ memory: true });
  await N.newsRun(io2, { nowMs: NEWS_NOW });
  assert.equal(g.count("openfda"), 1);
  await N.newsRun(io2, { nowMs: NEWS_NOW });
  assert.equal(g.count("openfda"), 1);
});
test("fix 10: the Node side attaches openFDA's error code, and the snapshot gate follows the same rule", async () => {
  const reply = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const get = (status, body) => makeIo(reply(status, body), 0).fetchJson("openfda", "https://api.fda.gov/x").then(() => null, (e) => e);
  const nf = await get(404, { error: { code: "NOT_FOUND", message: "No matches found!" } });
  assert.equal(nf.status, 404); assert.equal(nf.code, "NOT_FOUND");
  const bare = await get(404, "<html>Not Found</html>");
  assert.equal(bare.status, 404); assert.equal(bare.code, undefined);
  assert.equal((await get(404, { error: { code: "<script>alert(1)</script>" } })).code, undefined, "a code that is not SHOUTY_SNAKE is ignored");
  assert.equal((await get(404, { message: "Not Found" })).code, undefined);
  // the gate: NOT_FOUND = no approvals right now, carry on; a bare 404 = openFDA is not answering
  const dir = tmp(), f = fakeNews({ results: [], stopped: [], fda: [] });
  assert.equal((await snap(dir, f)).changed, true, "NOT_FOUND at the gate is an empty answer");
  const dir2 = tmp(), g = fakeNews(world()); g.down.openfda = "404";
  assert.deepEqual(await snap(dir2, g), { changed: false, reason: "source-failed" }, "a bare 404 at the gate is a failure");
});

/* ---- 11. long tokens ---- */
test("fix 11: newsBreakHtml escapes first-class, breaks long runs, and never cuts an entity or a character", () => {
  const B = N.newsBreakHtml;
  assert.equal(B("A short sentence with <b>markup</b> & more."), "A short sentence with &lt;b&gt;markup&lt;/b&gt; &amp; more.", "short words are only escaped");
  assert.equal(B("a".repeat(18)), "a".repeat(18), "18 characters: untouched");
  assert.equal(B("a".repeat(19)), "a".repeat(12) + "<wbr>" + "a".repeat(7), "19 characters: a break after 12");
  const url = "https://example.org/" + "x".repeat(90);
  const out = B("See " + url + " now");
  assert.ok(out.startsWith("See https:/<wbr>/<wbr>example.org/<wbr>xxxxxxxxxxxx<wbr>") && out.endsWith("<wbr>xxxxxx now"), out);
  assert.equal(out.replace(/<wbr>/g, ""), "See " + url + " now", "removing the breaks gives the original text back");
  const noTags = out.replace(/<wbr>/g, "");
  assert.ok(!/<(?!\/?wbr>)/.test(out) && noTags.indexOf("<") === -1);
  // hostile strings stay inert, whatever a break lands next to
  for (const h of ['<script>alert(1)</script>'.repeat(4), "&amp;&lt;&gt;".repeat(8), '"onmouseover="x'.repeat(5), "'><img src=x onerror=alert(1)>".repeat(3)]) {
    const html = B(h);
    assert.ok(!/<(?!wbr>)/.test(html), "the only tags are <wbr>: " + html.slice(0, 80));
    const decoded = html.replace(/<wbr>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    assert.equal(decoded, h, "decodes back to exactly the input");
    for (const piece of html.split("<wbr>")) assert.ok(!/&[#\w]*$/.test(piece) || /&(amp|lt|gt|quot|#39);$/.test(piece), "no piece ends inside an entity: " + piece.slice(-12));
  }
  // emoji (surrogate pairs) are never split
  const emoji = B("😀".repeat(40));
  assert.ok(!/[\ud800-\udbff]<wbr>/.test(emoji) && !/<wbr>[\udc00-\udfff]/.test(emoji), "no break inside a surrogate pair");
  assert.equal(emoji.replace(/<wbr>/g, ""), "😀".repeat(40));
  assert.equal(B(""), ""); assert.equal(B(null), ""); assert.equal(B(undefined), ""); assert.equal(B(12345678901234567890n), "12345678901234567890".slice(0, 12) + "<wbr>" + "12345678901234567890".slice(12));
  assert.equal(B("a ".repeat(30)), "a ".repeat(30), "many short words: untouched");
  assert.equal(B("x".repeat(30) + "\n" + "y".repeat(30)).split("<wbr>").length, 5, "newlines separate runs: 12 + 12 + 6 characters each, so two breaks in each");
});
test("fix 11: live stories use it, hand-picked stories do not (their HTML stays byte for byte)", () => {
  const views = readFileSync(join(root, "app/views.js"), "utf8");
  assert.ok(views.includes("const text = n.hand ? esc : newsBreakHtml;") && views.includes("<h3>${text(n.title)}</h3><p class=\"muted\">${text(n.summary)}</p>"));
  const css = readFileSync(join(root, "app/shell.html"), "utf8");
  assert.ok(!/overflow-wrap|word-break/.test(css), "the design lock holds: no new CSS rule was needed");
});

/* ================= no collisions, build output ================= */
const topLevel = (src) => [...src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
test("identifiers: shared/news.js and app/news.js never collide with the other scripts or with each other", () => {
  const src = (p) => readFileSync(join(root, p), "utf8");
  const shared = topLevel(src("shared/news.js")), ctl = topLevel(src("app/news.js"));
  assert.equal(new Set(shared).size, shared.length, "no name declared twice in shared/news.js");
  assert.equal(new Set(ctl).size, ctl.length);
  const others = [...readdirSync(join(root, "app")).filter((f) => f.endsWith(".js") && f !== "news.js").map((f) => "app/" + f)].flatMap((p) => topLevel(src(p)));
  for (const name of [...shared, ...ctl]) assert.ok(!others.includes(name), `${name} is already declared by another script`);
  for (const name of ctl) assert.ok(!shared.includes(name), `${name} is declared in shared/news.js too`);
  for (const name of shared) assert.ok(/^(news|NEWS_)/.test(name), `${name} must start with news / NEWS_`);
  for (const name of ctl) assert.ok(/^(news|NEWS|newsls)/i.test(name), `${name} must start with news / NEWS`);
  assert.ok(!/^\s*import\b/m.test(src("shared/news.js")), "no imports");
});
test("build: shared/news.js is inlined as a classic script, the CSP gains exactly the four hosts", () => {
  const dir = tmp();
  for (const d of ["scripts", "shared", "app"]) cpSync(join(root, d), join(dir, d), { recursive: true });
  execFileSync(process.execPath, [join(dir, "scripts/build-site.mjs")], { encoding: "utf8", cwd: dir });
  const app = readFileSync(join(dir, "site/assets/app.js"), "utf8");
  assert.ok(app.startsWith("/* ---- shared/news.js ---- */"));
  assert.ok(!/^\s*(import|export)\b/m.test(app), "no module syntax in the page script");
  assert.ok(app.indexOf("function newsRun") < app.indexOf("/* ---- core.js ---- */") && app.indexOf("/* ---- live.js ---- */") < app.indexOf("/* ---- news.js ---- */") && app.indexOf("/* ---- news.js ---- */") < app.indexOf("/* ---- views.js ---- */"));
  assert.doesNotThrow(() => new vm.Script(app), "parses as a classic script (no duplicate const / let)");
  const html = readFileSync(join(dir, "site/index.html"), "utf8");
  const csp = /connect-src ([^;"]*)/.exec(html)[1].split(" ");
  assert.deepEqual(csp, ["'self'", "https://clinicaltrials.gov", ...N.NEWS_CONNECT_HOSTS]);
  assert.ok(!/dailymed/.test(html.match(/Content-Security-Policy"[^>]*>/)[0]));
  assert.ok(!/aria-live/.test(html.slice(html.indexOf('id="newsLive"') - 200, html.indexOf('id="newsList"'))), "no aria-live on the news intro");
  assert.ok(html.includes('each labelled with how sure we can be. Stories marked “Picked by hand” were chosen and written by a person. <span id="newsLive">Checking ClinicalTrials.gov and the FDA…</span></p>'), "the live text comes last, so a changing sentence never moves the fixed ones");
  assert.ok(!html.includes("last checked on 12 October 2026"), "the fixed 'last checked' text is gone");
});
