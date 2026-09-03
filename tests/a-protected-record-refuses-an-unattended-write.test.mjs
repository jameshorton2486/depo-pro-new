// An automated browser qualification wrote deposition.actualStart on Production Trial #1 -- a live
// deposition, a real evidentiary field -- because the run was pointed at the live record instead of a
// disposable copy and nothing in the application told the two apart. The value written happened to be
// correct. Nothing about the mechanism made it so, and the next one would not be.
//
// The design this tests deliberately does NOT try to detect automation. A flag the qualification
// harness sets would have failed on the actual incident: that browser was an ordinary one with no
// flag anywhere. This asks a question the application can really answer -- has a person deliberately
// opened this record in the last few minutes? -- and an unattended process cannot produce a yes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDepositionCorrections, createDeposition, readDepositionCorrections, writeDepositionCounsel, writeParticipantHonorific } from "../server/deposition-store.mjs";
import { DEPOSITION_PROTECTED, GUARDED_FILES, PROTECTION_FILE, UNLOCK_WINDOW_MS, depositionFolderFor, protectDeposition, protectionProjection, readProtection, unlockDeposition } from "../server/protected-records.mjs";

const AT = "2026-09-03T10:00:00.000Z";
// assert.throws checks that something threw; the code on the refusal is what the API maps to 423,
// so it has to be read off the error itself rather than inferred from the message.
const refused = (run) => { try { run(); } catch (error) { return error; } return null; };
const REASON = "Production Trial #1 -- live evidentiary record.";

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-protected-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { storageRoot: path.join(root, "depos") };
  const created = createDeposition(root, { deposition: {
    id: "DEP-20260430-ABCDE", caseStyle: "Delia Garza v. Home Depot USA, INC., et al", courtReporterName: "Miah Bardot",
    causeNumber: "25-CV-00598-OLG", witness: "Heath Thomas", depositionDate: "2026-08-12", audioIntakeIds: [], keyterms: [],
    canonicalSeed: { attorneys: [{ name: "Lucia D. Zhan", firm: "Brothers, Alvarado, Piazza & Cozort, P.C.", represents: ["Home Depot U.S.A., Inc."] }] },
  } }, options);
  const directory = path.join(options.storageRoot, ...created.storagePath.split("/"));
  const correct = (to = "2026-04-30") => appendDepositionCorrections(root, {
    depositionId: created.id, who: "DepoPro test correction channel", at: AT, ...options,
    corrections: [{ path: "deposition.depositionDate", from: "2026-08-12", to, why: "Certified transcript" }],
  });
  const read = () => JSON.parse(fs.readFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), "utf8"));
  return { root, options, created, directory, correct, read };
}

test("an unprotected deposition is untouched by any of this", t => {
  const space = workspace(t);
  assert.equal(protectionProjection(space.directory), null, "absent, not merely off");
  space.correct();
  assert.equal(space.read().deposition.depositionDate.value, "2026-04-30", "ordinary reporter work is unaffected");
});

test("a protected record refuses a correction, and writes nothing", t => {
  const space = workspace(t);
  protectDeposition(space.directory, { reason: REASON });

  const refusal = refused(() => space.correct());
  assert.equal(refusal?.code, DEPOSITION_PROTECTED);
  assert.match(refusal.message, /deposition is protected/);
  assert.match(refusal.message, /point the run at a disposable copy/, "and tells an automated caller what it did wrong");

  // The whole point. A refusal that still wrote would be worse than no refusal, because it would
  // also be a lie about what happened.
  assert.equal(space.read().deposition.depositionDate.value, "2026-08-12", "the record is as it was");
  assert.equal(readDepositionCorrections(space.root, space.created.id, space.options).length, 0, "and the log is empty");
});

test("every canonical writer is refused, not only the correction path", t => {
  // The guard sits in the atomic write primitives rather than in the eight write functions, so a
  // ninth added later is covered without being told this module exists. These are the two the
  // provenance work touched plus one that predates it -- if the guard were per-function, the third
  // is exactly the kind that would have been missed.
  const space = workspace(t);
  const record = space.read();
  protectDeposition(space.directory, { reason: REASON });

  for (const [label, run] of [
    ["correction log", () => space.correct()],
    ["honorific", () => writeParticipantHonorific(space.root, { depositionId: space.created.id, participantId: record.counsel[0].id, honorific: "Ms.", ...space.options })],
    ["counsel", () => writeDepositionCounsel(space.root, { depositionId: space.created.id, counsel: [{ id: record.counsel[0].id, fullName: "Someone Else" }], ...space.options })],
  ]) {
    const refusal = refused(run);
    assert.equal(refusal?.code, DEPOSITION_PROTECTED, `${label} was not refused`);
  }
});

test("a reporter opening the record deliberately lets the write through", t => {
  const space = workspace(t);
  protectDeposition(space.directory, { reason: REASON });
  assert.throws(() => space.correct(), /deposition is protected/);

  unlockDeposition(space.directory, { reason: "Entering the on-record start time." });
  space.correct();
  assert.equal(space.read().deposition.depositionDate.value, "2026-04-30", "the reporter's own work goes through");

  const projection = protectionProjection(space.directory);
  assert.equal(projection.protected, true, "opening it does not unprotect it");
  assert.equal(projection.unlocked, true);
  assert.equal(projection.unlockCount, 1);
});

test("the opening closes by itself, because a reporter who forgets is the ordinary case", t => {
  const space = workspace(t);
  protectDeposition(space.directory, { reason: REASON });
  const now = Date.parse(AT);
  unlockDeposition(space.directory, { reason: "Entering the on-record start time.", now });

  const protection = readProtection(space.directory);
  assert.equal(protectionProjection(space.directory, { now: now + UNLOCK_WINDOW_MS - 1000 }).unlocked, true, "open inside the window");
  assert.equal(protectionProjection(space.directory, { now: now + UNLOCK_WINDOW_MS + 1000 }).unlocked, false, "closed after it");

  // Both assertions above are computed FROM the window, so they hold at any length -- including a
  // window of a century, which is an unlock that never closes wearing the costume of one that does.
  // These two are the outside signal: a fixed bound the constant has to sit inside, and a fixed
  // clock reading it has to be closed at.
  assert.ok(UNLOCK_WINDOW_MS <= 60 * 60 * 1000, `the window is ${Math.round(UNLOCK_WINDOW_MS / 60000)} minutes; anything beyond an hour is a door left open`);
  assert.equal(protectionProjection(space.directory, { now: now + 2 * 60 * 60 * 1000 }).unlocked, false, "closed two hours later, whatever the constant says");

  // And an expired window really refuses, rather than merely displaying as closed.
  fs.writeFileSync(path.join(space.directory, PROTECTION_FILE),
    JSON.stringify({ ...protection, unlockedUntil: new Date(Date.now() - 1000).toISOString() }, null, 2));
  assert.throws(() => space.correct(), /deposition is protected/);
});

test("an unlock cannot be asserted by the thing being unlocked", t => {
  // Server-side state, written by a route, read by the guard. A client that could hand in its own
  // unlock would be a client that could hand in its own permission.
  const space = workspace(t);
  protectDeposition(space.directory, { reason: REASON });
  assert.throws(() => appendDepositionCorrections(space.root, {
    depositionId: space.created.id, who: "DepoPro test correction channel", at: AT, ...space.options, unlocked: true, unlockedUntil: "2099-01-01T00:00:00.000Z",
    corrections: [{ path: "deposition.depositionDate", from: "2026-08-12", to: "2026-04-30", why: "Certified transcript", unlocked: true }],
  }), /deposition is protected/);
});

test("a protection marker that cannot be read protects rather than disappears", t => {
  // The failure mode of guessing the other way is an unguarded write to a live record.
  const space = workspace(t);
  protectDeposition(space.directory, { reason: REASON });
  fs.writeFileSync(path.join(space.directory, PROTECTION_FILE), "{ this is not json");
  const refusal = refused(() => space.correct());
  assert.match(refusal?.message ?? "", /could not be read/);
  assert.equal(refusal.code, DEPOSITION_PROTECTED);
});

test("protecting and opening both require a reason", t => {
  const space = workspace(t);
  assert.throws(() => protectDeposition(space.directory, { reason: "  " }), /requires a reason/);
  assert.throws(() => unlockDeposition(space.directory, { reason: "x" }), /not protected/, "there is nothing to open yet");
  protectDeposition(space.directory, { reason: REASON });
  assert.throws(() => unlockDeposition(space.directory, { reason: "" }), /requires a reason/);
});

test("the guard covers the evidentiary files and deliberately stops there", () => {
  // Scope is a decision, not an oversight. The reporter corrects the transcript continuously, and a
  // record demanding an unlock every fifteen minutes to do the day's work gets switched off.
  assert.deepEqual([...GUARDED_FILES], ["canonical-deposition-record.json", "canonical-corrections.jsonl"]);
  const intake = p => path.join("C:", "depos", "r", "c", "d", "intake", p);
  assert.equal(depositionFolderFor(intake("canonical-deposition-record.json")), path.resolve(path.join("C:", "depos", "r", "c", "d")));
  assert.equal(depositionFolderFor(intake("canonical-corrections.jsonl")), path.resolve(path.join("C:", "depos", "r", "c", "d")));
  assert.equal(depositionFolderFor(intake("intake.json")), null, "intake is not evidence");
  assert.equal(depositionFolderFor(path.join("C:", "depos", "r", "c", "d", "transcript", "working.json")), null, "the transcript is the reporter's daily work");
  assert.equal(depositionFolderFor(path.join("C:", "depos", "r", "c", "d", "canonical-deposition-record.json")), null, "the name alone is not enough; it has to be in intake/");
});
