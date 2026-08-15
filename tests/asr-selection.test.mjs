import assert from "node:assert/strict";
import test from "node:test";
import { chooseAsrSource, chooseMeasuredAsrSource } from "../server/asr-selection.mjs";
import { compareTranscripts } from "../server/transcript-quality.mjs";
import { buildTermGroups } from "../server/term-groups.mjs";

// chooseMeasuredAsrSource requires both candidates to carry the same resolved term group
// set, so these fixtures stamp one the way POST /api/transcript/compare does.
const SET = buildTermGroups("deposition-core-v1", { ufmEntries:[{canonical:"Jane Doe",category:"person"}] });
function scored(reference, hypothesis, criticalTerms = [], set = SET) {
  return { termGroupSetId:set.termGroupSetId, termGroupSetVersion:set.termGroupSetVersion, ...compareTranscripts(reference, hypothesis, criticalTerms, set.groups) };
}
test("candidate wins only with a conservative advantage",()=>{assert.equal(chooseAsrSource({transcript:"Jane Doe",confidence:.80,words:[1,2]},{transcript:"Jane Doe",confidence:.83,words:[1,2]},["Jane Doe"]).winner,"processed")});
test("original wins when candidate loses a critical term",()=>{assert.equal(chooseAsrSource({transcript:"Jane Doe did not",confidence:.80,words:[1,2,3,4]},{transcript:"Jane did not",confidence:.90,words:[1,2,3]},["Jane Doe"]).winner,"original")});
test("original wins on a tie",()=>{assert.equal(chooseAsrSource({transcript:"test",confidence:.80,words:[1]},{transcript:"test",confidence:.80,words:[1]},[]).winner,"original")});

test("measured selector accepts a real WER improvement with no legal regression",()=>{
  const reference="Jane Doe did not attend the examination yesterday";
  const original=scored(reference,"Jane Doe did attend examination yesterday",["Jane Doe","did not"]);
  const processed=scored(reference,"Jane Doe did not attend the examination yesterday",["Jane Doe","did not"]);
  const result=chooseMeasuredAsrSource(original,processed);
  assert.equal(result.winner,"processed");
  assert.equal(result.measuredWer,true);
  assert.deepEqual(result.candidateSet,["original","processed"]);
});

test("measured selector rejects lower WER when deletions increase",()=>{
  const reference="one two three four five six seven eight nine ten";
  const original=scored(reference,"one too three four five six seven ate nine ten");
  const processed=scored(reference,"one two three four five six seven eight nine");
  const result=chooseMeasuredAsrSource(original,processed);
  assert.equal(processed.wer < original.wer,true);
  assert.equal(result.winner,"original");
  assert.match(result.reason,/deletions increased/);
});

test("measured selector rejects a negation regression despite lower WER",()=>{
  const reference="No I did not authorize the payment on August 15 2026";
  const original=scored(reference,"No I did not authorize payment August fifty twenty six");
  const processed=scored(reference,"I did authorize the payment on August 15 2026");
  const result=chooseMeasuredAsrSource(original,processed);
  assert.equal(processed.wer < original.wer,true);
  assert.equal(result.winner,"original");
  assert.ok(result.metrics.categoryRegressions.includes("negations"));
});

test("measured selector refuses comparisons against different references",()=>{
  assert.throws(()=>chooseMeasuredAsrSource(compareTranscripts("yes","yes"),compareTranscripts("no","no")),/same human reference/);
});

test("measured selector refuses candidates scored under different term group sets",()=>{
  const reference="No I did not authorize the payment on August 15 2026";
  const original=scored(reference,"No I did not authorize payment August fifty twenty six");
  const processed=scored(reference,"I did not authorize the payment on August 15 2026");
  assert.throws(()=>chooseMeasuredAsrSource(original,{...processed,termGroupSetVersion:"2.0.0"}),/same resolved term group set/);
  assert.throws(()=>chooseMeasuredAsrSource({...original,termGroupSetId:null},processed),/same resolved term group set/);
});
