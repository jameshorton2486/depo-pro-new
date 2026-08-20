// Deepgram's timestamps are relative to the stream, and a reconnection opens a new stream whose
// clock restarts at zero. A channel that drops once then showed [00:00:03] partway through a
// proceeding -- worse than showing nothing, because it reads as a real position in the recording.
//
// Locating a moment in the audio is the only job the live text has, so a clock that points at the
// wrong place is a defect in the one thing the feature is for.
import assert from "node:assert/strict";
import test from "node:test";
import { groupLiveEvents, sessionClock, streamClock } from "../app/live-paragraphs.mjs";

const word = (text, start, speaker) => ({ word:text, punctuatedWord:text, start, end:start + 0.4, speaker });
const event = (id, words, offset = 0) => ({ id, sessionOffsetSeconds:offset, channelId:"c1", words, start:words[0].start, duration:1 });

test("a reconnection continues the clock instead of restarting it", () => {
  const [before, after] = groupLiveEvents([
    event("a", [word("Before", 5, 0)]),
    event("b", [word("After", 3, 1), word("reconnect", 3.4, 1)], 600),
  ]);
  assert.equal(sessionClock(before.start), "00:00:05");
  assert.equal(sessionClock(after.start), "00:10:03", "3s into a stream that opened 10 minutes in");
});

test("an event with no recorded offset reads as stream time, unchanged", () => {
  // Sessions recorded before the offset existed must not shift.
  const [only] = groupLiveEvents([{ id:"a", channelId:"c1", words:[word("Legacy", 12, 0)], start:12, duration:1 }]);
  assert.equal(sessionClock(only.start), "00:00:12");
});

test("paragraph grouping still measures gaps on the same clock", () => {
  // Both runs carry the same offset, so the pause between them is unchanged by it.
  const paragraphs = groupLiveEvents([
    event("a", [word("One", 1, 0)], 300),
    event("b", [word("Two", 9, 0)], 300),
  ]);
  assert.equal(paragraphs.length, 2, "an 8s gap still breaks the paragraph");
});

test("HH:MM:SS at one width, so a column of stamps can be scanned", () => {
  assert.equal(sessionClock(134), "00:02:14");
  assert.equal(sessionClock(3725), "01:02:05");
  assert.equal(sessionClock(null), "--:--:--");
});

test("the existing stream clock is untouched", () => {
  assert.equal(streamClock(12), "00:12");
  assert.equal(streamClock(154.1), "02:34");
});
