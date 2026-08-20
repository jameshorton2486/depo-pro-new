// Names are what a deposition turns on, and streaming ASR is where they break: Etminan, Cukjati,
// Bardot, Herber are in no general vocabulary. The batch pass already builds a keyterm list from
// the people the deposition actually has and gets them right. The live socket opened without it and
// guessed at every one -- the list existed, nothing passed it.
//
// A read-back index that mishears every surname is an index the reporter cannot search.
import assert from "node:assert/strict";
import test from "node:test";
import { buildDeepgramLiveUrl } from "../server/deepgram-live.mjs";
import { KEYTERM_PRODUCT_CAP } from "../server/keyterm-limits.mjs";

const ROOM = { id:"ch1", role:"LOCAL_MICROPHONE" };
const WITNESS = { id:"ch2", role:"WITNESS" };
const terms = url => [...new URL(url).searchParams.getAll("keyterm")];

test("the deposition's names reach the socket", () => {
  const url = buildDeepgramLiveUrl(ROOM, ["Etminan", "Cukjati", "Herber"]);
  assert.deepEqual(terms(url), ["Etminan", "Cukjati", "Herber"]);
});

test("each term is its own parameter, as Deepgram requires", () => {
  // Repeated keyterm=, not one comma-joined value.
  const url = buildDeepgramLiveUrl(ROOM, ["Bardot", "Standing Seam"]);
  assert.equal((url.match(/[?&]keyterm=/g) ?? []).length, 2);
  assert.ok(url.includes("Standing+Seam") || url.includes("Standing%20Seam"), "a multi-word term is encoded, not split");
});

test("an unassigned capture connects with no names rather than not connecting", () => {
  // Recording is the thing that must never be blocked. A nameless index is still an index.
  const url = buildDeepgramLiveUrl(ROOM);
  assert.deepEqual(terms(url), []);
  assert.ok(url.startsWith("wss://api.deepgram.com/v1/listen?"));
  assert.equal(new URL(url).searchParams.get("model"), "nova-3");
});

test("keyterms are attached whatever the channel role", () => {
  // Diarization is gated by role; recognition is not. A witness channel needs the names too.
  assert.deepEqual(terms(buildDeepgramLiveUrl(WITNESS, ["Etminan"])), ["Etminan"]);
  assert.equal(new URL(buildDeepgramLiveUrl(WITNESS, ["Etminan"])).searchParams.get("diarize"), null);
  assert.equal(new URL(buildDeepgramLiveUrl(ROOM, ["Etminan"])).searchParams.get("diarize"), "true");
});

test("no other ASR setting moved", () => {
  // The one change is keyterms. smart_format, punctuate, endpointing and filler_words are separate
  // decisions, and filler removal is ruled out entirely -- the index must match what was said.
  //
  // utterance_end_ms is deliberately absent: it was approved for the live-usability branch, which
  // is parked and unmerged, so it is not part of main and is not smuggled in here.
  const query = new URL(buildDeepgramLiveUrl(ROOM, ["Etminan"])).searchParams;
  for (const [key, value] of Object.entries({
    model:"nova-3", language:"en-US", encoding:"linear16", sample_rate:"16000", channels:"1",
    interim_results:"true", endpointing:"300", punctuate:"true",
    smart_format:"true", filler_words:"true", profanity_filter:"false", vad_events:"true",
  })) assert.equal(query.get(key), value, `${key} must not move`);
});

test("the product cap is what applies, well inside Deepgram's request ceiling", () => {
  assert.equal(KEYTERM_PRODUCT_CAP, 50);
});
