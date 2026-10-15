// Fakes for the live "What's new" sources (ClinicalTrials.gov news queries, openFDA, RxNorm, PubMed, Europe PMC, DailyMed).
// One fake serves the unit tests (as the `io` of newsRun) and the browser test (behind Playwright's routing), so both exercise the
// same replies. Builders produce the real response shapes. Switches in `down` take a source offline on its own.
import { readFileSync } from "node:fs";

export const fixture = (name) => JSON.parse(readFileSync(new URL("../fixtures/news/" + name, import.meta.url), "utf8"));
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);   // the browser test runs its clock here, so every date below is stable
export const NEWS_NOW = NOW;
export const day = (n) => new Date(NOW - n * 864e5).toISOString().slice(0, 10);

/** One v2 study with only the fields the news queries ask for. */
export function regStudy({ nct, title = "A study", status = "COMPLETED", whyStopped, sponsor = "Acme Pharma", phases = ["PHASE3"], enrollment = 120, enrollmentType = "ACTUAL",
  conditions = ["Asthma"], interventions = [["Zedrafil", "DRUG"], ["Placebo", "DRUG"]], resultsDate, updated, verified = "2026-10", pcd = "2026-03-01", cd, cdType = "ACTUAL" } = {}) {
  const st = { overallStatus: status, statusVerifiedDate: verified, primaryCompletionDateStruct: { date: pcd }, lastUpdatePostDateStruct: { date: updated || resultsDate || day(2) } };
  if (whyStopped !== undefined) st.whyStopped = whyStopped;
  if (cd !== null) st.completionDateStruct = { date: cd || pcd, type: cdType };
  if (resultsDate) st.resultsFirstPostDateStruct = { date: resultsDate };
  return { protocolSection: {
    identificationModule: { nctId: nct, briefTitle: title }, statusModule: st,
    sponsorCollaboratorsModule: { leadSponsor: { name: sponsor, class: "INDUSTRY" } }, conditionsModule: { conditions },
    designModule: { phases, enrollmentInfo: { count: enrollment, type: enrollmentType } },
    armsInterventionsModule: { interventions: interventions.map(([name, type]) => ({ name, ...(type ? { type } : {}) })) },
  }, hasResults: !!resultsDate };
}
/** One drugsfda record: its own original submission plus whatever else the test adds. */
export function fdaRecord({ app, brand, generics = ["zedrafil"], cls = "TYPE 1", date = "20260920", status = "AP", type = "ORIG", extra = [] }) {
  return { application_number: app, sponsor_name: "ACME PHARMA",
    submissions: [{ submission_type: type, submission_number: "1", submission_status: status, submission_status_date: date, submission_class_code: cls }, ...extra],
    products: [{ product_number: "001", brand_name: brand ?? "", active_ingredients: generics.map((g) => ({ name: g.toUpperCase(), strength: "10MG" })), dosage_form: "TABLET", route: "ORAL", marketing_status: "Prescription" }] };
}
export const rxJson = (names) => ({ drugGroup: { name: null, conceptGroup: [{ tty: "BPCK" }, ...(names.length ? [{ tty: "SBD", conceptProperties: names.map((name, i) => ({ rxcui: String(2752693 + i), name, synonym: "", tty: "SBD" })) }] : [])] } });

/**
 * @param spec.results   regStudy() objects for the results feed (already in the registry's order)
 * @param spec.stopped   regStudy() objects for the stopped feed
 * @param spec.fda       fdaRecord() objects
 * @param spec.rx        { "brand": ["camizestrant 75 MG Oral Tablet [Etcamah]"] }
 * @param spec.pm / ep   { "NCT…": { n, id } }; anything else answers zero hits
 * @param spec.dailymed  { "NDA…": { setid, title } }  (what the snapshot's DailyMed would say)
 */
export function fakeNews(spec = {}) {
  const f = { spec, down: {}, calls: [], status: {} };
  const hit = (map, nct) => map && map[nct];
  f.handle = (urlString) => {
    const u = new URL(urlString), p = u.searchParams, host = u.host;
    const call = (source) => { f.calls.push({ source, url: urlString, t: Date.now() }); return source; };
    const json = (body, status = 200) => ({ status, json: body });
    const down = (source) => { const d = f.down[source]; if (!d) return null; return d === "429" ? { status: 429, json: fixture("pubmed-429.json"), noCors: true } : d === "500" ? { status: 500, json: { error: "down" } } : d === "404" ? { status: 404, json: { message: "Not Found" } } : { abort: true }; };
    if (host === "clinicaltrials.gov" && u.pathname.endsWith("/studies") && !p.has("filter.ids")) {
      const kind = /ResultsFirstPostDate/.test(p.get("sort") || "") ? "results" : p.has("filter.overallStatus") ? "stopped" : null;
      if (!kind) return null;   // an ordinary registry request: the caller's own fake answers it
      const src = call(kind === "results" ? "ctgovResults" : "ctgovStopped");
      return down(src) || json({ studies: kind === "results" ? spec.results || [] : spec.stopped || [] });
    }
    if (host === "api.fda.gov") {
      const src = call("openfda");
      if (down(src)) return down(src);
      const all = spec.fda || [];
      if (!all.length) return json({ error: { code: "NOT_FOUND", message: "No matches found!" } }, 404);
      const skip = Number(p.get("skip") || 0), limit = Number(p.get("limit") || 100);
      return json({ meta: { last_updated: "2026-10-13", results: { skip, limit, total: all.length } }, results: all.slice(skip, skip + limit) });
    }
    if (host === "rxnav.nlm.nih.gov") {
      const src = call("rxnorm");
      return down(src) || json(rxJson((spec.rx || {})[String(p.get("name")).toLowerCase()] || []));
    }
    if (host === "eutils.ncbi.nlm.nih.gov") {
      const src = call("pubmed");
      if (down(src)) return down(src);
      const h = hit(spec.pm, String(p.get("term")).replace("[si]", ""));
      return json({ header: { type: "esearch", version: "0.3" }, esearchresult: { count: String(h ? h.n : 0), retmax: "1", retstart: "0", idlist: h && h.id ? [h.id] : [], translationset: [] } });
    }
    if (host === "www.ebi.ac.uk") {
      const src = call("epmc");
      if (down(src)) return down(src);
      const h = hit(spec.ep, (String(p.get("query")).match(/NCT\d{8}/) || [])[0]);
      return json({ version: "6.9", hitCount: h ? h.n : 0, resultList: { result: h && h.id ? [{ id: h.id, source: "MED", pmid: h.id }] : [] } });
    }
    if (host === "dailymed.nlm.nih.gov") {
      const src = call("dailymed");
      if (down(src)) return down(src);
      const d = (spec.dailymed || {})[p.get("application_number")];
      return json({ data: d ? [{ spl_version: 1, published_date: "Sep 10, 2026", title: d.title, setid: d.setid }] : [], metadata: { total_elements: d ? 1 : 0 } });
    }
    return null;
  };
  /** The Node-side `io` for newsRun(): same replies, no waiting. `memory` adds an in-memory cache. */
  f.io = ({ memory = false } = {}) => {
    const m = new Map();
    return {
      sleep: async () => {},
      fetchJson: async (source, url) => {
        const r = f.handle(url);
        if (!r || r.abort || r.noCors) throw new TypeError("fetch failed");
        if (r.status >= 400) throw Object.assign(new Error(source + " " + r.status), { status: r.status }, r.json && r.json.error && typeof r.json.error.code === "string" ? { code: r.json.error.code } : {});
        return r.json;
      },
      cache: memory ? { get: (k) => m.get(k), put: (k, v) => m.set(k, v) } : null,
    };
  };
  f.count = (source) => f.calls.filter((c) => c.source === source).length;
  return f;
}

/** A small believable world: 10 results (2 find articles), 7 stopped, 8 FDA approvals of which some are corroborated. */
export function world() {
  const results = [
    regStudy({ nct: "NCT10000001", resultsDate: day(1), enrollment: 85, interventions: [["Obinutuzumab", "DRUG"]], conditions: ["Nephrotic Syndrome"], sponsor: "Roche" }),
    regStudy({ nct: "NCT10000002", resultsDate: day(2), enrollment: 900, interventions: [["Itepekimab SAR440340", "BIOLOGICAL"]], conditions: ["COPD"], sponsor: "Sanofi" }),
    regStudy({ nct: "NCT10000003", resultsDate: day(3), status: "TERMINATED", whyStopped: "Business decision.", interventions: [["Zedrafil", "DRUG"]], conditions: ["Asthma"], cd: "2026-09-10" }),   // also in the stopped feed
    regStudy({ nct: "NCT04964934", resultsDate: day(3), interventions: [["Camizestrant", "DRUG"]], conditions: ["Breast Cancer"] }),                                           // already a hand-picked story
    regStudy({ nct: "NCT03548935", resultsDate: day(4), interventions: [["Semaglutide", "DRUG"]], conditions: ["Obesity"] }),                                                  // in our library
    ...[5, 6, 7, 8, 9, 10, 11].map((d, i) => regStudy({ nct: "NCT1000001" + i, resultsDate: day(d), phases: i % 2 ? ["PHASE2", "PHASE3"] : ["PHASE3"], interventions: [["Drug" + String.fromCharCode(65 + i), "DRUG"]], conditions: ["Condition " + (i + 1)] })),
  ];
  const stopped = [
    regStudy({ nct: "NCT10000003", status: "TERMINATED", whyStopped: "Business decision.", updated: day(1), interventions: [["Zedrafil", "DRUG"]], conditions: ["Asthma"], resultsDate: day(3), cd: "2026-09-10" }),
    regStudy({ nct: "NCT20000002", status: "WITHDRAWN", whyStopped: "Funding <img src=x onerror=alert(1)> was withdrawn", updated: day(2), enrollment: 0, interventions: [["Pelacarsen", "DRUG"]], conditions: ["ACS"], cd: "2028-01", cdType: "ESTIMATED" }),
    regStudy({ nct: "NCT20000003", status: "SUSPENDED", whyStopped: "Dosing is paused as a precaution.", updated: day(3), interventions: [["Tapinarof cream, 1%", "DRUG"]], conditions: ["Atopic Dermatitis"], cd: "2027-08", cdType: "ESTIMATED" }),
    regStudy({ nct: "NCT20000004", status: "TERMINATED", whyStopped: "", updated: day(4), interventions: [["Batoclimab", "BIOLOGICAL"]], conditions: ["Graves"], cd: "2026-08-17" }),
    regStudy({ nct: "NCT20000005", status: "TERMINATED", whyStopped: "Slow enrolment.", updated: day(5), interventions: [["Poziotinib", "DRUG"]], conditions: ["NSCLC"], cd: "2026-09-01" }),
    regStudy({ nct: "NCT20000006", status: "TERMINATED", whyStopped: "Strategy change.", updated: day(6), interventions: [["Drugx", "DRUG"]], conditions: ["Gout"], cd: "2026-09-02" }),
    regStudy({ nct: "NCT05636176", status: "TERMINATED", whyStopped: "Futility.", updated: day(7), interventions: [["Ziltivekimab", "BIOLOGICAL"]], conditions: ["Heart Failure"], cd: "2026-09-03" }),   // the hand-picked Novo story covers this drug
  ];
  const fda = [
    fdaRecord({ app: "NDA220359", brand: "ETCAMAH", generics: ["camizestrant"], date: "20260904" }),     // the hand-picked Etcamah story covers it
    fdaRecord({ app: "NDA300001", brand: "ALPHAXA", generics: ["alphaxine"], date: "20260925" }),         // RxNorm confirms
    fdaRecord({ app: "NDA300002", brand: "BETARIL", generics: ["betarilol hydrochloride"], date: "20260924" }),   // DailyMed confirms
    fdaRecord({ app: "NDA300003", brand: "GAMMIX", generics: ["gammixate"], date: "20260923" }),          // nobody else knows it yet: not shown
    fdaRecord({ app: "NDA300004", brand: "DELTARA", generics: ["deltarine"], date: "20260922", cls: "TYPE 2" }),   // RxNorm confirms
    fdaRecord({ app: "BLA760001", brand: "EPSILIMAB", generics: ["epsilimab-xyzw"], date: "20260921" }),  // RxNorm + DailyMed
    fdaRecord({ app: "NDA300005", brand: "ZETARIX", generics: ["zetarix"], date: "20260920" }),            // brand equals generic: only DailyMed with the full generic name can confirm it
    fdaRecord({ app: "NDA300006", brand: "THETAVO", generics: ["thetavone"], date: "20260919" }),         // RxNorm confirms
    fdaRecord({ app: "NDA300007", brand: "IOTARA", generics: ["iotarine"], date: "20260918" }),            // RxNorm confirms (the 6th confirmed: over the cap)
    fdaRecord({ app: "NDA300008", brand: "ABCD", generics: ["abcdex"], date: "20260901", cls: "TYPE 5" }),   // wrong class: never a candidate
  ];
  const spec = {
    results, stopped, fda,
    rx: { alphaxa: ["alphaxine 10 MG Oral Tablet [Alphaxa]"], deltara: ["deltarine 5 MG Oral Tablet [Deltara]"], epsilimab: ["epsilimab-xyzw 100 MG/ML Injectable Solution [Epsilimab]"], thetavo: ["thetavone 20 MG Oral Tablet [Thetavo]"], iotara: ["iotarine 1 MG Oral Tablet [Iotara]"] },
    pm: { NCT10000001: { n: 2, id: "41111111" }, NCT10000002: { n: 1, id: "42222222" } }, ep: { NCT10000001: { n: 2, id: "41111111" }, NCT10000010: { n: 1, id: "43333333" } },
    dailymed: {
      NDA300002: { setid: "11111111-2222-3333-4444-555555555555", title: "BETARIL (BETARILOL HYDROCHLORIDE) TABLET [ACME PHARMA]" },
      BLA760001: { setid: "22222222-3333-4444-5555-666666666666", title: "EPSILIMAB (EPSILIMAB-XYZW) INJECTION [ACME PHARMA]" },
      NDA300005: { setid: "33333333-4444-5555-6666-777777777777", title: "ZETARIX (ZETARIX) TABLET [ACME PHARMA]" },
    },
  };
  return spec;
}
