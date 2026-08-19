import assert from "node:assert/strict";
import test from "node:test";
import { applyOverlay, appendOperations, emptyOverlay, undoLast } from "../server/reporter-overlay.mjs";
import { computeReviewStateHash, reviewStateProjection, assertProposalIsCurrent, STALE_CORRECTION_PROPOSAL } from "../server/review-state-hash.mjs";

const WORD = n => `job:word:${n}`;
const transcript = (overrides = {}) => ({
  schemaVersion: "1.1.0",
  transcript_hash: "stored-projection-hash",
  speakerMap: {
    status: "reconciled",
    reconciledAt: "2026-08-18T09:00:00.000Z",
    assignments: [
      { sourceJobIdentity: "job", deepgramSpeaker: 0, speakerIdentity: "witness", transcriptRole: "WITNESS" },
      { sourceJobIdentity: "job", deepgramSpeaker: 1, speakerIdentity: "attorney-1", transcriptRole: "QUESTIONING_ATTORNEY" },
    ],
  },
  segments: [{ id: "job:segment:1", asrWordIds: [WORD(1), WORD(2), WORD(3)] }],
  ...overrides,
});
const overlayOf = (...operations) => ({ ...emptyOverlay("DEP"), operations });
const hash = (transcriptValue, overlay) => computeReviewStateHash({ transcript: transcriptValue, overlay });

test("1 — the same transcript, speaker map and overlay hash the same",()=>{
  const overlay = overlayOf({ op: "replace", wordId: WORD(2), text: "corrected" });
  assert.equal(hash(transcript(), overlay), hash(transcript(), overlay));
});

test("2 — key ordering cannot change the hash",()=>{
  // The failure this prevents is a hash that depends on how an object was built rather than what
  // it says: the same state loaded from disk and constructed in memory must agree.
  const ordered = { op: "replace", wordId: WORD(2), text: "corrected" };
  const reversed = { text: "corrected", wordId: WORD(2), op: "replace" };
  assert.equal(hash(transcript(), overlayOf(ordered)), hash(transcript(), overlayOf(reversed)));

  const flipped = transcript();
  flipped.speakerMap = { assignments: flipped.speakerMap.assignments, reconciledAt: flipped.speakerMap.reconciledAt, status: flipped.speakerMap.status };
  assert.equal(hash(flipped, overlayOf(ordered)), hash(transcript(), overlayOf(ordered)));
});

for (const [name, operation] of [
  ["3 — replace",  { op: "replace", wordId: WORD(2), text: "corrected" }],
  ["4 — delete",   { op: "delete", wordId: WORD(2) }],
  ["5 — insert",   { op: "insert", afterWordId: WORD(2), text: "added" }],
  ["6 — split",    { op: "split", segmentId: null, beforeWordId: WORD(2) }],
  ["7 — label",    { op: "label", wordId: WORD(2), speakerIdentity: "attorney-1", transcriptRole: "QUESTIONING_ATTORNEY" }],
]) {
  test(`${name} changes the hash`,()=>{
    // Every operation type can change what a correction targets, so every one must invalidate.
    assert.notEqual(hash(transcript(), overlayOf(operation)), hash(transcript(), emptyOverlay("DEP")));
  });
}

test("8 — a changed speaker assignment changes the hash",()=>{
  const moved = transcript();
  moved.speakerMap.assignments[1].speakerIdentity = "attorney-2";
  assert.notEqual(hash(moved, emptyOverlay("DEP")), hash(transcript(), emptyOverlay("DEP")));
});

test("9 — reconciliation timestamps alone do not change the hash",()=>{
  // Reconciling writes a fresh reconciledAt every time. If that were covered, re-saving an
  // unchanged speaker map would invalidate every proposal in flight for no semantic reason.
  const later = transcript();
  later.speakerMap.reconciledAt = "2026-12-25T23:59:59.000Z";
  later.updatedAt = "2026-12-25T23:59:59.000Z";
  assert.equal(hash(later, emptyOverlay("DEP")), hash(transcript(), emptyOverlay("DEP")));
});

test("10 — metadata that cannot change the correction target does not change the hash",()=>{
  // Covered by omission rather than by a filter: the projection names the fields that decide what
  // an operation does, so anything an implementation adds later is excluded without maintenance.
  const decorated = overlayOf({ op: "replace", wordId: WORD(2), text: "corrected", author: "reporter", clientTime: "2026-08-18T09:00:00Z", note: "typo" });
  const plain = overlayOf({ op: "replace", wordId: WORD(2), text: "corrected" });
  assert.equal(hash(transcript(), decorated), hash(transcript(), plain));

  const extra = transcript({ recordType: "WORKING_TRANSCRIPT", derivedFrom: ["job"] });
  assert.equal(hash(extra, plain), hash(transcript(), plain));
});

test("11 — the hash is taken over inputs, never over rendered text",()=>{
  // Rendered text carries style: April 24, 2026 for 04/24/2026. Hashing it would make an edit to
  // transcript-style.mjs invalidate every proposal in flight, for every deposition.
  const projection = reviewStateProjection({ transcript: transcript(), overlay: overlayOf({ op: "replace", wordId: WORD(2), text: "corrected" }) });
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes("April"), false);
  assert.deepEqual(Object.keys(projection).sort(), ["overlay", "schemaVersion", "speakerMap", "transcriptContentHash"]);
  assert.equal(projection.transcriptContentHash, "stored-projection-hash", "the stored projection identity is an input, not a replacement");
});

test("12 — a proposal generated against an earlier state is refused",()=>{
  const before = hash(transcript(), emptyOverlay("DEP"));
  const after = hash(transcript(), overlayOf({ op: "delete", wordId: WORD(2) }));
  assert.notEqual(before, after);

  const proposal = { reviewStateHash: before, wordId: WORD(3), text: "Bardot" };
  const verdict = assertProposalIsCurrent(proposal, after);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, STALE_CORRECTION_PROPOSAL);
  assert.equal(verdict.carried, before);
  assert.equal(verdict.expected, after);
  assert.equal(assertProposalIsCurrent(proposal, before).ok, true, "and accepted against the state it was made for");
  assert.equal(assertProposalIsCurrent({ wordId: WORD(3) }, after).ok, false, "a proposal with no hash cannot establish its state");
});

test("13 — undoing an edit returns the hash to what it was",()=>{
  // The characterisation test. An overlay is an ordered list and undo is a pop, so this asks
  // whether the hash represents semantic review state or incidental history. If it represented
  // history, a state reached by edit-then-undo would differ from the state never edited.
  const empty = emptyOverlay("DEP");
  const before = hash(transcript(), empty);
  const edited = appendOperations(empty, [{ op: "replace", wordId: WORD(2), text: "corrected" }]);
  assert.notEqual(hash(transcript(), edited), before);
  const { overlay: undone } = undoLast(edited);
  assert.equal(hash(transcript(), undone), before, "the hash must return exactly, not merely become valid again");
});

test("14 — reopening an unmodified deposition produces the same hash",()=>{
  // Nothing about reading a transcript may change its identity: a hash that moved on open would
  // invalidate every proposal the moment a reporter looked at the deposition.
  const overlay = overlayOf({ op: "split", segmentId: null, beforeWordId: WORD(2) }, { op: "label", wordId: WORD(2), speakerIdentity: "witness", transcriptRole: "WITNESS" });
  const first = hash(transcript(), overlay);
  const reopened = hash(JSON.parse(JSON.stringify(transcript())), JSON.parse(JSON.stringify(overlay)));
  assert.equal(reopened, first);
});

test("operation order is meaning, and is never canonicalised away",()=>{
  // A split before a label targets a different segment than a label before a split. Sorting the
  // operations would make two different transcripts hash identically, which is the precise
  // failure this whole mechanism exists to prevent.
  const split = { op: "split", segmentId: null, beforeWordId: WORD(2) };
  const label = { op: "label", wordId: WORD(2), speakerIdentity: "witness", transcriptRole: "WITNESS" };
  assert.notEqual(hash(transcript(), overlayOf(split, label)), hash(transcript(), overlayOf(label, split)));
});

test("the overlay contribution is real: two overlays that differ produce different renders",()=>{
  // Guards the guard. If applyOverlay ignored these operations the hash could still differ while
  // meaning nothing, so the operations are confirmed to actually change the transcript.
  const segments = [{ id: "job:segment:1", sourceJobIdentity: "job", asrWordIds: [WORD(1), WORD(2), WORD(3)], text: "a b c", deepgramSpeaker: 0 }];
  const known = new Set([WORD(1), WORD(2), WORD(3)]);
  const plain = applyOverlay(segments, emptyOverlay("DEP"), { knownWordIds: known });
  const edited = applyOverlay(segments, overlayOf({ op: "delete", wordId: WORD(2) }), { knownWordIds: known });
  assert.equal(plain.deleted.size, 0);
  assert.equal(edited.deleted.size, 1);
});
