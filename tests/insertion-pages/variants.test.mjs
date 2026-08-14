import assert from "node:assert/strict";
import test from "node:test";
import { captionJurisdiction, selectInsertionVariant } from "../../server/insertion-pages/variants.mjs";

test("variant selection has no implicit default", () => {
  assert.equal(selectInsertionVariant(), null);
  assert.equal(selectInsertionVariant({ jurisdiction: "texas-state", signatureDisposition: "requested" }), "TEXAS_STATE_SIGNATURE_REQUESTED");
  assert.equal(selectInsertionVariant({ jurisdiction: "federal", signatureDisposition: "waived" }), "FEDERAL_SIGNATURE_WAIVED");
});

test("caption jurisdiction identifies a United States District Court", () => {
  assert.equal(captionJurisdiction("IN THE UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TEXAS"), "federal");
});
