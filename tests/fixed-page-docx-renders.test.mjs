// The deliverable itself, rendered and reopened.
//
// tests/final-document-docx.test.mjs exercises createFixedPageDocxSpec -- the pure JavaScript
// spec builder -- and stops there. Nothing in the suite has ever spawned the Python renderer or
// written a .docx byte, so the 219/219 Word parity and the nine-page round trip were one-off
// proofs rather than regression-gated results. Everything downstream of the spec could break
// while the suite stayed green.
//
// Asserting that spec JSON equals expected spec JSON proves nothing about the file a reporter
// sends. Two true facts on the near side of a boundary say nothing about the far side, so this
// test crosses it: render, reopen with python-docx, and count what is actually in the document.
//
// The model here is built inline from synthetic values rather than from
// scripts/create-milestone2-browser-fixture.mjs. The fixture generator is a browser fixture with
// its own evidence and its own reasons to change; a regression gate on page geometry should fail
// when the geometry changes, not when an unrelated fixture is edited.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTranscriptDocxArtifact } from "../server/final-document-docx.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../server/texas-freelance-deposition-profile.mjs";

// Resolved exactly as the runtime resolves it, so the test cannot skip on a machine where the
// code would run. The previous formatter test required DEPO_PRO_PYTHON to be an existing PATH
// while final-document-docx.mjs accepts the bare string and falls back to "python" -- so it
// skipped on machines that had a working interpreter.
const python = process.env.DEPO_PRO_PYTHON ?? "python";

function rendererAvailability() {
  const probe = spawnSync(python, ["-c", "import docx, lxml"], { encoding: "utf8", windowsHide: true });
  if (probe.error) return { ok: false, why: `no Python interpreter resolved from DEPO_PRO_PYTHON ?? "python" (tried ${python}: ${probe.error.message})` };
  if (probe.status !== 0) return { ok: false, why: `Python at ${python} cannot import python-docx/lxml: ${(probe.stderr || "").trim()}` };
  return { ok: true, why: "" };
}

// Literal 25, deliberately NOT TEXAS_FREELANCE_DEPOSITION_V1.linesPerPage.
//
// Reading the expected value out of the profile under test makes the assertion tautological:
// change linesPerPage to 24 and a profile-derived test builds 24-line pages, expects 24, and
// passes -- reporting green while the certified page geometry silently moved. Twenty-five
// physical line positions is UFM_REQUIRED, so it is an outside signal and belongs here as one.
const LINES = 25;

// One occupied line per page, the rest blank. The occupied line is what proves text survived; the
// blanks are what prove the 25 physical positions are emitted rather than collapsed.
function page(number, text, { role = "testimony", sectionKind = "testimony", editable = true } = {}) {
  return {
    id: `page-${number}`, pageNumber: number, role, sectionKind, editable,
    lines: Array.from({ length: LINES }, (_, index) => ({
      position: index + 1,
      content: index === 0 ? text : "",
      occupied: index === 0,
      paragraphId: index === 0 ? `para-${number}` : null,
      fragments: index === 0 ? [{ id: `frag-${number}`, sourceWordId: `word-${number}` }] : [],
      fields: [],
    })),
  };
}

function syntheticCompleteModel() {
  return {
    recordType: "COMPLETE_TRANSCRIPT_DOCUMENT_MODEL",
    modelHash: "synthetic-model-hash",
    source: { reviewStateHash: "synthetic-review-hash" },
    layoutProfile: TEXAS_FREELANCE_DEPOSITION_V1,
    pages: [
      page(1, "                              INDEX", { role: "index", sectionKind: "administrative", editable: false }),
      page(2, "    Q.    Does the renderer actually run?"),
      page(3, "    A.    That is what this test measures."),
    ],
  };
}

function disposableDirectory() {
  // os.tmpdir(), never the deposition root. A test artifact written under the deposition root
  // would be indistinguishable from a reporter's own output to anything that scans it.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-docx-"));
  test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("the fixed-page renderer writes a DOCX whose reopened pages carry 25 physical line positions", (t) => {
  const availability = rendererAvailability();
  if (!availability.ok) return t.skip(`Fixed-page DOCX rendering was not exercised: ${availability.why}`);

  // The UFM requirement itself, asserted against the outside signal rather than against itself.
  assert.equal(TEXAS_FREELANCE_DEPOSITION_V1.linesPerPage, LINES, "the profile no longer states 25 physical line positions");
  assert.equal(TEXAS_FREELANCE_DEPOSITION_V1.charactersPerLine, 63);

  const outputDirectory = disposableDirectory();
  const artifact = createTranscriptDocxArtifact(null, { depositionId: "SYNTHETIC", printModel: syntheticCompleteModel(), outputDirectory });

  assert.equal(path.basename(artifact.outputPath), "complete-transcript.docx");
  assert.ok(fs.existsSync(artifact.outputPath), "the renderer reported success but wrote no file");
  assert.ok(artifact.bytes > 0);
  assert.equal(artifact.renderer.renderer, "DEPO_PRO_INTERNAL_FIXED_PAGE_OOXML_V1");
  assert.equal(artifact.renderer.pages, 3);
  assert.equal(artifact.renderer.profile, "TEXAS_FREELANCE_DEPOSITION_V1");

  // Reopen the written file. Everything above is still the near side of the boundary: the
  // renderer's own report of what it did. This is the document.
  const read = spawnSync(python, ["-c", [
    "import json,sys",
    "from docx import Document",
    "d=Document(sys.argv[1])",
    "ps=[p.text for p in d.paragraphs]",
    "brk=[i for i,p in enumerate(d.paragraphs) if p.paragraph_format.page_break_before]",
    "print(json.dumps({'paragraphs':len(ps),'breaks':brk,'texts':[t for t in ps if t.strip()]}))",
  ].join("\n"), artifact.outputPath], { encoding: "utf8", windowsHide: true });
  assert.equal(read.status, 0, `reopening the DOCX failed: ${read.stderr}`);
  const document = JSON.parse(read.stdout.trim());

  // Two full pages of 25, then the final page with its trailing blanks dropped: 25 + 25 + 1.
  // A renderer that collapsed blank lines would report 3 here and still "work" on screen.
  assert.equal(document.paragraphs, LINES * 2 + 1);
  assert.equal(artifact.renderer.physicalLines, LINES * 2 + 1);
  // A page break before the first line of every page after the first is what makes the page
  // boundaries physical rather than a consequence of how much text happened to fit.
  assert.deepEqual(document.breaks, [LINES, LINES * 2]);
  assert.deepEqual(document.texts, [
    "                              INDEX",
    "    Q.    Does the renderer actually run?",
    "    A.    That is what this test measures.",
  ]);
});

test("a testimony-only model renders under its own name", (t) => {
  const availability = rendererAvailability();
  if (!availability.ok) return t.skip(`Fixed-page DOCX rendering was not exercised: ${availability.why}`);

  const outputDirectory = disposableDirectory();
  const model = syntheticCompleteModel();
  const artifact = createTranscriptDocxArtifact(null, {
    depositionId: "SYNTHETIC",
    printModel: { ...model, recordType: "TRANSCRIPT_PRINT_MODEL" },
    outputDirectory,
  });

  assert.equal(path.basename(artifact.outputPath), "professional-testimony.docx");
  assert.ok(fs.existsSync(artifact.outputPath));
});
