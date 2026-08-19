import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDepositionAudio } from "../server/deposition-store.mjs";
import { registerCaptureAudio } from "../server/live-capture.mjs";

const DEPOSITION = "DEP-20260818-CAPTR";
const sha = buffer => crypto.createHash("sha256").update(buffer).digest("hex");

/** A deposition with a finished capture session sitting inside it, as the live screen leaves one. */
function fixture({ states = ["FINALIZED", "FINALIZED"], sessionState = "FINALIZED", audio = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-capture-"));
  const storageRoot = path.join(root, "depos");
  const directory = path.join(storageRoot, "reporter", "cause", "deposition");
  const sessionId = "LIVE-20260818140000-ABC123";
  const channels = path.join(directory, "live-capture", sessionId, "channels");
  fs.mkdirSync(channels, { recursive: true });

  const sources = states.map((state, index) => {
    const relative = `live-capture/${sessionId}/channels/${String(index + 1).padStart(2, "0")}-ch${index + 1}.wav`;
    const bytes = Buffer.from(`channel ${index + 1} audio payload`);
    if (state === "FINALIZED") fs.writeFileSync(path.join(directory, ...relative.split("/")), bytes);
    return {
      id: `ch${index + 1}`, ordinal: index, role: index ? "VIRTUAL_MEETING_AUDIO" : "LOCAL_MICROPHONE",
      deviceId: `device-${index}`, deviceName: `Device ${index}`, state,
      artifact: state === "FINALIZED" ? { relativePath: relative, bytes: bytes.length, sha256: sha(bytes), finalized: true } : null,
    };
  });

  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: DEPOSITION, audio, audioFiles: [], audioIntakeIds: [] }));
  fs.writeFileSync(path.join(directory, "live-capture", sessionId, "capture-session.json"), JSON.stringify({ sessionId, depositionId: DEPOSITION, state: sessionState, sources }));
  return { root, storageRoot, directory, sessionId };
}

const deposition = value => JSON.parse(fs.readFileSync(path.join(value.directory, "deposition.json"), "utf8"));

test("a finished capture session becomes the deposition's audio",()=>{
  // The seam. Before this the recording lived inside the deposition folder and the deposition
  // could not see it, because audio[] was only ever written when the deposition was created.
  const value = fixture();
  try {
    const result = registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot });
    assert.equal(result.added.length, 2);
    assert.deepEqual(result.skipped, []);

    const record = deposition(value);
    assert.equal(record.audio.length, 2);
    assert.equal(record.workflowStatus, "recorded");
    assert.deepEqual(record.audioIntakeIds, result.added.map(item => item.uploadId));
    // Registered where it lies: no copy, and the path still resolves inside the deposition.
    for (const item of record.audio) {
      assert.match(item.path, /^live-capture\//);
      assert.ok(fs.existsSync(path.join(value.directory, ...item.path.split("/"))));
      assert.match(item.uploadId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("registering the same session twice is refused, not duplicated",()=>{
  // The upload id is derived from the session and channel rather than random, so a second
  // registration collides with itself instead of quietly adding the same recording again.
  const value = fixture();
  try {
    registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot });
    assert.throws(() => registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot }), /already part of this deposition/);
    assert.equal(deposition(value).audio.length, 2, "the refused attempt left the record alone");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a recording still in progress cannot be added",()=>{
  const value = fixture({ sessionState: "RECORDING" });
  try {
    assert.throws(() => registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot }), /Stop and finalize/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("one failed channel does not cost the surviving recordings",()=>{
  // The whole point of independent per-channel capture. Refusing the session because a device
  // dropped would turn one hardware fault into a lost record.
  const value = fixture({ states: ["FINALIZED", "FAILED"], sessionState: "DEGRADED" });
  try {
    const result = registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot });
    assert.equal(result.added.length, 1);
    assert.deepEqual(result.skipped, [{ id: "ch2", role: "VIRTUAL_MEETING_AUDIO", state: "FAILED" }], "what was left out is reported, not passed over");
    assert.equal(deposition(value).audio.length, 1);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a session with nothing finalized is refused rather than recorded as empty",()=>{
  const value = fixture({ states: ["FAILED", "FAILED"], sessionState: "DEGRADED" });
  try {
    assert.throws(() => registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot }), /no finalized channels/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("audio that changed on disk since it was recorded is refused",()=>{
  // The hash written at stop says what was captured. Recomputing it here says the bytes are still
  // those. Registering the recording is exactly the moment to find out.
  const value = fixture();
  try {
    const file = path.join(value.directory, "live-capture", value.sessionId, "channels", "01-ch1.wav");
    fs.writeFileSync(file, Buffer.from("something else entirely"));
    assert.throws(() => registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot }), /failed SHA-256 verification/);
    assert.equal(deposition(value).audio.length, 0, "a failed verification adds nothing at all");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("existing audio is added to, never replaced",()=>{
  const value = fixture({ audio: [{ uploadId: "11111111-2222-3333-4444-555555555555", source: "original", sha256: "x", path: "audio/original/prior.wav", name: "prior.wav" }] });
  try {
    registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: value.sessionId, storageRoot: value.storageRoot });
    const record = deposition(value);
    assert.equal(record.audio.length, 3);
    assert.equal(record.audio[0].name, "prior.wav", "the audio that was already there is still first and unchanged");
    assert.equal(record.audio[0].sha256, "x", "and is not re-verified, because this call did not add it");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("an audio path outside the deposition folder is refused",()=>{
  const value = fixture();
  try {
    assert.throws(() => appendDepositionAudio(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot,
      entries: [{ uploadId: "11111111-2222-3333-4444-555555555555", path: "../../../escape.wav" }] }), /escaped the deposition folder/);
    assert.throws(() => appendDepositionAudio(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot,
      entries: [{ uploadId: "11111111-2222-3333-4444-555555555555", path: "audio/original/absent.wav" }] }), /was not found/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
