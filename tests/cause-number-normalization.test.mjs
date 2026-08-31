import assert from "node:assert/strict";
import test from "node:test";

import { manualIntakeAnalysis } from "../app/manual-intake.mjs";
import { normalizeCauseNumber } from "../server/cause-number.mjs";
import { masterDataFromExtraction } from "../server/master-deposition-data.mjs";

test("cause-number letters are canonical uppercase", () => {
  assert.equal(normalizeCauseNumber(" 25-cv-00598-oLg "), "25-CV-00598-OLG");
  assert.equal(masterDataFromExtraction({ setup:{ causeNumber:"25-cv-00598-olg" } }).case.causeNumber.value, "25-CV-00598-OLG");
});

test("manual intake returns one uppercase cause number in both projections", () => {
  const result = manualIntakeAnalysis({ caseStyle:"A v. B", witness:"W", causeNumber:"25-cv-598-olg", depositionDate:"2026-04-30", deponentType:"" });
  assert.equal(result.causeNumber, "25-CV-598-OLG");
  assert.equal(result.masterData.case.causeNumber.value, "25-CV-598-OLG");
});
