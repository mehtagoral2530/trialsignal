// Turns a ClinicalTrials.gov API v2 study into the flat shape the views use.
// Pure functions only: the snapshot script and the tests import this file too.

const STATUS = {
  RECRUITING: "Recruiting",
  NOT_YET_RECRUITING: "Not yet recruiting",
  ENROLLING_BY_INVITATION: "Enrolling by invitation",
  ACTIVE_NOT_RECRUITING: "Active, not recruiting",
  COMPLETED: "Completed",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
  WITHDRAWN: "Withdrawn",
  UNKNOWN: "Status unknown",
  AVAILABLE: "Available",
  NO_LONGER_AVAILABLE: "No longer available",
  TEMPORARILY_NOT_AVAILABLE: "Temporarily not available",
  APPROVED_FOR_MARKETING: "Approved for marketing",
  WITHHELD: "Withheld",
};

const titleCase = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

export const statusLabel = (code) => (code ? STATUS[code] || titleCase(code) : "");

// Official registry terms stay; a plain gloss is shown after them.
const STATUS_GLOSS = {
  RECRUITING: "looking for volunteers",
  NOT_YET_RECRUITING: "opening soon",
  ENROLLING_BY_INVITATION: "invited people only",
  ACTIVE_NOT_RECRUITING: "running, no longer enrolling",
  COMPLETED: "finished",
  TERMINATED: "stopped early",
  WITHDRAWN: "stopped before anyone joined",
  SUSPENDED: "paused",
  UNKNOWN: "not updated recently",
};
export const statusGloss = (code) => STATUS_GLOSS[code] || "";

// Dot colour class for a status.
export function statusClass(code) {
  if (["RECRUITING", "ENROLLING_BY_INVITATION", "AVAILABLE"].includes(code)) return "st-recruit";
  if (code === "NOT_YET_RECRUITING") return "st-notyet";
  if (code === "ACTIVE_NOT_RECRUITING") return "st-active";
  if (["TERMINATED", "WITHDRAWN", "SUSPENDED"].includes(code)) return "st-stop";
  return "st-done";
}

const PHASE_GLOSS = {
  "Early phase 1": "first test in people",
  "Phase 1": "first test in people",
  "Phase 1/2": "early test",
  "Phase 2": "does it work, at what dose",
  "Phase 2/3": "mid-to-large test",
  "Phase 3": "large final test",
  "Phase 4": "after approval",
};
export const phaseGloss = (label) => PHASE_GLOSS[label] || "";

// Tone drives the pill colour: open now, under way, stopped early, or neutral.
export function statusTone(code) {
  if (["RECRUITING", "ENROLLING_BY_INVITATION", "AVAILABLE"].includes(code)) return "ok";
  if (["NOT_YET_RECRUITING", "ACTIVE_NOT_RECRUITING"].includes(code)) return "info";
  if (["TERMINATED", "WITHDRAWN", "SUSPENDED"].includes(code)) return "bad";
  return "";
}

// A trial is "running" until it reaches a final status.
export const isRunning = (code) =>
  ["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING", "SUSPENDED"].includes(code);

export function phaseLabel(phases) {
  const p = (phases || []).filter(Boolean);
  if (!p.length) return "";
  if (p.length === 1 && p[0] === "NA") return "Phase not applicable";
  if (p.length === 1 && p[0] === "EARLY_PHASE1") return "Early phase 1";
  const nums = p.map((x) => x.replace(/^PHASE/, "")).filter((x) => /^\d$/.test(x));
  return nums.length ? `Phase ${nums.join("/")}` : titleCase(p.join(", "));
}

const ARM_TYPES = {
  EXPERIMENTAL: "Experimental",
  ACTIVE_COMPARATOR: "Active comparator",
  PLACEBO_COMPARATOR: "Placebo comparator",
  SHAM_COMPARATOR: "Sham comparator",
  NO_INTERVENTION: "No intervention",
  OTHER: "Other",
};
export const armTypeLabel = (t) => ARM_TYPES[t] || titleCase(t);

const MASKING = {
  NONE: "Open-label",
  SINGLE: "Single-blind",
  DOUBLE: "Double-blind",
  TRIPLE: "Triple-blind",
  QUADRUPLE: "Quadruple-blind",
};
const MODEL = {
  PARALLEL: "Parallel groups",
  CROSSOVER: "Crossover",
  SINGLE_GROUP: "Single group",
  FACTORIAL: "Factorial",
  SEQUENTIAL: "Sequential",
};

// Design as a list of short tags, each with an optional glossary key.
export function designTags(design = {}) {
  const tags = [];
  if (design.allocation === "RANDOMIZED") tags.push({ text: "Randomized", term: "randomized" });
  if (design.allocation === "NON_RANDOMIZED") tags.push({ text: "Not randomized", term: "randomized" });
  if (design.masking && MASKING[design.masking]) {
    tags.push({ text: MASKING[design.masking], term: design.masking === "NONE" ? "open-label" : "double-blind" });
  }
  if (design.model && MODEL[design.model]) tags.push({ text: MODEL[design.model], term: null });
  return tags;
}

export const ageLabel = (s) => (s ? String(s).replace(/\b(Years?|Months?|Weeks?|Days?)\b/, (w) => w.toLowerCase()) : "");
export const sexLabel = (s) => ({ ALL: "All", FEMALE: "Female", MALE: "Male" })[s] || "";

// The registry stores criteria as Markdown-ish text with escaped symbols.
export const unescapeMd = (s) => String(s || "").replace(/\\([\\`*_{}[\]()#+\-.!<>^|~=])/g, "$1");

const INC = /^(?:key\s+)?inclusion\s+criteria\b[^:]*:?\s*(.*)$/i;
const EXC = /^(?:key\s+)?exclusion\s+criteria\b[^:]*:?\s*(.*)$/i;
const BULLET = /^(?:[*•\-–]|\d{1,2}[.)]|[a-z][.)])\s+(.*)$/i;

// Splits free-text eligibility into inclusion and exclusion lists.
// Each item keeps its nesting level so sub-points can be indented.
export function splitCriteria(text) {
  const out = { inclusion: [], exclusion: [], notes: [] };
  if (!text) return out;
  let mode = "notes";
  let last = null;
  for (const raw of unescapeMd(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const t = line.trim();
    if (!t) continue;
    const inc = t.match(INC);
    const exc = !inc && t.match(EXC);
    if (inc || exc) {
      mode = inc ? "inclusion" : "exclusion";
      last = null;
      const rest = (inc || exc)[1].trim();
      if (rest) out[mode].push((last = { text: rest, level: 0 }));
      continue;
    }
    const b = t.match(BULLET);
    const indent = line.length - line.trimStart().length;
    if (b) {
      out[mode].push((last = { text: b[1].trim(), level: indent >= 2 ? 1 : 0 }));
    } else if (last && mode !== "notes" && /^[a-z(]/.test(t)) {
      last.text += ` ${t}`; // wrapped continuation of the previous point
    } else {
      out[mode].push((last = { text: t, level: indent >= 2 ? 1 : 0 }));
    }
  }
  return out;
}

const dateOf = (s) => (s && s.date) || "";
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || "");

export function normalizeStudy(raw) {
  const p = (raw && raw.protocolSection) || {};
  const id = p.identificationModule || {};
  const st = p.statusModule || {};
  const sp = p.sponsorCollaboratorsModule || {};
  const ds = p.designModule || {};
  const di = ds.designInfo || {};
  const el = p.eligibilityModule || {};
  const ai = p.armsInterventionsModule || {};
  const om = p.outcomesModule || {};
  const locs = (p.contactsLocationsModule && p.contactsLocationsModule.locations) || [];
  const countries = [...new Set(locs.map((l) => l.country).filter(Boolean))];
  const outcomes = (list) => (list || []).map((o) => ({ measure: unescapeMd(o.measure), timeFrame: unescapeMd(o.timeFrame) }));

  return {
    id: id.nctId || "",
    acronym: id.acronym || "",
    title: id.briefTitle || "",
    officialTitle: id.officialTitle || "",
    status: st.overallStatus || "",
    phases: ds.phases || [],
    phase: phaseLabel(ds.phases),
    studyType: ds.studyType || "",
    sponsor: (sp.leadSponsor && sp.leadSponsor.name) || "",
    collaborators: (sp.collaborators || []).map((c) => c.name).filter(Boolean),
    conditions: (p.conditionsModule && p.conditionsModule.conditions) || [],
    summary: unescapeMd(p.descriptionModule && p.descriptionModule.briefSummary),
    design: {
      allocation: di.allocation || "",
      model: di.interventionModel || "",
      purpose: di.primaryPurpose || "",
      masking: (di.maskingInfo && di.maskingInfo.masking) || "",
      whoMasked: (di.maskingInfo && di.maskingInfo.whoMasked) || [],
    },
    arms: (ai.armGroups || []).map((a) => ({
      label: a.label || "",
      type: a.type || "",
      description: unescapeMd(a.description),
      interventions: a.interventionNames || [],
    })),
    interventions: (ai.interventions || []).map((i) => ({ type: i.type || "", name: i.name || "" })),
    primaryOutcomes: outcomes(om.primaryOutcomes),
    secondaryOutcomes: outcomes(om.secondaryOutcomes),
    eligibility: {
      criteria: el.eligibilityCriteria || "",
      sex: el.sex || "",
      minAge: el.minimumAge || "",
      maxAge: el.maximumAge || "",
      healthy: el.healthyVolunteers ?? null,
    },
    enrollment: ds.enrollmentInfo ? { count: ds.enrollmentInfo.count ?? null, type: ds.enrollmentInfo.type || "" } : null,
    dates: {
      start: dateOf(st.startDateStruct),
      primaryCompletion: dateOf(st.primaryCompletionDateStruct),
      primaryCompletionType: (st.primaryCompletionDateStruct && st.primaryCompletionDateStruct.type) || "",
      completion: dateOf(st.completionDateStruct),
      firstPosted: dateOf(st.studyFirstPostDateStruct),
      resultsPosted: dateOf(st.resultsFirstPostDateStruct),
      lastUpdate: dateOf(st.lastUpdatePostDateStruct),
    },
    sites: locs.length,
    countries,
    hasResults: !!(raw && raw.hasResults),
    groups: baselineGroups(raw),
  };
}

// Group sizes from posted results (baseline characteristics), without the "Total" column.
export function baselineGroups(raw) {
  const bc = raw && raw.resultsSection && raw.resultsSection.baselineCharacteristicsModule;
  if (!bc || !bc.groups || !bc.denoms || !bc.denoms.length) return null;
  const denom = bc.denoms.find((d) => /participant/i.test(d.units || "")) || bc.denoms[0];
  const groups = bc.groups
    .filter((g) => !/^total$/i.test((g.title || "").trim()))
    .map((g) => {
      const c = (denom.counts || []).find((x) => x.groupId === g.id);
      return [g.title || "Group", c ? Number(c.value) || 0 : 0];
    })
    .filter(([, n]) => n > 0);
  return groups.length > 1 ? groups : null;
}

// The few fields a feed row needs; used for live feeds and the saved copy alike.
export function feedRow(m) {
  return {
    id: m.id,
    acronym: m.acronym,
    title: m.title,
    status: m.status,
    phase: /not applicable/i.test(m.phase) ? "" : m.phase,
    sponsor: m.sponsor,
    condition: (m.conditions || [])[0] || "",
    dates: { lastUpdate: m.dates.lastUpdate, firstPosted: m.dates.firstPosted, resultsPosted: m.dates.resultsPosted },
  };
}

// Smaller copy for the saved snapshot: long free text is clipped.
export function trimForSnapshot(m) {
  return {
    ...m,
    summary: clip(m.summary, 900),
    arms: m.arms.map((a) => ({ ...a, description: clip(a.description, 320) })),
    secondaryOutcomes: m.secondaryOutcomes.slice(0, 12),
  };
}
