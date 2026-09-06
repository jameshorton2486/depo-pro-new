// The control that produces a split-with-speaker.
//
// The operation exists and is qualified; this is what the Workspace offers the reporter, and it
// lives outside the component because the Workspace has no test harness here.
//
// What these tests do NOT cover is the wiring -- that the button calls this and that the operation
// reaches the currency-checked endpoint. Stated rather than implied, and it is why this checkpoint
// was driven in a browser before being accepted.
import assert from "node:assert/strict";
import test from "node:test";
import {
  splitSpeakerChoices, splitWithSpeakerControl, splitWithSpeakerOperation,
} from "../app/split-with-speaker-control.mjs";
import { validateOperation } from "../server/reporter-overlay.mjs";

const CANDIDATES = [
  { id:"counsel-bentley", label:"MR. BENTLEY", defaultRole:"QUESTIONING_ATTORNEY" },
  { id:"witness", label:"THE WITNESS", defaultRole:"WITNESS" },
  { id:"counsel-ramon", label:"MR. RAMON", defaultRole:"DEFENDING_ATTORNEY" },
  { id:"videographer", label:"THE VIDEOGRAPHER", defaultRole:"VIDEOGRAPHER" },
];
const words = ["w1", "w2", "w3"].map(id => ({ id, authored:false }));
const paragraph = { id:"p1", elementType:"QUESTION", words };

// --- where ------------------------------------------------------------------------------------

test("the selected word is where the next speaker begins", () => {
  const control = splitWithSpeakerControl({ paragraph, selectedWordId:"w2" });
  assert.equal(control.beforeWordId, "w2");
  assert.equal(control.disabledReason, null);
});

test("the first word of a paragraph is refused, and says what to select instead", () => {
  // applyOverlay orphans this as SPLIT_AT_SEGMENT_START. Refusing here means the reporter learns
  // before the save rather than finding a correction that silently did nothing.
  const control = splitWithSpeakerControl({ paragraph, selectedWordId:"w1" });
  assert.equal(control.beforeWordId, null);
  assert.match(control.disabledReason, /already begins the paragraph/);
  assert.match(control.disabledReason, /NEXT speaker/);
});

test("every refusal names itself in a sentence the reporter can act on", () => {
  assert.match(splitWithSpeakerControl({}).disabledReason, /Select the word/);
  assert.match(splitWithSpeakerControl({ paragraph }).disabledReason, /Select the word/);
  assert.match(splitWithSpeakerControl({ paragraph, selectedWordId:"nope" }).disabledReason, /not in this paragraph/);
  assert.match(
    splitWithSpeakerControl({ paragraph:{ ...paragraph, words:[...words, { id:"a1", authored:true }] }, selectedWordId:"a1" }).disabledReason,
    /recorded word/);
});

// --- who --------------------------------------------------------------------------------------

test("Q. and A. lead, because a merged question and answer is what most boundaries are", () => {
  const choices = splitSpeakerChoices({ candidates:CANDIDATES });
  assert.deepEqual(choices.slice(0, 2).map(choice => choice.label), ["Q.", "A."]);
  assert.deepEqual(choices[0], { key:"question", label:"Q.", title:"The examiner speaking — MR. BENTLEY", speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" });
  assert.deepEqual(choices[1], { key:"answer", label:"A.", title:"The witness speaking — THE WITNESS", speakerIdentity:"witness", transcriptRole:"WITNESS" });
});

test("the rest of the room follows, each once", () => {
  const choices = splitSpeakerChoices({ candidates:CANDIDATES });
  assert.deepEqual(choices.slice(2).map(choice => choice.speakerIdentity), ["counsel-ramon", "videographer"]);
  const identities = choices.map(choice => choice.speakerIdentity);
  assert.equal(new Set(identities).size, identities.length, "the examiner and the witness are not offered twice");
});

test("Q. falls back to the examining attorney the assembly recorded", () => {
  // A roster where nobody carries the questioning role -- the real Etminan shape, where every
  // candidate arrived with defaultRole "".
  const bare = [{ id:"counsel-bentley", label:"MR. BENTLEY", defaultRole:"" }, { id:"witness", label:"THE WITNESS", defaultRole:"WITNESS" }];
  const choices = splitSpeakerChoices({ candidates:bare, examinerIdentity:"counsel-bentley" });
  assert.equal(choices[0].speakerIdentity, "counsel-bentley");
  assert.equal(choices[0].transcriptRole, "QUESTIONING_ATTORNEY");
});

test("a choice with nobody behind it is not offered", () => {
  assert.deepEqual(splitSpeakerChoices({ candidates:[] }), []);
  const witnessOnly = splitSpeakerChoices({ candidates:[{ id:"witness", label:"THE WITNESS", defaultRole:"WITNESS" }] });
  assert.deepEqual(witnessOnly.map(choice => choice.label), ["A."], "no examiner, no Q.");
});

test("the name shown is the transcript's, never the canonical id", () => {
  const choices = splitSpeakerChoices({ candidates:CANDIDATES, labels:{ "counsel-bentley":"MR. BENTLEY:", witness:"THE WITNESS:" } });
  assert.equal(choices[0].title, "The examiner speaking — MR. BENTLEY", "the trailing colon is the label's, not the name's");
  for (const choice of choices) assert.doesNotMatch(choice.title, /counsel-|^witness$/);
});

// --- what it writes -----------------------------------------------------------------------------

test("one determination writes one operation the overlay accepts", () => {
  const operation = splitWithSpeakerOperation({ paragraph, selectedWordId:"w2", speakerIdentity:"witness", transcriptRole:"WITNESS" });
  assert.deepEqual(operation, { op:"split", beforeWordId:"w2", speakerIdentity:"witness", transcriptRole:"WITNESS" });
  const validated = validateOperation(operation);
  assert.equal(validated.ok, true, validated.message);
  assert.equal(validated.operation.speakerIdentity, "witness");
});

test("it never writes a second operation, because that was the whole point", () => {
  const operation = splitWithSpeakerOperation({ paragraph, selectedWordId:"w2", speakerIdentity:"witness", transcriptRole:"WITNESS" });
  assert.deepEqual(Object.keys(operation).sort(), ["beforeWordId", "op", "speakerIdentity", "transcriptRole"]);
  assert.equal(operation.op, "split", "a split, not a split and a label");
});

test("nothing is written where nothing can be done", () => {
  assert.equal(splitWithSpeakerOperation({ paragraph, selectedWordId:"w1", speakerIdentity:"witness" }), null, "the first word");
  assert.equal(splitWithSpeakerOperation({ paragraph, selectedWordId:"w2" }), null, "no speaker chosen");
  assert.equal(splitWithSpeakerOperation({ paragraph:null, selectedWordId:"w2", speakerIdentity:"witness" }), null);
});

test("the reporter is never asked whether it is a question", () => {
  // Q. and A. are labels on the choices, but what the operation carries is a speaker and a role.
  // Whether the new paragraph prints Q. is derived downstream from who is examining, exactly as for
  // a paragraph nobody touched -- and nothing here has read a word of the text.
  const asQuestion = splitWithSpeakerOperation({ paragraph, selectedWordId:"w2", speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" });
  assert.equal("elementType" in asQuestion, false);
  assert.equal("label" in asQuestion, false);
  assert.equal("text" in asQuestion, false);
});
