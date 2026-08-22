import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCaptureSession,
  runningCaptureSession,
  startCaptureSession,
  stopCaptureSession,
} from "../server/live-capture.mjs";

// `active` in live-capture.mjs is module state shared by every test in this process, so each case
// gets its own deposition rather than racing the previous one's leftovers.
let counter = 0;
const nextDeposition = () => `DEP-20260822-RE${String(++counter).padStart(3, "0")}`;
const SCREEN = fs.readFileSync(new URL("../app/LiveCaptureScreen.tsx", import.meta.url), "utf8");

// A capture process that behaves the way stopChild expects: it exits when asked to, so a stop can
// be tested without an ffmpeg and without a five-second kill timeout.
function stubChild() {
  const handlers = {};
  return {
    stderr: { on() {} },
    stdin: { write() { setImmediate(() => handlers.exit?.(0)); } },
    once(event, fn) { handlers[event] = fn; },
    kill() { handlers.exit?.(0); },
  };
}

function scratch() {
  const depositionId = nextDeposition();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-reattach-"));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: depositionId, caseStyle: "A v. B", witness: "W" }));
  return { depositionId, storageRoot, folder, cleanup: () => fs.rmSync(storageRoot, { recursive: true, force: true }) };
}

// Starts a real session with stubbed capture processes, exactly as the screen would.
function startRecording(s, { depositionId = s.depositionId } = {}) {
  const session = createCaptureSession(null, {
    depositionId, storageRoot: s.storageRoot, label: "Reattach",
    sources: [
      { id: "local-microphone", role: "LOCAL_MICROPHONE", deviceId: "mic-a", deviceName: "Mic A" },
      { id: "meeting-audio", role: "VIRTUAL_MEETING_AUDIO", deviceId: "mix-b", deviceName: "Mix B" },
    ],
  });
  startCaptureSession(null, { depositionId, sessionId: session.sessionId, storageRoot: s.storageRoot, spawnProcess: () => stubChild() });
  return session;
}

const manifestOf = (s, sessionId) =>
  JSON.parse(fs.readFileSync(path.join(s.folder, "live-capture", sessionId, "capture-session.json"), "utf8"));

test("a client that mounts with no local state finds the recording that is running", async () => {
  // The defect: the screen rendered its idle state from a null local session while the server was
  // still recording, so a reload left audio being written with no Stop anywhere.
  const s = scratch();
  const started = startRecording(s);
  const found = runningCaptureSession(null, { depositionId: s.depositionId });
  assert.ok(found, "a reload arrives with nothing stored and must still find the session");
  assert.equal(found.sessionId, started.sessionId);
  assert.equal(found.state, "RECORDING");
  assert.deepEqual(found.sources.map((source) => source.id), ["local-microphone", "meeting-audio"],
    "the channels come back, so the meters and monitoring have something to render");
  assert.deepEqual(found.sources.map((source) => source.deviceId), ["mic-a", "mix-b"],
    "and the devices actually being recorded, which a reattaching client never selected");
  await stopCaptureSession(null, { sessionId: started.sessionId });
  s.cleanup();
});

test("reattaching observes and controls; it never finalizes what it found", async () => {
  // The line that matters most here. A recovery path that treated a discovered recording as stale
  // would end a live deposition on a stray page load.
  const s = scratch();
  const started = startRecording(s);
  for (let mount = 0; mount < 3; mount++) runningCaptureSession(null, { depositionId: s.depositionId });
  const record = manifestOf(s, started.sessionId);
  assert.equal(record.state, "RECORDING", "three mounts must leave the recording running");
  assert.deepEqual(record.events.map((event) => event.type), ["SESSION_CONFIGURED", "LOCAL_RECORDING_STARTED"],
    "no stop was recorded, because looking is not stopping");
  assert.ok(record.sources.every((source) => source.artifact?.finalized === false));
  await stopCaptureSession(null, { sessionId: started.sessionId });
  s.cleanup();
});

test("the lookup is scoped to its context and does not return another deposition's recording", async () => {
  const s = scratch();
  const started = startRecording(s);
  assert.equal(runningCaptureSession(null, { depositionId: "DEP-20260822-OTHER" }), null);
  assert.equal(runningCaptureSession(null, { depositionId: null }), null, "an unassigned screen must not adopt a deposition's capture");
  assert.ok(runningCaptureSession(null, { depositionId: s.depositionId }));
  await stopCaptureSession(null, { sessionId: started.sessionId });
  s.cleanup();
});

test("nothing is running before a recording starts, and nothing is running after it stops", async () => {
  const s = scratch();
  assert.equal(runningCaptureSession(null, { depositionId: s.depositionId }), null);
  const started = startRecording(s);
  assert.ok(runningCaptureSession(null, { depositionId: s.depositionId }));
  await stopCaptureSession(null, { sessionId: started.sessionId });
  assert.equal(runningCaptureSession(null, { depositionId: s.depositionId }), null, "a stopped session is not reattachable");
  s.cleanup();
});

test("a reattached session stops cleanly and both channels finalize and hash", async () => {
  const s = scratch();
  startRecording(s);
  // The client that stops it is not the client that started it: this is the reload case, where the
  // only handle on the recording is the one the server just handed back.
  const found = runningCaptureSession(null, { depositionId: s.depositionId });
  // The audio the capture processes would have written.
  const directory = path.join(s.folder, "live-capture", found.sessionId, "channels");
  fs.mkdirSync(directory, { recursive: true });
  const written = {};
  for (const [index, source] of found.sources.entries()) {
    const file = path.join(directory, `${String(index + 1).padStart(2, "0")}-${source.id}.wav`);
    const body = Buffer.concat([Buffer.from(`RIFF....WAVEfmt `), crypto.randomBytes(4096)]);
    fs.writeFileSync(file, body);
    written[source.id] = crypto.createHash("sha256").update(body).digest("hex");
  }
  const stopped = await stopCaptureSession(null, { sessionId: found.sessionId });
  assert.equal(stopped.state, "FINALIZED");
  assert.equal(stopped.sources.length, 2);
  for (const source of stopped.sources) {
    assert.equal(source.state, "FINALIZED");
    assert.equal(source.artifact.finalized, true);
    assert.equal(source.artifact.sha256, written[source.id], `${source.id} hashes the bytes actually on disk`);
  }
  assert.notEqual(stopped.sources[0].artifact.sha256, stopped.sources[1].artifact.sha256, "two channels, two hashes");
  assert.ok(stopped.events.map((event) => event.type).includes("LOCAL_RECORDING_STOPPED"));
  s.cleanup();
});

test("the screen asks the server on mount rather than trusting anything it stored", () => {
  assert.match(SCREEN, /api\/live-capture\/running\?depositionId=/,
    "the reattach lookup is what makes a reload survivable");
  assert.ok(
    !/localStorage[^\n]*sessionId|sessionId[^\n]*localStorage/.test(SCREEN),
    "a stored sessionId fails on a cleared cache and cannot help a second machine; the server owns this",
  );
});

test("a recording is never filtered out of the one list that could reach it", () => {
  // The second half of the defect. The screen had lost the session on reload, and the list that
  // exists for exactly that case excluded it by state, so there was no path back to the audio.
  assert.ok(
    !/!\(item\.state === "RECORDING" && item\.running\)/.test(SCREEN),
    "a running recording must appear in the unattached list, not be hidden from it",
  );
  assert.ok(
    !/item\.state !== "RECORDING"/.test(SCREEN),
    "the original filter is what made a live recording unreachable",
  );
  assert.match(SCREEN, /Stop this recording/, "and it has to be stoppable from there");
  assert.match(SCREEN, /stopSession\(item\.sessionId\)/);
  assert.match(SCREEN, /Finalize this recording/, "an interrupted one still finalizes rather than stopping");
});
