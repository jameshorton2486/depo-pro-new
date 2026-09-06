// §248. A certified page may not name a speaker the record cannot.
//
// The Print Model substitutes "SPEAKER 1:" for a paragraph whose speaker has no label. That is right
// for Preview -- a reporter reading before the speaker map is reconciled needs to tell voices apart
// by number rather than face a wall of blank labels. It is wrong on a served transcript, where it
// reads as an attribution rather than as the gap it is, under the reporter's CSR number.
//
// Found by the Phase D4 Word gate, and only by reopening the generated file. Measured afterwards on
// a live record whose speaker map was never reconciled: 895 paragraphs, every one of them a
// placeholder, across 81 pages. The project's own F-13 records a real export of that same deposition
// carrying SPEAKER 0: inline, so this has happened rather than merely being possible.
import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { addCanonicalOath } from "./canonical-oath-fixture.mjs";
import { buildCompleteTranscriptModel } from "../server/complete-transcript-model.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/long-deposition.mjs";

function canonicalRecord() {
  const record = createCanonicalDepositionRecord({
    jurisdictionType:"texas-state", court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS",
    causeNumber:"2026-CI-40881", caseStyle:"Alan Prentice v. Meridian Freight Company",
    witness:"Alan Prentice", depositionDate:"2026-08-31", remote:false, location:"San Antonio, Texas",
    parties:[{ name:"Alan Prentice", role:"Plaintiff" }, { name:"Meridian Freight Company", role:"Defendant" }],
    attorneys:[
      { name:"Michael Alvarez", honorific:"Mr.", firm:"Alvarez Law", address:"100 Main, San Antonio, Texas", phone:"210-555-0101", represents:["Alan Prentice"], side:"PLAINTIFF", actualAppearance:true },
      { name:"Grace Whitfield", honorific:"Ms.", firm:"Whitfield Trial Group", address:"400 Main, San Antonio, Texas", phone:"210-555-0104", represents:["Meridian Freight Company"], side:"DEFENDANT", actualAppearance:true },
      { name:"Elena Ramirez", honorific:"Ms.", firm:"Ramirez Defense", address:"200 Main, San Antonio, Texas", phone:"210-555-0102", represents:["Meridian Freight Company"], side:"DEFENDANT", actualAppearance:true },
    ],
    reporterProfile:{ name:"Sarah Jenkins", licenseNumber:"1234", csrExpiration:"2029-12-31", company:"Jenkins Reporting", firmRegistrationNumber:"5678", address:"300 Main, San Antonio, Texas", phone:"210-555-0103" },
  });
  record.deposition.witnessSworn = { value:true, source:"REPORTER_ENTERED", state:"REPORTER_ADDED", confidence:null, citations:[] };
  addCanonicalOath(record);
  for (const [index, id] of ["counsel-alvarez", "counsel-whitfield", "counsel-ramirez"].entries()) record.counsel[index].id = id;
  return record;
}

const operator = {
  jurisdiction:"texas-state", signatureDisposition:"requested", signatureDispositionBasis:"Stated on the record",
  // Without this the single-examiner path refuses first, and the refusal under test is never reached.
  examiningCounselId:"counsel-alvarez",
  courtHeadingLine:"IN THE DISTRICT COURT OF", countyCourtLine:"BEXAR COUNTY, TEXAS", judicialDistrictLine:"45TH JUDICIAL DISTRICT",
  proceedingHeading:"ORAL DEPOSITION OF",
  titleNarrative:["Alan Prentice, produced as a witness and duly sworn,", "was taken before Sarah Jenkins,", "Certified Shorthand Reporter in and for Texas."],
  certification:{ custodialAttorney:"Michael Alvarez", charges:"500.00", chargesResponsibleParty:"Plaintiff", submissionDate:"2026-09-14", returnDeadline:"2026-09-28", serviceDate:"2026-09-30", certificationDate:"2026-09-14", furtherCertificationDate:"2026-09-30", returnStatus:"2026-09-28" },
  timeUsed:{ totalOnRecordMinutes:240, parties:[{ name:"Michael Alvarez", minutes:160 }, { name:"Grace Whitfield", minutes:80 }] },
};

function printModelFrom({ candidates = SPEAKER_CANDIDATES, working = WORKING } = {}) {
  const rendered = renderTranscript({ working, evidence:[EVIDENCE], speakerCandidates:candidates, examinerIdentity:"counsel-alvarez" });
  return { rendered, printModel:buildTranscriptPrintModel({ rendered, reviewStateHash:"s248", deposition:{ id:"DEP-248", caseStyle:"Alan Prentice v. Meridian Freight Company", witness:"Alan Prentice", depositionDate:"2026-08-31", causeNumber:"2026-CI-40881" } }) };
}
const finalize = printModel => buildCompleteTranscriptModel({
  depositionId:"DEP-248", printModel, record:canonicalRecord(),
  intake:{ counselOfRecord:["Michael Alvarez", "Grace Whitfield", "Elena Ramirez"] }, operator,
  generatedAt:"2026-09-01T12:00:00.000Z",
});

// --- the refusal ----------------------------------------------------------------------------------

test("a participant the record does not list stops the final document", async () => {
  // The Word gate's own case: the transcript has a videographer, the canonical record does not, and
  // three paragraphs printed a placeholder speaker on a 217-page certified document.
  const { printModel } = printModelFrom({ candidates:SPEAKER_CANDIDATES.filter(item => item.id !== "videographer") });
  assert.equal(printModel.previewLabelled.length, 3, "the print model must see the substitution");

  await assert.rejects(finalize(printModel), error => {
    assert.equal(error.code, "COMPLETE_TRANSCRIPT_UNRESOLVED_SPEAKER");
    // The number is the Deepgram cluster index now, not a counter over first appearances -- the two
  // schemes used to collide on screen and mislead a reporter about who had been assigned. What this
  // test is about is unchanged: the refusal fires, and it names a placeholder the reporter can go and
  // find rather than one that points at a different voice.
  assert.match(error.message, /3 paragraph\(s\) would print a placeholder such as SPEAKER \d+:/);
    return true;
  });
});

test("the refusal names the remedy that actually applies", async () => {
  // Two different causes, said differently. Every speaker assigned but a participant missing from
  // the record is a different repair from a speaker map nobody has reconciled, and a reporter shown
  // the wrong one goes to the wrong screen.
  const { printModel } = printModelFrom({ candidates:SPEAKER_CANDIDATES.filter(item => item.id !== "videographer") });
  await assert.rejects(finalize(printModel), error => {
    assert.equal(error.speakerMapStatus, "reconciled");
    assert.match(error.message, /Canonical Deposition Data Record does not list/);
    assert.match(error.message, /Appearances or Participants/);
    return true;
  });
});

test("an unreconciled transcript is refused, and told to reconcile", async () => {
  // The live measurement reproduced faithfully. Removing the candidate list alone is not this case:
  // it strips the labels while the stored speaker map still reads `reconciled`, and the refusal then
  // names the wrong remedy. An unreconciled transcript is one whose segments carry no identity AND
  // whose map says so -- which is the state the live Heath Thomas record is in, all 1,970 segments.
  const unreconciled = {
    ...WORKING,
    speakerMap:{ status:"unreconciled", assignments:[] },
    segments:WORKING.segments.map(segment => ({ ...segment, speakerIdentity:null, transcriptRole:null })),
  };
  const { printModel } = printModelFrom({ candidates:[], working:unreconciled });
  assert.ok(printModel.previewLabelled.length > 100,
    `expected the whole transcript to fall back, saw ${printModel.previewLabelled.length}`);
  await assert.rejects(finalize(printModel), error => {
    assert.equal(error.code, "COMPLETE_TRANSCRIPT_UNRESOLVED_SPEAKER");
    assert.match(error.message, /Assign every speaker in Workspace/);
    return true;
  });
});

test("the refusal names which paragraphs, not merely how many", async () => {
  const { printModel } = printModelFrom({ candidates:SPEAKER_CANDIDATES.filter(item => item.id !== "videographer") });
  await assert.rejects(finalize(printModel), error => {
    assert.equal(error.paragraphs.length, 3);
    for (const id of error.paragraphs) assert.match(id, /^paragraph:/, id);
    return true;
  });
});

// --- what must keep working -----------------------------------------------------------------------

test("a transcript that names every speaker still produces its document", async () => {
  // The positive control. A refusal that fired on everything would pass every test above while
  // making the application useless.
  const { printModel } = printModelFrom();
  assert.deepEqual(printModel.previewLabelled, [], "the fixture names every speaker");
  const model = await finalize(printModel);
  assert.equal(model.recordType, "COMPLETE_TRANSCRIPT_DOCUMENT_MODEL");
  assert.ok(model.pages.length > 50, `a 45,000-word transcript assembled to only ${model.pages.length} pages`);
});

test("Preview still shows the placeholder, because that is what Preview is for", async () => {
  // The refusal belongs at the finalization boundary and nowhere earlier. A reporter reading before
  // the speaker map is reconciled needs to tell voices apart by number; taking that away would fix
  // a certified-output defect by breaking the screen that exists to prevent it.
  const { printModel } = printModelFrom({ candidates:[] });
  const placeholders = printModel.pages.flatMap(page => page.lines)
    .filter(line => /SPEAKER (\d+|UNKNOWN):/.test(String(line.content ?? "")));
  assert.ok(placeholders.length > 0, "Preview must still render the fallback labels");
  assert.ok(printModel.pages.length > 0, "and must still paginate");
});

test("the status is carried, so the message can tell the two causes apart", async () => {
  assert.equal(printModelFrom().printModel.speakerMap?.status, "reconciled");
  const unassigned = printModelFrom({ working:{ ...WORKING, speakerMap:{ status:"unreconciled", assignments:[] } } });
  assert.equal(unassigned.printModel.speakerMap?.status, "unreconciled");
});
