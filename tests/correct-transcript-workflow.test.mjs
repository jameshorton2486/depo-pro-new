import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Renamed from "Correct Transcript" to "AI Review" when the control became explicitly
// reporter-initiated: the old name suggested the button corrected the transcript, which is exactly
// what it must not do. The substantive assertions below are unchanged -- the workflow is still
// proposal-only, still built from the same passes, and still applies nothing without the reporter.
test("Workspace exposes an extensible proposal-only AI Review workflow",()=>{
  const source=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8");
  assert.match(source,/>AI Review</);
  assert.match(source,/Run AI Review/,"the control names the act the reporter is taking");
  assert.match(source,/Additional things AI should check/);
  assert.match(source,/\/api\/correction\/entity-pass/);
  assert.match(source,/\/api\/transcript\/speaker-suggestions/);
  assert.match(source,/Apply selected word corrections/);
  assert.match(source,/Use this assignment/);
  assert.match(source,/AI proposes; nothing changes until you review and approve it/);
});
