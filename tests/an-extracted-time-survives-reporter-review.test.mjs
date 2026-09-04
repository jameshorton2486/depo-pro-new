// An extracted scheduled time has to survive being looked at.
//
// Found in end-to-end qualification against the Heath Thomas Notice, which states "1:30 p.m.
// (Central Time)". Extraction read it correctly and the Reporter Data Sheet labelled the cell
// EXTRACTED with high confidence -- and rendered the control blank, because <input type="time">
// can only display HH:MM. The sheet seeds every input with the extraction's own value, so an
// untouched save submitted "", and reviewedMasterData recorded the question as unanswered:
//
//   value "1:30 p.m. (Central Time)"  status EXTRACTED  sourceDocument Heath_Thomas_NOD.pdf
//     -> reporter opens the screen, changes nothing, saves
//   value null  status MISSING  sourceType null  sourceDocument null
//
// A fact the Notice actually stated became a fact it never stated, with nobody having touched it,
// and the reporter had no cue -- the badge said high confidence right up until it said MISSING.
//
// The repair is the pattern scheduledDate already used one line above: normalize the seed the way
// the input read it, so unchanged compares equal. The STORED value keeps its original wording --
// "(Central Time)" is currently the only place the zone survives, since logistics.time_zone is not
// required by the extraction schema and did not come through.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseClockTime } from "../app/intake-logistics.mjs";
import { reviewedMasterData } from "../app/master-data-review.mjs";

const SHEET = fs.readFileSync(new URL("../app/CanonicalDataSheet.tsx", import.meta.url), "utf8");

const extractedTime = (value) => ({
  deposition: {
    scheduledStart: {
      value, status: "EXTRACTED", sourceType: "NOD",
      sourceDocument: "Heath_Thomas_NOD.pdf", citation: "page 2, deponent line", confidence: "high",
    },
  },
});
// Only the control under test is present, so nothing else can move and be mistaken for this repair.
const submit = (time) => new Map([["canonicalScheduledStart", time]]);
const review = (seed, time) => reviewedMasterData(seed, submit(time)).deposition.scheduledStart;

test("the notice's own wording renders as a value the time control can display", () => {
  assert.equal(parseClockTime("1:30 p.m."), "13:30");
  assert.equal(parseClockTime("1:30 p.m. (Central Time)"), "13:30", "the parenthesised zone must not defeat it");
  assert.equal(parseClockTime("1:30 p.m. Central Time"), "13:30");
  assert.equal(parseClockTime("9:30 a.m."), "09:30");
  assert.equal(parseClockTime("13:30"), "13:30", "an already-normalized value is left alone");

  // The sheet has to actually use it. This was the whole defect: the function existed and the row
  // fed the control the raw stored value instead.
  assert.match(SHEET, /name="canonicalScheduledStart"[^/]*defaultValue=\{parseClockTime\(/,
    "the time input must seed through parseClockTime, not the raw canonical value");
});

test("a reporter who changes nothing does not erase the extracted time", () => {
  for (const stored of ["1:30 p.m. (Central Time)", "1:30 p.m.", "13:30"]) {
    const cell = review(extractedTime(stored), parseClockTime(stored));
    assert.equal(cell.value, stored, `${stored}: the stored value must be untouched`);
    assert.equal(cell.status, "EXTRACTED", `${stored}: still extracted`);
  }
});

test("and the Notice keeps the credit for having said it", () => {
  // The point of the comparison in reviewedMasterData: an untouched cell keeps the document
  // attribution and citation that make it evidentiary. Reporter provenance here would be a lie --
  // the reporter did not enter this, extraction did.
  const cell = review(extractedTime("1:30 p.m. (Central Time)"), "13:30");
  assert.equal(cell.sourceType, "NOD");
  assert.equal(cell.sourceDocument, "Heath_Thomas_NOD.pdf");
  assert.equal(cell.citation, "page 2, deponent line");
  assert.equal(cell.confidence, "high");
  assert.notEqual(cell.sourceType, "REPORTER", "an untouched field must not claim the reporter answered it");
});

test("the original wording survives, because it carries the only surviving time zone", () => {
  const cell = review(extractedTime("1:30 p.m. (Central Time)"), "13:30");
  assert.match(String(cell.value), /Central Time/,
    "normalizing the stored value would discard the zone; the control is what needed normalizing");
});

test("a reporter who really does change the time is recorded as having changed it", () => {
  const cell = review(extractedTime("1:30 p.m. (Central Time)"), "14:00");
  assert.equal(cell.value, "14:00");
  assert.equal(cell.status, "CONFIRMED");
  assert.equal(cell.sourceType, "REPORTER");
  assert.equal(cell.sourceDocument, null, "no document said 2:00; nothing may be cited for it");
  assert.equal(cell.citation, null);
  assert.equal(cell.confidence, null);
});

test("a reporter who clears a time that really was extracted still clears it", () => {
  // The repair must not make the field un-clearable. Deliberately emptying it is a real answer.
  const cell = review(extractedTime("1:30 p.m. (Central Time)"), "");
  assert.equal(cell.value, null);
  assert.equal(cell.status, "MISSING");
  assert.equal(cell.sourceType, null, "and nothing claims to have answered it");
});

test("a time nobody extracted stays missing rather than being invented", () => {
  const seed = { deposition: { scheduledStart: { value: null, status: "MISSING", sourceType: null, sourceDocument: null, citation: null, confidence: null } } };
  const cell = reviewedMasterData(seed, submit("")).deposition.scheduledStart;
  assert.equal(cell.value, null);
  assert.equal(cell.status, "MISSING");
  assert.equal(parseClockTime(null), undefined);
  assert.equal(parseClockTime(""), undefined);
  assert.equal(parseClockTime("sometime after lunch"), undefined, "an unreadable time is not a guess");
});

test("nothing else on the sheet moved", () => {
  // The authorization was one field. A seed carrying its neighbours must come back untouched when
  // only the time control is submitted -- absent controls are skipped, not read as cleared.
  const seed = {
    deposition: {
      scheduledStart: extractedTime("1:30 p.m.").deposition.scheduledStart,
      timeZone: { value: null, status: "MISSING", sourceType: null },
      location: { value: "Via Zoom (remote video conference)", status: "EXTRACTED", sourceType: "NOD", sourceDocument: "Heath_Thomas_NOD.pdf" },
      remote: { value: null, status: "MISSING", sourceType: null },
    },
    case: { causeNumber: { value: "25-CV-00598-OLG", status: "EXTRACTED", sourceType: "NOD" } },
  };
  const after = reviewedMasterData(seed, submit("13:30"));
  assert.deepEqual(after.deposition.location, seed.deposition.location);
  assert.deepEqual(after.deposition.timeZone, seed.deposition.timeZone);
  assert.deepEqual(after.deposition.remote, seed.deposition.remote);
  assert.deepEqual(after.case.causeNumber, seed.case.causeNumber);
});
