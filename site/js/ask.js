// Answers everyday questions from one trial's record. Each answer says where it came
// from (a named section of the registry record, or TrialSignal's reviewed summary), so
// readers can check it. No AI and no guessing: if the record doesn't cover a question,
// the answer says so.

import { fmtDate, num } from "./util.js";
import { statusLabel, splitCriteria, ageLabel, sexLabel, armTypeLabel } from "./normalize.js";

export const SUGGESTIONS = [
  "Who could not join?",
  "How long did it run?",
  "Was it blinded?",
  "Where did it run?",
  "What were the side effects?",
];

// Ordered from most to least specific; the first match wins.
const INTENTS = [
  ["exclusion", /\b(not join|couldn.?t join|can.?t join|cannot join|not take part|exclu|ruled out|not eligible|not allowed)/],
  ["blinding", /\b(blind|masked|masking|know who got|knew who)/],
  ["duration", /\b(how long|duration|last(ed)?|follow[- ]?up|weeks?|months?|years?)\b/],
  ["safety", /\b(safe|safety|side[- ]?effects?|adverse|risks?|harm)/],
  ["size", /\b(how many|enrol|enroll|number of (people|participants)|participants|sample size|how big)/],
  ["where", /\b(where|locations?|sites?|countr|hospitals?|cities|city|near)/],
  ["sponsor", /\b(sponsor|who runs|who is running|who ran|fund|company|manufacturer)/],
  ["who", /\b(eligib|who can|who could|take part|inclusion|criteria|join|qualif|requirements?|ages?|old)/],
  ["how", /\b(outcomes?|measur|endpoints?|assess|success)/],
  ["what", /\b(treatments?|drugs?|medic|tested|interventions?|doses?|placebo|compar|vaccine|arms?|groups?|get|got)/],
  ["found", /\b(results?|found|work|effective|benefit|show|evidence|paper|published|happen)/],
  ["status", /\b(status|recruit|when|dates?|start|finish|end|still|open|over|complete)/],
  ["purpose", /\b(trying to|find out|purpose|aims?|goal|about|question|why|summary)/],
];

export function intentOf(q) {
  const s = String(q || "").toLowerCase();
  const hit = INTENTS.find(([, re]) => re.test(s));
  return hit ? hit[0] : null;
}

const reg = (part) => ({ from: "registry", part });
const SUMMARY = { from: "summary", part: "" };
const top = (list, n = 3) => list.filter((x) => !x.level).slice(0, n).map((x) => x.text.replace(/[\s;:,.]+$/, ""));

// model: normalized registry record (may be null). curated: library entry (may be null).
export function answer(q, { model, curated } = {}) {
  const k = intentOf(q);
  if (!k) {
    return { text: "I can only answer from this trial’s registry record and TrialSignal’s reviewed summary, and that question isn’t covered. Try one of the suggestions, or open the official record.", from: null };
  }
  const M = model;
  const C = curated;
  const missing = (what) => ({ text: `The record doesn’t include ${what} here. Check the official record on ClinicalTrials.gov.`, from: null });
  const crit = M ? splitCriteria(M.eligibility.criteria) : { inclusion: [], exclusion: [] };

  switch (k) {
    case "exclusion": {
      if (!crit.exclusion.length) return missing("exclusion criteria");
      const n = crit.exclusion.filter((x) => !x.level).length;
      return { text: `The registry lists ${n} ${n === 1 ? "reason" : "reasons"} someone could not join. The first few:`, items: top(crit.exclusion, 4), note: "Only the study team can decide whether a particular person is eligible.", ...reg("eligibility section") };
    }

    case "blinding": {
      if (!M || !M.design.masking) return missing("blinding details");
      if (M.design.masking === "NONE") return { text: "No. It was open label: everyone knew who got which treatment.", ...reg("design section") };
      const level = { SINGLE: "single", DOUBLE: "double", TRIPLE: "triple", QUADRUPLE: "quadruple" }[M.design.masking] || "";
      const who = (M.design.whoMasked || []).map((w) => w.toLowerCase().replace(/_/g, " ")).map((w) => (w === "investigator" ? "the study doctors" : w === "participant" ? "participants" : w === "care provider" ? "care providers" : w === "outcomes assessor" ? "the people measuring results" : w));
      return { text: `Yes. It was ${level}-blind${who.length ? `: ${who.join(", ").replace(/, ([^,]*)$/, " and $1")} didn’t know who got what` : ""}.`, ...reg("design section") };
    }

    case "duration": {
      if (!M) return missing("dates");
      const d = M.dates;
      const done = ["COMPLETED", "TERMINATED"].includes(M.status);
      const parts = [];
      if (d.start) parts.push(`It started on ${fmtDate(d.start)}.`);
      if (d.primaryCompletion) parts.push(`The main data was ${d.primaryCompletionType === "ESTIMATED" ? "expected" : "collected"} by ${fmtDate(d.primaryCompletion)}.`);
      if (d.completion) parts.push(`The whole study ${M.status === "COMPLETED" ? "finished" : done ? "stopped" : "is set to finish"} on ${fmtDate(d.completion)}.`);
      const tf = M.primaryOutcomes[0] && M.primaryOutcomes[0].timeFrame;
      if (tf) parts.push(`The main measure was taken at: ${tf}.`);
      return parts.length ? { text: parts.join(" "), ...reg("status and outcome sections") } : missing("dates");
    }

    case "purpose":
      if (C) return { text: C.question, ...SUMMARY };
      if (M && M.summary) return { text: M.summary, ...reg("description") };
      return missing("a summary");

    case "who": {
      if (!M && !C) return missing("eligibility details");
      const items = [];
      if (M) {
        const e = M.eligibility;
        items.push(`Ages: ${e.minAge ? ageLabel(e.minAge) : "any age"} to ${e.maxAge ? ageLabel(e.maxAge) : "no upper limit"}`);
        if (e.sex) items.push(`Sex: ${sexLabel(e.sex)}`);
        if (crit.inclusion.length) items.push(`Must have: ${top(crit.inclusion).join("; ")}`);
      }
      return { text: C ? C.plainPop : "Main points from the eligibility criteria:", items, note: "Only the study team can decide whether a particular person is eligible.", ...(M ? reg("eligibility section") : SUMMARY) };
    }

    case "what":
      if (C) return { text: `${C.intervention}, compared with ${lowerFirst(C.comparator)}. ${C.plainTx}`, ...SUMMARY };
      if (M && M.arms.length) {
        return {
          text: "The study has these groups:",
          items: M.arms.map((a) => `${a.label}${a.type ? ` (${armTypeLabel(a.type).toLowerCase()})` : ""}${a.interventions.length ? `: ${a.interventions.join(", ")}` : ""}`),
          ...reg("arms and interventions section"),
        };
      }
      return missing("the interventions");

    case "how":
      if (M && M.primaryOutcomes.length) {
        return {
          text: `Main (primary) ${M.primaryOutcomes.length === 1 ? "outcome" : "outcomes"}:`,
          items: M.primaryOutcomes.map((o) => (o.timeFrame ? `${o.measure} (${o.timeFrame})` : o.measure)),
          note: M.secondaryOutcomes.length ? `Plus ${M.secondaryOutcomes.length} secondary ${M.secondaryOutcomes.length === 1 ? "outcome" : "outcomes"}.` : "",
          ...reg("outcome measures section"),
        };
      }
      return missing("outcome measures");

    case "found":
      if (C) return { text: C.result, note: C.evidence === "published" ? "From a peer-reviewed paper." : "From a company announcement, not yet peer-reviewed. Treat it as preliminary.", ...SUMMARY };
      if (M && M.hasResults) return { text: "Results are posted on the registry. Open the record’s Results tab to read them, and search PubMed for a publication.", ...reg("results section") };
      return { text: "TrialSignal hasn’t linked any results for this trial, and none are posted on the registry yet.", ...reg("status section") };

    case "safety":
      if (C && C.safety) return { text: C.safety, ...SUMMARY };
      if (M && M.hasResults) return { text: "Safety results are posted with the registry results. Open the record’s Results tab and look for “Adverse Events”.", ...reg("results section") };
      return missing("safety results");

    case "status":
      if (!M) return missing("a status");
      return {
        text: `${statusLabel(M.status) || "Status not given"}.`,
        items: [
          M.dates.start && `Started ${fmtDate(M.dates.start)}`,
          M.dates.primaryCompletion && `Main results ${M.dates.primaryCompletionType === "ESTIMATED" ? "expected" : "collected"} ${fmtDate(M.dates.primaryCompletion)}`,
          M.dates.lastUpdate && `Record last updated ${fmtDate(M.dates.lastUpdate)}`,
        ].filter(Boolean),
        ...reg("status section"),
      };

    case "where":
      if (M && M.sites) {
        const list = M.countries.slice(0, 8).join(", ") + (M.countries.length > 8 ? ` and ${M.countries.length - 8} more` : "");
        return { text: `At ${num(M.sites)} ${M.sites === 1 ? "site" : "sites"}${M.countries.length ? ` in ${M.countries.length} ${M.countries.length === 1 ? "country" : "countries"}: ${list}` : ""}.`, note: "Site lists change. Contact details are on the official record.", ...reg("locations section") };
      }
      return missing("locations");

    case "sponsor":
      if (M && M.sponsor) return { text: `${M.sponsor}${M.collaborators.length ? `, with ${M.collaborators.join(", ")}` : ""}.`, ...reg("sponsor section") };
      return missing("a sponsor");

    case "size":
      if (M && M.enrollment && M.enrollment.count != null) {
        return { text: `${num(M.enrollment.count)} people (${M.enrollment.type === "ESTIMATED" ? "planned" : "actual"} enrollment).`, ...reg("design section") };
      }
      return missing("enrollment numbers");
  }
  return missing("that");
}

const lowerFirst = (s) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || "");
