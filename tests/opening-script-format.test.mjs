import assert from "node:assert/strict";
import test from "node:test";

import { jurisdictionScripts } from "../server/opening-procedures.mjs";

const fact = value => ({ value });

test("the Texas remote opening uses the approved remote language and spaced license token", () => {
  const canonical = {
    case: { jurisdictionType: fact("texas-state") },
    deposition: { remote: fact(true) },
  };
  const template = jurisdictionScripts(canonical, {}).opening.template;
  assert.match(template, /^Yes\. This is Cause Number \[CAUSE NUMBER\]/);
  assert.match(template, /via \[REMOTE PLATFORM\] in accordance with the Texas Rules of Civil Procedure/);
  assert.match(template, /Reporter license in Texas, Number \[REPORTER LICENSE NUMBER\]\./);
  assert.match(template, /agreement for this remote deposition and the remote swearing of the witness/);
});

test("the Texas in-person and federal openings retain their existing paths", () => {
  const state = jurisdictionScripts({ case:{ jurisdictionType:fact("texas-state") }, deposition:{ remote:fact(false) } }, {}).opening.template;
  const federal = jurisdictionScripts({ case:{ jurisdictionType:fact("federal") }, deposition:{ remote:fact(true) } }, {}).opening.template;
  assert.match(state, /^We are on the record\./);
  assert.match(federal, /Civil Action Number \[CAUSE NUMBER\]/);
  assert.doesNotMatch(federal, /Reporter license in Texas/);
});
