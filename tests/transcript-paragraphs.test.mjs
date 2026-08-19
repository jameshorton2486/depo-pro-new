import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PARAGRAPH_CHARACTERS,
  groupTranscriptSegments,
  speakerBuckets,
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

test("two jobs each with a speaker 0 produce two buckets, not one", () => {
  // Deepgram numbers speakers per request, so speaker 0 in one job and speaker 0 in another are
  // two different people sharing an index. Keyed by index alone they merged into one row, and
  // whichever identity the reporter chose was applied to both -- no error, no warning, the wrong
  // person attributed in a certified record. A deposition recorded in three volumes has three.
  const paragraph = (job, speaker, words, text) => ({
    deepgramSpeaker:speaker, segmentIds:[`${job}:segment:1`], text,
    words:Array.from({ length:words }, () => ({})),
  });
  const buckets = speakerBuckets([
    paragraph("jobA", 0, 100, "Videographer on jobA"),
    paragraph("jobB", 0, 50, "Witness on jobB"),
    paragraph("jobA", 0, 20, "More jobA speaker zero"),
    paragraph("jobA", 1, 10, "Reporter on jobA"),
  ]);
  assert.deepEqual(buckets.map(bucket => bucket.key), ["jobA:0", "jobB:0", "jobA:1"]);
  assert.equal(buckets.filter(bucket => bucket.deepgramSpeaker === 0).length, 2, "each job keeps its own speaker 0");
  assert.equal(buckets.find(bucket => bucket.key === "jobA:0").words, 120, "paragraphs from one job and speaker accumulate");
  assert.equal(buckets.find(bucket => bucket.key === "jobB:0").words, 50, "and do not leak into the other job");
});

test("the bucket key is the one the server validates against", () => {
  // reconcileSpeakerMap builds `${sourceJobIdentity}:${deepgramSpeaker}` and refuses an
  // assignment whose key is not an observed speaker. If the panel offered a different key the
  // save would fail at the server rather than in the browser, which is a worse place to find out.
  const [bucket] = speakerBuckets([{ deepgramSpeaker:3, segmentIds:["job-sha:segment:9"], text:"x", words:[{}] }]);
  assert.equal(bucket.key, `${bucket.jobIdentity}:${bucket.deepgramSpeaker}`);
  assert.equal(bucket.jobIdentity, "job-sha");
});

test("a paragraph with no speaker is not a bucket", () => {
  assert.deepEqual(speakerBuckets([{ deepgramSpeaker:null, segmentIds:["job:segment:1"], text:"x", words:[{}] }]), []);
  assert.deepEqual(speakerBuckets([]), []);
});
