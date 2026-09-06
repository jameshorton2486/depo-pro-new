// §247-C. The action that creates the mark.
//
// The operation exists (§247-A) and the labeller reads it (§247-B); until now only a test could
// write one. The rules live here rather than in the component, because the Workspace has no test
// harness in this repository.
//
// What these tests do NOT cover is the wiring -- that the button calls this function and that the
// operation reaches the currency-checked endpoint. Stated rather than implied, and it is why this
// checkpoint is not merged until it has been driven in a browser.
import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorWordId, examinerColloquyControl, examinerColloquyLabel, examinerColloquyOperation,
} from "../app/examiner-colloquy-control.mjs";
import { validateOperation } from "../server/reporter-overlay.mjs";

const LABELS = { "counsel-bentley":"MR. BENTLEY", "counsel-ramon":"MS. RAMON", witness:"THE WITNESS" };
const spoken = { id:"job1:word:42", authored:false };
const question = { id:"p1", elementType:"QUESTION", label:"Q.", speakerIdentity:"counsel-bentley", examinerColloquy:false, words:[spoken] };
const marked = { ...question, elementType:"COLLOQUY", label:"MR. BENTLEY:", examinerColloquy:true };

// --- what is offered ------------------------------------------------------------------------------

test("the examiner's question can be marked", () => {
  const control = examinerColloquyControl({ paragraph:question });
  assert.equal(control.action, "mark");
  assert.equal(control.anchorWordId, spoken.id);
  assert.equal(control.disabledReason, null);
});

test("a paragraph the reporter already marked offers the way back", () => {
  const control = examinerColloquyControl({ paragraph:marked });
  assert.equal(control.action, "clear");
  assert.equal(control.disabledReason, null);
});

test("only the examiner's own speech can be reclassified", () => {
  // A paragraph already reading as colloquy or as an answer has nothing to reclassify. The test is
  // the label the transcript produced -- a paragraph reads Q. exactly when the active examiner said
  // it -- rather than deriving the active examiner again on the client, which would be a second
  // answer to a question the server has already answered.
  for (const elementType of ["COLLOQUY", "ANSWER", "HEADING", "BY_LINE"]) {
    const control = examinerColloquyControl({ paragraph:{ ...question, elementType, examinerColloquy:false } });
    assert.equal(control.action, null, elementType);
    assert.match(control.disabledReason, /does not read as the examiner's question/, elementType);
  }
});

test("every refusal names itself in a sentence the reporter can act on", () => {
  assert.match(examinerColloquyControl({}).disabledReason, /Choose the paragraph/);
  assert.match(examinerColloquyControl({ paragraph:{ ...question, words:[{ id:"overlay:x:1", authored:true }] } }).disabledReason,
    /no recorded word/);
});

test("the anchor is the first word the microphone produced", () => {
  const authored = { id:"overlay:job1:word:41:1", authored:true };
  assert.equal(anchorWordId({ words:[authored, spoken] }), spoken.id);
  assert.equal(anchorWordId({ words:[authored] }), null);
  assert.equal(anchorWordId(null), null);
});

// --- what it writes -------------------------------------------------------------------------------

test("marking writes one colloquy operation the overlay accepts", () => {
  const operation = examinerColloquyOperation({ paragraph:question });
  assert.deepEqual(operation, { op:"colloquy", wordId:"job1:word:42" });
  const validated = validateOperation(operation);
  assert.equal(validated.ok, true, validated.message);
  assert.deepEqual(validated.operation, operation);
});

test("clearing writes the paired operation, not a second determination", () => {
  const operation = examinerColloquyOperation({ paragraph:marked });
  assert.deepEqual(operation, { op:"uncolloquy", wordId:"job1:word:42" });
  assert.equal(validateOperation(operation).ok, true);
  assert.equal("elementType" in operation, false, "clearing asserts nothing about what the utterance is");
});

test("a paragraph with nothing to do writes nothing", () => {
  assert.equal(examinerColloquyOperation({ paragraph:{ ...question, elementType:"ANSWER" } }), null);
  assert.equal(examinerColloquyOperation({ paragraph:null }), null);
  assert.equal(examinerColloquyOperation({ paragraph:{ ...question, words:[{ id:"overlay:x:1", authored:true }] } }), null);
});

test("the reporter is never asked who spoke", () => {
  // The transcript already knows. Asking again would invite a second answer to a question already
  // answered, and the two could disagree on a certified page.
  const operation = examinerColloquyOperation({ paragraph:question });
  assert.deepEqual(Object.keys(operation).sort(), ["op", "wordId"]);
  assert.equal("speakerIdentity" in operation, false);
});

// --- what the button says ---------------------------------------------------------------------------

test("the button says what pressing it does, and names the speaker", () => {
  assert.equal(examinerColloquyLabel({ paragraph:question, labels:LABELS }), "Not a question — MR. BENTLEY speaking");
  assert.equal(examinerColloquyLabel({ paragraph:marked, labels:LABELS }), "Read MR. BENTLEY as asking a question again");
});

test("the name comes from the speaker map, never from the paragraph label", () => {
  // An unmarked paragraph is labelled "Q.". Reading the name off the label would have offered to
  // mark "Q." as not a question, which is what the first draft of this did.
  const shown = examinerColloquyLabel({ paragraph:question, labels:LABELS });
  assert.doesNotMatch(shown, /Q\./);
  assert.doesNotMatch(shown, /counsel-bentley/, "the canonical id is never printed");
  assert.equal(examinerColloquyLabel({ paragraph:question, labels:{} }), "Not a question — the examiner speaking",
    "and with no name known it says so rather than printing an empty one");
});

test("nothing is offered where nothing can be done", () => {
  assert.equal(examinerColloquyLabel({ paragraph:{ ...question, elementType:"ANSWER" }, labels:LABELS }), null);
  assert.equal(examinerColloquyLabel({ paragraph:null, labels:LABELS }), null);
});
