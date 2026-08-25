import assert from "node:assert/strict";
import test from "node:test";

import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { appendOperations, emptyOverlay, undoLast } from "../server/reporter-overlay.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const render = (overlay = emptyOverlay("DEP-CHARACTERIZATION"), working = WORKING) => renderTranscript({
  working,
  evidence: [EVIDENCE],
  speakerCandidates: SPEAKER_CANDIDATES,
  examinerIdentity: "counsel-bentley",
  overlay,
});

const firstSplittable = () => WORKING.segments.find((segment) => segment.asrWordIds.length >= 4);

test("characterization: render preserves evidence while replacements, deletion, insertion, labels, and flags change only the reading", () => {
  const segment = firstSplittable();
  const [first, replacement, deleted, insertedAfter] = segment.asrWordIds;
  const overlay = appendOperations(emptyOverlay("DEP-CHARACTERIZATION"), [
    { op: "replace", wordId: replacement, text: "CORRECTED." },
    { op: "delete", wordId: deleted },
    { op: "insert", afterWordId: insertedAfter, text: "reporter authored" },
    { op: "label", wordId: first, speakerIdentity: "witness", transcriptRole: "WITNESS" },
    { op: "flag", fromWordId: first, toWordId: replacement },
  ]);

  const rendered = render(overlay);
  const words = rendered.paragraphs.flatMap((paragraph) => paragraph.words);
  const evidenceIds = new Set(EVIDENCE.words.map((word) => word.id));
  const corrected = words.find((word) => word.id === replacement);
  const struck = words.find((word) => word.id === deleted);
  const authored = words.find((word) => word.authored);

  assert.equal(corrected.text, "CORRECTED.");
  assert.equal(corrected.edited, true);
  assert.equal(corrected.originalText, EVIDENCE.words.find((word) => word.id === replacement).punctuatedWord);
  assert.equal(struck.deleted, true);
  assert.ok(!rendered.paragraphs.find((paragraph) => paragraph.words.some((word) => word.id === deleted)).text.includes(struck.text));
  assert.equal(authored.text, "reporter authored");
  assert.equal(authored.start, null);
  assert.equal(authored.end, null);
  assert.equal(authored.confidence, null);
  assert.equal(authored.deepgramSpeaker, null);
  assert.equal(evidenceIds.has(authored.id), false);
  assert.equal(words.filter((word) => word.flagged).length, 2);
  assert.equal(rendered.counts.orphaned, 0);
  assert.ok(words.some((word) => word.id === deleted), "deletion suppresses the reading but retains evidence identity");
});

test("characterization: overlay ordering is semantic", () => {
  const segment = firstSplittable();
  const anchor = segment.asrWordIds[2];
  const splitThenLabel = appendOperations(emptyOverlay("DEP-CHARACTERIZATION"), [
    { op: "split", beforeWordId: anchor },
    { op: "label", wordId: anchor, speakerIdentity: "witness", transcriptRole: "WITNESS" },
  ]);
  const labelThenSplit = appendOperations(emptyOverlay("DEP-CHARACTERIZATION"), [
    { op: "label", wordId: anchor, speakerIdentity: "witness", transcriptRole: "WITNESS" },
    { op: "split", beforeWordId: anchor },
  ]);

  assert.notDeepEqual(render(splitThenLabel).paragraphs, render(labelThenSplit).paragraphs);
});

test("characterization: current undo removes one low-level operation from a split-plus-label action", () => {
  const segment = firstSplittable();
  const anchor = segment.asrWordIds[2];
  const overlay = appendOperations(emptyOverlay("DEP-CHARACTERIZATION"), [
    { op: "split", beforeWordId: anchor },
    { op: "label", wordId: anchor, speakerIdentity: "witness", transcriptRole: "WITNESS" },
  ]);
  const { overlay: undone, removed } = undoLast(overlay);

  assert.equal(removed.op, "label");
  assert.deepEqual(undone.operations.map((operation) => operation.op), ["split"]);
  assert.equal(render(undone).counts.paragraphs, render().counts.paragraphs + 1);
});

test("characterization: paragraph ids are render-order identities and an early split renumbers later paragraphs", () => {
  const before = render();
  const segment = firstSplittable();
  const anchor = segment.asrWordIds[2];
  const after = render(appendOperations(emptyOverlay("DEP-CHARACTERIZATION"), { op: "split", beforeWordId: anchor }));
  const laterEvidenceWord = before.paragraphs.at(-1).words.at(-1).id;
  const beforeParagraph = before.paragraphs.find((paragraph) => paragraph.words.some((word) => word.id === laterEvidenceWord));
  const afterParagraph = after.paragraphs.find((paragraph) => paragraph.words.some((word) => word.id === laterEvidenceWord));

  assert.notEqual(beforeParagraph.id, afterParagraph.id);
  assert.match(beforeParagraph.id, /^paragraph:\d+$/);
  assert.match(afterParagraph.id, /^paragraph:\d+$/);
});

test("characterization: paragraph timing ignores adjacent authored words and uses measured evidence bounds", () => {
  const segment = firstSplittable();
  const anchor = segment.asrWordIds[1];
  const overlay = appendOperations(emptyOverlay("DEP-CHARACTERIZATION"), { op: "insert", afterWordId: anchor, text: "authored context" });
  const paragraph = render(overlay).paragraphs.find((item) => item.words.some((word) => word.id === anchor));
  const timestamped = paragraph.words.filter((word) => Number.isFinite(word.start));

  assert.equal(paragraph.start, timestamped[0].start);
  assert.equal(paragraph.end, timestamped.at(-1).end);
  assert.ok(paragraph.words.some((word) => word.authored && word.start === null && word.end === null));
});

test("characterization: Print Model fixes 25 positions per page and traces body lines to paragraphs, segments, and evidence words", () => {
  const rendered = render();
  const model = buildTranscriptPrintModel({
    rendered,
    reviewStateHash: "characterized-review-state",
    deposition: { id: "DEP-CHARACTERIZATION", caseStyle: "Alpha v. Beta", witness: "Witness", depositionDate: "2026-08-25", causeNumber: "C-1" },
  });

  assert.ok(model.pages.length > 0);
  assert.ok(model.pages.every((page) => page.lines.length === 25));
  assert.ok(model.pages.every((page) => page.lines.map((line) => line.position).join(",") === Array.from({ length: 25 }, (_, index) => index + 1).join(",")));
  const occupied = model.pages.flatMap((page) => page.lines).filter((line) => line.occupied);
  assert.ok(occupied.some((line) => line.trace?.paragraphId));
  assert.ok(occupied.some((line) => line.trace?.sourceSegmentIds?.length));
  assert.ok(occupied.some((line) => line.trace?.sourceWordIds?.length));
  assert.equal(model.source.reviewStateHash, "characterized-review-state");
  assert.equal(model.source.renderedContentHash, rendered.renderedContentHash);
  assert.ok(model.findings.print.some((finding) => finding.code === "PRINT_LAYOUT_PROFILE_UNVERIFIED"));
});
