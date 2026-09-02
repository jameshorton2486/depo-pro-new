// The model proposes a fact; the server plans the mutation.
//
// The existing speaker pass can say "this Deepgram cluster is this person" and nothing else. The
// first real deposition broke that in both directions on its first pass: one cluster held the witness
// and counsel, and one witness utterance was mis-diarized into a cluster whose other utterances are
// still unidentified. Neither is expressible as a whole-cluster fact.
//
// So a proposal now carries a word range. `label` addresses a whole segment, though, so a range that
// does not line up with segment edges needs those edges cut first -- and `split` is what cuts them.
// Deciding which operations to emit is mechanics, and mechanics stay out of the prompt: a model
// choosing its own overlay operations is a model choosing how the record is written.
//
// The tests below are the shapes a range can take. The dangerous direction throughout is a plan that
// covers MORE words than the reporter accepted, because that puts a person's name on speech they did
// not make.
import assert from "node:assert/strict";
import test from "node:test";
import { planRangeAcceptance } from "../server/range-acceptance-planner.mjs";
import { applyOverlay, emptyOverlay } from "../server/reporter-overlay.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const JOB = "job1";
const w = n => `${JOB}:word:${n}`;
// Two segments, five words each, spoken by cluster 7 and attributed to nobody yet.
const segments = () => [
  { id:"seg-a", sourceJobIdentity:JOB, sourceUploadId:"up1", deepgramSpeaker:7, speakerIdentity:null, transcriptRole:null,
    asrWordIds:[w(1), w(2), w(3), w(4), w(5)], text:"one two three four five", start:0, end:5 },
  { id:"seg-b", sourceJobIdentity:JOB, sourceUploadId:"up1", deepgramSpeaker:7, speakerIdentity:null, transcriptRole:null,
    asrWordIds:[w(6), w(7), w(8), w(9), w(10)], text:"six seven eight nine ten", start:5, end:10 },
  // A third segment, because a range crossing only two never has a MIDDLE segment to cover. Without
  // it, a planner that skipped every middle passed the whole suite.
  { id:"seg-c", sourceJobIdentity:JOB, sourceUploadId:"up1", deepgramSpeaker:7, speakerIdentity:null, transcriptRole:null,
    asrWordIds:[w(11), w(12), w(13), w(14), w(15)], text:"eleven twelve thirteen fourteen fifteen", start:10, end:15 },
];
const WITNESS = { speakerIdentity:"witness", transcriptRole:"WITNESS" };
const plan = (range) => planRangeAcceptance(segments(), { ...WITNESS, ...range });

// Applies a plan as one transaction and reports which words ended up attributed to the witness.
function wordsGivenToWitness(operations) {
  const result = applyOverlay(segments(), { ...emptyOverlay("DEP-TEST"), operations });
  assert.deepEqual(result.orphaned, [], `no operation may orphan: ${JSON.stringify(result.orphaned)}`);
  return result.segments.filter(s => s.speakerIdentity === "witness").flatMap(s => s.asrWordIds);
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => w(from + i));

// --- the shapes a range can take ---------------------------------------------------------------

test("a range that is exactly one segment is one label", () => {
  const { ok, operations } = plan({ startWordId:w(1), endWordId:w(5) });
  assert.equal(ok, true);
  assert.deepEqual(operations, [{ op:"label", wordId:w(1), ...WITNESS }]);
  assert.deepEqual(wordsGivenToWitness(operations), range(1, 5), "and no boundary the reporter did not ask for");
});

test("a range ending at a segment's end is one split carrying the speaker", () => {
  const { ok, operations } = plan({ startWordId:w(3), endWordId:w(5) });
  assert.equal(ok, true);
  assert.deepEqual(operations, [{ op:"split", beforeWordId:w(3), ...WITNESS }]);
  assert.deepEqual(wordsGivenToWitness(operations), range(3, 5));
});

test("a range starting at a segment's start cuts the far edge before it labels", () => {
  // Labelling first would put the speaker on the whole segment, and the split would then carry it
  // into the tail -- silently widening the accepted range. Order is the correctness here. The cut
  // carries no speaker on purpose: an omitted speaker means the remainder inherits what it had.
  const { ok, operations } = plan({ startWordId:w(1), endWordId:w(3) });
  assert.equal(ok, true);
  assert.deepEqual(operations, [
    { op:"split", beforeWordId:w(4) },
    { op:"label", wordId:w(1), ...WITNESS },
  ]);
  assert.deepEqual(wordsGivenToWitness(operations), range(1, 3), "words 4 and 5 keep the speaker they had");
});

test("a range inside a segment cuts both edges", () => {
  const { ok, operations } = plan({ startWordId:w(2), endWordId:w(4) });
  assert.equal(ok, true);
  // Far edge first, and this order is a measured correctness requirement rather than a preference.
  // A split's speaker is optional and an omitted one means INHERIT, so there is no way to say "the
  // remainder goes back to what it was". Cutting the near edge first gave the witness the whole tail
  // and the second cut inherited it -- word 5 was attributed to her when words 2 to 4 were accepted.
  assert.deepEqual(operations, [
    { op:"split", beforeWordId:w(5) },
    { op:"split", beforeWordId:w(2), ...WITNESS },
  ]);
  assert.deepEqual(wordsGivenToWitness(operations), range(2, 4), "word 1 before it and word 5 after it are untouched");
});

test("a range crossing a segment boundary covers both parts and nothing else", () => {
  const { ok, operations } = plan({ startWordId:w(4), endWordId:w(7) });
  assert.equal(ok, true);
  assert.deepEqual(wordsGivenToWitness(operations), range(4, 7));
});

test("a range covering whole segments end to end", () => {
  const { ok, operations } = plan({ startWordId:w(1), endWordId:w(15) });
  assert.equal(ok, true);
  assert.deepEqual(wordsGivenToWitness(operations), range(1, 15));
});

test("a segment wholly inside a crossing range is covered too", () => {
  // The middle. A planner that walked only the first and last segments of a crossing range left this
  // one attributed to nobody, and the whole suite passed because the fixture had no middle.
  const { ok, operations } = plan({ startWordId:w(3), endWordId:w(13) });
  assert.equal(ok, true);
  assert.deepEqual(wordsGivenToWitness(operations), range(3, 13));
  assert.ok(operations.some(item => item.op === "label" && item.wordId === w(6)),
    "the middle segment is labelled whole rather than split");
});

test("a single word is a range of one", () => {
  // The Trial #1 shape: one short utterance mis-diarized into somebody else's cluster.
  const { ok, operations } = plan({ startWordId:w(3), endWordId:w(3) });
  assert.equal(ok, true);
  assert.deepEqual(wordsGivenToWitness(operations), [w(3)]);
});

test("a single word at a segment's start, and at its end", () => {
  assert.deepEqual(wordsGivenToWitness(plan({ startWordId:w(1), endWordId:w(1) }).operations), [w(1)]);
  assert.deepEqual(wordsGivenToWitness(plan({ startWordId:w(5), endWordId:w(5) }).operations), [w(5)]);
});

// --- what it refuses ------------------------------------------------------------------------------

test("a range it cannot place is refused rather than approximated", () => {
  assert.equal(plan({ startWordId:w(99), endWordId:w(3) }).reason, "START_WORD_NOT_FOUND");
  assert.equal(plan({ startWordId:w(1), endWordId:w(99) }).reason, "END_WORD_NOT_FOUND");
  assert.equal(plan({ startWordId:w(4), endWordId:w(2) }).reason, "END_PRECEDES_START");
  assert.equal(plan({ startWordId:w(8), endWordId:w(3) }).reason, "END_PRECEDES_START", "across segments too");
  assert.equal(planRangeAcceptance(segments(), { startWordId:w(1), endWordId:w(2) }).reason, "SPEAKER_REQUIRED");
  assert.equal(plan({ startWordId:w(1) }).reason, "RANGE_INCOMPLETE");
});

// --- what must never happen ------------------------------------------------------------------------

test("no plan ever attributes a word outside the accepted range", () => {
  // The failure this layer exists to prevent, checked exhaustively over every range in the fixture.
  for (let from = 1; from <= 15; from += 1) {
    for (let to = from; to <= 15; to += 1) {
      const { ok, operations } = plan({ startWordId:w(from), endWordId:w(to) });
      assert.equal(ok, true, `${from}..${to} must be plannable`);
      assert.deepEqual(wordsGivenToWitness(operations), range(from, to), `${from}..${to}`);
    }
  }
});

test("the evidence is never rewritten", () => {
  const before = JSON.stringify(segments());
  const input = segments();
  const { operations } = planRangeAcceptance(input, { startWordId:w(2), endWordId:w(4), ...WITNESS });
  assert.equal(JSON.stringify(input), before, "planning reads and does not mutate");
  const result = applyOverlay(input, { ...emptyOverlay("DEP-TEST"), operations });
  for (const segment of result.segments) {
    assert.equal(segment.deepgramSpeaker, 7, "the diarization cluster survives under the correction");
    assert.equal(segment.sourceJobIdentity, JOB);
  }
  const ids = result.segments.flatMap(s => s.asrWordIds);
  assert.deepEqual(ids, range(1, 15), "every word id, in order, exactly once");
});

test("the plan emits only operations that already exist", () => {
  const permitted = new Set(["label", "split"]);
  for (let from = 1; from <= 15; from += 1) {
    for (let to = from; to <= 15; to += 1) {
      for (const operation of plan({ startWordId:w(from), endWordId:w(to) }).operations) {
        assert.ok(permitted.has(operation.op), `${operation.op} is not an existing operation`);
      }
    }
  }
});

// --- the regression that matters ------------------------------------------------------------------

test("a corrected speaker still derives its own designation, with nothing asserting it", async () => {
  // The point of the whole architecture, and the thing Trial #1 proved by hand at 78:52: correct WHO
  // spoke and the existing label model produces A. on its own. No proposal says "this is an answer",
  // no operation carries an elementType, and labelParagraphs is untouched by this work.
  //
  // Built from the shipped fixture with one segment's identity removed, which is the shape a
  // mis-diarized utterance takes: words the record holds, attributed to nobody.
  const { EVIDENCE, SPEAKER_CANDIDATES, WORKING } = await import("./fixtures/etminan-evidence.mjs");
  const stripped = WORKING.segments.map((segment, index) => index === 3
    ? { ...segment, speakerIdentity:null, transcriptRole:null, asrWordIds:[...segment.asrWordIds] }
    : { ...segment, asrWordIds:[...segment.asrWordIds] });
  const answer = stripped[3];

  const render = overlay => renderTranscript({
    working:{ ...WORKING, segments:stripped }, evidence:[EVIDENCE],
    speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay,
  });
  const paragraphOf = result => result.paragraphs.find(item => (item.asrWordIds ?? []).includes(answer.asrWordIds[0]));

  const before = paragraphOf(render({ ...emptyOverlay("DEP-TEST"), operations:[] }));
  assert.notEqual(before.label, "A.", "the fixture must start unattributed for this to prove anything");

  const { ok, operations } = planRangeAcceptance(stripped, {
    startWordId:answer.asrWordIds[0], endWordId:answer.asrWordIds.at(-1),
    speakerIdentity:"witness", transcriptRole:"WITNESS",
  });
  assert.equal(ok, true);
  for (const operation of operations) assert.equal("elementType" in operation, false, "no operation asserts what kind of utterance this is");

  const after = paragraphOf(render({ ...emptyOverlay("DEP-TEST"), operations }));
  assert.equal(after.label, "A.", "the existing label model derived the designation from the accepted speaker");
  assert.equal(after.speakerIdentity, "witness");
  assert.equal(after.deepgramSpeaker, answer.deepgramSpeaker, "and the diarization cluster still shows what the machine thought");
});
