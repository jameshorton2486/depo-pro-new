import assert from "node:assert/strict";
import test from "node:test";
import { PARAGRAPH_PAUSE_SECONDS, groupLiveEvents, streamClock, voiceLabel } from "../app/live-paragraphs.mjs";
import { buildDeepgramLiveUrl } from "../server/deepgram-live.mjs";

const event = (id, start, duration, transcript, speaker = null) => ({
  id, channelId: "ch1", start, duration, transcript,
  words: transcript.split(" ").map((word, index) => ({ punctuatedWord: word, start: start + index * 0.2, speaker })),
});

test("a turn change starts a new paragraph",()=>{
  // The break is what makes a passage findable. Two voices running together in one block is the
  // thing this exists to prevent.
  const paragraphs = groupLiveEvents([
    event("a", 0, 3, "And what happened next", 0),
    event("b", 3.2, 4, "I arrived at the clinic", 1),
    event("c", 7.4, 2, "that morning", 1),
  ]);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].text, "And what happened next");
  assert.equal(paragraphs[1].text, "I arrived at the clinic that morning", "the same voice continuing is one paragraph");
});

test("a long pause breaks a paragraph even within one voice",()=>{
  const together = groupLiveEvents([event("a", 0, 3, "One", 0), event("b", 3.5, 2, "Two", 0)]);
  assert.equal(together.length, 1, `a ${0.5}s gap is not a break`);
  const apart = groupLiveEvents([event("a", 0, 3, "One", 0), event("b", 3 + PARAGRAPH_PAUSE_SECONDS + 1, 2, "Two", 0)]);
  assert.equal(apart.length, 2, "a gap beyond the threshold is");
  // Measured from the end of the previous event, not from its start.
  assert.equal(groupLiveEvents([event("a", 0, 10, "One", 0), event("b", 11, 2, "Two", 0)]).length, 1);
});

test("a live speaker number never renders as a name",()=>{
  // Live diarization has no lookahead and renumbers as the stream evolves, and speaker 0 live is
  // not speaker 0 in the batch pass. A label that looked like a person would be read as an
  // attribution, so this function cannot produce one.
  assert.equal(voiceLabel(0), "Voice A");
  assert.equal(voiceLabel(1), "Voice B");
  assert.equal(voiceLabel(25), "Voice Z");
  assert.equal(voiceLabel(26), "Voice A2", "and it keeps going without wrapping onto an earlier voice");
  assert.equal(voiceLabel(null), "Voice");
  for (const value of [0, 1, 5, 25, 26, 99]) {
    assert.match(voiceLabel(value), /^Voice [A-Z]\d*$/, "no name, no role, no roster identity can appear here");
  }
});

test("diarization returning nothing leaves the voice unstated rather than invented",()=>{
  // This is what the live stream actually returned before diarize was enabled: no speaker at all.
  // The paragraph still forms, and it says nothing about who spoke.
  const paragraphs = groupLiveEvents([event("a", 0, 3, "Of the FCC. Brendan Carr."), event("b", 3.1, 3, "He has been outspoken")]);
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].speaker, null);
  assert.equal(paragraphs[0].voice, null, "an absent voice is absent, not Voice A");
});

test("the shared channel is diarized and a dedicated one is not",()=>{
  // Measured against a real 3.5-minute stream: diarize_model alone returned no speaker on any word,
  // because diarize=true is what enables it. Only the shared remote channel gets it -- a dedicated
  // microphone carries one voice, and diarizing it would invent turns the room never had.
  const shared = new URL(buildDeepgramLiveUrl({ id: "meeting-audio", role: "VIRTUAL_MEETING_AUDIO" }));
  assert.equal(shared.searchParams.get("diarize"), "true", "diarize_model without diarize is inert");
  assert.equal(shared.searchParams.has("diarize_model"), false, "Nova-3 rejects diarize_model with HTTP 400; diarize alone enables it");
  // Ruling, 2026-08-19: a LOCAL_MICROPHONE covers a room rather than a person, so it is diarized
  // too. Without it that channel produces one unbroken block and there are no turn breaks at all.
  const room = new URL(buildDeepgramLiveUrl({ id: "ch1", role: "LOCAL_MICROPHONE" }));
  assert.equal(room.searchParams.get("diarize"), "true");
  // A channel named for one participant keeps the original reasoning: diarizing it would invent
  // turns the room never had.
  const dedicated = new URL(buildDeepgramLiveUrl({ id: "ch1", role: "WITNESS" }));
  assert.equal(dedicated.searchParams.has("diarize"), false, "a channel assigned to one person is one voice");
  assert.equal(dedicated.searchParams.get("interim_results"), "true");
});

test("paragraphs carry a stream position, and empty transcripts are dropped",()=>{
  const paragraphs = groupLiveEvents([event("a", 12, 3, "found me here", 0), event("b", 20, 2, "   ", 1)]);
  assert.equal(paragraphs.length, 1, "an empty transcript is not a paragraph");
  assert.equal(paragraphs[0].start, 12);
  assert.equal(paragraphs[0].end, 15);
  assert.equal(streamClock(12), "00:12");
  assert.equal(streamClock(154.1), "02:34");
  assert.equal(streamClock(null), "--:--");
});

test("nothing here can reach the working transcript",()=>{
  // The guard the whole module exists under: a paragraph carries a live speaker number and a
  // neutral label, and neither is shaped like anything the speaker map accepts. The batch
  // transcription of the registered audio does speaker work, with a real roster.
  const [paragraph] = groupLiveEvents([event("a", 0, 3, "testimony", 2)]);
  assert.equal(paragraph.voice, "Voice C");
  assert.equal(paragraph.speakerIdentity, undefined, "a live paragraph has no canonical identity");
  assert.equal(paragraph.transcriptRole, undefined, "and no transcript role");
  assert.equal(paragraph.asrWordIds, undefined, "and no evidence word ids to anchor a correction to");
});

test("three voices inside one utterance become three paragraphs",()=>{
  // The defect this closes, seen on a real recording: a room with three people speaking rendered
  // as one unbroken block labelled Voice A. Deepgram diarizes per word and returns turn changes
  // inside a single utterance; reading the speaker off the first word discarded every one of them.
  const words = [
    { punctuatedWord: "So", start: 0.0, end: 0.2, speaker: 0 },
    { punctuatedWord: "not", start: 0.2, end: 0.4, speaker: 0 },
    { punctuatedWord: "by", start: 0.4, end: 0.6, speaker: 0 },
    { punctuatedWord: "summer.", start: 0.6, end: 0.9, speaker: 0 },
    { punctuatedWord: "Again,", start: 1.0, end: 1.3, speaker: 1 },
    { punctuatedWord: "I'm", start: 1.3, end: 1.5, speaker: 1 },
    { punctuatedWord: "optimistic.", start: 1.5, end: 2.0, speaker: 1 },
    { punctuatedWord: "Oh,", start: 2.1, end: 2.3, speaker: 2 },
    { punctuatedWord: "I", start: 2.3, end: 2.5, speaker: 2 },
  ];
  const paragraphs = groupLiveEvents([{ id: "e1", channelId: "ch1", start: 0, duration: 2.5, transcript: words.map(w => w.punctuatedWord).join(" "), words }]);

  assert.equal(paragraphs.length, 3, "one utterance, three turns");
  assert.deepEqual(paragraphs.map(p => p.voice), ["Voice A", "Voice B", "Voice C"]);
  assert.deepEqual(paragraphs.map(p => p.text), ["So not by summer.", "Again, I'm optimistic.", "Oh, I"]);
  assert.equal(paragraphs[1].start, 1.0, "each turn carries the time its own first word began");
  assert.equal(paragraphs[0].end, 0.9);
});

test("a voice continuing across two utterances stays one paragraph",()=>{
  // Splitting on word-level speaker must not fragment a single speaker who talks through an
  // endpointing boundary.
  const run = (id, start, speaker, ...texts) => ({ id, channelId: "ch1", start, duration: texts.length * 0.3,
    transcript: texts.join(" "), words: texts.map((t, i) => ({ punctuatedWord: t, start: start + i * 0.3, end: start + i * 0.3 + 0.25, speaker })) });
  const paragraphs = groupLiveEvents([run("e1", 0, 0, "I", "arrived", "at"), run("e2", 0.95, 0, "the", "clinic")]);
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "I arrived at the clinic");
  assert.equal(paragraphs[0].voice, "Voice A");
});
