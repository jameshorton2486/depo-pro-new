// Accepting one proposal used to invalidate every other proposal in the same pass.
//
// Measured against Production Trial #1: a pass produced 173 speaker-range proposals; accepting the
// first left 172 refused STALE_CORRECTION_PROPOSAL. One acceptance per pass run, by construction --
// accepting appends an overlay operation, the whole-state hash moves, and every pending proposal
// carries the hash from before it. Re-running the pass cost 195 seconds, so correcting by hand was
// roughly 580x faster than accepting AI proposals. A worklist that dies on first use is not one.
//
// The fix is NOT to decide a stale proposal is probably still fine. review-state-hash.mjs is right
// that this is a judgement about text the reporter has already altered. It is to ask a question
// that can be ANSWERED: have the words this proposal targets changed?
//
// That is decidable because of R2. A proposal may anchor only to a wordId -- segment anchors are
// refused -- and word ids come from immutable ASR evidence as `<job>:word:N`. They do not move when
// something elsewhere is split, joined or relabelled. So the target's identity is stable and only
// its state has to be checked.
import assert from "node:assert/strict";
import test from "node:test";
import { STALE_CORRECTION_PROPOSAL, assertProposalIsCurrent, computeAnchorStateHash, proposalAnchorProjection, proposalWordIds } from "../server/review-state-hash.mjs";

const word = (n, text, extra = {}) => ({ id: `job:word:${n}`, text, ...extra });
const segments = (overrides = {}) => ([
  { id: "s1", speakerIdentity: null, transcriptRole: null, words: [word(1, "Good"), word(2, "afternoon")], ...(overrides.s1 ?? {}) },
  { id: "s2", speakerIdentity: null, transcriptRole: null, words: [word(3, "Yes"), word(4, "ma'am")], ...(overrides.s2 ?? {}) },
  { id: "s3", speakerIdentity: null, transcriptRole: null, words: [word(5, "Thank"), word(6, "you")], ...(overrides.s3 ?? {}) },
]);

const anchorFor = (segs, proposal) => computeAnchorStateHash({ segments: segs, wordIds: proposalWordIds({ segments: segs, proposal }) });

test("a proposal targets its own words, and knows which they are", () => {
  const segs = segments();
  assert.deepEqual(proposalWordIds({ segments: segs, proposal: { wordId: "job:word:3", endWordId: "job:word:4" } }),
    ["job:word:3", "job:word:4"]);
  assert.deepEqual(proposalWordIds({ segments: segs, proposal: { wordId: "job:word:5" } }), ["job:word:5"]);
  assert.deepEqual(proposalWordIds({ segments: segs, proposal: { wordId: "job:word:99" } }), [], "an unknown anchor targets nothing");
});

test("an unrelated change elsewhere no longer kills a pending proposal", () => {
  // THE REGRESSION. Proposal targets words 3-4. Somebody accepts a change to word 6, three
  // segments away. The whole-state hash moves; this proposal's own words do not.
  const proposal = { wordId: "job:word:3", endWordId: "job:word:4" };
  const before = segments();
  const carried = anchorFor(before, proposal);

  const after = segments({ s3: { words: [word(5, "Thank"), word(6, "you,")], speakerIdentity: "attorney-1" } });
  const now = anchorFor(after, proposal);

  assert.equal(carried, now, "the targeted words are untouched, so the anchor state is unchanged");
  const verdict = assertProposalIsCurrent(
    { reviewStateHash: "hash-from-before", anchorStateHash: carried }, "hash-that-has-since-moved", { anchorStateHash: now });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.basis, "anchor-state", "accepted on the narrower proof, not on the whole-state hash");
});

test("a change to the proposal's own words still refuses", () => {
  const proposal = { wordId: "job:word:3", endWordId: "job:word:4" };
  const before = segments();
  const carried = anchorFor(before, proposal);

  for (const [label, after] of [
    ["text replaced", segments({ s2: { words: [word(3, "Yes"), word(4, "sir")] } })],
    ["word struck", segments({ s2: { words: [word(3, "Yes"), word(4, "ma'am", { struck: true })] } })],
    ["speaker already assigned", segments({ s2: { speakerIdentity: "witness-1", words: [word(3, "Yes"), word(4, "ma'am")] } })],
    ["role already assigned", segments({ s2: { transcriptRole: "A", words: [word(3, "Yes"), word(4, "ma'am")] } })],
    ["word deleted entirely", segments({ s2: { words: [word(3, "Yes")] } })],
  ]) {
    const now = anchorFor(after, proposal);
    assert.notEqual(carried, now, `${label}: the anchor state must change`);
    const verdict = assertProposalIsCurrent(
      { reviewStateHash: "before", anchorStateHash: carried }, "moved", { anchorStateHash: now });
    assert.equal(verdict.ok, false, label);
    assert.equal(verdict.code, STALE_CORRECTION_PROPOSAL, label);
  }
});

test("a vanished target is refused rather than silently ignored", () => {
  // A word struck out of existence leaves the projection entirely. If missing ids were dropped,
  // a proposal whose whole range was deleted would hash the same as one targeting nothing.
  const present = proposalAnchorProjection({ segments: segments(), wordIds: ["job:word:3", "job:word:4"] });
  const gone = proposalAnchorProjection({ segments: segments({ s2: { words: [] } }), wordIds: ["job:word:3", "job:word:4"] });
  assert.notDeepEqual(present, gone);
  assert.deepEqual(gone.missing, ["job:word:3", "job:word:4"], "absence is recorded, not skipped");
});

test("the whole-state hash still passes an unchanged transcript on its own", () => {
  const verdict = assertProposalIsCurrent({ reviewStateHash: "same" }, "same");
  assert.equal(verdict.ok, true);
  assert.equal(verdict.basis, "whole-state", "the existing fast path is unchanged and needs no anchor hash");
});

test("a proposal that committed to nothing gets the old strict verdict", () => {
  // No anchorStateHash means there is nothing to check against. Inventing one at acceptance time
  // would be deciding after the fact that the proposal was probably fine -- exactly the judgement
  // this design refuses to make.
  const verdict = assertProposalIsCurrent({ reviewStateHash: "before" }, "moved", { anchorStateHash: "anything" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, STALE_CORRECTION_PROPOSAL);
});

test("a proposal carrying no review-state hash at all is still refused", () => {
  const verdict = assertProposalIsCurrent({ anchorStateHash: "x" }, "current", { anchorStateHash: "x" });
  assert.equal(verdict.ok, false, "the pass must say what it analysed; an anchor alone is not provenance");
  assert.match(verdict.message, /carries no review-state hash/);
});

test("the many-proposal case, which is the point", () => {
  // Ten proposals across ten segments. Accepting one changes that one. The other nine must survive.
  const many = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`, speakerIdentity: null, transcriptRole: null,
    words: [word(i * 2 + 1, `word${i * 2 + 1}`), word(i * 2 + 2, `word${i * 2 + 2}`)],
  }));
  const proposals = many.map(segment => ({ wordId: segment.words[0].id, endWordId: segment.words[1].id }));
  const carried = proposals.map(p => anchorFor(many, p));

  // Accept the first: segment 0 gains a speaker identity.
  const after = many.map((segment, i) => i === 0 ? { ...segment, speakerIdentity: "witness-1" } : segment);

  const survivors = proposals.filter((p, i) => assertProposalIsCurrent(
    { reviewStateHash: "before", anchorStateHash: carried[i] }, "moved", { anchorStateHash: anchorFor(after, p) }).ok);

  assert.equal(survivors.length, 9, "nine unrelated proposals survive one acceptance");
  assert.equal(assertProposalIsCurrent(
    { reviewStateHash: "before", anchorStateHash: carried[0] }, "moved", { anchorStateHash: anchorFor(after, proposals[0]) }).ok,
    false, "and the one that was acted on is correctly spent");
});
