// An appearance role is translated into a transcript role, or into nothing.
//
// FOUND ON THE FIRST REAL AI CORRECTION PASS AGAINST HEATH THOMAS. The candidate list built its
// defaultRole with `appearanceRole.toUpperCase().replaceAll(" ", "_")`. That is not a translation
// into TRANSCRIPT_ROLES; it is a string transformation that happens to land on a valid role for
// "defending attorney" and on nothing at all for anything else.
//
// Heath Thomas's examining attorney is recorded as "examining attorney", so the pass wrote
// EXAMINING_ATTORNEY into 49 label operations in the reporter overlay -- a value the vocabulary
// does not contain, that reconcileSpeakerMap refuses, and that produced colloquy labels where Q.
// belonged. Every speaker attribution in a 2h27m deposition was affected, and nothing refused it.
//
// The rule this file holds: what comes out is a member of TRANSCRIPT_ROLES, or it is null. Never a
// third thing, and never a guess.
import assert from "node:assert/strict";
import test from "node:test";
import { TRANSCRIPT_ROLES, transcriptRoleForAppearance } from "../server/transcription-jobs.mjs";

test("the roles this deposition actually records are translated", () => {
  // The exact strings in the Heath Thomas canonical record.
  assert.equal(transcriptRoleForAppearance("examining attorney"), "QUESTIONING_ATTORNEY");
  assert.equal(transcriptRoleForAppearance("defending attorney"), "DEFENDING_ATTORNEY");
});

test("an appearance role that implies no transcript role becomes null, not a guess", () => {
  // Co-counsel and of-counsel are counsel of record. Whether they examined or defended on THIS
  // record is not stated anywhere, and a default would write an unearned Q. or A. into a certified
  // transcript. Null reads downstream as "label them by name", which is what a reporter does.
  assert.equal(transcriptRoleForAppearance("co-counsel for plaintiff"), null);
  assert.equal(transcriptRoleForAppearance("of counsel for plaintiff"), null);
  assert.equal(transcriptRoleForAppearance("counsel"), null);
  assert.equal(transcriptRoleForAppearance(""), null);
  assert.equal(transcriptRoleForAppearance(null), null);
  assert.equal(transcriptRoleForAppearance(undefined), null);
});

test("a role already stated in the vocabulary passes through", () => {
  for (const role of TRANSCRIPT_ROLES) assert.equal(transcriptRoleForAppearance(role), role);
  assert.equal(transcriptRoleForAppearance("witness"), "WITNESS");
});

test("nothing outside the vocabulary can come out", () => {
  // The property, not a list of examples. Whatever goes in, what comes back is either a role the
  // overlay and the speaker map both accept, or null.
  const inputs = [
    "examining attorney", "Examining Attorney", "attorney for the plaintiff", "defending attorney",
    "co-counsel for plaintiff", "of counsel", "guardian ad litem", "corporate representative",
    "videographer", "interpreter", "court reporter", "witness", "", "   ", "OTHER", "EXAMINING_ATTORNEY",
    "questioning attorney", "cross-examining attorney", "attorney", "paralegal", "observer",
  ];
  for (const input of inputs) {
    const role = transcriptRoleForAppearance(input);
    assert.ok(role === null || TRANSCRIPT_ROLES.includes(role),
      `"${input}" produced ${JSON.stringify(role)}, which is neither null nor a transcript role`);
  }
});

test("the string transformation that caused this cannot come back", () => {
  // The specific defect, named. If defaultRole is ever computed by uppercasing an appearance role
  // again, this is the value that reaches the overlay.
  assert.notEqual(transcriptRoleForAppearance("examining attorney"), "EXAMINING_ATTORNEY");
});
