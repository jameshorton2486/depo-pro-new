import assert from "node:assert/strict";
import test from "node:test";
import { computeTranscriptContentHash, withTranscriptContentHash } from "../server/transcript-content-hash.mjs";

const transcript = () => ({
  schemaVersion: "1.1.0",
  recordType: "WORKING_TRANSCRIPT",
  derivedFrom: ["job-1"],
  speakerMap: { status: "unreconciled", assignments: [] },
  segments: [{ id: "segment-1", text: "Good afternoon.", asrWordIds: ["word-1"] }],
  updatedAt: "2026-08-15T00:00:00.000Z",
});

test("transcript content hash is stable across timestamps and object key order", () => {
  const first = transcript();
  const second = { ...first, updatedAt: "2026-08-16T00:00:00.000Z", speakerMap: { assignments: [], status: "unreconciled" } };
  assert.equal(computeTranscriptContentHash(first), computeTranscriptContentHash(second));
});

test("transcript content hash changes when canonical content changes", () => {
  const first = transcript();
  const second = structuredClone(first);
  second.segments[0].text = "Good evening.";
  assert.notEqual(computeTranscriptContentHash(first), computeTranscriptContentHash(second));
});

test("stored hash does not hash itself", () => {
  const first = withTranscriptContentHash(transcript());
  assert.equal(first.transcript_hash, computeTranscriptContentHash(first));
});

test("speaker reconciliation timestamps do not change transcript content hash", () => {
  const first = transcript();
  first.speakerMap.reconciledAt = "2026-08-15T00:00:00.000Z";
  const second = structuredClone(first);
  second.speakerMap.reconciledAt = "2026-08-16T00:00:00.000Z";
  assert.equal(computeTranscriptContentHash(first), computeTranscriptContentHash(second));
});

test("equivalent speaker assignment order does not change transcript content hash", () => {
  const first = transcript();
  first.speakerMap.assignments = [
    { sourceJobIdentity: "job-1", deepgramSpeaker: 1, speakerIdentity: "witness", transcriptRole: "WITNESS" },
    { sourceJobIdentity: "job-1", deepgramSpeaker: 0, speakerIdentity: "reporter", transcriptRole: "COURT_REPORTER" },
  ];
  const second = structuredClone(first);
  second.speakerMap.assignments.reverse();
  assert.equal(computeTranscriptContentHash(first), computeTranscriptContentHash(second));
});

test("speaker assignment changes alter transcript content hash", () => {
  const first = transcript();
  first.speakerMap.assignments = [{ sourceJobIdentity: "job-1", deepgramSpeaker: 1, speakerIdentity: "witness", transcriptRole: "WITNESS" }];
  const second = structuredClone(first);
  second.speakerMap.assignments[0].transcriptRole = "OTHER";
  assert.notEqual(computeTranscriptContentHash(first), computeTranscriptContentHash(second));
});

test("schema version changes alter transcript content hash", () => {
  const first = transcript();
  const second = { ...first, schemaVersion: "1.2.0" };
  assert.notEqual(computeTranscriptContentHash(first), computeTranscriptContentHash(second));
});
