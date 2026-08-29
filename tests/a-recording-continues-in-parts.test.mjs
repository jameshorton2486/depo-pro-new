// A deposition breaks. The reporter stops, and later has to be recording again -- and the two runs
// are one proceeding even though they are two captures.
//
// What this pins is the thing that would be tempting and wrong: joining the parts into one audio
// file. That would destroy the per-part hash and manufacture continuity across a gap where none
// existed, so a listener hears one unbroken take of something that had minutes taken out of the
// middle, with nothing in the file to say so. The parts stay separate captures with separate
// hashes; what is stitched is the timeline.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureRecordingParts, continueCaptureSession, createCaptureSession, startCaptureSession, stopCaptureSession } from "../server/live-capture.mjs";

const DEPOSITION = "DEP-20260825-PARTS";
const SOURCES = [
  { id: "local-microphone", role: "LOCAL_MICROPHONE", deviceId: "Microphone (Test)", deviceName: "Microphone (Test)" },
  { id: "meeting-audio", role: "VIRTUAL_MEETING_AUDIO", deviceId: "Stereo Mix (Test)", deviceName: "Stereo Mix (Test)" },
];

function scratch(t) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-parts-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: DEPOSITION, caseStyle: "A v. B", witness: "Witness" }));
  return storageRoot;
}

// Each spawn writes bytes unique to its own output path, so two parts of one channel cannot
// coincidentally hash the same -- which is what makes the distinct-hash assertion mean something.
function fakeSpawn() {
  return (_command, args) => {
    const file = args.at(-1);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("exit", 0);
    child.stdin = { write() { fs.writeFileSync(file, `captured:${file}`); setImmediate(() => child.emit("exit", 0)); } };
    return child;
  };
}

async function recordOnePart(storageRoot, { continues = null } = {}) {
  const session = continues
    ? continueCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot, previousSessionId: continues })
    : createCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot, label: "Volume I", sources: SOURCES });
  startCaptureSession(process.cwd(), { depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot, spawnProcess: fakeSpawn() });
  return await stopCaptureSession(process.cwd(), { sessionId: session.sessionId });
}

test("a continued recording is the next part of the same recording", async (t) => {
  const storageRoot = scratch(t);
  const first = await recordOnePart(storageRoot);
  const second = continueCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot, previousSessionId: first.sessionId });

  assert.notEqual(second.sessionId, first.sessionId, "a part is its own capture session");
  assert.equal(second.partOf.recordingId, first.sessionId, "the recording is named by its first part");
  assert.equal(second.partOf.ordinal, 2);
  assert.equal(second.partOf.previousSessionId, first.sessionId);
  assert.equal(typeof second.partOf.gapMsBefore, "number", "the gap is measured, not omitted");
  assert.ok(second.partOf.gapMsBefore >= 0);
  assert.equal(first.partOf, null, "a first part is not part of anything yet");
  // The devices carry over; a reporter who already armed a preflight must not have to reselect.
  assert.deepEqual(second.sources.map((source) => source.deviceId), SOURCES.map((source) => source.deviceId));
  assert.deepEqual(second.sources.map((source) => source.role), SOURCES.map((source) => source.role));
});

test("the parts are ordered, and the gap between them is stated rather than smoothed over", async (t) => {
  const storageRoot = scratch(t);
  const first = await recordOnePart(storageRoot);
  const second = await recordOnePart(storageRoot, { continues: first.sessionId });
  const third = await recordOnePart(storageRoot, { continues: second.sessionId });

  const recording = captureRecordingParts(process.cwd(), { depositionId: DEPOSITION, storageRoot, sessionId: second.sessionId });
  assert.equal(recording.recordingId, first.sessionId, "any part finds the whole recording");
  assert.deepEqual(recording.parts.map((part) => part.ordinal), [1, 2, 3]);
  assert.deepEqual(recording.parts.map((part) => part.sessionId), [first.sessionId, second.sessionId, third.sessionId]);
  assert.equal(recording.missingParts, 0);
  assert.equal(recording.continuous, false, "three parts are not one continuous span and must not read as one");
  assert.equal(recording.parts[0].gapMsBefore, null, "nothing precedes the first part");
  assert.equal(typeof recording.totalGapMs, "number");
});

test("the audio is never joined: every part keeps its own file and its own hash", async (t) => {
  const storageRoot = scratch(t);
  const first = await recordOnePart(storageRoot);
  const second = await recordOnePart(storageRoot, { continues: first.sessionId });

  const paths = [first, second].flatMap((part) => part.sources.map((source) => source.artifact.relativePath));
  assert.equal(new Set(paths).size, 4, "two parts by two channels is four distinct files");
  const hashes = [first, second].flatMap((part) => part.sources.map((source) => source.artifact.sha256));
  assert.equal(hashes.filter(Boolean).length, 4, "every channel of every part is hashed");
  assert.equal(new Set(hashes).size, 4, "the audio of a part is its own bytes, not a copy or a concatenation");
  // A joined file would have to live somewhere, and nothing writes one.
  const deposition = path.join(storageRoot, "reporter", "cause", "witness");
  const stray = fs.readdirSync(path.join(deposition, "live-capture"), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("LIVE-") && entry.name !== "preflight")
    .map((entry) => entry.name);
  assert.deepEqual(stray, [], "no combined artifact is produced anywhere");
});

test("a part that has not been finalized cannot be continued", async (t) => {
  const storageRoot = scratch(t);
  const session = createCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot, sources: SOURCES });
  // Configured but never started: there is no stop to measure a gap from.
  assert.throws(() => continueCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot, previousSessionId: session.sessionId }),
    /Stop and finalize part 1/);

  startCaptureSession(process.cwd(), { depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot, spawnProcess: fakeSpawn() });
  // Still running: continuing would leave two captures writing from the same devices at once.
  assert.throws(() => continueCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot, previousSessionId: session.sessionId }),
    /Stop and finalize part 1/);
  await stopCaptureSession(process.cwd(), { sessionId: session.sessionId });
});

test("continuing something that is not a recording is refused, not guessed at", (t) => {
  const storageRoot = scratch(t);
  assert.throws(() => continueCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot, previousSessionId: "LIVE-NOPE" }), /was not found/);
  assert.throws(() => continueCaptureSession(process.cwd(), { depositionId: DEPOSITION, storageRoot }), /requires the part it continues/);
});
