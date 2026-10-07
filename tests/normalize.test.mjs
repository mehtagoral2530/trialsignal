import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseLabel, statusLabel, statusTone, splitCriteria, normalizeStudy, designTags, unescapeMd } from "../site/js/normalize.js";

test("phase labels read like people say them", () => {
  assert.equal(phaseLabel(["PHASE3"]), "Phase 3");
  assert.equal(phaseLabel(["PHASE2", "PHASE3"]), "Phase 2/3");
  assert.equal(phaseLabel(["EARLY_PHASE1"]), "Early phase 1");
  assert.equal(phaseLabel(["NA"]), "Phase not applicable");
  assert.equal(phaseLabel([]), "");
});

test("status labels and tones", () => {
  assert.equal(statusLabel("ACTIVE_NOT_RECRUITING"), "Active, not recruiting");
  assert.equal(statusLabel("SOMETHING_NEW"), "Something new");
  assert.equal(statusTone("RECRUITING"), "ok");
  assert.equal(statusTone("TERMINATED"), "bad");
  assert.equal(statusTone("COMPLETED"), "");
});

test("registry escapes are removed", () => {
  assert.equal(unescapeMd("EF =\\< 35% and age \\>18, BMI 30 kg/m\\^2"), "EF =< 35% and age >18, BMI 30 kg/m^2");
});

test("criteria split into inclusion and exclusion, keeping sub-points", () => {
  const text = [
    "Key Inclusion Criteria:",
    "",
    "* Age ≥ 18",
    "* Has one of the following:",
    "  * hypertension",
    "  * dyslipidemia",
    "* BMI \\>30",
    "  that continues on a wrapped line",
    "",
    "Exclusion Criteria:",
    "",
    "1. Diabetes",
    "2. Pregnancy",
  ].join("\n");
  const c = splitCriteria(text);
  assert.deepEqual(c.inclusion.map((x) => [x.text, x.level]), [
    ["Age ≥ 18", 0],
    ["Has one of the following:", 0],
    ["hypertension", 1],
    ["dyslipidemia", 1],
    ["BMI >30 that continues on a wrapped line", 0],
  ]);
  assert.deepEqual(c.exclusion.map((x) => x.text), ["Diabetes", "Pregnancy"]);
  assert.equal(c.notes.length, 0);
});

test("text before the first heading is kept as notes", () => {
  const c = splitCriteria("For more information, visit the sponsor site.\n\nInclusion Criteria:\n\n* Adults");
  assert.deepEqual(c.notes.map((x) => x.text), ["For more information, visit the sponsor site."]);
  assert.equal(c.inclusion.length, 1);
});

test("normalizeStudy flattens an API v2 record", () => {
  const raw = {
    hasResults: true,
    protocolSection: {
      identificationModule: { nctId: "NCT00000001", acronym: "TEST-1", briefTitle: "A Test" },
      statusModule: {
        overallStatus: "RECRUITING",
        startDateStruct: { date: "2024-01-15" },
        primaryCompletionDateStruct: { date: "2027-06", type: "ESTIMATED" },
        lastUpdatePostDateStruct: { date: "2026-10-01" },
      },
      sponsorCollaboratorsModule: { leadSponsor: { name: "Acme" }, collaborators: [{ name: "Beta Uni" }] },
      designModule: { phases: ["PHASE3"], enrollmentInfo: { count: 500, type: "ESTIMATED" }, designInfo: { allocation: "RANDOMIZED", maskingInfo: { masking: "DOUBLE" } } },
      outcomesModule: { primaryOutcomes: [{ measure: "Weight \\>5% lower", timeFrame: "Week 52" }] },
      contactsLocationsModule: { locations: [{ country: "Canada" }, { country: "Canada" }, { country: "Japan" }] },
    },
  };
  const m = normalizeStudy(raw);
  assert.equal(m.id, "NCT00000001");
  assert.equal(m.phase, "Phase 3");
  assert.equal(m.sponsor, "Acme");
  assert.deepEqual(m.collaborators, ["Beta Uni"]);
  assert.equal(m.enrollment.count, 500);
  assert.equal(m.dates.primaryCompletionType, "ESTIMATED");
  assert.equal(m.primaryOutcomes[0].measure, "Weight >5% lower");
  assert.equal(m.sites, 3);
  assert.deepEqual(m.countries, ["Canada", "Japan"]);
  assert.equal(m.hasResults, true);
  assert.deepEqual(designTags(m.design).map((t) => t.text), ["Randomized", "Double-blind"]);
});

test("normalizeStudy tolerates the slim search-result shape", () => {
  const m = normalizeStudy({ protocolSection: { identificationModule: { nctId: "NCT00000002", briefTitle: "Slim" } } });
  assert.equal(m.title, "Slim");
  assert.equal(m.phase, "");
  assert.equal(m.enrollment, null);
  assert.equal(m.sites, 0);
});
