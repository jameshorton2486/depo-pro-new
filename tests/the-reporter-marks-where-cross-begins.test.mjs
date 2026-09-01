// Phase E of the Examination Model. See §246 in the audit ledger.
//
// Everything underneath is built and qualified. The only thing that could create an examination
// boundary was a test fixture; this is the reporter's own action. One click on the paragraph where
// counsel took over writes one operation, and the heading, the BY-line, the Q./A. labelling and the
// index all follow from it.
//
// The Workspace component has no test harness in this repository, so the rules live in a pure
// module and are tested here. What is NOT covered by these tests is the wiring itself -- that the
// button calls this function and that the operation reaches the currency-checked endpoint. That is
// stated rather than implied, and it is why the browser check at the end of Phase E matters.
import assert from "node:assert/strict";
import test from "node:test";
import {
  EXAMINATION_TYPE_CHOICES,
  anchorWordId,
  examinationControl,
  examinationOperation,
  examinationSummary,
} from "../app/examination-control.mjs";
import { validateOperation } from "../server/reporter-overlay.mjs";

const CANDIDATES = [
  { id:"counsel-alvarez", label:"Michael Alvarez", defaultRole:"QUESTIONING_ATTORNEY" },
  { id:"counsel-whitfield", label:"Grace Whitfield", defaultRole:"DEFENDING_ATTORNEY" },
  { id:"witness", label:"Alan Prentice", defaultRole:"WITNESS" },
  { id:"reporter", label:"Sarah Jenkins", defaultRole:"COURT_REPORTER" },
  { id:"videographer", label:"Alex Cruz", defaultRole:"VIDEOGRAPHER" },
];
const LABELS = { "counsel-alvarez":"MR. ALVAREZ", "counsel-whitfield":"MS. WHITFIELD", witness:"THE WITNESS" };
const paragraph = (...words) => ({ id:"p1", words });
const spoken = { id:"job1:word:42", authored:false };

// --- who can be named --------------------------------------------------------------------------

test("counsel whose appearance role is not yet set are still offered", () => {
  // Measured against a live candidate list, not assumed: getSpeakerCandidates derives defaultRole
  // from the counsel record's appearanceRole, which the reporter fills in during Appearances, and
  // all three attorneys came back with "". A control that required an attorney role offered nobody
  // on an ordinary deposition. Eligibility is an exclusion of the fixed participants instead.
  const unroled = [
    { id:"counsel-alvarez", label:"Michael Alvarez", defaultRole:"" },
    { id:"counsel-whitfield", label:"Grace Whitfield", defaultRole:"" },
    { id:"witness", label:"Alan Prentice", defaultRole:"WITNESS" },
    { id:"reporter", label:"Sarah Jenkins", defaultRole:"COURT_REPORTER" },
    { id:"videographer", label:"Alex Cruz", defaultRole:"VIDEOGRAPHER" },
  ];
  const { examiners, disabledReason } = examinationControl({ paragraph:paragraph(spoken), candidates:unroled, labels:LABELS });
  assert.equal(disabledReason, null, "an unroled counsel list must not read as no counsel at all");
  assert.deepEqual(examiners.map(item => item.id), ["counsel-alvarez", "counsel-whitfield"]);
});

test("only counsel can be named as an examiner, and by canonical id", () => {
  const { examiners } = examinationControl({ paragraph:paragraph(spoken), candidates:CANDIDATES, labels:LABELS });
  assert.deepEqual(examiners, [
    { id:"counsel-alvarez", label:"MR. ALVAREZ" },
    { id:"counsel-whitfield", label:"MS. WHITFIELD" },
  ]);
  assert.equal(examiners.some(item => item.id === "witness"), false, "the witness does not conduct an examination");
  assert.equal(examiners.some(item => item.id === "reporter" || item.id === "videographer"), false);
});

test("defending counsel is offered, because cross is what she conducts", () => {
  // The whole defect began with defending counsel's questions rendering as colloquy. A control that
  // only offered questioning attorneys could not mark the case it exists for.
  const { examiners } = examinationControl({ paragraph:paragraph(spoken), candidates:CANDIDATES, labels:LABELS });
  assert.ok(examiners.some(item => item.id === "counsel-whitfield"));
});

test("the display name is the transcript's, never the raw identity", () => {
  const { examiners } = examinationControl({ paragraph:paragraph(spoken), candidates:CANDIDATES, labels:LABELS });
  for (const examiner of examiners) assert.doesNotMatch(examiner.label, /^counsel-/, examiner.label);
  // With no label yet, the candidate's own name stands in rather than the id.
  const unlabelled = examinationControl({ paragraph:paragraph(spoken), candidates:CANDIDATES, labels:{} });
  assert.equal(unlabelled.examiners[0].label, "Michael Alvarez");
});

// --- when the action must not be offered ---------------------------------------------------------

test("every refusal names itself in a sentence the reporter can act on", () => {
  const nothing = examinationControl({ candidates:CANDIDATES, labels:LABELS });
  assert.match(nothing.disabledReason, /Choose the paragraph/);

  const authoredOnly = examinationControl({ paragraph:paragraph({ id:"overlay:x:1", authored:true }), candidates:CANDIDATES, labels:LABELS });
  assert.match(authoredOnly.disabledReason, /no recorded word/);

  const noCounsel = examinationControl({ paragraph:paragraph(spoken), candidates:[CANDIDATES[2]], labels:LABELS });
  assert.match(noCounsel.disabledReason, /nobody to name as the examiner/);
});

test("a paragraph that already begins an examination says which one", () => {
  // applyOverlay orphans a second boundary on one word, which is right but only visible afterwards
  // as a finding. The reporter is told before they act, and told what is already there.
  const control = examinationControl({
    paragraph:paragraph(spoken), candidates:CANDIDATES, labels:LABELS,
    examinations:[{ atWordId:spoken.id, examinerPersonId:"counsel-whitfield", type:"CROSS", implicit:false }],
  });
  assert.equal(control.alreadyMarked, true);
  assert.match(control.disabledReason, /Cross-examination by MS\. WHITFIELD already begins here/);
  assert.match(control.disabledReason, /Undo it/, "and the remedy is named");
});

test("an examination elsewhere in the transcript does not block this paragraph", () => {
  const control = examinationControl({
    paragraph:paragraph(spoken), candidates:CANDIDATES, labels:LABELS,
    examinations:[
      { atWordId:null, examinerPersonId:"counsel-alvarez", type:"DIRECT", implicit:true },
      { atWordId:"job1:word:9999", examinerPersonId:"counsel-whitfield", type:"CROSS", implicit:false },
    ],
  });
  assert.equal(control.alreadyMarked, false);
  assert.equal(control.disabledReason, null);
});

// --- the anchor ------------------------------------------------------------------------------------

test("the anchor is the first word the microphone produced, not reporter-authored text", () => {
  const authored = { id:"overlay:job1:word:41:1", authored:true };
  assert.equal(anchorWordId(paragraph(authored, spoken)), spoken.id,
    "an inserted word carries no evidence anchor and cannot locate an examination");
  assert.equal(anchorWordId(paragraph(authored)), null);
  assert.equal(anchorWordId(null), null);
});

// --- what the action says, and what it writes ------------------------------------------------------

test("the action says what it will record", () => {
  assert.equal(examinationSummary({ type:"CROSS", examinerPersonId:"counsel-whitfield", labels:LABELS, candidates:CANDIDATES }),
    "Cross-examination by MS. WHITFIELD begins here");
  assert.equal(examinationSummary({ type:"REDIRECT", examinerPersonId:"counsel-alvarez", labels:LABELS, candidates:CANDIDATES }),
    "Redirect examination by MR. ALVAREZ begins here");
});

test("it says nothing until both facts are stated", () => {
  // Neither is inferred -- not from the speaker of the paragraph, not from how many examinations
  // already exist. A boundary names a person and a kind of examination, and both are the
  // reporter's to state.
  assert.equal(examinationSummary({ type:"CROSS", examinerPersonId:"", labels:LABELS, candidates:CANDIDATES }), null);
  assert.equal(examinationSummary({ type:"", examinerPersonId:"counsel-whitfield", labels:LABELS, candidates:CANDIDATES }), null);
  assert.equal(examinationSummary({ type:"SIDEBAR", examinerPersonId:"counsel-whitfield", labels:LABELS, candidates:CANDIDATES }), null);
});

test("one action writes one operation the overlay accepts", () => {
  const operation = examinationOperation({ paragraph:paragraph(spoken), type:"CROSS", examinerPersonId:"counsel-whitfield" });
  assert.deepEqual(operation, { op:"examination", atWordId:"job1:word:42", examinerPersonId:"counsel-whitfield", type:"CROSS" });
  // Crossing the boundary: the server's own validator, not a second copy of its rules here.
  const validated = validateOperation(operation);
  assert.equal(validated.ok, true, validated.message);
  assert.deepEqual(validated.operation, operation);
});

test("every offered type is one the overlay accepts", () => {
  for (const choice of EXAMINATION_TYPE_CHOICES) {
    const operation = examinationOperation({ paragraph:paragraph(spoken), type:choice.value, examinerPersonId:"counsel-alvarez" });
    assert.ok(operation, `${choice.value} produced no operation`);
    assert.equal(validateOperation(operation).ok, true, `${choice.value} was refused by the overlay`);
  }
  assert.deepEqual(EXAMINATION_TYPE_CHOICES.map(choice => choice.value), ["DIRECT", "CROSS", "REDIRECT", "RECROSS"]);
});

test("a half-stated action writes nothing at all", () => {
  // Not a partial operation for the server to reject: nothing leaves the screen. A boundary naming
  // nobody is refused at validation, and one that reached the sequence would name an examiner the
  // index cannot print.
  assert.equal(examinationOperation({ paragraph:paragraph(spoken), type:"CROSS", examinerPersonId:"   " }), null);
  assert.equal(examinationOperation({ paragraph:paragraph(spoken), type:"", examinerPersonId:"counsel-whitfield" }), null);
  assert.equal(examinationOperation({ paragraph:null, type:"CROSS", examinerPersonId:"counsel-whitfield" }), null);
  assert.equal(examinationOperation({ paragraph:paragraph({ id:"overlay:x:1", authored:true }), type:"CROSS", examinerPersonId:"counsel-whitfield" }), null);
});
