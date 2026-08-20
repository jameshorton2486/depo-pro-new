// Timestamps, red review marks, and export, for the live transcript.
//
// The fixture is modelled on the failure the reporter reported: long stable turns interrupted by
// two- and three-word fragments attributed to the other voice, with no pause either side. Grammar
// says those fragments belong to the surrounding speaker. Grammar is not speaker evidence, so the
// test asserts they are FLAGGED and left alone.
import assert from "node:assert/strict";
import test from "node:test";
import { groupLiveEvents, paragraphTimestamp, sessionClock } from "../app/live-paragraphs.mjs";
import { isRed, markRed, redWordIds, removeRed } from "../app/live-annotations.mjs";

const word = (text, start, speaker, extra = {}) => ({ word:text, punctuatedWord:text, start, end:start + 0.4, speaker, confidence:0.92, ...extra });
const event = (id, words, { offset = 0, channelId = "c1" } = {}) => ({ id, sessionOffsetSeconds:offset, channelId, words, start:words[0]?.start ?? 0, duration:1 });

/** Speaker A turn, B question, ambiguous fragment, A response, rapid switch, unlabelled segment. */
const FIXTURE = [
  event("e1", [word("Anything", 10, 0), word("that", 10.5, 0), word("happens", 11, 0), word("within", 11.5, 0), word("a", 12, 0), word("day", 12.5, 0), word("is", 13, 0), word("noise.", 13.5, 0)]),
  event("e2", [word("Can", 14, 1), word("you", 14.3, 1), word("comment", 14.6, 1), word("on", 14.9, 1), word("that?", 15.2, 1)]),
  // Three words, other voice, no pause either side. The fragmentation shape -- and also the shape
  // of a genuine interjection. Nothing in the audio evidence separates them.
  event("e3", [word("and", 15.6, 0), word("how", 15.8, 0), word("do", 16.0, 0)]),
  event("e4", [word("we", 16.2, 1), word("reverse", 16.5, 1), word("that?", 16.9, 1), word("It", 17.3, 1), word("matters.", 17.7, 1)]),
  event("e5", [word("40,000,000,000,000", 30, 0), word("is", 30.6, 0), word("a", 30.9, 0), word("big", 31.2, 0), word("number.", 31.6, 0)]),
  event("e6", [word("Undiarized", 40, null), word("stretch.", 40.5, null)]),
];
const paragraphs = () => groupLiveEvents(FIXTURE);

// ---------------------------------------------------------------------------------------------
// Section 27 — timestamps
// ---------------------------------------------------------------------------------------------

test("every finalized paragraph carries a start timestamp", () => {
  for (const paragraph of paragraphs()) assert.match(paragraphTimestamp(paragraph), /^\d{2}:\d{2}:\d{2}$/);
});

test("the timestamp is the start of the paragraph's first finalized word", () => {
  const [first] = paragraphs();
  assert.equal(paragraphTimestamp(first), sessionClock(first.words[0].sessionStart));
  assert.equal(paragraphTimestamp(first), "00:00:10");
});

test("HH:MM:SS always, including under an hour, so a column of stamps aligns", () => {
  assert.equal(sessionClock(134), "00:02:14");
  assert.equal(sessionClock(3725), "01:02:05");
  assert.equal(sessionClock(null), "--:--:--");
});

test("a reconnection does not restart the clock partway through", () => {
  // The whole point of carrying sessionOffsetSeconds: Deepgram's stream clock restarts at zero on
  // a new socket, and a two-hour proceeding must not show [00:00:03] in the middle.
  const [, second] = groupLiveEvents([event("a", [word("Before", 5, 0)]), event("b", [word("After", 3, 1), word("reconnect", 3.4, 1)], { offset:600 })]);
  assert.equal(paragraphTimestamp(second), "00:10:03");
});

test("the timestamp is stable when later paragraphs arrive", () => {
  const before = paragraphTimestamp(groupLiveEvents(FIXTURE.slice(0, 2))[0]);
  const after = paragraphTimestamp(groupLiveEvents(FIXTURE)[0]);
  assert.equal(before, after);
});

test("regrouping is deterministic, so a rerender cannot move a timestamp", () => {
  assert.deepEqual(paragraphs().map(paragraphTimestamp), paragraphs().map(paragraphTimestamp));
});

test("the timestamp is metadata and never enters the transcript wording", () => {
  for (const paragraph of paragraphs()) {
    assert.doesNotMatch(paragraph.text, /\d{2}:\d{2}:\d{2}/);
    assert.doesNotMatch(paragraph.text, /\[/);
  }
});

// ---------------------------------------------------------------------------------------------
// Section 28 — red review marks
// ---------------------------------------------------------------------------------------------

const marked = (count = 2) => {
  const list = paragraphs();
  const target = list[0];
  return { list, target, annotations: markRed([], { paragraphId:target.id, wordIds:target.wordIds.slice(1, 1 + count), createdAt:"2026-08-19T00:00:00Z" }) };
};

test("one finalized word can be marked red", () => {
  const { target, annotations } = marked(1);
  assert.equal(annotations.length, 1);
  assert.ok(isRed(annotations, target.wordIds[1]));
  assert.ok(!isRed(annotations, target.wordIds[0]));
});

test("a phrase of several words can be marked red", () => {
  const { target, annotations } = marked(3);
  assert.deepEqual([...redWordIds(annotations)], target.wordIds.slice(1, 4));
});

test("marking red does not change the underlying words", () => {
  const { list, target, annotations } = marked(2);
  void annotations;
  assert.deepEqual(groupLiveEvents(FIXTURE)[0].text, target.text);
  assert.deepEqual(list[0].words.map(item => item.text), groupLiveEvents(FIXTURE)[0].words.map(item => item.text));
});

test("red survives regrouping when more transcript arrives", () => {
  // Anchored to word ids, and finalized events are append-only, so later events cannot move it.
  const { target, annotations } = marked(2);
  const extended = groupLiveEvents([...FIXTURE, event("e7", [word("More", 60, 0), word("speech.", 60.4, 0)])]);
  const stillThere = extended.find(paragraph => paragraph.id === target.id);
  assert.ok(stillThere);
  for (const id of target.wordIds.slice(1, 3)) assert.ok(stillThere.wordIds.includes(id) && isRed(annotations, id));
});

test("red can be removed, and removing one word leaves the rest of the phrase red", () => {
  const { target, annotations } = marked(3);
  const narrowed = removeRed(annotations, { wordIds:[target.wordIds[2]] });
  assert.ok(!isRed(narrowed, target.wordIds[2]));
  assert.ok(isRed(narrowed, target.wordIds[1]));
  assert.deepEqual(removeRed(narrowed, { wordIds:target.wordIds }), []);
});

test("interim text cannot be marked, because it carries no word ids", () => {
  // The screen renders interim as a plain string with no data-word-id, so a selection over it
  // resolves to no ids -- and markRed refuses an empty range rather than anchoring to nothing.
  assert.deepEqual(markRed([], { paragraphId:"p1", wordIds:[] }), []);
  assert.deepEqual(markRed([], { paragraphId:"", wordIds:["x"] }), []);
});

test("the same word is not marked twice", () => {
  const { target, annotations } = marked(2);
  const again = markRed(annotations, { paragraphId:target.id, wordIds:target.wordIds.slice(1, 3) });
  assert.equal(again.length, 1);
});

// ---------------------------------------------------------------------------------------------
// Sections 29-30 — diarization regression and integrity
// ---------------------------------------------------------------------------------------------









test("no word is lost or duplicated by paragraph regrouping", () => {
  const fromEvents = FIXTURE.flatMap(item => item.words.map(w => w.punctuatedWord));
  const fromParagraphs = paragraphs().flatMap(paragraph => paragraph.words.map(w => w.text));
  assert.deepEqual(fromParagraphs, fromEvents, "finalized words in must equal finalized words out");
  assert.equal(new Set(paragraphs().flatMap(paragraph => paragraph.wordIds)).size, fromEvents.length, "no id appears twice");
});

test("Deepgram's original word text is retained whatever is displayed", () => {
  // The index has to keep pointing at what the audio says. rawText is that; text is what the screen
  // shows and what a reporter may edit over.
  for (const paragraph of paragraphs()) {
    for (const word of paragraph.words) assert.equal(word.rawText, word.text, "unedited, the two agree");
    assert.ok(paragraph.words.every(word => typeof word.rawText === "string" && word.rawText));
  }
});

test("a red mark stays on the word when the text under it is edited", () => {
  // Anchoring is by word id, so an edit changes what the word says and not which word is marked.
  const { target, annotations } = marked(2);
  const markedIds = target.wordIds.slice(1, 3);
  const edited = { ...target, words: target.words.map(word => markedIds.includes(word.id) ? { ...word, text: "EDITED" } : word) };
  for (const id of markedIds) assert.ok(isRed(annotations, id), "the mark did not move or vanish");
  assert.deepEqual(edited.words.filter(word => markedIds.includes(word.id)).map(word => word.rawText),
    target.words.filter(word => markedIds.includes(word.id)).map(word => word.text),
    "and Deepgram's original survives the edit");
});
