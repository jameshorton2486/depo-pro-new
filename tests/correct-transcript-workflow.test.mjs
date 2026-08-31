import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Workspace exposes an extensible proposal-only Correct Transcript workflow",()=>{
  const source=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8");
  assert.match(source,/>Correct Transcript</);
  assert.match(source,/Additional things AI should check/);
  assert.match(source,/\/api\/correction\/entity-pass/);
  assert.match(source,/\/api\/transcript\/speaker-suggestions/);
  assert.match(source,/Apply selected word corrections/);
  assert.match(source,/Use this assignment/);
  assert.match(source,/Nothing changes until you review and apply it/);
});
