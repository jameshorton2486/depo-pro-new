// The canonical record has six known errors across two depositions and no way to repair them: a
// notice is an intake-time artifact with no post-creation write path, so re-extraction is not
// available. This is that path, and it is a log rather than an in-place edit because a certified
// record's history has to survive the write that changes it.
//
// The real corrections, used as fixtures throughout:
//   Thomas   depositionDate 2026-08-12 -> 2026-04-30   (certified transcript says April 30)
//   Zhan     represents + Shawn Herber                 (certified appearance page names him)
//   Etminan  remote null -> true, remotePlatform Zoom  (certified page-1 preamble)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { CORRECTION_ORIGINS, applyCorrection, correctionId, parseCorrectionLog, replayCorrections, resolveField, validateCorrection } from "../server/canonical-corrections.mjs";
import { appendDepositionCorrections, createDeposition, readDepositionCorrections, writeParticipantHonorific } from "../server/deposition-store.mjs";

const AT = "2026-08-19T22:00:00.000Z";
// Not a person. The log records which path a correction came through, because that is the only part
// of "who did this" an application with no signed-in user can actually know.
const ORIGIN = "WORKSPACE";
const original = () => createCanonicalDepositionRecord({
  caseStyle:"Delia Garza v. Home Depot USA, INC., et al", causeNumber:"25-CV-00598-OLG",
  witness:"Heath Thomas", depositionDate:"2026-08-12", court:"United States District Court",
  attorneys:[{ name:"Lucia D. Zhan", firm:"Brothers, Alvarado, Piazza & Cozort, P.C.", represents:["Home Depot U.S.A., Inc."] }],
});
const correction = extra => ({ origin:ORIGIN, at:AT, why:"Certified transcript page 1", ...extra });

test("a path names a field, and one that does not resolve is refused", () => {
  const record = original();
  assert.ok(resolveField(record, "deposition.depositionDate"));
  assert.ok(resolveField(record, "counsel.0.represents"), "numeric segments index arrays");
  assert.equal(resolveField(record, "deposition.notAField"), null);
  const result = validateCorrection(record, correction({ path:"deposition.notAField", from:null, to:"x" }));
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot create one/);
});

test("a correction written against a stale reading is refused", () => {
  // The guard that matters most: applying it would overwrite whatever replaced the value.
  const result = validateCorrection(original(), correction({ path:"deposition.depositionDate", from:"2026-01-01", to:"2026-04-30" }));
  assert.equal(result.ok, false);
  assert.match(result.message, /stale reading/);
});

test("origin and why are required, because a certified value has to say what it rests on", () => {
  const record = original();
  const at = extra => validateCorrection(record, correction({ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30", ...extra }));
  for (const missing of [{ origin:"" }, { why:"" }]) assert.equal(at(missing).ok, false);
  // An origin outside the enum is refused rather than recorded. The point of an enum here is that a
  // free string drifts back into looking like a name, which is the defect this replaced.
  assert.equal(at({ origin:"Miah Bardot" }).ok, false);
  assert.equal(at({ origin:"WORKSPACE " }).ok, true, "surrounding space is trimmed, not rejected");
  for (const origin of CORRECTION_ORIGINS) assert.equal(at({ origin }).ok, true);
});

test("a correction may not name its author at all", () => {
  // REFUSED, NOT IGNORED. A default nobody passes is still a door, and this one was open: the
  // honorific route forwarded a caller-supplied name straight into a canonical record's history.
  // Ignoring the field would leave callers believing they had attributed something.
  const result = validateCorrection(original(), { ...correction({ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30" }), who:"Somebody Else" });
  assert.equal(result.ok, false);
  assert.match(result.message, /may not name its author/);
  // Including the name it would most plausibly be given, which is the one that actually got signed
  // to a correction the reporter never made.
  assert.equal(validateCorrection(original(), { ...correction({ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30" }), who:"Miah Bardot, Texas CSR 12129" }).ok, false);
});

test("a correction that changes nothing is refused", () => {
  const result = validateCorrection(original(), correction({ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-08-12" }));
  assert.equal(result.ok, false);
  assert.match(result.message, /already holds/);
});

test("a corrected field becomes REPORTER_ENTERED whatever it held before", () => {
  // Etminan's remote comes from the certified transcript's preamble -- a document, but not the
  // Notice, and intake.notice is null. Inheriting NOD_EXTRACTED would assert a notice said it.
  const record = createCanonicalDepositionRecord(
    { witness:"Mohammad Etminan, M.D.", extractedFields:["remote"] }, { noticeSupplied:true });
  assert.equal(record.deposition.remote.source, "NOD_EXTRACTED");
  const { entry } = validateCorrection(record, correction({ path:"deposition.remote", from:null, to:true, why:"Certified transcript page 1 preamble: via Zoom" }));
  const corrected = applyCorrection(record, entry);
  assert.equal(corrected.deposition.remote.value, true);
  assert.equal(corrected.deposition.remote.source, "REPORTER_ENTERED");
  assert.equal(corrected.deposition.remote.state, "REPORTER_ADDED");
  assert.match(entry.why, /page 1 preamble/, "why carries where it came from; source carries who put it there");
});

test("applying a correction never mutates the record it was given", () => {
  const record = original();
  const { entry } = validateCorrection(record, correction({ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30" }));
  applyCorrection(record, entry);
  assert.equal(record.deposition.depositionDate.value, "2026-08-12");
});

test("the id is deterministic, so the same correction cannot acquire a new identity", () => {
  const entry = { depositionId:"DEP-1", path:"deposition.depositionDate", from:"a", to:"b", origin:ORIGIN, at:AT };
  assert.equal(correctionId(entry), correctionId({ ...entry }));
  assert.notEqual(correctionId(entry), correctionId({ ...entry, to:"c" }));
  // And an entry written before origin existed still hashes to the id it was written with. Logs on
  // disk carry `who`; recomputing those to something new would give an append-only history a set of
  // identities that move, which is the one thing such a history is for. The constant below was taken
  // from the pre-change implementation itself, not from the new one, so it witnesses rather than agrees.
  assert.equal(correctionId({ depositionId:"DEP-1", path:"deposition.depositionDate", from:"a", to:"b", who:"Miah Bardot", at:AT }),
    "e0500a5a157f441c5f82b54d92575c7c");
});

// ---------------------------------------------------------------------------------------------
// Store boundary
// ---------------------------------------------------------------------------------------------

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-corrections-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const options = { storageRoot: path.join(root, "depos") };
  const created = createDeposition(root, { deposition:{
    id:"DEP-20260430-ABCDE", caseStyle:"Delia Garza v. Home Depot USA, INC., et al", courtReporterName:"Miah Bardot",
    causeNumber:"25-CV-00598-OLG", witness:"Heath Thomas", depositionDate:"2026-08-12", audioIntakeIds:[], keyterms:[],
    canonicalSeed:{ attorneys:[{ name:"Lucia D. Zhan", firm:"Brothers, Alvarado, Piazza & Cozort, P.C.", represents:["Home Depot U.S.A., Inc."] }] },
  } }, options);
  const recordFile = path.join(options.storageRoot, ...created.storagePath.split("/"), "intake", "canonical-deposition-record.json");
  const logFile = path.join(options.storageRoot, ...created.storagePath.split("/"), "intake", "canonical-corrections.jsonl");
  return { root, options, created, recordFile, logFile, read:() => JSON.parse(fs.readFileSync(recordFile, "utf8")) };
}

test("a correction lands in the record and in the log beside it", t => {
  const space = workspace(t);
  const result = appendDepositionCorrections(space.root, {
    depositionId:"DEP-20260430-ABCDE", origin:ORIGIN, at:AT, ...space.options,
    corrections:[{ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30", why:"Certified transcript: APRIL 30, 2026" }],
  });
  assert.equal(result.appended.length, 1);
  assert.equal(space.read().deposition.depositionDate.value, "2026-04-30");
  const log = readDepositionCorrections(space.root, "DEP-20260430-ABCDE", space.options);
  assert.equal(log.length, 1);
  assert.equal(log[0].path, "deposition.depositionDate");
  assert.equal(log[0].from, "2026-08-12");
  assert.equal(log[0].origin, ORIGIN);
  assert.match(log[0].why, /APRIL 30/);
});

test("an older canonical counsel record gains only the missing honorific field before audited resolution",t=>{
  const space=workspace(t),record=space.read();delete record.counsel[0].honorific;fs.writeFileSync(space.recordFile,JSON.stringify(record));
  writeParticipantHonorific(space.root,{depositionId:space.created.id,participantId:record.counsel[0].id,honorific:"Ms.",...space.options});
  const updated=space.read();assert.equal(updated.counsel[0].honorific.value,"MS.");assert.equal(updated.counsel[0].honorific.source,"REPORTER_ENTERED");
  const log=readDepositionCorrections(space.root,space.created.id,space.options);assert.equal(log.at(-1).path,"counsel.0.honorific");assert.equal(log.at(-1).from,null);
});

test("a written correction carries an origin and no author whatsoever", t => {
  // The one live forgery of attribution in the application: writeParticipantHonorific took `who`,
  // and the route handed it through from the request body, so anything that could reach the local
  // API could name anyone it liked as the author of a change to a canonical record.
  //
  // The first fix made the label a call-site constant, "Workspace reporter" -- honest, but still a
  // human-shaped string in a field called `who`. This asserts the field is gone from what gets
  // written, not merely that it holds something harmless: a reader who finds no `who` cannot
  // mistake one for a signature, and "Miah Bardot, Texas CSR 12129" was mistaken for exactly that.
  const space = workspace(t), record = space.read();
  const write = extra => writeParticipantHonorific(space.root, { depositionId:space.created.id,
    participantId:record.counsel[0].id, honorific:"Ms.", ...extra, ...space.options });

  // Refused at the boundary, not quietly dropped. `who` was a real parameter here until recently, so
  // code written against the old signature still runs -- and would lose its attribution in silence,
  // which is the same defect wearing a quieter face.
  assert.throws(() => write({ who:"Somebody Else" }), /may not name its author/);
  assert.equal(readDepositionCorrections(space.root, space.created.id, space.options).length, 0, "and nothing was written");

  write({});
  const entry = readDepositionCorrections(space.root, space.created.id, space.options).at(-1);
  assert.equal(entry.origin, "WORKSPACE");
  assert.equal("who" in entry, false, "the written entry carries no author field at all");

  const api = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  assert.equal(/writeParticipantHonorific\([^)]*who:/.test(api), false, "and the route no longer forwards one");
  assert.equal(/writeParticipantHonorific\([^)]*origin:/.test(api), false, "nor an origin -- the call site names its own");
});

test("origin is decided by the call site, not by whoever calls it", t => {
  // Replacing a forgeable `who` with a forgeable `origin` would move the defect rather than fix it.
  const space = workspace(t), record = space.read();
  writeParticipantHonorific(space.root, { depositionId:space.created.id, participantId:record.counsel[0].id,
    honorific:"Ms.", origin:"AUTOMATION", ...space.options });
  assert.equal(readDepositionCorrections(space.root, space.created.id, space.options).at(-1).origin, "WORKSPACE",
    "a supplied origin is not honoured; the path that ran names itself");
});

test("the log is append-only: a second correction adds a line, never replaces one", t => {
  const space = workspace(t);
  const append = (to, why) => appendDepositionCorrections(space.root, {
    depositionId:"DEP-20260430-ABCDE", origin:ORIGIN, ...space.options,
    corrections:[{ path:"deposition.depositionDate", from:space.read().deposition.depositionDate.value, to, why, at:`2026-08-19T22:0${to.length % 9}:00.000Z` }],
  });
  append("2026-04-30", "Certified transcript");
  append("2026-04-29", "Superseded by a second reading");
  const log = readDepositionCorrections(space.root, "DEP-20260430-ABCDE", space.options);
  assert.equal(log.length, 2, "the first correction survives the second");
  assert.deepEqual(log.map(entry => entry.to), ["2026-04-30", "2026-04-29"]);
  assert.equal(log[0].from, "2026-08-12", "the original value is still recoverable from the log");
});

test("a log written before origin existed is still readable, and still replays", t => {
  // The entries on disk today carry `who`. They are not rewritten -- an append-only history whose
  // past entries get edited to match new vocabulary is not append-only, and the reason to keep the
  // old shape readable is the same reason to keep the log at all.
  const space = workspace(t);
  const legacy = {
    id:"legacy-1", depositionId:"DEP-20260430-ABCDE", path:"deposition.depositionDate",
    from:"2026-08-12", to:"2026-04-30", who:"Miah Bardot, Texas CSR 12129",
    why:"Certified transcript: APRIL 30, 2026", at:AT,
  };
  fs.writeFileSync(space.logFile, JSON.stringify(legacy) + "\n");

  const log = readDepositionCorrections(space.root, "DEP-20260430-ABCDE", space.options);
  assert.equal(log.length, 1, "an entry with no origin is read, not refused");
  assert.equal(log[0].who, "Miah Bardot, Texas CSR 12129", "and keeps the field it was written with");
  assert.equal(log[0].origin, undefined, "no origin is invented for it");

  // And it still applies. Reading history must not depend on the vocabulary in use when it is read.
  const replayed = replayCorrections(structuredClone(space.created.canonicalData), log);
  assert.equal(replayed.deposition.depositionDate.value, "2026-04-30");
});

test("the store exposes no update, delete or compaction path", async () => {
  // Not "none implemented yet" -- none, so a later caller finds nothing to reach for.
  const store = await import("../server/deposition-store.mjs");
  const forbidden = Object.keys(store).filter(name => /correction/i.test(name) && !/^(append|read)/.test(name));
  assert.deepEqual(forbidden, [], "the only correction verbs are append and read");
});

test("replaying the log against the original record reproduces the current one exactly", t => {
  const space = workspace(t);
  const asCreated = structuredClone(space.created.canonicalData);
  appendDepositionCorrections(space.root, {
    depositionId:"DEP-20260430-ABCDE", origin:ORIGIN, at:AT, ...space.options,
    corrections:[
      { path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30", why:"Certified transcript" },
      { path:"counsel.0.represents", from:["Home Depot U.S.A., Inc."], to:["Home Depot U.S.A., Inc.", "Shawn Herber"], why:"Certified appearance page names Herber", at:"2026-08-19T22:01:00.000Z" },
    ],
  });
  const replayed = replayCorrections(asCreated, readDepositionCorrections(space.root, "DEP-20260430-ABCDE", space.options));
  assert.deepEqual(replayed, space.read(), "record and log must not drift; one of them would be lying");
});

test("a batch is checked in the order it will be applied", t => {
  const space = workspace(t);
  assert.throws(() => appendDepositionCorrections(space.root, {
    depositionId:"DEP-20260430-ABCDE", origin:ORIGIN, at:AT, ...space.options,
    corrections:[
      { path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30", why:"first" },
      { path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-29", why:"stale within the batch" },
    ],
  }), /stale reading/);
  assert.equal(space.read().deposition.depositionDate.value, "2026-08-12", "a rejected batch writes nothing");
  assert.equal(readDepositionCorrections(space.root, "DEP-20260430-ABCDE", space.options).length, 0);
});

test("the same correction cannot be appended twice", t => {
  const space = workspace(t);
  const once = () => appendDepositionCorrections(space.root, {
    depositionId:"DEP-20260430-ABCDE", origin:ORIGIN, at:AT, ...space.options,
    corrections:[{ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30", why:"Certified transcript" }],
  });
  once();
  assert.throws(once, /stale reading|already in the log/);
});

test("a truncated log is refused rather than silently partly read", t => {
  const space = workspace(t);
  appendDepositionCorrections(space.root, {
    depositionId:"DEP-20260430-ABCDE", origin:ORIGIN, at:AT, ...space.options,
    corrections:[{ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30", why:"Certified transcript" }],
  });
  // A crash mid-write is what temp+rename exists to prevent; this is what it would look like.
  fs.writeFileSync(space.logFile, fs.readFileSync(space.logFile, "utf8").trim().slice(0, -12));
  assert.throws(() => readDepositionCorrections(space.root, "DEP-20260430-ABCDE", space.options), /not valid JSON/);
});

test("the log is written whole, so a crash cannot leave a half line", t => {
  const space = workspace(t);
  appendDepositionCorrections(space.root, {
    depositionId:"DEP-20260430-ABCDE", origin:ORIGIN, at:AT, ...space.options,
    corrections:[{ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30", why:"Certified transcript" }],
  });
  const text = fs.readFileSync(space.logFile, "utf8");
  assert.ok(text.endsWith("\n"), "every line is terminated, so the last one is never partial");
  assert.doesNotThrow(() => parseCorrectionLog(text));
  assert.equal(fs.readdirSync(path.dirname(space.logFile)).filter(name => name.endsWith(".tmp")).length, 0, "no temp file survives");
  void crypto;
});

test("the field envelope keeps its own shape; the log owns history", () => {
  const record = original();
  const { entry } = validateCorrection(record, correction({ path:"deposition.depositionDate", from:"2026-08-12", to:"2026-04-30" }));
  const corrected = applyCorrection(record, entry);
  assert.deepEqual(Object.keys(corrected.deposition.depositionDate).sort(), Object.keys(record.deposition.depositionDate).sort());
  for (const key of ["changedAt", "changedBy", "history", "corrections"]) {
    assert.ok(!(key in corrected.deposition.depositionDate), `${key} belongs in the log, not the envelope`);
  }
});
