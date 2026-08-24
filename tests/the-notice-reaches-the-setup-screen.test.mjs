import assert from "node:assert/strict";
import test from "node:test";
import { flattenLocation, logisticsFields, parseClockTime, parseNoticeDate } from "../app/intake-logistics.mjs";
import { extractedFieldKeys } from "../app/extracted-fields.mjs";

// The extraction supplied the date, the time, the address and the platform. The setup screen showed
// all four blank, because the two sides used different vocabularies: the form read
// `logistics.scheduled_start`, `.platform`, `.remote`, `.videotaped`, `.time_zone`, while the
// extractor writes `start_time`, `remote_platform`, `recording_method`. The key sets overlapped on
// exactly one name -- `location` -- and there the extractor emits an object where the form expects
// a string, so it blanked too. The reporter then retyped what was already in intake.json, and the
// record attributed the retyping to the Notice.
//
// What is deliberately never mapped: `remote` and `videotaped` have no extractor key. "Zoom implies
// remote" and "audiovisual implies videotaped" are inference from prose, and a value must come from
// something that actually supplied it. They stay MISSING, which leaves DEPOSITION_METHOD_MISSING
// blocking the certified render -- the honest state.
const NOTICE = {
  deposition_date: "September 18, 2026",
  logistics: {
    deposition_date: "September 18, 2026",
    start_time: "9:30 a.m. Central Time",
    location: { street: "1201 Navarro Street, Suite 400", city: "San Antonio", state: "Texas", zip: "78205" },
    remote_platform: "Zoom",
    recording_method: "stenographic and audiovisual",
    interpreter: null,
  },
};

test("everything the Notice stated reaches the setup screen", () => {
  assert.deepEqual(logisticsFields(NOTICE), {
    depositionDate: "2026-09-18",
    scheduledStart: "09:30",
    location: "1201 Navarro Street, Suite 400, San Antonio, Texas 78205",
    remotePlatform: "Zoom",
  });
});

test("a Notice that does not state the method leaves those fields unsupplied", () => {
  // The permanent case, pinned independently of what any particular Notice happens to contain.
  // A Notice genuinely silent on the method must produce nothing to map, forever -- this is not a
  // transitional state that the mapping removes. What the mapping changes is which fields land
  // here for a Notice that does state them, never whether the state exists.
  const silent = { logistics: { service_method: "Notice to all counsel of record" } };
  assert.deepEqual(logisticsFields(silent), {
    depositionDate: undefined, scheduledStart: undefined, location: undefined, remotePlatform: undefined,
  });
  assert.deepEqual(extractedFieldKeys(silent, () => ""), [],
    "nothing was supplied, so nothing may be declared as coming from the Notice");
});

test("remote and videotaped are never mapped, however strongly the prose implies them", () => {
  // The Notice says "conducted remotely via Zoom" and "recorded by stenographic and audiovisual
  // means". Both are implications. Neither is an extracted field, and the record must name what
  // actually supplied a value.
  const mapped = logisticsFields(NOTICE);
  assert.ok(!("remote" in mapped), "a platform is not a statement that the deposition was remote");
  assert.ok(!("videotaped" in mapped), "a recording method is not a videotaped flag");
  assert.ok(!("timeZone" in mapped),
    "the zone sits in the same prose as the time; lifting it out is the same inference");
  const declared = extractedFieldKeys(NOTICE, key => ({
    canonicalRemotePlatform: "Zoom", canonicalScheduledStart: "09:30",
  }[key] ?? ""));
  for (const forbidden of ["remote", "videotaped", "timeZone", "corporateRepresentative"]) {
    assert.ok(!declared.includes(forbidden), `${forbidden} has no extractor counterpart and must not be declared`);
  }
});

test("a partial address joins only what exists, with no orphaned punctuation", () => {
  // It reaches a certified page, so an absent suite must not leave a stray comma behind.
  const cases = [
    [{ street: "1201 Navarro Street", city: "San Antonio", state: "Texas", zip: "78205" }, "1201 Navarro Street, San Antonio, Texas 78205"],
    [{ street: "1201 Navarro Street", city: "San Antonio", state: "Texas" }, "1201 Navarro Street, San Antonio, Texas"],
    [{ city: "San Antonio", state: "Texas", zip: "78205" }, "San Antonio, Texas 78205"],
    [{ street: "1201 Navarro Street", zip: "78205" }, "1201 Navarro Street, 78205"],
    [{ state: "Texas" }, "Texas"],
  ];
  for (const [input, expected] of cases) {
    const joined = flattenLocation(input);
    assert.equal(joined, expected);
    assert.ok(!/,\s*,|^\s*,|,\s*$/.test(joined), `orphaned punctuation in ${JSON.stringify(joined)}`);
  }
});

test("an address with nothing in it is missing, not an empty string", () => {
  // An empty string reads as an answer. There is no address here, and that is a different thing.
  for (const empty of [{}, { street: "", city: "", state: "", zip: "" }, null, undefined, 42]) {
    assert.equal(flattenLocation(empty), undefined, `${JSON.stringify(empty)} is not an address`);
  }
});

test("a date the parser cannot read stays missing rather than becoming a guess", () => {
  // This is the field that sat blank and required while the extractor had the answer. Whatever
  // replaces the blank must not be a guess: no partial-year fallback, no defaulting to the filing
  // date, no Date() coercion turning a typo into a confident wrong day.
  for (const unreadable of ["Septmber 18, 2026", "2026-02-30", "next Tuesday", "18/09/2026", "2026", "", null, undefined]) {
    assert.equal(parseNoticeDate(unreadable), undefined, `${JSON.stringify(unreadable)} must not parse`);
  }
  assert.equal(parseNoticeDate("September 18, 2026"), "2026-09-18");
  assert.equal(parseNoticeDate("2026-09-18"), "2026-09-18", "an already-ISO date passes through");
});

test("a time the parser cannot read stays missing too", () => {
  for (const unreadable of ["noon", "25:00", "9:99 a.m.", "", null]) {
    assert.equal(parseClockTime(unreadable), undefined, `${JSON.stringify(unreadable)} must not parse`);
  }
  assert.equal(parseClockTime("9:30 a.m. Central Time"), "09:30");
  assert.equal(parseClockTime("1:05 p.m."), "13:05");
  assert.equal(parseClockTime("12:00 a.m."), "00:00", "midnight is not noon");
  assert.equal(parseClockTime("12:30 p.m."), "12:30");
});

test("a mapped value the reporter edited is theirs, not the Notice's", () => {
  const asExtracted = extractedFieldKeys(NOTICE, key => ({
    depositionDate: "2026-09-18", canonicalScheduledStart: "09:30",
    canonicalLocation: "1201 Navarro Street, Suite 400, San Antonio, Texas 78205",
    canonicalRemotePlatform: "Zoom",
  }[key] ?? ""));
  for (const key of ["depositionDate", "scheduledStart", "location", "remotePlatform"]) {
    assert.ok(asExtracted.includes(key), `${key} came off the Notice unchanged`);
  }
  const edited = extractedFieldKeys(NOTICE, key => ({
    depositionDate: "2026-09-21", canonicalScheduledStart: "09:30",
    canonicalLocation: "Somewhere else entirely", canonicalRemotePlatform: "Zoom",
  }[key] ?? ""));
  assert.ok(!edited.includes("depositionDate"), "the reporter moved the date; it is their answer");
  assert.ok(!edited.includes("location"), "and changed the address");
  assert.ok(edited.includes("scheduledStart") && edited.includes("remotePlatform"), "the untouched ones still belong to the Notice");
});
