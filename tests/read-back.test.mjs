import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCaptureSession } from "../server/live-capture.mjs";
import { CHANNEL_NOT_RECORDED, CHANNEL_REQUIRED, CROSS_CHANNEL_SEEK, READ_BACK_LEAD_IN_SECONDS, readBackAudioFile, recordingOffsetSeconds, resolveReadBackTarget, searchLiveIndex } from "../server/read-back.mjs";

const SESSION = "LIVE-20260818140000-ABC123";
const capture = (overrides = {}) => ({
  sessionId: SESSION, state: "FINALIZED",
  clock: { kind: "process.hrtime.bigint", originWallClock: "2026-08-18T14:00:00.000Z" },
  timeline: { channelsSampleAligned: false, interChannelOffsetMeasured: false },
  sources: [
    { id: "ch1", role: "WITNESS", state: "FINALIZED", artifact: { relativePath: `live-capture/${SESSION}/channels/01-ch1.wav`, sha256: "aaa", finalized: true } },
    { id: "ch2", role: "EXAMINING_ATTORNEY", state: "FINALIZED", artifact: { relativePath: `live-capture/${SESSION}/channels/02-ch2.wav`, sha256: "bbb", finalized: true } },
    { id: "ch3", role: "INTERPRETER", state: "FAILED", artifact: null },
  ],
  ...overrides,
});

// Deepgram connected 90 seconds after recording began, so a stream time of 12s is 102s in the file.
const live = (overrides = {}) => ({
  sessionId: SESSION, state: "OPEN", canonicalTranscriptAuthority: false,
  connectionHistory: [
    { type: "CONNECTED", at: "2026-08-18T14:01:30.000Z", channelId: "ch1", epoch: 1 },
    { type: "CONNECTED", at: "2026-08-18T14:01:30.000Z", channelId: "ch2", epoch: 1 },
  ],
  finalizedEvents: [
    { id: "e1", channelId: "ch1", channelRole: "WITNESS", start: 10, transcript: "I arrived at the clinic that morning", words: [{ punctuatedWord: "clinic", start: 12, end: 12.4 }] },
    { id: "e2", channelId: "ch2", channelRole: "EXAMINING_ATTORNEY", start: 20, transcript: "And what happened at the clinic", words: [{ punctuatedWord: "clinic", start: 23, end: 23.4 }] },
    { id: "e3", channelId: "ch1", channelRole: "WITNESS", start: 40, transcript: "The lights were off", words: [{ punctuatedWord: "lights", start: 41, end: 41.5 }] },
  ],
  ...overrides,
});

test("search finds only what was said on the channel asked about",()=>{
  // Both channels say "clinic". A search of one must not return the other's, because the hit is
  // about to be used to position playback in this channel's file.
  const hits = searchLiveIndex(live(), { channelId: "ch1", query: "clinic" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].channelId, "ch1");
  assert.equal(hits[0].streamSeconds, 12, "the matching word positions the hit, not the start of the utterance");
  assert.equal(searchLiveIndex(live(), { channelId: "ch2", query: "clinic" })[0].streamSeconds, 23);
});

test("a search with no channel is refused rather than defaulted",()=>{
  // A default channel would make cross-channel search the easy path and the enforcement below a
  // formality.
  assert.throws(() => searchLiveIndex(live(), { query: "clinic" }), error => error.code === CHANNEL_REQUIRED);
  assert.deepEqual(searchLiveIndex(live(), { channelId: "ch1", query: "   " }), [], "an empty query finds nothing rather than everything");
});

test("a hit is positioned in the recording, not in the Deepgram stream",()=>{
  // Deepgram's clock starts when it connects. Recording started 90 seconds earlier, so a stream
  // time of 12s is 102s into the file -- and playback begins a lead-in before that.
  const [hit] = searchLiveIndex(live(), { channelId: "ch1", query: "clinic" });
  const target = resolveReadBackTarget({ capture: capture(), live: live(), hit, channelId: "ch1" });
  assert.equal(recordingOffsetSeconds(capture(), live(), "ch1"), 90);
  assert.equal(target.streamSeconds, 12);
  assert.equal(target.recordingSeconds, 102);
  assert.equal(target.playFromSeconds, 102 - READ_BACK_LEAD_IN_SECONDS);
  assert.match(target.audioPath, /01-ch1\.wav$/, "and it plays this channel's file");
});

test("playback starts before the moment, because that is how a read-back is performed",()=>{
  // The context is what settles the word. It is also what makes the unmeasured residual
  // immaterial: seconds of lead-in against tens of milliseconds of error.
  const [hit] = searchLiveIndex(live(), { channelId: "ch1", query: "clinic" });
  const target = resolveReadBackTarget({ capture: capture(), live: live(), hit, channelId: "ch1", leadInSeconds: 8 });
  assert.equal(target.playFromSeconds, 94);
  assert.ok(target.leadInSeconds > Math.max(...target.residual.observedVariationMs) / 1000, "the lead-in must exceed the residual it is covering");

  const early = resolveReadBackTarget({ capture: capture(), live: live(), hit: { ...hit, streamSeconds: 1 }, channelId: "ch1" });
  assert.equal(early.playFromSeconds, 86, "a hit near the start still clamps at zero rather than going negative");
  const atStart = resolveReadBackTarget({ capture: { ...capture(), clock: { originWallClock: "2026-08-18T14:01:30.000Z" } }, live: live(), hit: { ...hit, streamSeconds: 1 }, channelId: "ch1" });
  assert.equal(atStart.playFromSeconds, 0);
});

test("a hit from one channel cannot position playback in another",()=>{
  // The enforcement. The offset between channels was never measured, so a position taken from one
  // does not locate the same moment in another -- and it would look perfectly reasonable.
  const [hit] = searchLiveIndex(live(), { channelId: "ch2", query: "clinic" });
  assert.throws(() => resolveReadBackTarget({ capture: capture(), live: live(), hit, channelId: "ch1" }), error => {
    assert.equal(error.code, CROSS_CHANNEL_SEEK);
    assert.equal(error.hitChannelId, "ch2");
    assert.equal(error.requestedChannelId, "ch1");
    return true;
  });
  assert.throws(() => resolveReadBackTarget({ capture: capture(), live: live(), hit, channelId: null }), error => error.code === CHANNEL_REQUIRED);
});

test("the position is labelled approximate and carries what is unmeasured",()=>{
  // A bare number invites being treated as exact. This is the difference between recording the
  // absence and recording a value that measures nothing.
  const [hit] = searchLiveIndex(live(), { channelId: "ch1", query: "clinic" });
  const target = resolveReadBackTarget({ capture: capture(), live: live(), hit, channelId: "ch1" });
  assert.equal(target.precision, "approximate");
  assert.equal(target.positionable, true);
  assert.equal(target.residual.measured, false);
  assert.deepEqual(target.residual.observedVariationMs, [28, 83]);
});

test("a position that cannot be derived is unavailable, never zero",()=>{
  // Falling back to zero would send the reporter to the start of the deposition while reporting
  // success.
  const [hit] = searchLiveIndex(live(), { channelId: "ch1", query: "clinic" });
  const target = resolveReadBackTarget({ capture: { ...capture(), clock: {} }, live: live(), hit, channelId: "ch1" });
  assert.equal(target.recordingSeconds, null);
  assert.equal(target.playFromSeconds, null);
  assert.equal(target.precision, "unavailable");
  assert.equal(target.positionable, false);
  assert.equal(recordingOffsetSeconds(capture(), { connectionHistory: [] }, "ch1"), null);
});

test("a channel with no finished recording cannot be played back",()=>{
  const hit = { channelId: "ch3", streamSeconds: 5 };
  assert.throws(() => resolveReadBackTarget({ capture: capture(), live: live(), hit, channelId: "ch3" }), error => error.code === CHANNEL_NOT_RECORDED);
});

test("read-back audio stays inside the deposition folder",()=>{
  const directory = "C:/depos/reporter/cause/deposition";
  const [hit] = searchLiveIndex(live(), { channelId: "ch1", query: "clinic" });
  const target = resolveReadBackTarget({ capture: capture(), live: live(), hit, channelId: "ch1" });
  assert.match(readBackAudioFile(directory, target).replaceAll("\\", "/"), /deposition\/live-capture\//);
  assert.throws(() => readBackAudioFile(directory, { audioPath: "../../../escape.wav" }), error => error.code === CHANNEL_NOT_RECORDED);
});

test("the manifest the code actually writes states the channels are not aligned",()=>{
  // Asserted against createCaptureSession, not against a fixture in this file. A test that checks
  // its own fixture proves the fixture, which is how a guard passes while guarding nothing.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-readback-"));
  try {
    const storageRoot = path.join(root, "depos");
    const directory = path.join(storageRoot, "reporter", "cause", "deposition");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: "DEP-20260818-RDBCK" }));
    const session = createCaptureSession(null, { depositionId: "DEP-20260818-RDBCK", storageRoot,
      sources: [{ id: "ch1", role: "WITNESS", deviceId: "d1", deviceName: "D1" }, { id: "ch2", role: "EXAMINING_ATTORNEY", deviceId: "d2", deviceName: "D2" }] });

    assert.equal(session.timeline.channelsSampleAligned, false);
    assert.equal(session.timeline.interChannelOffsetMeasured, false);
    assert.match(session.timeline.doNotUseFor, /wrong speaker/i, "and says what the absence forbids, not merely that it exists");
    // The claim survives being written and read back, since that is how a future reader meets it.
    const stored = JSON.parse(fs.readFileSync(path.join(directory, "live-capture", session.sessionId, "capture-session.json"), "utf8"));
    assert.equal(stored.timeline.interChannelOffsetMeasured, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
