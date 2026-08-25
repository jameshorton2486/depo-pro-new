// THIS IS A SOURCE ASSERTION OVER IntakeScreen.tsx. IT DOES NOT RENDER ANYTHING.
//
// The filename reads like behavioral coverage of the live path. It is not, and this comment is
// the only thing that will say so later. What the file does is regex `IntakeScreen.tsx` as text
// and pin literals. Nothing here clicks a radio, builds a draft, or reaches page.tsx.
//
// So be exact about what it cannot tell you. It passes whenever `creationMode: mode` is present
// in the source -- even if the radios never update `mode`, even if `onContinue` is never reached,
// even if page.tsx stops reading `draft.creationMode` entirely. And it fails on any edit to that
// literal, a harmless rename included. It is a check built from the same source it checks.
//
// It did kill the mutation below, but that is the shape of the instrument rather than evidence
// about behavior: the mutation was itself a source edit. Mutation run by hand on 2026-08-25 --
// `creationMode: mode` replaced with `creationMode: "existing_recording"` -- and the third test
// failed with `the draft's creationMode must be the radiogroup's state; it is
// "existing_recording"`. Restored immediately; the suite is green on the unmutated file.
//
// WHAT IS STILL UNVERIFIED: that selecting Live Deposition creates the deposition and lands on
// Live capture with its keyterms on the socket. That needs one click-through, and it is blocked
// on the Anthropic API key, since `Continue` is disabled until Claude analysis returns. The
// positive control when it runs is counting `keyterm=REDACTED` occurrences in the session's
// `connectionHistory` -- that shows terms reached the wire, where a connected socket alone would
// not. Do not read this file as having covered that.
//
// Why the file earns its place anyway: the chain the Live Deposition option depends on is three
// links long and lives in one component -- the radio sets `mode`, the draft's `creationMode` is
// built from `mode`, and page.tsx routes on the draft's value. Write a literal where `mode`
// belongs and choosing Live Deposition silently produces a workflowStatus "review" deposition
// that lands in the Workspace instead of the recording screen. Nothing throws. This is regression
// insurance on that one literal, and nothing more.
//
// Why it is not written as an executed render: no test in this repository executes a React
// component. There is no renderer and no JSX transform in the test runner, and the two other
// tests that reach a .tsx (deposition-date-not-invented, counsel-wiring) read the file as text
// for the same reason.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const APP = path.resolve(import.meta.dirname, "..", "app");
const INTAKE = fs.readFileSync(path.join(APP, "IntakeScreen.tsx"), "utf8");
const PAGE = fs.readFileSync(path.join(APP, "page.tsx"), "utf8");

// The two <button role="radio"> elements, each paired with the label the reporter reads.
function recordingModeRadios() {
  return [...INTAKE.matchAll(/<button\b(?:(?!<button\b)[\s\S])*?role="radio"[\s\S]*?<strong>([^<]+)<\/strong>/g)]
    .map((match) => ({ label: match[1], source: match[0] }));
}

test("the reporter is offered exactly the two named choices", () => {
  assert.deepEqual(recordingModeRadios().map((radio) => radio.label),
    ["Prerecorded Deposition", "Live Deposition"]);
});

test("each choice sets the creation mode the rest of the app routes on", () => {
  const [prerecorded, live] = recordingModeRadios();
  assert.match(prerecorded.source, /onClick=\{\(\) => setMode\("existing_recording"\)\}/);
  assert.match(live.source, /onClick=\{\(\) => setMode\("live"\)\}/,
    'the Live Deposition radio must set "live" -- any other value routes to the Workspace');
  // aria-checked is what a screen reader and the selected styling both read.
  assert.match(prerecorded.source, /aria-checked=\{mode === "existing_recording"\}/);
  assert.match(live.source, /aria-checked=\{mode === "live"\}/);
});

test("the draft carries what the radio set, not a literal", () => {
  // The link the change exists for. A hardcoded value here passes every other test in the suite.
  const draft = /onContinue\(\{\s*creationMode: ([^,\n]+),/.exec(INTAKE);
  assert.ok(draft, "onContinue must build the draft with creationMode first, where this can see it");
  assert.equal(draft[1].trim(), "mode",
    `the draft's creationMode must be the radiogroup's state; it is ${draft[1].trim()}`);
});

test("the mode is state, defaulted to prerecorded, and never inferred from the audio list", () => {
  assert.match(INTAKE, /\[mode, setMode\] = useState<DepositionCreationMode>\("existing_recording"\)/);
  // Audio is optional on the prerecorded path, so `audioFiles.length` cannot stand in for the
  // choice: an intake whose recordings arrive later would be read as live.
  assert.doesNotMatch(INTAKE, /creationMode:[^,\n]*audioFiles/);
  assert.doesNotMatch(INTAKE, /setMode\([^)]*audioFiles/);
});

test("page.tsx routes on the draft's value and nothing else", () => {
  assert.match(PAGE, /workflowStatus: intakeDraft\.creationMode === "live" \? "scheduled" : "review"/);
  assert.match(PAGE, /setShowLiveCapture\(item\.creationMode==="live"\)/);
  // The fallback that used to sit here (`intakeDraft?.creationMode ?? creationMode`) could supply
  // a mode the reporter never chose. There is no second source now.
  assert.doesNotMatch(PAGE, /intakeDraft\?\.creationMode \?\?/);
});

test("the walk-in entry cannot be dropped by a caller forgetting it", () => {
  // The only surviving way into capture with no deposition. Optional would let it disappear
  // silently; required makes its removal a type error.
  assert.match(INTAKE, /onRecordUnattached: \(\) => void;/,
    "onRecordUnattached must be required, not optional");
  assert.match(PAGE, /onRecordUnattached=\{\(\) => \{ setShowIntake\(false\); setActive\(null\); setShowLiveCapture\(true\); \}\}/);
});
