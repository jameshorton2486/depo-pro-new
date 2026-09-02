// Phase D4 of the Examination Model. See §246 in the audit ledger.
//
// D1 resolved the sequence, D2 announced it, D3 cited it. This drives all three through the real
// chain to a Word file and reopens that file to check what actually landed in it:
//
//   overlay -> renderTranscript -> Print Model -> Final Document Model -> DOCX -> reopened
//
// No Word-specific examination model. The DOCX is a rendering of the same document model the
// screen shows, and the point of reopening it is that everything before that step is the
// application's own account of what it produced.
//
// This is the automated half. The Human Gate is a reporter reading the generated transcript, and
// it is not replaced by anything here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendTransaction, emptyOverlay } from "../server/reporter-overlay.mjs";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { addCanonicalOath } from "./canonical-oath-fixture.mjs";
import { buildCompleteTranscriptModel } from "../server/complete-transcript-model.mjs";
import { createTranscriptDocxArtifact } from "../server/final-document-docx.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/long-deposition.mjs";

const python = process.env.DEPO_PRO_PYTHON ?? "python";
function rendererAvailability() {
  const probe = spawnSync(python, ["-c", "import docx, lxml"], { encoding:"utf8", windowsHide:true });
  if (probe.error) return { ok:false, why:`no Python interpreter resolved from DEPO_PRO_PYTHON ?? "python"` };
  if (probe.status !== 0) return { ok:false, why:`Python at ${python} cannot import python-docx/lxml` };
  return { ok:true, why:"" };
}

const CROSS_AT = WORKING.segments.find(segment => segment.speakerIdentity === "counsel-whitfield").asrWordIds[0];

/**
 * The canonical record for the fixture deposition.
 *
 * Counsel ids are set to the transcript's speaker identities. In production that alignment is not
 * arranged, it is automatic -- getSpeakerCandidates builds candidates FROM this record and carries
 * `{id: item.id}` through -- so the two halves cannot drift. Here the fixture's speaker map was
 * hand-written beside a hand-written record, and this is what production would have done for them.
 */
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
  courtHeadingLine:"IN THE DISTRICT COURT OF", countyCourtLine:"BEXAR COUNTY, TEXAS", judicialDistrictLine:"45TH JUDICIAL DISTRICT",
  proceedingHeading:"ORAL DEPOSITION OF",
  titleNarrative:["Alan Prentice, produced as a witness and duly sworn,", "was taken before Sarah Jenkins,", "Certified Shorthand Reporter in and for Texas."],
  certification:{ custodialAttorney:"Michael Alvarez", charges:"500.00", chargesResponsibleParty:"Plaintiff", submissionDate:"2026-09-14", returnDeadline:"2026-09-28", serviceDate:"2026-09-30", certificationDate:"2026-09-14", furtherCertificationDate:"2026-09-30", returnStatus:"2026-09-28" },
  timeUsed:{ totalOnRecordMinutes:240, parties:[{ name:"Michael Alvarez", minutes:160 }, { name:"Grace Whitfield", minutes:80 }] },
};

export async function buildQualificationDocument(outputDirectory) {
  const overlay = appendTransaction(emptyOverlay("DEP-QUALIFY-CROSS"), [
    { op:"examination", atWordId:CROSS_AT, examinerPersonId:"counsel-whitfield", type:"CROSS" },
  ]);
  const rendered = renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, overlay, examinerIdentity:"counsel-alvarez" });
  const printModel = buildTranscriptPrintModel({
    rendered, reviewStateHash:computeReviewStateHash({ transcript:WORKING, overlay }),
    deposition:{ id:"DEP-QUALIFY-CROSS", caseStyle:"Alan Prentice v. Meridian Freight Company", witness:"Alan Prentice", depositionDate:"2026-08-31", causeNumber:"2026-CI-40881" },
  });
  const model = await buildCompleteTranscriptModel({
    depositionId:"DEP-QUALIFY-CROSS", printModel, record:canonicalRecord(),
    intake:{ counselOfRecord:["Michael Alvarez", "Grace Whitfield", "Elena Ramirez"] }, operator,
    generatedAt:"2026-09-01T12:00:00.000Z",
  });
  const artifact = await createTranscriptDocxArtifact(null, { depositionId:"DEP-QUALIFY-CROSS", printModel:model, outputDirectory });
  return { rendered, printModel, model, artifact };
}

function reopen(outputPath) {
  const read = spawnSync(python, ["-c", [
    "import json,sys",
    "from docx import Document",
    "d=Document(sys.argv[1])",
    "print(json.dumps({'lines':[p.text for p in d.paragraphs]}))",
  ].join("\n"), outputPath], { encoding:"utf8", windowsHide:true, maxBuffer:64 * 1024 * 1024 });
  assert.equal(read.status, 0, `reopening the DOCX failed: ${(read.stderr || "").trim()}`);
  return JSON.parse(read.stdout).lines;
}

test("a cross-examination reaches the Word document as testimony, announced and indexed", async (t) => {
  const availability = rendererAvailability();
  if (!availability.ok) return t.skip(`Word qualification was not exercised: ${availability.why}`);

  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-d4-"));
  t.after(() => fs.rmSync(outputDirectory, { recursive:true, force:true }));
  const { rendered, model, artifact } = await buildQualificationDocument(outputDirectory);

  assert.ok(artifact.bytes > 0, "the renderer reported success but wrote no file");
  const lines = reopen(artifact.outputPath);

  // ---- the transition, in the file ------------------------------------------------------------
  const headingAt = lines.findIndex(line => line.trim() === "CROSS-EXAMINATION");
  assert.ok(headingAt > 0, "CROSS-EXAMINATION is in the Word document");
  assert.equal(lines.filter(line => line.trim() === "CROSS-EXAMINATION").length, 1, "exactly once");
  assert.equal(lines[headingAt + 1].trim(), "BY MS. WHITFIELD:", "the by-line names the examiner and follows the heading");
  assert.equal(lines.filter(line => line.trim() === "BY MS. WHITFIELD:").length, 1);

  // ---- what surrounds it ----------------------------------------------------------------------
  const before = lines.slice(0, headingAt).filter(line => line.trim());
  const after = lines.slice(headingAt + 2).filter(line => line.trim());
  assert.ok(before.some(line => line.trim().startsWith("Q.")), "the direct examination ends in question-and-answer");
  assert.ok(after.some(line => line.trim().startsWith("Q.")), "the cross-examination renders as questions");
  assert.ok(after.some(line => line.trim().startsWith("A.")), "and the answers to it as answers");
  assert.ok(after.some(line => line.includes("MS. RAMIREZ:")), "objections during cross remain attorney colloquy");

  // ---- the index ------------------------------------------------------------------------------
  const indexLines = lines.filter(line => line.includes("Examination by"));
  assert.equal(indexLines.length, 2, "one index line per examination");
  assert.ok(indexLines[0].includes("Mr. Michael Alvarez"), `first examiner named: ${indexLines[0]}`);
  assert.ok(indexLines[1].includes("Ms. Grace Whitfield"), `second examiner named: ${indexLines[1]}`);

  // The cited page is the page the heading actually prints on, not a number anyone supplied.
  const entries = model.sections ? model.pagination?.index?.examinations : null;
  const crossEntry = (entries ?? []).find(entry => entry.type === "CROSS")
    ?? { startPage:Number(indexLines[1].match(/(\d+)-(\d+)\s*$/)?.[1]) };
  const headingPage = model.pages.find(page => page.lines.some(line => String(line.content ?? "").trim() === "CROSS-EXAMINATION"))?.pageNumber;
  assert.equal(crossEntry.startPage, headingPage,
    `the index cites page ${crossEntry.startPage} and the heading prints on page ${headingPage}`);

  // ---- geometry survives the insertion --------------------------------------------------------
  for (const page of model.pages) assert.equal(page.lines.length, 25, `page ${page.pageNumber} (${page.role}) lost its 25 line positions`);
  assert.deepEqual(model.pages.map(page => page.pageNumber), Array.from({ length:model.pages.length }, (_, index) => index + 1),
    "page numbers are contiguous from 1");

  // ---- one authority ---------------------------------------------------------------------------
  assert.deepEqual(rendered.examinations.map(item => `${item.type}:${item.examinerPersonId}`),
    ["DIRECT:counsel-alvarez", "CROSS:counsel-whitfield"],
    "the Word document, the index and the labelling all came from this one sequence");
});
