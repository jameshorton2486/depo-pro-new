import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
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
  assert.equal(DEEPGRAM_CONFIGURATION_VERSION,"prerecorded-nova3-diarizer-v2-3");
  const base = { audioSha256:"a".repeat(64), keytermSetSha256:"b".repeat(64) };
  const before = transcriptionIdentity({ ...base, configurationVersion:"prerecorded-nova3-diarizer-v2-2" });
  const after = transcriptionIdentity({ ...base, configurationVersion:DEEPGRAM_CONFIGURATION_VERSION });
  assert.notEqual(before.sha256, after.sha256, "a changed configuration version must produce a different job identity");
});

test("diarization is actually requested, not just configured",()=>{
  // `diarize_model` picks which diarizer; `diarize` decides whether one runs. Only the second
  // was ever sent. With no speakers, every word returns speaker:null, deriveSegments collapses
  // the transcript into a single speakerless group, and the speaker map and Q./A. mapping have
  // nothing to key on -- a total failure of the speaker pipeline, discovered on a paid run.
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize,"true");
  assert.equal(new URL(buildDeepgramRequest().url).searchParams.get("diarize"),"true");
});

test("the recorded diarization request is read from the request, not asserted",()=>{
  // It was hardcoded `requested:true` while `diarize` was absent, so the record claimed a
  // request nobody made and `available:false` would have read as a Deepgram failure.
  const source = fs.readFileSync(new URL("../server/deepgram-service.mjs", import.meta.url), "utf8");
  assert.equal(/diarization:\{\s*requested:\s*true/.test(source),false,"requested must be derived from the sent options");
  assert.match(source,/requested:\s*request\.options\?\.diarize\s*===\s*"true"/);
});

test("changing any request option requires bumping the configuration version",()=>{
  // The version is hand-maintained and feeds transcriptionIdentity. Nothing tied it to the
  // options, so smart_format could flip while the version stayed put and two different
  // requests would share a job identity -- the same drift shape as a hand-kept nav flag.
  // Change an option and this fails, naming the bump it needs.
  const sorted = Object.fromEntries(Object.entries(DEEPGRAM_PLAYGROUND_OPTIONS).sort(([a],[b])=>a.localeCompare(b)));
  const digest = crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0,16);
  assert.equal(digest,"35fac5a756f064cc",`The Deepgram option set changed. Bump DEEPGRAM_CONFIGURATION_VERSION and update this digest together, or two different requests will share a job identity. Options are now ${JSON.stringify(sorted)}`);
  assert.equal(DEEPGRAM_CONFIGURATION_VERSION,"prerecorded-nova3-diarizer-v2-3");
});

test("every option that decides output is explicit, none riding a provider default",()=>{
  // An absent option is one whose behaviour is decided elsewhere and can change without a
  // diff. Compare scores original against RX-enhanced audio, so any parameter differing
  // between the two runs is measured as an RX effect.
  for (const key of ["model","language","diarize","diarize_model","filler_words","profanity_filter","numerals","paragraphs","punctuate","smart_format","utterances"]) {
    assert.ok(key in DEEPGRAM_PLAYGROUND_OPTIONS,`${key} must be pinned explicitly, whatever its value`);
  }
});

test("every option is a string, because URLSearchParams stringifies silently",()=>{
  // A boolean false would serialize to "false" and look right; a nullish value would serialize
  // to "null" or "undefined" and Deepgram would reject or ignore it. Pin the type.
  for (const [key, value] of Object.entries(DEEPGRAM_PLAYGROUND_OPTIONS)) {
    assert.equal(typeof value,"string",`${key} must be a string`);
    assert.notEqual(value.trim(),"",`${key} must not be empty`);
  }
});
