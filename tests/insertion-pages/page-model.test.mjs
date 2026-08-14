import assert from "node:assert/strict";
import test from "node:test";
import { createInsertionPageSet, createPage, pageOverflowFindings } from "../../server/insertion-pages/page-model.mjs";

test("line model is deterministic and retains field provenance", () => {
  const input = {
    setId: "set-1", depositionId: "DEP-20260814-TEST1", variant: "TEXAS_STATE_SIGNATURE_REQUESTED",
    templateHashes: { title: "abc" }, intentionalBlanks: ["cert.serviceDate"], generatedAt: "2026-08-14T12:00:00.000Z",
    pages: [{ pageNumber: 1, role: "title", lines: [{ text: "IN THE DISTRICT COURT", fields: ["caption.court"] }] }],
  };
  const first = createInsertionPageSet(input);
  const second = createInsertionPageSet(input);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.pages[0].lines[0], { line: 1, text: "IN THE DISTRICT COURT", fields: ["caption.court"] });
  assert.equal(first.layoutVerified, false);
});

test("page overflow is a blocking finding", () => {
  const page = createPage({ pageNumber: 9, role: "certification", lines: Array.from({ length: 26 }, (_, index) => ({ text: String(index + 1) })) });
  assert.deepEqual(pageOverflowFindings([page]).map((finding) => finding.code), ["PAGE_LINE_OVERFLOW"]);
});
