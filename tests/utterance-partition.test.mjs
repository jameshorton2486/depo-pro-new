import assert from "node:assert/strict";
import test from "node:test";
import { assignWordsToUtterances } from "../server/transcription-jobs.mjs";

// The fixture's whole point is word w3: it starts inside utterance A and ends inside B. Without
// a straddling word the partition assertion is vacuous -- every word falls cleanly in one
// utterance and an overlap predicate and a partition are indistinguishable.
const UTTERANCES = [
  { start:0.0, end:2.0, transcript:"one two three" },
  { start:2.0, end:4.0, transcript:"four five" },
  { start:4.0, end:6.0, transcript:"six" },
];
const WORDS = [
  { id:"w1", start:0.10, end:0.60 },
  { id:"w2", start:0.70, end:1.40 },
  { id:"w3", start:1.80, end:2.40 }, // straddles the A/B boundary at 2.0
  { id:"w4", start:2.50, end:3.10 },
  { id:"w5", start:3.20, end:3.90 },
  { id:"w6", start:4.30, end:5.00 },
];

test("the fixture actually contains a straddling word",()=>{
  const straddler = WORDS.find(word => word.start < UTTERANCES[0].end && word.end > UTTERANCES[1].start);
  assert.ok(straddler,"without this the partition test proves nothing");
  assert.equal(straddler.id,"w3");
});

test("every word is claimed by exactly one utterance",()=>{
  const assigned = assignWordsToUtterances(UTTERANCES, WORDS);
  const all = assigned.flat();
  assert.equal(all.length, new Set(all).size, `a word was claimed twice: ${JSON.stringify(assigned)}`);
  assert.deepEqual([...all].sort(), WORDS.map(word => word.id).sort(), "every word must be claimed exactly once");
});

test("a straddling word goes to the earlier utterance, not both and not neither",()=>{
  const assigned = assignWordsToUtterances(UTTERANCES, WORDS);
  assert.ok(assigned[0].includes("w3"),"first match in document order keeps it with the utterance that began earlier");
  assert.equal(assigned[1].includes("w3"),false);
  assert.deepEqual(assigned,[["w1","w2","w3"],["w4","w5"],["w6"]]);
});

test("assignment is deterministic across runs",()=>{
  const first = assignWordsToUtterances(UTTERANCES, WORDS);
  const second = assignWordsToUtterances(UTTERANCES, WORDS);
  assert.deepEqual(first, second);
});

test("utterance boundaries are untouched",()=>{
  const before = JSON.stringify(UTTERANCES);
  assignWordsToUtterances(UTTERANCES, WORDS);
  assert.equal(JSON.stringify(UTTERANCES), before, "assignment must not mutate the utterances it reads");
});

test("words with no timing are skipped rather than mis-assigned",()=>{
  const assigned = assignWordsToUtterances(UTTERANCES,[...WORDS,{ id:"wx", start:null, end:null }]);
  assert.equal(assigned.flat().includes("wx"),false);
});

test("a word outside every utterance is claimed by none",()=>{
  // Not an error here -- the render layer reports it as EVIDENCE_NOT_RENDERED, which is where
  // it belongs. What matters is that it is not silently forced into an adjacent utterance.
  const assigned = assignWordsToUtterances(UTTERANCES,[...WORDS,{ id:"late", start:9.0, end:9.5 }]);
  assert.equal(assigned.flat().includes("late"),false);
});

test("open-ended utterances still partition",()=>{
  const open = [{ start:null, end:null, transcript:"everything" },{ start:0, end:1, transcript:"also everything" }];
  const assigned = assignWordsToUtterances(open, WORDS);
  assert.deepEqual(assigned[0], WORDS.map(word => word.id),"a boundless utterance claims what it overlaps");
  assert.deepEqual(assigned[1],[],"and leaves nothing for the next");
});
