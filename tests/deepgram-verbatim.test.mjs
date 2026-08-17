import assert from "node:assert/strict";
import test from "node:test";
import { DEEPGRAM_CONFIGURATION_VERSION, DEEPGRAM_PLAYGROUND_OPTIONS, buildDeepgramRequest } from "../server/deepgram-service.mjs";
import { transcriptionIdentity } from "../server/transcription-jobs.mjs";

// A Texas deposition record is verbatim. The reporter-verified Etminan transcript keeps 134
// "um", 100 "uh" and 2 "mm-hmm", and profanity is evidence that must never be masked. Both of
// those are decided by request parameters, before any code in this repo sees a word -- nothing
// downstream can recover a disfluency the ASR was told to drop.
test("the request preserves disfluencies and never filters profanity",()=>{
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.filler_words,"true","Nova-3 strips uh/um/mm-hmm unless filler_words is on");
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.profanity_filter,"false","profanity is evidence; masking it alters the record");
});

test("both parameters actually reach the query string",()=>{
  // Asserting the constant alone would pass even if buildDeepgramRequest dropped them.
  const url = new URL(buildDeepgramRequest(["Etminan"]).url);
  assert.equal(url.searchParams.get("filler_words"),"true");
  assert.equal(url.searchParams.get("profanity_filter"),"false");
  assert.equal(url.searchParams.get("model"),"nova-3");
  assert.deepEqual(url.searchParams.getAll("keyterm"),["Etminan"]);
});

test("the configuration version changes when the request changes",()=>{
  // transcriptionIdentity hashes configurationVersion. Two jobs carrying the same version
  // while the request differed is the ADR-0018 defect: the record cannot show which parameters
  // produced which transcript. Pinning profanity_filter changed the request, so the version
  // moved with it.
  assert.equal(DEEPGRAM_CONFIGURATION_VERSION,"prerecorded-nova3-diarizer-v2-2");
  const base = { audioSha256:"a".repeat(64), keytermSetSha256:"b".repeat(64) };
  const before = transcriptionIdentity({ ...base, configurationVersion:"prerecorded-nova3-diarizer-v2-1" });
  const after = transcriptionIdentity({ ...base, configurationVersion:DEEPGRAM_CONFIGURATION_VERSION });
  assert.notEqual(before.sha256, after.sha256, "a changed configuration version must produce a different job identity");
});

test("every option is a string, because URLSearchParams stringifies silently",()=>{
  // A boolean false would serialize to "false" and look right; a nullish value would serialize
  // to "null" or "undefined" and Deepgram would reject or ignore it. Pin the type.
  for (const [key, value] of Object.entries(DEEPGRAM_PLAYGROUND_OPTIONS)) {
    assert.equal(typeof value,"string",`${key} must be a string`);
    assert.notEqual(value.trim(),"",`${key} must not be empty`);
  }
});
