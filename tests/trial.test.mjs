import { test } from "node:test";
import assert from "node:assert/strict";
import { dotsFor, followUp, groupKinds } from "../site/js/views/trial.js";
import { SNAPSHOT } from "../site/data/snapshot.js";
import { lib } from "../site/data/library.js";

test("dots always add up to 100", () => {
  assert.deepEqual(dotsFor([["A", 643], ["B", 630], ["C", 636], ["D", 630]]).reduce((a, b) => a + b), 100);
  assert.deepEqual(dotsFor([["A", 1], ["B", 2]]), [33, 67]);
});

test("follow-up time is read from the main measure's time frame", () => {
  assert.equal(followUp("Baseline, Week 72"), "72 weeks");
  assert.equal(followUp("Up to 18 months"), "18 months");
  assert.equal(followUp("4.5 years"), "4.5 years");
  assert.equal(followUp("End of study"), "See step 4");
});

test("comparison groups are recognised in real registry data", () => {
  const kinds = (id) => groupKinds(SNAPSHOT[id].groups, SNAPSHOT[id], lib(id));
  assert.deepEqual(kinds("NCT04184622"), [true, false, false, false]); // placebo + 3 doses
  assert.deepEqual(kinds("NCT01035255"), [false, true]); // LCZ696 vs enalapril
  assert.deepEqual(kinds("NCT01844505"), [false, false, true]); // nivolumab, combination, ipilimumab alone
  assert.deepEqual(kinds("NCT03529110"), [false, true]); // T-DXd vs T-DM1
  assert.deepEqual(kinds("NCT02296125"), [false, true]); // osimertinib vs standard EGFR-TKI
});

test("comparison groups are recognised when the registry calls every arm experimental", () => {
  const kinds = (id) => groupKinds(SNAPSHOT[id].groups, SNAPSHOT[id], lib(id));
  assert.deepEqual(kinds("NCT04994509"), [false, true, true]); // lenacapavir vs two daily pills
  assert.deepEqual(kinds("NCT02193074"), [true, false]); // sham control vs nusinersen
  assert.deepEqual(kinds("NCT03987919"), [false, false, false, true]); // three tirzepatide doses vs semaglutide
});

test("the reviewed summary wins when the registry swaps its arm types", () => {
  const kinds = (id) => groupKinds(SNAPSHOT[id].groups, SNAPSHOT[id], lib(id));
  assert.deepEqual(kinds("NCT01194570"), [true, false]); // ORATORIO: placebo vs ocrelizumab
  assert.deepEqual(kinds("NCT03036124"), [false, true]); // DAPA-HF: "Dapa 10mg" vs placebo
  assert.deepEqual(kinds("NCT02142738"), [false, true]); // KEYNOTE-024: pembrolizumab vs chemotherapy
});
