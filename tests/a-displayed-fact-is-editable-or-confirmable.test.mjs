// Every fact the reporter sees is either editable, confirmable, or read-only for a stated reason.
//
// Pre-Record Verification showed fourteen deposition facts beside an unlabelled checkbox. The
// reporter did not know what checking it meant, and four of the values could be changed while ten
// could not. Two of those ten -- actualStart and reportingMethod -- were never writable by anything
// at all, while readiness required actualStart, so no deposition could ever finish that step.
//
// The rulings this encodes: one attributed correction mechanism for canonical facts, one separate
// confirmation for review state, and no readiness requirement the reporter cannot satisfy.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDepositionCorrections, appendFieldCorrection, readCorrectionAuthority, readDepositionCorrections, setOpeningParticipantAttendance, writeDepositionProceeding } from "../server/deposition-store.mjs";
import { EDITABLE_PATHS, confirmationToken, confirmOpeningFields, confirmOpeningParticipant, getOpeningProjection, saveOpeningState } from "../server/opening-procedures.mjs";

const ID = "DEP-20260902-FACTS";
const envelope = (value, state = "EXTRACTED", source = "NOD_EXTRACTED") => ({ value, source, state, confidence: null, citations: [] });
const missing = (source = "REPORTER_ENTERED") => envelope(null, "MISSING", source);

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-facts-"));
  const directory = path.join(root, "store", "bardot_m", "cause", "witness_2026-09-02");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.mkdirSync(path.join(directory, "workflow"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ schemaVersion: "1.0.0", id: ID }));
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    case: { caseStyle: envelope("Baier v. DTK"), causeNumber: envelope("2025CI06119"), court: envelope("407th Judicial District Court"), county: envelope("Bexar County"), jurisdictionType: envelope("texas-state") },
    deposition: {
      witness: envelope("Jennifer Baier"), depositionDate: envelope("2026-05-04"), scheduledStart: envelope("09:30", "EXTRACTED", "REPORTER_ENTERED"),
      actualStart: missing("TRANSCRIPT_DERIVED"), location: envelope("Remote via Zoom", "EXTRACTED", "REPORTER_ENTERED"),
      remote: envelope(true, "EXTRACTED", "REPORTER_ENTERED"), remotePlatform: envelope("Zoom", "EXTRACTED", "REPORTER_ENTERED"),
      witnessLocationCity:envelope("San Antonio","REPORTER_ADDED","REPORTER_ENTERED"),witnessLocationCounty:envelope("Bexar","REPORTER_ADDED","REPORTER_ENTERED"),witnessLocationState:envelope("Texas","REPORTER_ADDED","REPORTER_ENTERED"),witnessLocationCountry:envelope("United States","REPORTER_ADDED","REPORTER_ENTERED"),officerLocation:envelope("San Antonio, Texas","REPORTER_ADDED","REPORTER_ENTERED"),remoteAuthoritySource:envelope("Texas Rule 199.1 and notice","REPORTER_ADDED","REPORTER_ENTERED"),identityVerificationMethod:envelope("Government identification viewed on camera","REPORTER_ADDED","REPORTER_ENTERED"),canSeeWitness:envelope(true,"REPORTER_ADDED","REPORTER_ENTERED"),canHearWitness:envelope(true,"REPORTER_ADDED","REPORTER_ENTERED"),
      reportingMethod: missing("REPORTER_PROFILE"), witnessSworn: missing(),
    },
    reporter: { fullName: envelope("Miah Bardot", "EXTRACTED", "REPORTER_PROFILE"), csrNumber: envelope("12129", "EXTRACTED", "REPORTER_PROFILE"),
      csrExpiration: envelope("2027-12-31", "EXTRACTED", "REPORTER_PROFILE"), firmRegistrationNumber: envelope("5678", "EXTRACTED", "REPORTER_PROFILE"),authorityBasis:envelope("Texas CSR 12129","REPORTER_ADDED","REPORTER_ENTERED") },
    counsel: [{ id:"counsel-1", fullName:envelope("Marcus Ramon"), firm:envelope("Ramon Law Group"), represents:envelope(["Jennifer Baier"]), appearanceRole:envelope("ATTORNEY_FOR_PLAINTIFF"), actualAppearance:envelope(true,"REPORTER_ADDED","REPORTER_ENTERED"), remoteAppearance:envelope(false,"REPORTER_ADDED","REPORTER_ENTERED") }],
    parties: [], participants: { otherAttendees: [], interpreters: [], videographers: [] },
  }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, options: { storageRoot: path.join(root, "store") }, directory };
}
const project = space => getOpeningProjection(space.root, { depositionId: ID, ...space.options });
const fieldAt = (space, target) => project(space).fields.find(item => item.path === target);

// --- one correction mechanism, and it demands attribution --------------------------------------

test("a reporter correction keeps the old value, the new one, who, when and why", t => {
  const space = workspace(t);
  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "case.county", to: "Bexar", why: "The Notice abbreviates it." });

  assert.equal(fieldAt(space, "case.county").value, "Bexar", "the new value reaches the canonical record");
  const [entry] = readDepositionCorrections(space.root, ID, space.options);
  assert.equal(entry.path, "case.county");
  assert.equal(entry.from, "Bexar County", "the old value stays in the history");
  assert.equal(entry.to, "Bexar");
  assert.equal(entry.why, "The Notice abbreviates it.");
  assert.equal(entry.who, "DepoPro local opening screen (operator identity not authenticated)", "records the provable write channel rather than impersonating the assigned reporter");
  assert.ok(Date.parse(entry.at), "and when");
});

test("who cannot be supplied by the caller, so authority cannot be forged", t => {
  const space = workspace(t);
  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "case.county", to: "Travis", why: "test", who: "Somebody Else", attestor: "Somebody Else" });
  assert.equal(readDepositionCorrections(space.root, ID, space.options)[0].who, "DepoPro local opening screen (operator identity not authenticated)");
  assert.equal(readCorrectionAuthority(space.root, { depositionId: ID, ...space.options }), "DepoPro local opening screen (operator identity not authenticated)");
});

test("appearance attendance is corrected without impersonating the assigned CSR", t => {
  const space=workspace(t);
  setOpeningParticipantAttendance(space.root,{depositionId:ID,...space.options,participantId:"counsel-1",attendance:"REMOTE",why:"Present on the Zoom roll call."});
  const projection=getOpeningProjection(space.root,{depositionId:ID,...space.options});
  const participant=projection.participants.find(item=>item.id==="counsel-1");
  assert.equal(participant.actualAppearance.value,true);
  assert.equal(participant.remoteAppearance.value,true);
  assert.equal(participant.verified,false,"changing attendance reopens confirmation");
  const entries=readDepositionCorrections(space.root,ID,space.options).filter(item=>item.path.includes("Appearance"));
  assert.ok(entries.length>=1);
  assert.ok(entries.every(item=>item.who==="DepoPro local opening screen (operator identity not authenticated)"));
});

test("a fact outside the screen's own list is refused by name", t => {
  const space = workspace(t);
  assert.throws(() => appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "reporter.fullName", to: "Someone", why: "test" }), /not a reporter-correctable fact/);
  // The reporter's own details are a snapshot of a profile nothing re-reads. Which of the two a
  // certificate rests on is a question this checkpoint did not answer, so it is not offered.
  assert.equal(EDITABLE_PATHS.has("reporter.fullName"), false);
  assert.equal(EDITABLE_PATHS.has("reporter.csrNumber"), false);
});

test("a correction requires a reason, because a certified record has to say what a value rests on", t => {
  const space = workspace(t);
  assert.throws(() => appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "case.county", to: "Travis", why: "" }), /requires why/);
  assert.deepEqual(readDepositionCorrections(space.root, ID, space.options), [], "and nothing is written");
});

// --- the dead ends ------------------------------------------------------------------------------

test("actual start can be entered, and stops being a readiness dead end", t => {
  const space = workspace(t);
  // Created as TRANSCRIPT_DERIVED and never written by anything, while openingDetails readiness
  // required it -- so that step could not be completed on any deposition that has ever existed.
  assert.equal(fieldAt(space, "deposition.actualStart").value, null);
  assert.equal(fieldAt(space, "deposition.actualStart").editable, true);

  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "deposition.actualStart", to: "09:31", why: "Stated on the record at 1:39 of the recording." });
  const after = fieldAt(space, "deposition.actualStart");
  assert.equal(after.value, "09:31");
  assert.equal(after.state, "REPORTER_ADDED", "reporter-entered, not derived from the recording");
  assert.equal(after.source, "REPORTER_ENTERED");
});

test("reporting method can be entered too", t => {
  const space = workspace(t);
  assert.equal(fieldAt(space, "deposition.reportingMethod").editable, true);
  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "deposition.reportingMethod", to: "Stenographic", why: "How this deposition was taken." });
  assert.equal(fieldAt(space, "deposition.reportingMethod").value, "Stenographic");
});

test("readiness can actually be reached once the facts exist and are confirmed", t => {
  const space = workspace(t);
  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "deposition.reportingMethod", to: "Machine shorthand", why: "Reporter selected the method used." });
  for (const group of project(space).preRecordGroups) {
    confirmOpeningFields(space.root, { depositionId: ID, ...space.options, paths: group.paths, confirmed: true });
  }
  const readiness = project(space).readiness;
  assert.equal(readiness.caption, true);
  assert.equal(readiness.openingDetails, true, "the four review sections drive the two pre-record readiness steps");
});

test("pre-record readiness is four review decisions and actual start waits for the live record", t => {
  const space = workspace(t);
  let projection = project(space);
  assert.equal(projection.preRecordGroups.length, 4);
  assert.equal(projection.fields.find(field => field.path === "deposition.actualStart").value, null);

  for (const group of projection.preRecordGroups) {
    if (group.id === "officer") {
      appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
        path: "deposition.reportingMethod", to: "Machine shorthand", why: "Reporter selected the method used." });
    }
    projection = project(space);
    confirmOpeningFields(space.root, { depositionId: ID, ...space.options, paths: group.paths, confirmed: true });
  }

  projection = project(space);
  assert.equal(projection.preRecordGroups.every(group => group.ready), true);
  assert.equal(projection.readiness.openingDetails, true, "actual start is captured after recording begins and does not block pre-record review");
});

// --- confirmation is a comparison, so it cannot go stale ----------------------------------------

test("confirming a fact never changes it", t => {
  const space = workspace(t);
  const before = fieldAt(space, "case.court").value;
  const current = project(space);
  saveOpeningState(space.root, { depositionId: ID, ...space.options,
    state: { ...current.state, verifiedFields: { "case.court": confirmationToken(before) } } });
  assert.equal(fieldAt(space, "case.court").value, before, "the fact is untouched");
  assert.equal(fieldAt(space, "case.court").verified, true);
  assert.deepEqual(readDepositionCorrections(space.root, ID, space.options), [], "and no correction was written");
});

test("editing a confirmed fact reopens its confirmation, with nothing having to clear a flag", t => {
  const space = workspace(t);
  const current = project(space);
  saveOpeningState(space.root, { depositionId: ID, ...space.options,
    state: { ...current.state, verifiedFields: { "case.county": confirmationToken("Bexar County") } } });
  assert.equal(fieldAt(space, "case.county").verified, true);

  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "case.county", to: "Travis County", why: "Corrected against the Notice." });

  // The confirmation is not cleared -- it no longer matches. Two files could never be written
  // atomically, and a failure between them would leave a changed fact carrying confirmation of its
  // predecessor. There is nothing to keep in step here.
  assert.equal(fieldAt(space, "case.county").verified, false, "the value that was confirmed no longer exists");
  const stored = getOpeningProjection(space.root, { depositionId: ID, ...space.options }).state.verifiedFields["case.county"];
  assert.equal(stored, confirmationToken("Bexar County"), "the tick still records what was confirmed");
});

test("confirming the new value confirms it again", t => {
  const space = workspace(t);
  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "case.county", to: "Travis County", why: "Corrected." });
  const current = project(space);
  saveOpeningState(space.root, { depositionId: ID, ...space.options,
    state: { ...current.state, verifiedFields: { "case.county": confirmationToken("Travis County") } } });
  assert.equal(fieldAt(space, "case.county").verified, true);
});

test("a legacy tick is honoured, unless the log shows the fact has moved since", t => {
  const space = workspace(t);
  // Every existing tick in the store is a bare `true`, which says something was confirmed and never
  // which value. Where the log shows no change, the value it confirmed is the value now.
  saveOpeningState(space.root, { depositionId: ID, ...space.options,
    state: { ...project(space).state, verifiedFields: { "case.court": true, "case.county": true } } });
  assert.equal(fieldAt(space, "case.court").verified, true, "unchanged since, so the old tick still means something");

  appendFieldCorrection(space.root, { depositionId: ID, ...space.options, allowed: EDITABLE_PATHS,
    path: "case.county", to: "Travis County", why: "Corrected." });
  assert.equal(fieldAt(space, "case.county").verified, false,
    "changed since, so which value was confirmed is unknowable and asking again is the honest answer");
  assert.equal(fieldAt(space, "case.court").verified, true, "and the other legacy tick is unaffected");
});

test("participant confirmation is tied to the roster facts that were reviewed", t => {
  const space = workspace(t);
  confirmOpeningParticipant(space.root, { depositionId:ID, ...space.options, participantId:"counsel-1", confirmed:true });
  assert.equal(project(space).participants[0].verified, true);

  const recordFile = path.join(space.directory, "intake", "canonical-deposition-record.json");
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  record.counsel[0].actualAppearance = envelope(false,"REPORTER_ADDED","REPORTER_ENTERED");
  fs.writeFileSync(recordFile, JSON.stringify(record));
  assert.equal(project(space).participants[0].verified, false, "a changed attendance fact reopens confirmation rather than inheriting the old review");
});

// --- the migrated proceeding writer -------------------------------------------------------------

test("court and method now leave a correction trail, and only for what changed", t => {
  const space = workspace(t);
  writeDepositionProceeding(space.root, { depositionId: ID, ...space.options,
    proceeding: { court: "407th Judicial District Court", location: "Remote via Zoom", remotePlatform: "Teams", remote: true } });

  const log = readDepositionCorrections(space.root, ID, space.options);
  assert.equal(log.length, 1, "three of the four were already what they are; a correction that changes nothing is history nobody can read");
  assert.equal(log[0].path, "deposition.remotePlatform");
  assert.equal(log[0].from, "Zoom");
  assert.equal(log[0].to, "Teams");
  assert.equal(log[0].who, "DepoPro local opening screen (operator identity not authenticated)");
  assert.equal(fieldAt(space, "deposition.remotePlatform").value, "Teams");
});

test("saving the same court and method twice writes nothing the second time", t => {
  const space = workspace(t);
  const proceeding = { court: "Another Court", location: "Remote via Zoom", remotePlatform: "Zoom", remote: true };
  writeDepositionProceeding(space.root, { depositionId: ID, ...space.options, proceeding });
  const first = readDepositionCorrections(space.root, ID, space.options).length;
  writeDepositionProceeding(space.root, { depositionId: ID, ...space.options, proceeding });
  assert.equal(readDepositionCorrections(space.root, ID, space.options).length, first,
    "the Workspace form posts all four every save; only a change is a correction");
});

test("an existing deposition and its existing log are readable and keep replaying", t => {
  const space = workspace(t);
  appendDepositionCorrections(space.root, { depositionId: ID, ...space.options, who: "Miah Bardot",
    corrections: [{ path: "case.causeNumber", from: "2025CI06119", to: "2025-CI-06119", why: "Certified transcript spelling." }] });
  writeDepositionProceeding(space.root, { depositionId: ID, ...space.options, proceeding: { remotePlatform: "Teams" } });
  const log = readDepositionCorrections(space.root, ID, space.options);
  assert.deepEqual(log.map(entry => entry.path), ["case.causeNumber", "deposition.remotePlatform"],
    "the new writer appends to the same log rather than starting another");
  assert.equal(fieldAt(space, "case.causeNumber").value, "2025-CI-06119", "and the earlier correction still stands");
});
