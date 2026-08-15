import assert from "node:assert/strict";
import test from "node:test";
import { chooseAsrSource, chooseMeasuredAsrSource } from "../server/asr-selection.mjs";
import { compareTranscripts } from "../server/transcript-quality.mjs";
test("candidate wins only with a conservative advantage",()=>{assert.equal(chooseAsrSource({transcript:"Jane Doe",confidence:.80,words:[1,2]},{transcript:"Jane Doe",confidence:.83,words:[1,2]},["Jane Doe"]).winner,"processed")});
test("original wins when candidate loses a critical term",()=>{assert.equal(chooseAsrSource({transcript:"Jane Doe did not",confidence:.80,words:[1,2,3,4]},{transcript:"Jane did not",confidence:.90,words:[1,2,3]},["Jane Doe"]).winner,"original")});
test("original wins on a tie",()=>{assert.equal(chooseAsrSource({transcript:"test",confidence:.80,words:[1]},{transcript:"test",confidence:.80,words:[1]},[]).winner,"original")});

test("measured selector accepts a real WER improvement with no legal regression",()=>{
  const reference="Jane Doe did not attend the examination yesterday";
  const original=compareTranscripts(reference,"Jane Doe did attend examination yesterday",["Jane Doe","did not"],{properNames:["Jane Doe"]});
  const processed=compareTranscripts(reference,"Jane Doe did not attend the examination yesterday",["Jane Doe","did not"],{properNames:["Jane Doe"]});
  const result=chooseMeasuredAsrSource(original,processed);
  assert.equal(result.winner,"processed");
  assert.equal(result.measuredWer,true);
  assert.deepEqual(result.candidateSet,["original","processed"]);
});

test("measured selector rejects lower WER when deletions increase",()=>{
  const reference="one two three four five six seven eight nine ten";
  const original=compareTranscripts(reference,"one too three four five six seven ate nine ten");
  const processed=compareTranscripts(reference,"one two three four five six seven eight nine");
  const result=chooseMeasuredAsrSource(original,processed);
  assert.equal(processed.wer < original.wer,true);
  assert.equal(result.winner,"original");
  assert.match(result.reason,/deletions increased/);
});

test("measured selector rejects a negation regression despite lower WER",()=>{
  const reference="No I did not authorize the payment on August 15 2026";
  const original=compareTranscripts(reference,"No I did not authorize payment August fifty twenty six");
  const processed=compareTranscripts(reference,"I did authorize the payment on August 15 2026");
  const result=chooseMeasuredAsrSource(original,processed);
  assert.equal(processed.wer < original.wer,true);
  assert.equal(result.winner,"original");
  assert.ok(result.metrics.categoryRegressions.includes("negations"));
});

test("measured selector refuses comparisons against different references",()=>{
  assert.throws(()=>chooseMeasuredAsrSource(compareTranscripts("yes","yes"),compareTranscripts("no","no")),/same human reference/);
});
