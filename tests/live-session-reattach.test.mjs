import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCaptureSession, recoverableCaptureSessions, startCaptureSession, stopCaptureSession } from "../server/live-capture.mjs";

// What survives here after discovery was composed onto one endpoint.
//
// tests/live-session-recovery.test.mjs owns discovery itself -- that a running recording is offered
// back, that two are reported rather than guessed between, that a manifest saying RECORDING is never
// offered as something to pick up, and that an abandoned recording inside a deposition is found.
// This file asserted those against the narrower endpoint it was written for, and repeating them
// against the one that survived would be two suites saying the same thing about the same code.
//
// What is left is the part that file does not cover: that looking never finalizes, and that the
// screen asks the server rather than remembering.
let counter = 0;
const nextDeposition = () => `DEP-20260822-RE${String(++counter).padStart(3, "0")}`;
const SCREEN = fs.readFileSync(new URL("../app/LiveCaptureScreen.tsx", import.meta.url), "utf8");

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

function startRecording(s) {
  const session = createCaptureSession(null, {
    depositionId: s.depositionId, storageRoot: s.storageRoot, label: "Reattach",
    sources: [
      { id: "local-microphone", role: "LOCAL_MICROPHONE", deviceId: "mic-a", deviceName: "Mic A" },
      { id: "meeting-audio", role: "VIRTUAL_MEETING_AUDIO", deviceId: "mix-b", deviceName: "Mix B" },
    ],
  });
  startCaptureSession(null, { depositionId: s.depositionId, sessionId: session.sessionId, storageRoot: s.storageRoot, spawnProcess: () => stubChild() });
  return session;
}

const manifestOf = (s, sessionId) =>
  JSON.parse(fs.readFileSync(path.join(s.folder, "live-capture", sessionId, "capture-session.json"), "utf8"));
const discover = (s) => recoverableCaptureSessions(null, { storageRoot: s.storageRoot });

test("discovery observes and controls; it never finalizes what it found", async () => {
  // The line that matters most. A recovery path that treated a discovered recording as stale would
  // end a live deposition on a stray page load, and asking what is running is the one thing every
  // client does on mount.
  const s = scratch();
  const started = startRecording(s);
  for (let mount = 0; mount < 3; mount++) discover(s);
  const record = manifestOf(s, started.sessionId);
  assert.equal(record.state, "RECORDING", "three mounts must leave the recording running");
  assert.deepEqual(record.events.map((event) => event.type), ["SESSION_CONFIGURED", "LOCAL_RECORDING_STARTED"],
    "no stop was recorded, because looking is not stopping");
  assert.ok(record.sources.every((source) => source.artifact?.finalized === false));
  await stopCaptureSession(null, { sessionId: started.sessionId });
  s.cleanup();
});

test("every offered recording names the deposition it belongs to", async () => {
  // Discovery is deliberately not scoped by deposition -- a reporter whose browser reloaded may be
  // anywhere in the app, and a recording they cannot see is a recording they cannot stop. Scoping is
  // the client's to do, which it can only do if each entry says which deposition it is for.
  const s = scratch();
  const started = startRecording(s);
  const offered = discover(s).recoverable.find((item) => item.sessionId === started.sessionId);
  assert.ok(offered, "a running recording is offered");
  assert.equal(offered.depositionId, s.depositionId);
  assert.deepEqual(offered.channels.map((channel) => channel.id), ["local-microphone", "meeting-audio"],
    "the channels come back, so the meters and monitoring have something to render");
  await stopCaptureSession(null, { sessionId: started.sessionId });
  s.cleanup();
});

test("the screen asks the server on mount rather than trusting anything it stored", () => {
  assert.match(SCREEN, /api\/live-capture\/recoverable/,
    "one discovery endpoint; asking a second, narrower one would be a second answer to the same question");
  assert.ok(
    !/localStorage[^\n]*sessionId|sessionId[^\n]*localStorage/.test(SCREEN),
    "a stored sessionId fails on a cleared cache and cannot help a second machine; the server owns this",
  );
  assert.ok(!/api\/live-capture\/running/.test(SCREEN),
    "the narrower endpoint was retired when discovery was composed onto one");
});

test("a recording is never filtered out of the one list that could reach it", () => {
  // The screen had lost the session on reload, and the list that exists for exactly that case
  // excluded it by state, so there was no path back to the audio.
  assert.ok(
    !/item\.state !== "RECORDING"/.test(SCREEN),
    "the original filter is what made a live recording unreachable",
  );
  assert.match(SCREEN, /Stop this recording/, "a running one has to be stoppable from there");
  assert.match(SCREEN, /Finalize this recording/, "and an interrupted one finalizes rather than stopping");
});
