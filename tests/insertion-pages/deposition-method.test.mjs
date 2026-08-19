// How the deposition was conducted belongs to the deposition, not to each attorney -- ADR-0020,
// grounded in three certified specimens that state it once in the page-1 preamble and list every
// attorney plainly ("via Zoom, before Miah Bardot, CSR", with no per-attorney annotation).
//
// The old per-attorney check blocked Bentley and Ramon on the Etminan record even though both
// appeared, on a field no certified page renders.
import assert from "node:assert/strict";
import test from "node:test";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { validateInsertionInput } from "../../server/insertion-pages/validate.mjs";

const assemble = deposition => assembleInsertionInput({
  record:{ counsel:[{ id:"a", fullName:"Dennis J. Bentley", firm:"F", represents:["Plaintiff"], actualAppearance:true }], parties:[], deposition, case:{} },
  intake:{}, operator:{}, pagination:{}, template:{},
});
const codes = deposition => validateInsertionInput(assemble(deposition))
  .filter(finding => finding.severity === "blocking" && finding.code === "DEPOSITION_METHOD_MISSING")
  .map(finding => finding.target);

test("a record that does not say how the deposition was taken is blocked", () => {
  assert.deepEqual(codes({ remote:null }), ["deposition.remote"]);
  assert.deepEqual(codes({}), ["deposition.remote"]);
});

test("remote without a platform is blocked, because the preamble reads 'via <platform>'", () => {
  assert.deepEqual(codes({ remote:true }), ["deposition.remotePlatform"]);
});

test("in person without a location is blocked", () => {
  assert.deepEqual(codes({ remote:false }), ["deposition.location"]);
});

test("a remote deposition naming its platform passes", () => {
  assert.deepEqual(codes({ remote:true, remotePlatform:"Zoom" }), []);
});

test("an in-person deposition naming where it was taken passes", () => {
  assert.deepEqual(codes({ remote:false, location:"8830 Long Point Road, Houston, Texas" }), []);
});

test("counsel who appeared are never blocked for a method they do not carry", () => {
  // The whole point of the move. Both Etminan attorneys appeared and neither has a per-attorney
  // participation object; nothing about them may block.
  const findings = validateInsertionInput(assemble({ remote:true, remotePlatform:"Zoom" }));
  assert.deepEqual(findings.filter(f => /APPEARANCE_METHOD/.test(f.code)), []);
});
