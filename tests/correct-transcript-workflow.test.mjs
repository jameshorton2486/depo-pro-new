import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// This control has been named three times, and each rename recorded a decision.
//
//   "Correct Transcript"  suggested the button corrected the transcript, which it did not.
//   "AI Review"           said what it did: propose, and apply nothing without the reporter.
//   "AI Correct Transcript"  applies, deliberately.
//
// The third is the one that is live. The scopist and the reporter read the whole transcript against
// the audio afterwards regardless, so an approval queue in front of that is the same reading done
// twice -- approval was replaced by an audit trail and a single undoable pass, not by trust.
//
// The proposal workflow itself was not deleted. It is the secondary path, unchanged, kept while the
// applying pass is qualified on real depositions; these assertions keep its parts wired together.
test("Workspace applies AI corrections as one reporter-initiated pass", () => {
  const source = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(source, />AI Correct Transcript</, "the panel names the act");
  assert.match(source, /AI Correcting Transcript…/, "and says so while it runs");
  assert.match(source, /\/api\/correction\/ai-apply/, "one request, and the server decides the rest");
  assert.match(source, /Corrections are applied directly, as one pass you can undo/,
    "the reporter is told the model where they read it");
  assert.match(source, /Corrections applied \(\{aiPass\.applied\.length\}\)/,
    "the audit trail that replaced the approval queue");
  assert.match(source, /Not applied \(\{aiPass\.omitted\.length\}\)/,
    "including what was refused, and why");
  assert.match(source, /Undo AI Correction Pass/, "and the whole pass can be taken back");
});

test("the proposal workflow survives intact as the secondary path", () => {
  const source = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(source, /Propose corrections without applying them/);
  assert.match(source, /Additional things AI should check/);
  assert.match(source, /\/api\/correction\/entity-pass/);
  assert.match(source, /\/api\/transcript\/speaker-suggestions/);
  assert.match(source, /Apply selected word corrections/);
  assert.match(source, /Use this assignment/);
});
