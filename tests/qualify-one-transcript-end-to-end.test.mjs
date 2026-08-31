// One transcript, production length, driven through the whole chain and compared to the file.
//
// Everything upstream of this test asserts a rule about a paragraph. This asserts a property of a
// deposition: that 1,602 segments and 45,007 words survive reconstruction, rendering, pagination,
// document assembly and the Python renderer, and that the document a reporter opens in Word
// carries the same lines, in the same order, on the same pages, as the Page Review they signed
// off on.
//
// That last clause is the reason the test exists. If Workspace says a paragraph ends on page 118
// and Word breaks it onto 119, the reporter reviews the transcript twice -- once in Depo-Pro and
// again after export -- and the application has failed at the thing it is for. No existing test
// could detect that, because no existing test rendered more than three pages.
//
// The chain here is the real one. buildTranscriptPrintModel and buildCompleteTranscriptModel are
// the same functions getTranscriptPrintModel and getCompleteTranscriptModel call; only the input
// is a fixture instead of a deposition directory, so the test never touches stored evidence.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyOverlay, emptyOverlay } from "../server/reporter-overlay.mjs";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { buildCompleteTranscriptModel } from "../server/complete-transcript-model.mjs";
import { createTranscriptDocxArtifact } from "../server/final-document-docx.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../server/texas-freelance-deposition-profile.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { EVIDENCE, SCALE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/long-deposition.mjs";

const python = process.env.DEPO_PRO_PYTHON ?? "python";

function rendererAvailability() {
  const probe = spawnSync(python, ["-c", "import docx, lxml"], { encoding: "utf8", windowsHide: true });
  if (probe.error) return { ok: false, why: `no Python interpreter resolved from DEPO_PRO_PYTHON ?? "python" (tried ${python}: ${probe.error.message})` };
  if (probe.status !== 0) return { ok: false, why: `Python at ${python} cannot import python-docx/lxml: ${(probe.stderr || "").trim()}` };
  return { ok: true, why: "" };
}

// Outside signals, deliberately not read from the profile under test. Reading the expected value
// out of the thing being measured makes the assertion tautological: move linesPerPage to 24 and a
// profile-derived test builds, expects and passes on 24 while the certified geometry has silently
// changed. Twenty-five numbered lines is the UFM requirement; 63 characters is the width this
// application's reviewed Texas profile was qualified at.
const LINES = 25;
const WIDTH = 63;

// A transcript this long is worth reconstructing once. Each stage is timed on the way through and
// reported at the end, because "does it stay responsive on a real deposition" is a question the
// suite has never been able to answer.
const timings = [];
function timed(label, work) {
  const started = process.hrtime.bigint();
  const value = work();
  timings.push({ label, ms: Number(process.hrtime.bigint() - started) / 1e6 });
  return value;
}
async function timedAsync(label, work) {
  const started = process.hrtime.bigint();
  const value = await work();
  timings.push({ label, ms: Number(process.hrtime.bigint() - started) / 1e6 });
  return value;
}

function canonicalRecord() {
  return createCanonicalDepositionRecord({
    jurisdictionType: "texas-state", court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS",
    causeNumber: "2026-CI-40881", caseStyle: "Alan Prentice v. Meridian Freight Company",
    witness: "Alan Prentice", depositionDate: "2026-08-31", remote: false, location: "San Antonio, Texas",
    parties: [{ name: "Alan Prentice", role: "Plaintiff" }, { name: "Meridian Freight Company", role: "Defendant" }],
    attorneys: [
      { name: "Michael Alvarez", firm: "Alvarez Law", address: "100 Main, San Antonio, Texas", phone: "210-555-0101", represents: ["Alan Prentice"], side: "PLAINTIFF", actualAppearance: true },
      { name: "Elena Ramirez", firm: "Ramirez Defense", address: "200 Main, San Antonio, Texas", phone: "210-555-0102", represents: ["Meridian Freight Company"], side: "DEFENDANT", actualAppearance: true },
    ],
    reporterProfile: { name: "Sarah Jenkins", licenseNumber: "1234", csrExpiration: "2029-12-31", company: "Jenkins Reporting", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" },
  });
}

const operator = {
  jurisdiction: "texas-state", signatureDisposition: "requested", signatureDispositionBasis: "Stated on the record",
  courtHeadingLine: "IN THE DISTRICT COURT OF", countyCourtLine: "BEXAR COUNTY, TEXAS", judicialDistrictLine: "45TH JUDICIAL DISTRICT",
  proceedingHeading: "ORAL DEPOSITION OF",
  titleNarrative: ["Alan Prentice, produced as a witness and duly sworn,", "was taken before Sarah Jenkins,", "Certified Shorthand Reporter in and for Texas."],
  certification: { custodialAttorney: "Michael Alvarez", charges: "500.00", chargesResponsibleParty: "Plaintiff", submissionDate: "2026-09-14", returnDeadline: "2026-09-28", serviceDate: "2026-09-30", certificationDate: "2026-09-14", furtherCertificationDate: "2026-09-30", returnStatus: "2026-09-28" },
  timeUsed: { totalOnRecordMinutes: 240, parties: [{ name: "Michael Alvarez", minutes: 160 }, { name: "Grace Whitfield", minutes: 80 }] },
  // Page numbers are the paginator's. Supplying them here is what printed "4-5" on the index of
  // a 213-page body; completePagination now refuses them outright.
  examinations: [{ examiner: "Michael Alvarez" }],
};

function buildChain() {
  const overlay = emptyOverlay("DEP-QUALIFY-LONG");
  const reconstructed = timed("applyOverlay", () => applyOverlay(WORKING.segments, overlay));
  assert.equal(reconstructed.segments.length, SCALE.segments, "reconstruction dropped or invented segments");
  const rendered = timed("renderTranscript", () => renderTranscript({ working: WORKING, evidence: [EVIDENCE], speakerCandidates: SPEAKER_CANDIDATES, overlay }));
  const reviewStateHash = computeReviewStateHash({ transcript: WORKING, overlay });
  const printModel = timed("buildTranscriptPrintModel", () => buildTranscriptPrintModel({
    rendered, reviewStateHash,
    deposition: { id: "DEP-QUALIFY-LONG", caseStyle: "Alan Prentice v. Meridian Freight Company", witness: "Alan Prentice", depositionDate: "2026-08-31", causeNumber: "2026-CI-40881" },
  }));
  return { printModel, rendered };
}

function disposableDirectory(t) {
  // os.tmpdir(), never the deposition root. An artifact written under the deposition root is
  // indistinguishable from a reporter's own output to anything that later scans it.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-qualify-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("a production-length transcript survives the whole chain with its page geometry intact", async (t) => {
  const availability = rendererAvailability();
  if (!availability.ok) return t.skip(`End-to-end qualification was not exercised: ${availability.why}`);

  assert.equal(TEXAS_FREELANCE_DEPOSITION_V1.linesPerPage, LINES, "the profile no longer states 25 physical line positions");
  assert.equal(TEXAS_FREELANCE_DEPOSITION_V1.charactersPerLine, WIDTH, "the profile's qualified line width has moved");

  // The fixture must stay large. A future edit that shrinks it would quietly turn this back into
  // a three-page test that reports green while proving nothing about a deposition.
  assert.ok(SCALE.segments >= 1500, `the long fixture has shrunk to ${SCALE.segments} segments`);
  assert.ok(SCALE.words >= 12000, `the long fixture has shrunk to ${SCALE.words} words`);

  const { printModel } = buildChain();
  assert.ok(printModel.pages.length > 50, `a 45,000-word transcript paginated to only ${printModel.pages.length} pages`);

  const model = await timedAsync("buildCompleteTranscriptModel", () => buildCompleteTranscriptModel({
    depositionId: "DEP-QUALIFY-LONG", printModel, record: canonicalRecord(),
    intake: { counselOfRecord: ["Michael Alvarez", "Elena Ramirez"] }, operator,
    generatedAt: "2026-08-31T12:00:00.000Z",
  }));
  assert.equal(model.recordType, "COMPLETE_TRANSCRIPT_DOCUMENT_MODEL");

  // Every page, front matter and back matter included, carries the full 25 positions. A renderer
  // that collapsed blanks would still look correct on screen and be wrong on paper.
  for (const page of model.pages) {
    assert.equal(page.lines.length, LINES, `page ${page.pageNumber} (${page.role}) carries ${page.lines.length} line positions`);
    for (const line of page.lines) {
      assert.ok(String(line.content ?? "").length <= WIDTH, `page ${page.pageNumber} line ${line.position} is ${String(line.content).length} characters, past the ${WIDTH}-character width`);
    }
  }

  // Page numbers are contiguous from 1. A gap or repeat here is an index that will cite the wrong
  // page, which is the failure the reporter cannot see until the transcript is served.
  assert.deepEqual(model.pages.map(page => page.pageNumber), Array.from({ length: model.pages.length }, (_, index) => index + 1));

  const outputDirectory = disposableDirectory(t);
  const artifact = await timedAsync("createTranscriptDocxArtifact", () => createTranscriptDocxArtifact(null, { depositionId: "DEP-QUALIFY-LONG", printModel: model, outputDirectory }));
  assert.equal(path.basename(artifact.outputPath), "complete-transcript.docx");
  assert.ok(artifact.bytes > 0, "the renderer reported success but wrote no file");
  assert.equal(artifact.renderer.pages, model.pages.length);

  // ---- the boundary crossing -----------------------------------------------------------------
  // Everything above is the near side: the application's own account of what it produced. This
  // reopens the written file and compares it line for line with the Page Review model.
  const read = spawnSync(python, ["-c", [
    "import json,sys",
    "from docx import Document",
    "d=Document(sys.argv[1])",
    "ps=[p.text for p in d.paragraphs]",
    "brk=[i for i,p in enumerate(d.paragraphs) if p.paragraph_format.page_break_before]",
    "print(json.dumps({'lines':ps,'breaks':brk}))",
  ].join("\n"), artifact.outputPath], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(read.status, 0, `reopening the DOCX failed: ${read.stderr}`);
  const document = JSON.parse(read.stdout.trim());

  // The renderer drops the final page's trailing blanks, so the expected sequence is every line
  // of every page with only that tail removed.
  const expected = model.pages.flatMap(page => page.lines.map(line => String(line.content ?? "")));
  while (expected.length && expected.at(-1) === "") expected.pop();
  assert.equal(document.lines.length, expected.length, `Word holds ${document.lines.length} lines where Page Review holds ${expected.length}`);

  // Reported as the first divergence rather than a diff of 3,000 lines, with the page and
  // position it occurred at, because that is what someone would need in order to go and look.
  const divergence = document.lines.findIndex((line, index) => line !== expected[index]);
  if (divergence !== -1) {
    const page = Math.floor(divergence / LINES) + 1;
    assert.fail(`Word and Page Review diverge at line ${divergence} (page ${page}, position ${(divergence % LINES) + 1}):\n  Page Review: ${JSON.stringify(expected[divergence])}\n  Word:        ${JSON.stringify(document.lines[divergence])}`);
  }

  // Page boundaries are physical -- a break before the first line of every page after the first --
  // rather than a consequence of how much text happened to fit.
  assert.deepEqual(document.breaks, Array.from({ length: model.pages.length - 1 }, (_, index) => (index + 1) * LINES));

  const report = timings.map(entry => `${entry.label} ${entry.ms.toFixed(1)}ms`).join(" · ");
  console.log(`\n  [scale] ${SCALE.segments} segments · ${SCALE.words} words · ${model.pages.length} pages · ${(artifact.bytes / 1024).toFixed(0)} KB docx`);
  console.log(`  [timing] ${report}\n`);
});

test("the chain is deterministic: identical input produces an identical model", () => {
  const first = buildChain().printModel;
  const second = buildChain().printModel;
  // If these differ, a timing, clock or iteration-order dependency has entered pagination, and
  // two exports of an unedited transcript could paginate differently.
  assert.equal(first.modelHash, second.modelHash, "two runs over identical input produced different print models");
  assert.equal(first.pages.length, second.pages.length);
});

test("reconstruction does not write to disk", () => {
  // applyOverlay is documented pure -- no filesystem, no fetch -- and the harness depends on that
  // to run against a transcript of this size without producing artifacts. Asserted rather than
  // trusted: a future overlay that cached to disk would break the guarantee silently.
  const before = fs.readdirSync(os.tmpdir()).length;
  applyOverlay(WORKING.segments, emptyOverlay("DEP-QUALIFY-LONG"));
  assert.equal(fs.readdirSync(os.tmpdir()).length, before, "reconstruction created something in the temp directory");
});
