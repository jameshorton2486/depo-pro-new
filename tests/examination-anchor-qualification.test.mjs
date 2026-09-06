// Is an ASR word id a sufficient anchor for an examination boundary? Phase A of §246.
//
// The design proposes anchoring a boundary to an `asrWordId` rather than inventing a locator. That
// is a claim about durability, and a claim about durability is worth testing before a persisted
// operation is built on it. If the anchor moves, drifts, or silently resolves to the wrong place
// after ordinary reporter editing, the whole model is wrong and Phase B should not start.
//
// The property under test is narrow and specific: a word id chosen before editing must still
// identify the same position in the transcript afterwards, and must fail visibly rather than
// quietly when the word it names is gone.
//
// No production code is touched. This qualifies a design decision; it does not implement one.
import assert from "node:assert/strict";
import test from "node:test";
import { appendTransaction, applyOverlay, emptyOverlay } from "../server/reporter-overlay.mjs";
import { EVIDENCE, WORKING } from "./fixtures/etminan-evidence.mjs";

const overlayWith = (...operations) => appendTransaction(emptyOverlay("DEP-ANCHOR"), operations);
const order = result => result.segments.flatMap(segment => segment.asrWordIds);
const wordsOf = index => WORKING.segments[index].asrWordIds;

// The word a boundary would anchor to: the first evidence word of the paragraph where an
// examination changes hands. Chosen the way the design says the control would choose it.
const ANCHOR = wordsOf(4)[0];

test("the anchor is deterministic, and is a real evidence word", () => {
  assert.match(ANCHOR, /^job[0-9a-f]+:word:\d+$/, "anchors are the ids the raw response produced");
  assert.ok(EVIDENCE.words.some(word => word.id === ANCHOR), "the anchor names a word that exists in evidence");
  // Re-deriving from the fixture gives the same id, because ids come from the response, not a counter.
  assert.equal(WORKING.segments[4].asrWordIds[0], ANCHOR);
});

test("an anchor survives a correction to the word it names", () => {
  // Replacing a word does not remove it. The overlay records a correction over preserved evidence,
  // so the anchor still resolves -- which is what lets a boundary sit on a word the reporter later
  // fixes the spelling of.
  const result = applyOverlay(WORKING.segments, overlayWith({ op: "replace", wordId: ANCHOR, text: "Corrected" }));
  assert.ok(order(result).includes(ANCHOR), "a corrected word is still the same word");
  assert.equal(result.replaced.get(ANCHOR), "Corrected");
  assert.equal(result.orphaned.length, 0);
});

test("an anchor survives edits to its neighbours, and keeps its position", () => {
  const before = order(applyOverlay(WORKING.segments, emptyOverlay("x")));
  const positionBefore = before.indexOf(ANCHOR);

  const neighbour = wordsOf(3).at(-1);
  const result = applyOverlay(WORKING.segments, overlayWith(
    { op: "replace", wordId: neighbour, text: "Adjusted" },
    { op: "insert", afterWordId: neighbour, text: "inserted" },
  ));
  const after = order(result);
  assert.ok(after.includes(ANCHOR));
  assert.equal(after.indexOf(ANCHOR), positionBefore,
    "reporter-authored text is inserted beside evidence, not into the evidence order");
  assert.equal(result.orphaned.length, 0);
});

test("an anchor survives the paragraph around it being split", () => {
  // The transition paragraph is the likeliest one to be split, because a handover often shares a
  // paragraph with the words before it. The word keeps its identity; only the segment id changes.
  const later = wordsOf(4)[1];
  const result = applyOverlay(WORKING.segments, overlayWith({ op: "split", beforeWordId: later }));
  assert.ok(order(result).includes(ANCHOR), "splitting the paragraph does not consume the anchor");
  const holder = result.segments.find(segment => segment.asrWordIds.includes(ANCHOR));
  assert.equal(holder.asrWordIds[0], ANCHOR, "the anchor still begins its paragraph");
  assert.equal(result.orphaned.length, 0);
});

test("splitting before the anchor is refused, because the paragraph already begins there", () => {
  // Not a defect, and worth knowing before a control offers it: a boundary anchored to the first
  // word of a paragraph cannot be split away from it, because there is nothing to split.
  const result = applyOverlay(WORKING.segments, overlayWith({ op: "split", beforeWordId: ANCHOR }));
  assert.equal(result.orphaned.length, 1);
  assert.equal(result.orphaned[0].reason, "SPLIT_AT_SEGMENT_START");
});

test("an anchor survives a deletion elsewhere in the same paragraph", () => {
  const sibling = wordsOf(4).at(-1);
  assert.notEqual(sibling, ANCHOR, "the fixture paragraph must have more than one word for this to mean anything");
  const result = applyOverlay(WORKING.segments, overlayWith({ op: "delete", wordId: sibling }));
  assert.ok(order(result).includes(ANCHOR));
  assert.equal(result.orphaned.length, 0);
});

test("striking the anchored word does not move the anchor, because evidence is not removed", () => {
  // The failure mode I expected, and the better answer the architecture actually gives. Deleting a
  // word strikes it from the authoritative transcript; it stays in the evidence order, marked. So
  // a boundary anchored to a struck word still resolves to the same position rather than sliding
  // to a neighbour -- which would move an examination's start without anyone deciding to.
  const result = applyOverlay(WORKING.segments, overlayWith({ op: "delete", wordId: ANCHOR }));
  assert.equal(result.deleted.has(ANCHOR), true, "the word is struck from the transcript");
  assert.ok(order(result).includes(ANCHOR), "and kept in the evidence order, so the anchor still resolves");
  assert.equal(result.orphaned.length, 0, "no orphan, because nothing was lost");
});

test("reconstruction is deterministic, so an anchor resolves the same way on every reload", () => {
  // A boundary is only durable if the projection it resolves against is reproducible. Two runs
  // over identical input must place the anchor identically, or a reload could move an examination.
  const overlay = overlayWith({ op: "replace", wordId: wordsOf(2)[0], text: "Changed" });
  const first = order(applyOverlay(WORKING.segments, overlay));
  const second = order(applyOverlay(WORKING.segments, overlay));
  assert.deepEqual(first, second);
  assert.equal(first.indexOf(ANCHOR), second.indexOf(ANCHOR));
});

test("the identity a boundary should name is the canonical one, not the diarization one", () => {
  // Q2 of the design questions, asserted from the fixture rather than argued. A segment carries
  // both: speakerIdentity is the canonical counsel id the record holds, deepgramSpeaker is the
  // transient index the recogniser assigned. Only the former survives re-transcription.
  const segment = WORKING.segments.find(item => item.transcriptRole === "QUESTIONING_ATTORNEY");
  assert.match(segment.speakerIdentity, /^counsel-/, "the durable identity is a canonical counsel id");
  assert.equal(typeof segment.deepgramSpeaker, "number", "the diarization identity is a positional index");
  assert.notEqual(segment.speakerIdentity, String(segment.deepgramSpeaker),
    "they are different values, and a boundary naming the wrong one would break on re-transcription");
});
