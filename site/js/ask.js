// Answers everyday questions from one trial's record. Each answer names the part
// of the record it came from, so readers can check it. No AI and no guessing:
// if the record doesn't cover a question, the answer says so.

import { fmtDate, num } from "./util.js";
import { statusLabel, splitCriteria, ageLabel, sexLabel, armTypeLabel } from "./normalize.js";

export const SUGGESTIONS = [
  "What is this study trying to find out?",
  "Who can take part?",
  "What treatment is being tested?",
  "What outcomes are the researchers measuring?",
  "What has been found so far?",
  "Is it still recruiting?",
];

// Ordered from most to least specific; the first match wins.
const INTENTS = [
  ["safety", /\b(safe|safety|side[- ]?effects?|adverse|risks?|harm)/],
  ["size", /\b(how many|enrol|enroll|number of (people|participants)|participants|sample size|how big)/],
  ["where", /\b(where|locations?|sites?|countr|hospitals?|cities|city|near)/],
  ["sponsor", /\b(sponsor|who runs|who is running|fund|company|manufacturer)/],
  ["who", /\b(eligib|who can|take part|inclusion|exclusion|criteria|join|qualif|requirements?|ages?|old)/],
  ["how", /\b(outcomes?|measur|endpoints?|assess|success)/],
  ["what", /\b(treatments?|drugs?|medic|tested|interventions?|doses?|placebo|compar|vaccine|arms?|groups?)/],
  ["found", /\b(results?|found|work|effective|benefit|show|evidence|paper|published)/],
  ["status", /\b(status|recruit|when|dates?|start|finish|end|still|open|over|complete)/],
  ["purpose", /\b(trying to|find out|purpose|aims?|goal|about|question|why|summary)/],
];

export function intentOf(q) {
  const s = String(q || "").toLowerCase();
  const hit = INTENTS.find(([, re]) => re.test(s));
  return hit ? hit[0] : null;
}

const SRC = {
  library: "TrialSignal plain-language summary",
  description: "Description section of the registry record",
  eligibility: "Eligibility section of the registry record",
  arms: "Arms and interventions section of the registry record",
  outcomes: "Outcome measures section of the registry record",
  status: "Status section of the registry record",
  locations: "Locations section of the registry record",
  sponsor: "Sponsor section of the registry record",
  design: "Design section of the registry record",
  evidence: "Publication or announcement linked in TrialSignal",
};

// model: normalized registry record (may be null). curated: library entry (may be null).
export function answer(q, { model, curated } = {}) {
  const k = intentOf(q);
  if (!k) {
    return {
      text: "I couldn’t match that to a part of the record. Try asking about the purpose, who can take part, the treatment, what is measured, results, safety, status or locations.",
      source: null,
    };
  }
  const M = model;
  const C = curated;
  const missing = (what) => ({ text: `The record doesn’t include ${what} here. Check the official record on ClinicalTrials.gov.`, source: null });

  switch (k) {
    case "purpose":
      if (C) return { text: C.question, source: SRC.library };
      if (M && M.summary) return { text: M.summary, source: SRC.description };
      return missing("a summary");

    case "who": {
      if (!M && !C) return missing("eligibility details");
      const items = [];
      if (M) {
        const ages = [M.eligibility.minAge ? ageLabel(M.eligibility.minAge) : "any age", M.eligibility.maxAge ? ageLabel(M.eligibility.maxAge) : "no upper limit"];
        items.push(`Ages: ${ages.join(" to ")}`);
        if (M.eligibility.sex) items.push(`Sex: ${sexLabel(M.eligibility.sex)}`);
        const c = splitCriteria(M.eligibility.criteria);
        const top = (list) => list.filter((x) => !x.level).slice(0, 3).map((x) => x.text.replace(/[\s;:,.]+$/, "")).join("; ");
        if (c.inclusion.length) items.push(`Must have: ${top(c.inclusion)}`);
        if (c.exclusion.length) items.push(`Can’t have: ${top(c.exclusion)}`);
      }
      return {
        text: C ? C.plainPop : "Main points from the eligibility criteria:",
        items,
        note: "Only the study team can decide whether a particular person is eligible.",
        source: M ? SRC.eligibility : SRC.library,
      };
    }

    case "what":
      if (C) return { text: `${C.intervention}, compared with ${lowerFirst(C.comparator)}. ${C.plainTx}`, source: SRC.library };
      if (M && M.arms.length) {
        return {
          text: "The study has these groups:",
          items: M.arms.map((a) => `${a.label}${a.type ? ` (${armTypeLabel(a.type).toLowerCase()})` : ""}${a.interventions.length ? `: ${a.interventions.join(", ")}` : ""}`),
          source: SRC.arms,
        };
      }
      if (M && M.interventions.length) return { text: M.interventions.map((i) => i.name).join("; "), source: SRC.arms };
      return missing("the interventions");

    case "how":
      if (M && M.primaryOutcomes.length) {
        return {
          text: `Main (primary) ${M.primaryOutcomes.length === 1 ? "outcome" : "outcomes"}:`,
          items: M.primaryOutcomes.map((o) => (o.timeFrame ? `${o.measure} (${o.timeFrame})` : o.measure)),
          note: M.secondaryOutcomes.length ? `Plus ${M.secondaryOutcomes.length} secondary ${M.secondaryOutcomes.length === 1 ? "outcome" : "outcomes"}.` : "",
          source: SRC.outcomes,
        };
      }
      return missing("outcome measures");

    case "found":
      if (C) {
        const firm = C.evidence === "published" ? "From a peer-reviewed paper." : "From a company announcement, not yet peer-reviewed. Treat as preliminary.";
        return { text: C.result, note: firm, source: SRC.evidence };
      }
      if (M && M.hasResults) return { text: "Results have been posted on the registry. Open the record’s Results tab to read them, and search PubMed for a publication.", source: SRC.status };
      return { text: "TrialSignal hasn’t linked any results for this trial, and none are posted on the registry yet.", source: SRC.status };

    case "safety":
      if (C && C.safety) return { text: C.safety, source: SRC.evidence };
      if (M && M.hasResults) return { text: "Safety results are posted with the registry results. Open the record’s Results tab and look for “Adverse Events”.", source: SRC.status };
      return missing("safety results");

    case "status":
      if (!M) return C ? { text: "Live status isn’t loaded. Open the official record for the current status.", source: null } : missing("a status");
      return {
        text: `${statusLabel(M.status) || "Status not given"}.`,
        items: [
          M.dates.start && `Started ${fmtDate(M.dates.start)}`,
          M.dates.primaryCompletion && `Main results ${M.dates.primaryCompletionType === "ESTIMATED" ? "expected" : "collected"} ${fmtDate(M.dates.primaryCompletion)}`,
          M.dates.lastUpdate && `Record last updated ${fmtDate(M.dates.lastUpdate)}`,
        ].filter(Boolean),
        source: SRC.status,
      };

    case "where":
      if (M && M.sites) {
        const list = M.countries.slice(0, 8).join(", ") + (M.countries.length > 8 ? ` and ${M.countries.length - 8} more` : "");
        return { text: `${num(M.sites)} ${M.sites === 1 ? "site" : "sites"}${M.countries.length ? ` in ${list}` : ""}.`, note: "Site lists change. Contact details are on the official record.", source: SRC.locations };
      }
      return missing("locations");

    case "sponsor":
      if (M && M.sponsor) return { text: `${M.sponsor}${M.collaborators.length ? `, with ${M.collaborators.join(", ")}` : ""}.`, source: SRC.sponsor };
      return missing("a sponsor");

    case "size":
      if (M && M.enrollment && M.enrollment.count != null) {
        return { text: `${num(M.enrollment.count)} people (${M.enrollment.type === "ESTIMATED" ? "planned" : "actual"} enrollment).`, source: SRC.design };
      }
      return missing("enrollment numbers");
  }
  return missing("that");
}

const lowerFirst = (s) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || "");
