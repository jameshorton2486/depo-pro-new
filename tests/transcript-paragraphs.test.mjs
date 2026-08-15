import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PARAGRAPH_CHARACTERS,
  groupTranscriptSegments,
} from "../app/transcript-paragraphs.mjs";

function segment(id, { speaker = 0, start = 0, end = 1, text = "Text.", words = [id] } = {}) {
  return {
    id,
    sourceJobIdentity: "job-1",
    sourceUploadId: "upload-1",
    deepgramSpeaker: speaker,
    speakerIdentity: null,
    transcriptRole: null,
    start,
    end,
    text,
    asrWordIds: words,
  };
}

test("adjacent utterances from the same speaker form one display paragraph", () => {
  const paragraphs = groupTranscriptSegments([
    segment("one", { start: 0, end: 1, text: "Good afternoon." }),
    segment("two", { start: 1.2, end: 3, text: "We are on the record." }),
    segment("three", { start: 3.1, end: 5, text: "Today's date is April 24, 2026." }),
  ]);
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "Good afternoon. We are on the record. Today's date is April 24, 2026.");
  assert.deepEqual(paragraphs[0].segmentIds, ["one", "two", "three"]);
  assert.deepEqual(paragraphs[0].asrWordIds, ["one", "two", "three"]);
  assert.equal(paragraphs[0].start, 0);
  assert.equal(paragraphs[0].end, 5);
});

test("speaker changes and long pauses begin new paragraphs", () => {
  const paragraphs = groupTranscriptSegments([
    segment("one", { start: 0, end: 1 }),
    segment("two", { speaker: 1, start: 1.1, end: 2 }),
    segment("three", { speaker: 1, start: 8, end: 9 }),
  ]);
  assert.deepEqual(paragraphs.map(item => item.segmentIds), [["one"], ["two"], ["three"]]);
});

test("unknown timing does not combine evidence into an assumed speaker turn", () => {
  const paragraphs = groupTranscriptSegments([
    segment("one", { end: null }),
    segment("two", { start: null }),
  ]);
  assert.equal(paragraphs.length, 2);
});

test("paragraph length is capped without dropping source identifiers", () => {
  const long = "a".repeat(MAX_PARAGRAPH_CHARACTERS - 2);
  const paragraphs = groupTranscriptSegments([
    segment("one", { start: 0, end: 1, text: long, words: ["word-1"] }),
    segment("two", { start: 1.1, end: 2, text: "More.", words: ["word-2"] }),
  ]);
  assert.equal(paragraphs.length, 2);
  assert.deepEqual(paragraphs.flatMap(item => item.asrWordIds), ["word-1", "word-2"]);
});

test("source segments are not mutated", () => {
  const source = [segment("one"), segment("two", { start: 1.1, end: 2 })];
  const snapshot = structuredClone(source);
  groupTranscriptSegments(source);
  assert.deepEqual(source, snapshot);
});
