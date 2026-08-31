// The one thing on the live screen that cannot be allowed to fail.
//
// The audit established that local recording and Deepgram Live are independent by construction --
// separate ffmpeg processes, no Deepgram reference anywhere in live-capture.mjs, and a client that
// catches ASR failure on both start and stop. All of that was read, not run. Adapter tests passing
// is not the same claim as the recording surviving, which is what §109 is about and why this file
// exists: kill the socket while a recording is running, then stop the recording and look at what
// is on disk.
//
// The recording is the evidence. The live text is an index into it. If the socket dies the reporter
// loses a convenience; if the recording dies the proceeding is gone, and no later correction can
// reconstruct it. That asymmetry is the reason this is characterized rather than assumed.
//
// Nothing here reaches Deepgram. WebSocketClass and spawnProcess are the seams the module already
// exposes for its own tests; the audio is a synthetic fixture that never leaves the temp directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FILE_CAPTURE_FLAG,
  IN_PROCESS_FILE_SOURCES,
  createCaptureSession,
  startCaptureSession,
  stopCaptureSession,
} from "../server/live-capture.mjs";
import { startDeepgramLive, stopDeepgramLive } from "../server/deepgram-live.mjs";

const DEPOSITION = "DEP-20260831-ASRFL";

// Read at call time, so it is set and cleared around each case rather than for the process --
// otherwise one test turning it on quietly licenses every test after it.
function withFileCapture(run) {
  const previous = process.env[FILE_CAPTURE_FLAG];
  process.env[FILE_CAPTURE_FLAG] = "1";
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env[FILE_CAPTURE_FLAG];
    else process.env[FILE_CAPTURE_FLAG] = previous;
  }
}

function scratch({ channels = 2 } = {}) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-asrfail-"));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: DEPOSITION, caseStyle: "A v. B", witness: "W" }));
  const rate = 8000, frames = rate, data = Buffer.alloc(frames * 2 * channels);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2 * channels, 28); header.writeUInt16LE(2 * channels, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  const fixture = path.join(storageRoot, "fixture.wav");
  fs.writeFileSync(fixture, Buffer.concat([header, data]));
  return { storageRoot, folder, fixture, cleanup: () => fs.rmSync(storageRoot, { recursive: true, force: true }) };
}

const fileSources = (fixture, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `ch${index + 1}`, role: "PARTICIPANT_MICROPHONE", kind: "file", filePath: fixture, channelIndex: index,
  }));

// Stands in for the capture's ffmpeg. It writes the output file it was told to write, because a
// recorder that produces no bytes would pass a test about surviving for the wrong reason: the
// session would finalize as DEGRADED and the assertions below would be measuring nothing.
function captureProcesses(fixture) {
  const written = [];
  const spawnProcess = (command, args) => {
    const output = args[args.length - 1];
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(fixture, output);
    written.push(output);
    let onExit = null;
    return {
      stderr: { on() {} },
      stdin: { write() { if (onExit) onExit(0); } },   // ffmpeg quits on "q"
      once(event, fn) { if (event === "exit") onExit = fn; },
      kill() { if (onExit) onExit(1); },
    };
  };
  return { spawnProcess, written };
}

// A socket that opens and then fails, which is what a dropped connection looks like from here.
function failingSocket() {
  const handlers = {};
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.binaryType = ""; }
    on(event, fn) { handlers[event] = fn; return this; }
    send() { throw new Error("socket is gone"); }
    close() {}
  }
  return { Socket, handlers };
}

const feedProcess = () => ({ stdout: { on() {} }, stderr: { on() {} }, once() {}, kill() {} });

test("the recording finalizes with intact per-channel hashes after the Deepgram socket dies", async () => {
  const s = scratch();
  try {
    const session = withFileCapture(() => {
      const created = createCaptureSession(null, {
        depositionId: DEPOSITION, storageRoot: s.storageRoot,
        fileSources: IN_PROCESS_FILE_SOURCES, sources: fileSources(s.fixture, 2),
      });
      const { spawnProcess } = captureProcesses(s.fixture);
      startCaptureSession(null, { depositionId: DEPOSITION, sessionId: created.sessionId, storageRoot: s.storageRoot, spawnProcess });
      return created;
    });

    // Live text starts, then the connection fails mid-recording.
    const { Socket, handlers } = failingSocket();
    startDeepgramLive(null, {
      depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot: s.storageRoot,
      apiKey: "not-a-real-key", WebSocketClass: Socket, spawnProcess: feedProcess,
    });
    handlers.open?.();
    handlers.error?.(new Error("connection reset by peer"));

    // Exactly what LiveCaptureScreen does on stop: close Deepgram first, and swallow whatever it
    // throws. Against a dead socket this raises -- which is the case being characterized, not an
    // inconvenience to be avoided. The recording must finalize regardless.
    let asrStopFailed = false;
    try { await stopDeepgramLive(null, { sessionId: session.sessionId }) }
    catch { asrStopFailed = true }
    assert.equal(asrStopFailed, true, "the dead socket did not fail on close, so this test proved nothing");

    // The recording is stopped the way the reporter stops it, after the socket is already gone.
    const finalized = await stopCaptureSession(null, { sessionId: session.sessionId });

    assert.equal(finalized.state, "FINALIZED", "a dead socket must not degrade the recording");
    assert.equal(finalized.sources.length, 2);
    for (const source of finalized.sources) {
      assert.equal(source.state, "FINALIZED", `channel ${source.id} did not finalize`);
      assert.ok(source.artifact, `channel ${source.id} produced no artifact`);
      assert.equal(source.artifact.finalized, true);
      assert.ok(source.artifact.bytes > 0, `channel ${source.id} finalized as an empty file`);
      // The hash is the point. A recording that finalizes without one is not evidence.
      assert.match(source.artifact.sha256, /^[0-9a-f]{64}$/, `channel ${source.id} carries no usable hash`);
    }
    // Distinct channels are distinct files on disk, not one file counted twice.
    assert.equal(new Set(finalized.sources.map(source => source.artifact.relativePath)).size, 2);
  } finally { s.cleanup() }
});

test("a recording runs and finalizes with Deepgram not configured at all", async () => {
  const s = scratch();
  try {
    const session = withFileCapture(() => {
      const created = createCaptureSession(null, {
        depositionId: DEPOSITION, storageRoot: s.storageRoot,
        fileSources: IN_PROCESS_FILE_SOURCES, sources: fileSources(s.fixture, 2),
      });
      const { spawnProcess } = captureProcesses(s.fixture);
      startCaptureSession(null, { depositionId: DEPOSITION, sessionId: created.sessionId, storageRoot: s.storageRoot, spawnProcess });
      return created;
    });

    // No API key is a refusal to start live text, and the message says so in the reporter's terms.
    assert.throws(
      () => startDeepgramLive(null, { depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot: s.storageRoot, apiKey: "" }),
      /Local recording continues without live text/,
    );

    const finalized = await stopCaptureSession(null, { sessionId: session.sessionId });
    assert.equal(finalized.state, "FINALIZED", "a deposition with no Deepgram key still produces a recording");
    for (const source of finalized.sources) assert.match(source.artifact.sha256, /^[0-9a-f]{64}$/);
  } finally { s.cleanup() }
});

test("Deepgram refuses to start unless a recording is already running", () => {
  // The dependency runs one way. Live text attaches to a recording that exists; it never brings one
  // into being, so there is no path where the ASR side owns the audio.
  const s = scratch();
  try {
    const session = withFileCapture(() => createCaptureSession(null, {
      depositionId: DEPOSITION, storageRoot: s.storageRoot,
      fileSources: IN_PROCESS_FILE_SOURCES, sources: fileSources(s.fixture, 2),
    }));
    const { Socket } = failingSocket();
    assert.throws(
      () => startDeepgramLive(null, {
        depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot: s.storageRoot,
        apiKey: "k", WebSocketClass: Socket, spawnProcess: feedProcess,
      }),
      /Local recording must be running/,
    );
  } finally { s.cleanup() }
});
