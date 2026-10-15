// Live "What's new": every rule in one place. Pure functions plus one orchestrator, zero dependencies, no imports.
// Used three ways, so the browser and the snapshot job can never disagree:
//   * scripts/build-site.mjs inlines this file into site/assets/app.js (it strips `export `),
//   * scripts/news-snapshot.mjs runs newsRun() in Node and writes site/data/news.json (the saved copy),
//   * test/news.test.mjs checks the rules directly.
// Every name starts with news / NEWS_ so it can sit in the same global scope as app/*.js and data.js.
//
// Where the stories come from (all free, no keys, no accounts):
//   ClinicalTrials.gov  results newly posted, studies stopped / paused / cancelled (the primary record for both)
//   openFDA Drugs@FDA   new FDA approvals
//   RxNorm, DailyMed    a second source that must agree before an approval is shown (DailyMed sends no CORS header,
//                       so only the snapshot job can ask it; the browser reads its answers from news.json)
//   PubMed, Europe PMC  two independent searches for a journal article about a study whose results were posted
// Text rule: nothing here invents a claim. Strings are built from validated fields and fixed wording only.
// Escaping rule: values are cleaned here (control and bidi characters, length) but NOT HTML-escaped; the page escapes once, at render.

export const NEWS_CAPS = { results: 8, stopped: 5, approvals: 5 };
export const NEWS_WINDOWS = { registryDays: 30, fdaDays: 90, recentDays: 182, verifiedMonths: 3 };
export const NEWS_LEVEL = { stopped: 0, approved: 4, resultsUnchecked: 6, resultsPosted: 7 };
export const NEWS_HOSTS = {
  ctgov: "https://clinicaltrials.gov/api/v2/studies",
  fda: "https://api.fda.gov/drug/drugsfda.json",
  rxnorm: "https://rxnav.nlm.nih.gov/REST/drugs.json",
  pubmed: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
  epmc: "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
  dailymed: "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json",
};
/** Hosts the browser talks to besides clinicaltrials.gov (already allowed). DailyMed is absent on purpose: it sends no CORS header. */
export const NEWS_CONNECT_HOSTS = ["https://api.fda.gov", "https://eutils.ncbi.nlm.nih.gov", "https://www.ebi.ac.uk", "https://rxnav.nlm.nih.gov"];

/* ================= dates (strings only: never new Date(string)) ================= */
const newsPad = (n) => String(n).padStart(2, "0");
const NEWS_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const newsIso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const newsDaysAgo = (nowMs, n) => newsIso(nowMs - n * 864e5);
export function newsMonthsAgo(nowMs, n) {
  const d = new Date(nowMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1 - n;
  while (m < 1) { m += 12; y--; }
  return `${y}-${newsPad(m)}`;
}
export const newsCompact = (d) => String(d).replace(/-/g, "");
export function newsUncompact(c) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(c));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** "2025-09-04" -> "2025/09/04", "2025-09" -> "2025/09", anything else -> null (no floor). */
export function newsPubmedDate(d) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(d ?? ""));
  return m ? m.slice(1).filter(Boolean).join("/") : null;
}
/** Europe PMC takes "YYYY-MM-DD", "YYYY-MM" or "YYYY" as the floor. */
export const newsEpmcDate = (d) => (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(d ?? "")) ? String(d) : null);
/** A string that sorts correctly against ISO dates. "2025-Q4" becomes the last day of that quarter. */
export function newsSortKey(date) {
  const s = String(date ?? "");
  const q = /^(\d{4})-Q([1-4])$/.exec(s);
  if (q) return `${q[1]}-${["03-31", "06-30", "09-30", "12-31"][+q[2] - 1]}`;
  if (/^\d{4}-\d{2}$/.test(s)) return s + "-31";
  return s;
}
/** Same wording as fmtDate() in app/core.js, for dates that appear inside generated sentences. */
export function newsFmtDate(d) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(d ?? ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return "";
  return (m[3] ? +m[3] + " " : "") + NEWS_MON[+m[2] - 1] + " " + m[1];
}

/* ================= safety: cleaning and validation ================= */
const NEWS_CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;                                  // become a space
const NEWS_INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;   // zero-width and bidi controls: removed
/** Strip control, zero-width and bidi characters, collapse whitespace, clip at a word boundary with an ellipsis. No HTML handling: the page escapes. */
export function newsClean(s, max = 200) {
  s = String(s ?? "").replace(NEWS_CTRL, " ").replace(NEWS_INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);   // never split a surrogate pair
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.5) cut = cut.slice(0, sp);
  return cut.replace(/[\s.,;:!?-]+$/, "") + "…";
}
const newsStr = (x) => (typeof x === "number" ? String(x) : x);
export const newsIsNct = (s) => typeof s === "string" && /^NCT\d{8}$/.test(s);
export const newsIsApp = (s) => typeof s === "string" && /^(NDA|BLA)\d{5,6}$/.test(s);
export const newsIsPmid = (s) => /^\d{1,9}$/.test(newsStr(s) ?? "");
export const newsIsSetId = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const newsIsRxcui = (s) => /^\d{1,9}$/.test(newsStr(s) ?? "");
const newsDateOk = (d) => (typeof d === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(d) ? d : null);
const newsEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/**
 * Text -> HTML for a live story's headline and body: escaped, with <wbr> break points inside any very long unbroken run (a URL, a long
 * drug name), so such a token can never push a phone-width page sideways. No CSS is needed. The raw text is split BEFORE escaping, by
 * code point, so a <wbr> can never land inside an entity or a surrogate pair. Short words are left exactly as they were.
 */
export function newsBreakHtml(text) {
  return String(text ?? "").split(/(\s+)/).map((tok) => {
    const cps = Array.from(tok);
    if (cps.length <= 18 || /^\s+$/.test(tok)) return newsEsc(tok);
    const pieces = [];
    let cur = "", n = 0;
    cps.forEach((c, i) => {
      cur += c; n++;
      if ((c === "/" || n >= 12) && i < cps.length - 1) { pieces.push(cur); cur = ""; n = 0; }   // after a slash, or after 12 characters without one
    });
    pieces.push(cur);
    return pieces.map(newsEsc).join("<wbr>");
  }).join("");
}
const newsReEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match, case-insensitive. strict: a hyphen continues a word ("alphaxa-xr" is not "alphaxa"). */
const newsHasWord = (text, word, strict = false) => { const b = strict ? "[^a-z0-9-]" : "[^a-z0-9]"; return !!word && new RegExp("(^|" + b + ")" + newsReEsc(String(word).toLowerCase()) + "(" + b + "|$)").test(String(text ?? "").toLowerCase()); };
const newsGet = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

/** Every link the page can show is built here, only from validated ids: a hostile registry string can never become an href. */
export const newsUrls = {
  study: (nct) => (newsIsNct(nct) ? `https://clinicaltrials.gov/study/${nct}` : null),
  pubmed: (id) => (newsIsPmid(id) ? `https://pubmed.ncbi.nlm.nih.gov/${id}/` : null),
  epmc: (id) => (newsIsPmid(id) ? `https://europepmc.org/article/MED/${id}` : null),
  fda: (app) => (newsIsApp(app) ? `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${app.replace(/\D/g, "")}` : null),
  rxnorm: (rxcui) => (newsIsRxcui(rxcui) ? `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${rxcui}` : null),
  dailymed: (setid) => (newsIsSetId(setid) ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${setid}` : null),
};
const NEWS_SAFE_URL = [
  /^https:\/\/clinicaltrials\.gov\/study\/NCT\d{8}$/,
  /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d{1,9}\/$/,
  /^https:\/\/europepmc\.org\/article\/MED\/\d{1,9}$/,
  /^https:\/\/www\.accessdata\.fda\.gov\/scripts\/cder\/daf\/index\.cfm\?event=overview\.process&ApplNo=\d{5,6}$/,
  /^https:\/\/mor\.nlm\.nih\.gov\/RxNav\/search\?searchBy=RXCUI&searchTerm=\d{1,9}$/,
  /^https:\/\/dailymed\.nlm\.nih\.gov\/dailymed\/lookup\.cfm\?setid=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
];
export const newsSafeUrl = (u) => typeof u === "string" && NEWS_SAFE_URL.some((re) => re.test(u));

/* ================= requests (plain parameter objects; callers use URLSearchParams) ================= */
export const newsUrl = (base, params) => base + "?" + new URLSearchParams(params).toString();
const NEWS_REG_FIELDS = "NCTId,BriefTitle,OverallStatus,WhyStopped,Phase,LeadSponsorName,ResultsFirstPostDate,LastUpdatePostDate,PrimaryCompletionDate,CompletionDate,CompletionDateType,EnrollmentCount,EnrollmentType,Condition,InterventionName,InterventionType";
/** kind "results": newly posted results, phase 3 and 2/3. kind "stopped": terminated / suspended / withdrawn, recent and industry-run. */
export function newsRegistryParams(kind, nowMs) {
  const from = newsDaysAgo(nowMs, NEWS_WINDOWS.registryDays);
  if (kind === "results") {
    return { format: "json", pageSize: "20", sort: "ResultsFirstPostDate:desc,EnrollmentCount:desc", fields: NEWS_REG_FIELDS,
      "filter.advanced": `AREA[ResultsFirstPostDate]RANGE[${from},MAX] AND AREA[StudyType]INTERVENTIONAL AND AREA[Phase]PHASE3` };
  }
  if (kind === "stopped") {
    const verified = newsMonthsAgo(nowMs, NEWS_WINDOWS.verifiedMonths), completed = newsDaysAgo(nowMs, NEWS_WINDOWS.recentDays);
    return { format: "json", pageSize: "25", sort: "LastUpdatePostDate:desc", fields: NEWS_REG_FIELDS + ",StatusVerifiedDate", "filter.overallStatus": "TERMINATED,SUSPENDED,WITHDRAWN",
      "filter.advanced": `AREA[LastUpdatePostDate]RANGE[${from},MAX] AND AREA[StatusVerifiedDate]RANGE[${verified},MAX] AND AREA[CompletionDate]RANGE[${completed},MAX] AND AREA[StudyType]INTERVENTIONAL AND AREA[Phase]PHASE3 AND AREA[LeadSponsorClass]INDUSTRY` };
  }
  throw new Error("newsRegistryParams: unknown kind " + kind);
}
export const newsFdaWindow = (nowMs) => ({ fromCompact: newsCompact(newsDaysAgo(nowMs, NEWS_WINDOWS.fdaDays)), toCompact: newsCompact(newsIso(nowMs)) });
/** New molecular entities, new active ingredients and new biologics approved in the window. The sub-field matches are NOT correlated, so newsParseFda() re-applies the rule. "TYPE 1/4" tokenises separately and must be listed. */
export function newsFdaParams(nowMs, skip = 0, limit = 200) {
  const w = newsFdaWindow(nowMs);
  const c = (code) => `submissions.submission_class_code:"${code}"`;
  return { limit: String(limit), skip: String(skip),
    search: `submissions.submission_type:"ORIG" AND submissions.submission_status:"AP" AND submissions.submission_status_date:[${w.fromCompact} TO ${w.toCompact}] AND ((application_number:NDA* AND (${c("TYPE 1")} OR ${c("TYPE 1/4")} OR ${c("TYPE 2")})) OR (application_number:BLA* AND (${c("TYPE 1")} OR ${c("TYPE 1/4")})))` };
}
export const newsRxnormParams = (brand) => ({ name: String(brand) });
export function newsPubmedParams(nct, pcd) {
  const p = { db: "pubmed", term: `${nct}[si]`, retmode: "json", retmax: "1", sort: "pub_date", tool: "trialsignal" };
  const floor = newsPubmedDate(pcd);
  if (floor) Object.assign(p, { datetype: "pdat", mindate: floor, maxdate: "3000" });
  return p;
}
/** TITLE_ABS is required: a bare NCT query is a full-text search and returns reviews that merely mention the study. */
export function newsEpmcParams(nct, pcd) {
  const floor = newsEpmcDate(pcd);
  return { format: "json", resultType: "lite", pageSize: "1", sort: "P_PDATE_D desc", query: `TITLE_ABS:"${nct}" AND SRC:MED` + (floor ? ` AND FIRST_PDATE:[${floor} TO 3000-12-31]` : "") };
}
export const newsDailymedParams = (app) => ({ application_number: String(app) });

/* ================= parsers: pure, never throw ================= */
const NEWS_DRUG_TYPES = new Set(["DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT", "GENETIC"]);
const NEWS_NOT_A_DRUG = /placebo|\bsham\b|vehicle|comparator|standard (of )?(care|treatment|therapy)|usual care|\bcontrol\b|chemotherapy|\bsaline\b/i;
function newsDrugNames(interventions) {
  const out = [];
  for (const i of Array.isArray(interventions) ? interventions : []) {
    if (!i || !NEWS_DRUG_TYPES.has(String(i.type))) continue;
    const name = newsClean(String(i.name ?? "").replace(/^(combination product|drug|biological|genetic)\s*:\s*/i, "").split(/[,(]/)[0], 60);
    if (name && !NEWS_NOT_A_DRUG.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}
/** ClinicalTrials.gov v2 /studies reply -> Study[]; null if the reply is not the expected shape. */
export function newsParseRegistry(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.studies)) return null;
  const out = [];
  for (const s of json.studies) {
    const p = s && s.protocolSection;
    if (!p || typeof p !== "object") continue;
    const nct = newsGet(p, "identificationModule.nctId");
    if (!newsIsNct(nct)) continue;
    const st = p.statusModule || {};
    const cd = newsGet(st, "completionDateStruct.date");
    const n = newsGet(p, "designModule.enrollmentInfo.count");
    const resultsDate = newsDateOk(newsGet(st, "resultsFirstPostDateStruct.date"));
    out.push({
      nct, title: newsClean(newsGet(p, "identificationModule.briefTitle"), 300), status: String(st.overallStatus ?? "").toUpperCase().replace(/[^A-Z_]/g, ""),
      sponsor: newsClean(newsGet(p, "sponsorCollaboratorsModule.leadSponsor.name"), 80),
      phases: (Array.isArray(newsGet(p, "designModule.phases")) ? p.designModule.phases : []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z0-9_]{1,20}$/.test(x)),
      enrollment: Number.isFinite(n) && n >= 0 ? n : null, enrollmentType: String(newsGet(p, "designModule.enrollmentInfo.type") ?? "").toUpperCase() || null,
      conditions: (Array.isArray(newsGet(p, "conditionsModule.conditions")) ? p.conditionsModule.conditions : []).map((c) => newsClean(c, 80)).filter(Boolean).slice(0, 3),
      drugs: newsDrugNames(newsGet(p, "armsInterventionsModule.interventions")),
      whyStopped: newsClean(st.whyStopped, 1000),
      resultsDate, updated: newsDateOk(newsGet(st, "lastUpdatePostDateStruct.date")), verified: newsDateOk(st.statusVerifiedDate),
      pcd: newsDateOk(newsGet(st, "primaryCompletionDateStruct.date")) || newsDateOk(cd),
      completionDate: newsDateOk(cd), completionType: String(newsGet(st, "completionDateStruct.type") ?? "").toUpperCase() || null,
      hasResultsDate: !!resultsDate,
    });
  }
  return out;
}

const NEWS_SALT = /\b(hydrochloride|dihydrochloride|hydrobromide|sodium|potassium|calcium|magnesium|acetate|fumarate|hemifumarate|tosylate|mesylate|besylate|maleate|succinate|tartrate|citrate|sulfate|phosphate|bromide|chloride|monohydrate|dihydrate|hydrate)\b/g;
/** First word of a generic name, salts removed and any hyphen suffix dropped ("garetosmab-grts" -> "garetosmab"). */
export function newsIngredientKey(generic) {
  const s = String(generic ?? "").toLowerCase().replace(NEWS_SALT, " ").replace(/\s+/g, " ").trim() || String(generic ?? "").toLowerCase().trim();
  return s.split(/[\s,/]/)[0].replace(/-.*$/, "");
}
const NEWS_CLASS = { NDA: ["TYPE 1", "TYPE 1/4", "TYPE 2"], BLA: ["TYPE 1", "TYPE 1/4"] };
/** Merge candidates that share a brand, keeping the earliest approval; newest first. */
export function newsMergeFda(list) {
  const byBrand = new Map(), out = [];
  for (const c of list) {
    const k = c.brand ? c.brand.toLowerCase() : "app:" + c.app;
    const prev = byBrand.get(k);
    if (!prev) { byBrand.set(k, c); out.push(c); continue; }
    if (c.date < prev.date || (c.date === prev.date && c.app < prev.app)) { out[out.indexOf(prev)] = c; byBrand.set(k, c); }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.app.localeCompare(b.app));
}
/**
 * openFDA drugsfda reply -> eligible approvals. Re-applies the real rule on each record's OWN original submission:
 * type ORIG, status AP, status date inside the window; NDA class TYPE 1, 1/4 or 2; BLA class TYPE 1 or 1/4; never ANDA.
 * Returns {ok:false} if the reply is not the expected shape.
 */
export function newsParseFda(json, { fromCompact, toCompact } = {}) {
  if (!json || typeof json !== "object" || !Array.isArray(json.results)) return { ok: false };
  const list = [];
  for (const r of json.results) {
    const app = r && r.application_number;
    if (!newsIsApp(app)) continue;
    const own = (Array.isArray(r.submissions) ? r.submissions : []).find((s) => s && s.submission_type === "ORIG" && s.submission_status === "AP" && /^\d{8}$/.test(String(s.submission_status_date)) && String(s.submission_status_date) >= fromCompact && String(s.submission_status_date) <= toCompact);
    if (!own) continue;
    const cls = String(own.submission_class_code ?? "").toUpperCase().trim();
    if (!NEWS_CLASS[app.slice(0, 3)].includes(cls)) continue;
    const products = (Array.isArray(r.products) ? r.products : []).filter((p) => p && typeof p === "object");
    const brands = [...new Set(products.map((p) => newsClean(String(p.brand_name ?? "").replace(/\s*\([^)]*\)/g, ""), 60)).filter(Boolean))];
    const generics = [...new Set(products.flatMap((p) => (Array.isArray(p.active_ingredients) ? p.active_ingredients : []).map((a) => newsClean(a && a.name, 80).toLowerCase())).filter(Boolean))];
    if (!brands.length && !generics.length) continue;
    list.push({ app, date: newsUncompact(own.submission_status_date), cls, brand: brands[0] || null, generics, dosageForms: [...new Set(products.map((p) => newsClean(p.dosage_form, 40).toLowerCase()).filter(Boolean))] });
  }
  const meta = json.meta || {}, total = newsGet(meta, "results.total"), updated = newsGet(meta, "last_updated");
  return { ok: true, candidates: newsMergeFda(list), total: Number.isFinite(total) ? total : list.length, lastUpdated: newsDateOk(updated) };
}
/** Is the brand a different word from the generic name(s)? Only then can RxNorm vouch for it. */
export const newsBrandDistinct = (c) => !!c && !!c.brand && !(c.generics || []).some((g) => g === c.brand.toLowerCase());

/** RxNorm drugs.json -> the (up to 8) product names that carry [brand]. {ok:false} if the reply is not RxNorm-shaped. */
export function newsRxnormParse(json, brand) {
  const g = json && json.drugGroup;
  if (!g || typeof g !== "object") return { ok: false };
  const props = (Array.isArray(g.conceptGroup) ? g.conceptGroup : []).flatMap((x) => (x && Array.isArray(x.conceptProperties) ? x.conceptProperties : []));
  const want = `[${String(brand).toLowerCase()}]`;
  const hit = props.filter((p) => p && typeof p.name === "string" && p.name.toLowerCase().includes(want));
  return { ok: true, names: hit.slice(0, 8).map((p) => newsClean(p.name, 160)), rxcui: hit.length && newsIsRxcui(hit[0].rxcui) ? String(hit[0].rxcui) : null };
}
/** RxNorm vouches for an approval only if ONE product name has both the exact [Brand] and the active ingredient. Returns {ok, rxcui, brand} with RxNorm's own casing. */
export function newsRxnormMatch(parsed, cand) {
  if (!parsed || !parsed.ok || !newsBrandDistinct(cand)) return { ok: false };
  const want = `[${cand.brand.toLowerCase()}]`, keys = cand.generics.map(newsIngredientKey).filter(Boolean);
  for (const name of parsed.names || []) {
    const low = name.toLowerCase(), i = low.indexOf(want);
    if (i < 0 || !keys.some((k) => low.includes(k))) continue;
    return { ok: true, rxcui: parsed.rxcui, brand: name.slice(i + 1, i + 1 + cand.brand.length) };
  }
  return { ok: false };
}
export function newsPubmedParse(json) {
  const e = json && json.esearchresult;
  if (!e || typeof e !== "object" || !/^\d+$/.test(String(e.count))) return { ok: false };
  const id = (Array.isArray(e.idlist) ? e.idlist : [])[0];
  return { ok: true, n: Number(e.count), id: newsIsPmid(id) ? String(id) : null };
}
export function newsEpmcParse(json) {
  if (!json || typeof json !== "object" || !Number.isFinite(Number(json.hitCount)) || typeof json.resultList !== "object" || !json.resultList) return { ok: false };
  const top = (Array.isArray(json.resultList.result) ? json.resultList.result : [])[0];
  const id = top && top.source === "MED" ? top.pmid ?? top.id : null;
  return { ok: true, n: Number(json.hitCount), id: newsIsPmid(id) ? String(id) : null };
}
export function newsDailymedParse(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.data)) return { ok: false };
  const first = json.data[0];
  if (!first || typeof first !== "object" || !newsIsSetId(first.setid)) return { ok: true, setid: null, title: "" };
  return { ok: true, setid: first.setid, title: newsClean(first.title, 160) };
}
/** DailyMed vouches only if the label title names the brand (or, with no distinct brand, every generic name in full). */
export function newsDailymedMatch(entry, cand) {
  if (!entry || !newsIsSetId(entry.setid) || !cand) return false;
  const title = String(entry.title ?? "").toLowerCase();
  if (newsBrandDistinct(cand)) return newsHasWord(title, cand.brand, true);
  return cand.generics.length > 0 && cand.generics.every((g) => title.includes(g));
}
/** pm / ep = parsed PubMed / Europe PMC answers, or null / {ok:false} when that source could not be asked. */
export function newsJournal(pm, ep) {
  const asked = [["PubMed", pm], ["Europe PMC", ep]].filter(([, x]) => x && x.ok);
  const hits = asked.filter(([, x]) => x.n > 0);
  return {
    state: !asked.length ? "unknown" : hits.length ? "found" : "none",
    answered: asked.map((a) => a[0]), found: hits.map((a) => a[0]),
    pubmedId: pm && pm.ok && pm.n > 0 ? pm.id : null, epmcId: ep && ep.ok && ep.n > 0 ? ep.id : null,
  };
}

/* ================= plain-English text ================= */
const newsSentenceList = (a) => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a.join("");
const newsThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const newsTitleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function newsPhaseNoun(phases) {
  const p = phases || [];
  if (p.includes("PHASE3") && p.includes("PHASE2")) return "combined mid-stage and final-stage test (phase 2/3)";
  return p.includes("PHASE3") ? "final-stage test (phase 3)" : "study";
}
const newsPeople = (s) => (s.enrollmentType === "ACTUAL" && s.enrollment > 0 ? ` with ${newsThousands(s.enrollment)} people` : "");
const NEWS_REASON_MAX = 260;   // long enough for every registry reason seen so far to be quoted whole; newsClean's ellipsis is only a safety net
function newsReason(s) {
  const t = newsClean(s, 1000).replace(/[.;:,!?\s]+$/, "");
  return t ? newsClean(t, NEWS_REASON_MAX) : "";
}
function newsSubject(s, verb, withPeople) {   // "{Sponsor} ran this {phase}{people}." / "This was a {phase}{people}."
  const noun = newsPhaseNoun(s.phases), people = withPeople ? newsPeople(s) : "";
  return s.sponsor ? `${s.sponsor} ${verb} this ${noun}${people}.` : `This was a ${noun}${people}.`;
}
const newsDrug = (s) => (s.drugs || [])[0] || "";
const newsCond = (s) => (s.conditions || [])[0] || "";
function newsAbout(s) {   // "of {drug} for {condition}" / "about {condition}" / ""
  const d = newsDrug(s), c = newsCond(s);
  return d && c ? `of ${d} for ${c}` : d ? `of ${d}` : c ? `about ${c}` : "";
}
const newsSortDesc = (list) => list.map((x, i) => [x, i]).sort((a, b) => newsSortKey(b[0].date).localeCompare(newsSortKey(a[0].date)) || a[1] - b[1]).map((a) => a[0]);
const newsCap = (list, n) => list.slice(0, Math.max(0, n));

export function newsSourcesLabel(kind, parts = {}) {
  if (kind === "approval") return "Confirmed by " + ["Drugs@FDA", parts.rx && "RxNorm", parts.dm && "DailyMed"].filter(Boolean).join(" + ");
  const s = ["ClinicalTrials.gov", parts.pubmed && "PubMed", parts.epmc && "Europe PMC"].filter(Boolean);
  return (s.length > 1 ? "Sources: " : "Source: ") + s.join(" + ");
}

/** A study whose results were posted. `journal` comes from newsJournal(). Level 6 only when a search was made and found nothing. */
export function newsResultItem(study, journal) {
  const j = journal || newsJournal(null, null), about = newsAbout(study);
  let text = newsSubject(study, "ran", true);
  if (study.status === "TERMINATED") {
    text += " It was stopped early.";
    const r = newsReason(study.whyStopped);
    if (r) text += ` The study team’s reason: “${r}”.`;
  }
  if (study.completionType === "ACTUAL" && newsFmtDate(study.completionDate)) text += ` The registry lists its end date as ${newsFmtDate(study.completionDate)}.`;
  text += " The study team posted its results on ClinicalTrials.gov.";
  text += j.state === "found" ? ` A journal article that mentions this study is listed on ${j.found.join(" and ")}. It may not report these results.`
    : j.state === "none" ? ` Our search of ${j.answered.join(" and ")} for this study’s number (${study.nct}) found no journal article. Searches can miss articles, so one may already exist.`
    : " We couldn’t search for a journal article just now.";
  text += " We don’t say here whether the treatment worked. The official study record has the full results.";
  const links = [["Official study record", newsUrls.study(study.nct)], ["Journal article on PubMed", j.pubmedId && newsUrls.pubmed(j.pubmedId)], ["Journal article on Europe PMC", j.epmcId && newsUrls.epmc(j.epmcId)]].filter((l) => l[1]);
  return {
    live: true, id: "results:" + study.nct, kind: "results", date: study.resultsDate, level: j.state === "none" ? NEWS_LEVEL.resultsUnchecked : NEWS_LEVEL.resultsPosted, nct: study.nct, drug: newsDrug(study) || undefined,
    title: about ? `Results posted for a study ${about}` : "Results posted for a medical study", summary: text,
    sourcesLabel: newsSourcesLabel("results", { pubmed: j.found.includes("PubMed"), epmc: j.found.includes("Europe PMC") }), links,
  };
}
const NEWS_STOPPED = new Set(["TERMINATED", "SUSPENDED", "WITHDRAWN"]);
/** The registry's stopped / paused / cancelled studies, recent ones only. The date is when the registry record was last updated: the registry has no "stopped on" event date. */
export function newsStoppedItems(studies, nowMs) {
  const recent = newsDaysAgo(nowMs, NEWS_WINDOWS.recentDays), out = [];
  for (const s of studies || []) {
    if (!NEWS_STOPPED.has(s.status) || !s.updated) continue;
    if (s.completionDate && newsSortKey(s.completionDate) < recent) continue;                       // ended long ago: a housekeeping edit, not news
    if (s.status === "TERMINATED" && s.resultsDate && s.resultsDate < recent) continue;             // results posted long ago
    out.push(newsStoppedItem(s));
  }
  return out;
}
export function newsStoppedItem(s) {
  const about = newsAbout(s);
  const end = { TERMINATED: "was stopped early", SUSPENDED: "is paused", WITHDRAWN: "was cancelled before it began" }[s.status];
  const verb = { TERMINATED: "ran", SUSPENDED: "leads", WITHDRAWN: "planned" }[s.status];
  let text = newsSubject(s, verb, s.status === "TERMINATED");
  const r = newsReason(s.whyStopped);
  text += r ? ` The study team’s reason: “${r}”.` : " The study team hasn’t given a reason on the registry.";
  const endShown = s.status === "TERMINATED" && s.completionType === "ACTUAL" && !!newsFmtDate(s.completionDate);
  if (endShown) text += ` The registry lists its end date as ${newsFmtDate(s.completionDate)}.`;
  if (s.status === "SUSPENDED") text += " It may start again.";
  // The registry has no "stopped on" event date, so say so whenever the story has no actual end date of its own.
  if (!endShown) text += ` The registry doesn’t say when it was ${{ TERMINATED: "stopped", SUSPENDED: "paused", WITHDRAWN: "cancelled" }[s.status]}. The date above is when its record was last updated.`;
  if (s.resultsDate) text += " The study team has also posted results on ClinicalTrials.gov.";
  return {
    live: true, id: "stopped:" + s.nct, kind: "stopped", date: s.updated, datePrefix: "Registry record updated ", level: NEWS_LEVEL.stopped, nct: s.nct, drug: newsDrug(s) || undefined,
    title: about ? `A study ${about} ${end}` : `A medical study ${end}`, summary: text,
    sourcesLabel: newsSourcesLabel("stopped"), links: [["Official study record", newsUrls.study(s.nct)]].filter((l) => l[1]),
  };
}
/** An approval, only if a second source agrees: rx = newsRxnormMatch() result, dm = a DailyMed entry {setid,title}. Otherwise null. */
export function newsApprovalItem(c, { rx, dm } = {}) {
  const distinct = newsBrandDistinct(c);
  const rxOk = !!(rx && rx.ok) && distinct, dmOk = !!(dm && newsDailymedMatch(dm, c));   // RxNorm can only vouch for a brand that differs from the generic name
  if (!rxOk && !dmOk) return null;
  const brand = distinct ? (rxOk && rx.brand ? newsClean(rx.brand, 60) : newsTitleCase(c.brand)) : null;
  const generics = c.generics.slice(0, 3), list = newsSentenceList(generics);
  let text = "The FDA’s drug database lists it as approved.";
  if (c.app.startsWith("NDA")) text += c.cls === "TYPE 2" ? " The FDA classes it as a new form of an active ingredient it had already approved." : " The FDA classes it as a new drug, with an active ingredient not approved in the US before.";
  text += " This database doesn’t say what it’s used for. The FDA drug record links to its label, which does.";
  const links = [["FDA drug record", newsUrls.fda(c.app)], rxOk && ["RxNorm entry", newsUrls.rxnorm(rx.rxcui)], dmOk && ["DailyMed label", newsUrls.dailymed(dm.setid)]].filter((l) => l && l[1]);
  return {
    live: true, id: "approval:" + c.app, kind: "approval", date: c.date, level: NEWS_LEVEL.approved, app: c.app, brand: brand || undefined, generics,
    title: brand ? `FDA approved ${brand} (${list})` : `FDA approved ${list || "a new medicine"}`, summary: text,
    sourcesLabel: newsSourcesLabel("approval", { rx: rxOk, dm: dmOk }), links,
  };
}

/* ================= hand-picked stories and de-duplication ================= */
/** How sure we can be about a hand-picked story (app/views.js uses this as newsLevel). */
export const newsHandLevel = (n) => n.type === "Approval" ? 4 : n.type === "Discontinued" || /\bfails?\b|stops?\b/i.test(n.title) ? 0 : n.type === "Submission" ? 5 : (/peer-reviewed trial|NEJM|JAMA/i.test(n.evidence) && !/no peer|not yet/i.test(n.evidence)) ? 3 : 2;
/** NEWS (data.js) + NEWS_PLAIN (plain.js) -> display items. levelFn is the page's own hand-picked-level rule. */
export function newsHandItems(news, plain, levelFn) {
  return (news || []).map((n) => {
    const pl = (plain && plain[`${n.date}|${n.company}`]) || [n.title, n.summary];
    return { hand: true, kind: "hand", id: `hand:${n.date}|${n.company}`, date: n.date, level: levelFn(n), type: n.type, title: pl[0], summary: pl[1], rawTitle: n.title, rawSummary: n.summary, trial: n.trial || null, links: n.links || [], company: n.company };
  });
}
const newsHandText = (h) => [h.trial, h.title, h.summary, h.rawTitle, h.rawSummary, ...(h.links || []).map((l) => l && l[1])].filter(Boolean).join(" \n ");
export const newsHandHasNct = (nct, hand) => !!nct && (hand || []).some((h) => newsHandText(h).toUpperCase().includes(nct));
/** An approval is a duplicate only of a hand-picked Approval story that names its full brand or full generic name as a whole word. */
export function newsApprovalDup(brand, generics, hand) {
  const names = [brand, ...(generics || [])].filter(Boolean);
  return (hand || []).some((h) => h.type === "Approval" && names.some((n) => newsHasWord(newsHandText(h), n)));
}
/** A stopped story whose drug (5+ letters) is named in the title of a hand-picked level-0 story from the last 90 days. */
function newsStoppedDup(item, hand, nowMs) {
  const drug = (item.drug || "").toLowerCase();
  if (drug.length < 5) return false;
  const since = newsDaysAgo(nowMs, 90);
  return (hand || []).some((h) => h.level === NEWS_LEVEL.stopped && newsSortKey(h.date) >= since && (newsHasWord(h.title, drug) || newsHasWord(h.rawTitle, drug)));
}
/** Drop live items that a hand-picked story already covers. */
export function newsDedupeLive(items, hand, nowMs) {
  return (items || []).filter((i) => {
    if (!i) return false;
    if (i.kind === "approval") return !newsApprovalDup(i.brand, i.generics, hand);
    if (newsHandHasNct(i.nct, hand)) return false;
    return i.kind === "stopped" ? !newsStoppedDup(i, hand, nowMs) : true;
  });
}
const NEWS_RANK = { hand: 0, approval: 1, results: 2, stopped: 3 };
/**
 * One list, newest first. Order of the rules: duplicates of hand-picked stories go; the stopped list is capped first and a
 * study shown there leaves the results list; each kind is capped after that; ties sort hand-picked, approval, results, stopped, then id.
 */
export function newsMerge({ hand = [], results = [], stopped = [], approvals = [], caps = NEWS_CAPS, nowMs = Date.now() } = {}) {
  const stoppedKept = newsCap(newsSortDesc(newsDedupeLive(stopped, hand, nowMs)), caps.stopped);
  const shown = new Set(stoppedKept.map((i) => i.nct));
  const resultsKept = newsCap(newsSortDesc(newsDedupeLive(results, hand, nowMs).filter((i) => !shown.has(i.nct))), caps.results);
  const approvalsKept = newsCap(newsSortDesc(newsDedupeLive(approvals, hand, nowMs)), caps.approvals);
  return [...hand, ...approvalsKept, ...resultsKept, ...stoppedKept].map((x, i) => [x, i])
    .sort((a, b) => newsSortKey(b[0].date).localeCompare(newsSortKey(a[0].date)) || NEWS_RANK[a[0].hand ? "hand" : a[0].kind] - NEWS_RANK[b[0].hand ? "hand" : b[0].kind] || (a[0].id < b[0].id ? -1 : a[0].id > b[0].id ? 1 : 0) || a[1] - b[1])
    .map((a) => a[0]);
}

/* ================= the saved copy (site/data/news.json) ================= */
/** Re-validate a live item that came from a file. Anything unexpected -> null. Links must match the known patterns exactly. */
export function newsCheckItem(i) {
  if (!i || typeof i !== "object" || i.live !== true) return null;
  const want = { results: [6, 7], stopped: [0], approval: [4] }[i.kind];
  if (!want || !want.includes(i.level)) return null;
  if (typeof i.id !== "string" || !/^(results|stopped|approval):[A-Z0-9]{6,12}$/.test(i.id) || i.id.split(":")[0] !== i.kind) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.date))) return null;
  const links = (Array.isArray(i.links) ? i.links : []).filter((l) => Array.isArray(l) && typeof l[0] === "string" && newsSafeUrl(l[1])).map((l) => [newsClean(l[0], 60), l[1]]).slice(0, 6);
  const out = { live: true, id: i.id, kind: i.kind, date: i.date, level: i.level, title: newsClean(i.title, 300), summary: newsClean(i.summary, 1500), sourcesLabel: newsClean(i.sourcesLabel, 120), links };
  if (!out.title || !out.summary) return null;
  if (newsIsNct(i.nct)) out.nct = i.nct;
  if (newsIsApp(i.app)) out.app = i.app;
  if (typeof i.datePrefix === "string") out.datePrefix = newsClean(i.datePrefix, 40) + " ";
  if (typeof i.drug === "string") out.drug = newsClean(i.drug, 60);
  if (typeof i.brand === "string") out.brand = newsClean(i.brand, 60);
  if (Array.isArray(i.generics)) out.generics = i.generics.map((g) => newsClean(g, 80)).filter(Boolean).slice(0, 3);
  return out;
}
/** news.json -> {generatedAt, dataTimestamp, items, dailymed}, or null if it is not a usable saved copy. */
export function newsCheckSaved(j) {
  if (!j || typeof j !== "object" || j.version !== 1 || !/^\d{4}-\d{2}-\d{2}T/.test(String(j.generatedAt)) || !Array.isArray(j.items)) return null;
  const dailymed = {};
  for (const [k, v] of Object.entries(j.dailymed && typeof j.dailymed === "object" ? j.dailymed : {})) if (newsIsApp(k) && v && newsIsSetId(v.setid)) dailymed[k] = { setid: v.setid, title: newsClean(v.title, 160) };
  return { generatedAt: String(j.generatedAt), dataTimestamp: typeof j.dataTimestamp === "string" ? j.dataTimestamp : null, items: j.items.map(newsCheckItem).filter(Boolean), dailymed };
}

/* ================= the intro line (state -> HTML; every string here is fixed wording) ================= */
const NEWS_INTRO_PRIMARY = ["ClinicalTrials.gov", "the FDA"], NEWS_INTRO_CROSS = ["PubMed", "Europe PMC", "RxNorm"];
/** How each accepted primary name is shown in the sentence. DailyMed is never named here: only the hourly job can ask it, and each approval it confirms says so on its own card. */
const NEWS_INTRO_SHOWN = { "ClinicalTrials.gov": "ClinicalTrials.gov", "the FDA": "FDA" };
/**
 * state: loading | live | partial | paused. `primary` and `crossChecked` name the sources that this browser itself asked and that really
 * answered (so never DailyMed); both are filtered through a fixed list, in a fixed order, so no other text can ever reach the page from here.
 * The live stories are said to be written automatically, because they are: no person writes them. The time always comes last
 * (on its own line), so its changing width can never move the text above it.
 */
export function newsIntro(state, { checked = "just now", savedDate = "", primary = [], crossChecked = [] } = {}) {
  const pr = NEWS_INTRO_PRIMARY.filter((x) => (primary || []).includes(x)), cc = NEWS_INTRO_CROSS.filter((x) => (crossChecked || []).includes(x));
  const head = (pr.length ? `The rest are written automatically from live ${newsSentenceList(pr.map((x) => NEWS_INTRO_SHOWN[x]))} records` : "The rest are written automatically from live records") + (cc.length ? `, cross-checked with ${newsSentenceList(cc)}` : "") + ".";
  const time = `<br>Checked <span id="newsChecked">${newsEsc(checked)}</span>.`;
  switch (state) {
    case "live": return head + time;
    case "partial": return head + (savedDate ? ` Some stories below come from the saved copy from ${newsEsc(savedDate)}, because a source didn’t answer.` : " A source didn’t answer, so some stories may be missing.") + time;
    case "paused": return savedDate ? `Live updates are paused, so you’re seeing the saved copy from ${newsEsc(savedDate)}.` : "Live updates are paused, so you’re seeing only the stories picked by hand.";
    default: return "Checking ClinicalTrials.gov and the FDA…";
  }
}

/* ================= the pipeline ================= */
async function newsPool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, n), list.length) }, async () => { while (next < list.length) { const k = next++; out[k] = await fn(list[k], k); } }));
  return out;
}
/**
 * Fetch, cross-check and assemble the live stories. `io` supplies the environment:
 *   io.fetchJson(source, url, {timeoutMs}) -> parsed JSON, throws (with .status for HTTP errors, and .code when the reply names one) on failure.
 *       source is one of ctgov | openfda | rxnorm | pubmed | epmc | dailymed. Pacing, retries and caching of raw bodies are the environment's business.
 *   io.sleep(ms)
 *   io.cache {get(key), put(key, value)}  optional. Values are already-parsed (small) objects; failures are never put.
 * Each source fails independently: a feed that fails is replaced by the saved copy's items of that kind (failedKinds says which).
 * The result also says which sources really answered (`answered`, from the network or from the cache), so the page can name only those.
 * The registry stories do not wait for openFDA or RxNorm, and the approvals do not wait for the journal searches: the two pipelines run side by side.
 * Options: nowMs, hand (newsHandItems), getSaved() (the saved copy, checked by newsCheckSaved), concurrency, caps, rxBudget,
 *   pubmedRetryMs (browser: retry once, because a 429 reaches a browser as an opaque network error),
 *   dailymedAll (snapshot job: ask DailyMed about every candidate), dropUnknown (snapshot job: never save a result whose journal search could not be made).
 */
export async function newsRun(io, o = {}) {
  const nowMs = o.nowMs ?? Date.now(), caps = o.caps || NEWS_CAPS, hand = o.hand || [], conc = Math.max(1, o.concurrency || 4), rxBudget = o.rxBudget ?? 12;
  const src = { ctgovResults: "off", ctgovStopped: "off", openfda: "off", rxnorm: "off", pubmed: "off", epmc: "off", dailymed: "off" };
  const tripped = {}, answered = {};
  const note = (name, ok) => { if (!ok) src[name] = "failed"; else if (src[name] === "off") src[name] = "ok"; };
  const cget = (k) => { try { return io.cache ? io.cache.get(k) : undefined; } catch (e) { return undefined; } };
  const cput = (k, v) => { try { if (io.cache) io.cache.put(k, v); } catch (e) { /* a cache that cannot be written is only slower */ } };
  const savedP = (async () => { try { return (o.getSaved ? await o.getSaved() : null) || null; } catch (e) { return null; } })();

  const gates = {};   // source -> promise of "did the one retry work?" while that source is being retried
  /**
   * One lookup against a source that can corroborate: cached, or fetched and parsed. A failure trips that source for the rest of this
   * run, so a source that is down costs a handful of requests, not one per study. With retryMs (PubMed in a browser, where a 429 shows
   * up as an opaque network error) the first failure is retried once after that pause while the other lookups wait for the verdict.
   */
  async function look(name, key, run, { retryMs = 0, trip = true } = {}) {
    const hit = cget(key);
    if (hit !== undefined && hit !== null) { answered[name] = true; return hit; }   // an earlier answer from this source still counts as "answered"
    const attempt = async () => { const v = await run(); if (!v || v.ok !== true) throw new Error("unexpected " + name + " reply"); cput(key, v); note(name, true); answered[name] = true; return v; };
    const fail = () => { if (trip) tripped[name] = true; note(name, false); return null; };
    if (tripped[name]) return null;
    if (gates[name] && !(await gates[name])) return null;
    try { return await attempt(); }
    catch (e) {
      if (!(retryMs > 0)) return fail();
      if (!gates[name]) {
        let verdict; gates[name] = new Promise((r) => { verdict = r; });
        await io.sleep(retryMs);
        try { const v = await attempt(); verdict(true); return v; }
        catch (e2) { verdict(false); return fail(); }
      }
      if (!(await gates[name])) return null;
      try { return await attempt(); } catch (e3) { return fail(); }
    }
  }
  async function registry(kind) {
    const params = newsRegistryParams(kind, nowMs), key = `reg:${kind}:${newsDaysAgo(nowMs, NEWS_WINDOWS.registryDays)}`;
    const hit = cget(key);
    if (Array.isArray(hit)) return hit;
    let json;
    try { json = await io.fetchJson("ctgov", newsUrl(NEWS_HOSTS.ctgov, params), { timeoutMs: 20000 }); }
    catch (e) {
      if (!(e && e.status === 400)) throw e;
      const p = { ...params }; delete p.fields;   // same fallback as the saved-studies refresh: some field lists are refused
      json = await io.fetchJson("ctgov", newsUrl(NEWS_HOSTS.ctgov, p), { timeoutMs: 20000 });
    }
    const studies = newsParseRegistry(json);
    if (!studies) throw new Error("unexpected registry reply");
    cput(key, studies);
    return studies;
  }
  async function fda() {
    const win = newsFdaWindow(nowMs), key = `fda:${win.fromCompact}`;
    const hit = cget(key);
    if (hit && Array.isArray(hit.candidates)) return hit;
    let all = [], lastUpdated = null;
    for (let page = 0; page < 3; page++) {
      let json;
      try { json = await io.fetchJson("openfda", newsUrl(NEWS_HOSTS.fda, newsFdaParams(nowMs, page * 200)), { timeoutMs: 25000 }); }
      catch (e) { if (e && e.status === 404 && e.code === "NOT_FOUND") break; throw e; }   // only openFDA's own "No matches found" 404 is an empty list; any other 404 (a proxy, a gateway) is a failure
      const r = newsParseFda(json, win);
      if (!r.ok) throw new Error("unexpected openFDA reply");
      all = all.concat(r.candidates); lastUpdated = r.lastUpdated || lastUpdated;
      if (!((page + 1) * 200 < r.total)) break;
    }
    const v = { candidates: newsMergeFda(all), lastUpdated };
    if (v.candidates.length) cput(key, v);   // an empty list is never kept: it is asked again next time
    return v;
  }
  const feed = async (name, run) => { try { const v = await run(); note(name, true); answered[name] = true; return v; } catch (e) { note(name, false); return null; } };
  /* openFDA starts with the registry feeds but nobody waits for it here: the registry stories must not queue behind it */
  const fdaP = feed("openfda", fda);
  const [resStudies, stopStudies] = await Promise.all([feed("ctgovResults", () => registry("results")), feed("ctgovStopped", () => registry("stopped"))]);
  const saved = await savedP;
  const savedKind = (k) => (saved ? saved.items.filter((i) => i.kind === k) : []);

  /* stopped first: its cap decides which studies leave the results list */
  const stoppedItems = stopStudies ? newsCap(newsSortDesc(newsDedupeLive(newsStoppedItems(stopStudies, nowMs), hand, nowMs)), caps.stopped) : null;
  const shown = new Set((stoppedItems || savedKind("stopped")).map((i) => i.nct));

  /* results: only the studies that will be shown get journal lookups */
  async function resultsPipeline() {
    if (!resStudies) return null;
    const since = newsDaysAgo(nowMs, NEWS_WINDOWS.registryDays);
    const pick = newsCap(newsSortDesc(resStudies.filter((s) => s.resultsDate && newsSortKey(s.resultsDate) >= since && !shown.has(s.nct) && !newsHandHasNct(s.nct, hand)).map((s) => ({ ...s, date: s.resultsDate }))), caps.results);
    const built = await newsPool(pick, conc, async (s) => {
      const floor = s.pcd || s.completionDate || null;
      const [pm, ep] = await Promise.all([
        look("pubmed", `pm:${s.nct}:${floor || ""}`, async () => newsPubmedParse(await io.fetchJson("pubmed", newsUrl(NEWS_HOSTS.pubmed, newsPubmedParams(s.nct, floor)), { timeoutMs: 8000 })), { retryMs: o.pubmedRetryMs || 0 }),
        look("epmc", `ep:${s.nct}:${floor || ""}`, async () => newsEpmcParse(await io.fetchJson("epmc", newsUrl(NEWS_HOSTS.epmc, newsEpmcParams(s.nct, floor)), { timeoutMs: 8000 }))),
      ]);
      const j = newsJournal(pm, ep);
      return o.dropUnknown && j.state === "unknown" ? null : newsResultItem(s, j);
    });
    return built.filter(Boolean);
  }

  /* approvals: Drugs@FDA plus a second source, newest first */
  let fdaRes = null, builtDm = {};
  async function approvalsPipeline() {
    fdaRes = await fdaP;
    if (!fdaRes) return null;
    const cands = fdaRes.candidates;
    if (o.dailymedAll) {
      let misses = 0;   // two lookups in a row that still fail (after the environment's own retries) end the DailyMed round: it is down
      for (const c of cands.slice(0, 30)) {
        if (misses >= 2) break;
        const p = await look("dailymed", `dm:${c.app}`, async () => newsDailymedParse(await io.fetchJson("dailymed", newsUrl(NEWS_HOSTS.dailymed, newsDailymedParams(c.app)), { timeoutMs: 15000 })), { trip: false });
        if (!p) { misses++; continue; }
        misses = 0;
        if (newsDailymedMatch(p, c)) builtDm[c.app] = { setid: p.setid, title: p.title };
      }
    }
    const dm = { ...(saved ? saved.dailymed : {}), ...builtDm };
    const todo = cands.filter((c) => !newsApprovalDup(c.brand, c.generics, hand));
    const out = [];
    let rxCalls = 0;
    for (let i = 0; i < todo.length && out.length < caps.approvals; i += conc) {
      const done = await newsPool(todo.slice(i, i + conc), conc, async (c) => {
        let rx = null;
        if (newsBrandDistinct(c) && rxCalls < rxBudget) {
          rxCalls++;
          const p = await look("rxnorm", "rx:" + c.brand.toLowerCase(), async () => newsRxnormParse(await io.fetchJson("rxnorm", newsUrl(NEWS_HOSTS.rxnorm, newsRxnormParams(c.brand)), { timeoutMs: 8000 }), c.brand));
          rx = p ? newsRxnormMatch(p, c) : null;
        }
        return newsApprovalItem(c, { rx, dm: dm[c.app] });
      });
      for (const it of done) if (it && out.length < caps.approvals) out.push(it);
    }
    // RxNorm gave out and nothing else could vouch for approvals: this kind did not really answer
    return tripped.rxnorm && !Object.keys(dm).length ? null : out;
  }
  const [resultItems, approvalItems] = await Promise.all([resultsPipeline(), approvalsPipeline()]);

  const kinds = { results: resultItems, stopped: stoppedItems, approvals: approvalItems };
  const failedKinds = Object.keys(kinds).filter((k) => kinds[k] === null);
  const savedName = { results: "results", stopped: "stopped", approvals: "approval" };
  const usedSaved = failedKinds.filter((k) => savedKind(savedName[k]).length > 0);
  const live = {};
  for (const k of Object.keys(kinds)) live[k] = kinds[k] === null ? savedKind(savedName[k]) : kinds[k];
  return {
    items: newsMerge({ hand, ...live, caps, nowMs }), live, sources: src, answered, failedKinds, usedSaved,
    anyLive: src.ctgovResults === "ok" || src.ctgovStopped === "ok" || src.openfda === "ok",
    partial: failedKinds.length > 0, dailymed: builtDm, fdaUpdated: fdaRes ? fdaRes.lastUpdated : null,
  };
}
