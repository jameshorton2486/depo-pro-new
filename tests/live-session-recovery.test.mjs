// A recording that outlives the page must still be reachable.
//
// The reporter reloads at hour three -- a stuck render, a stray keystroke, Windows deciding to
// refresh something. Every bit of client state goes; ffmpeg does not notice and keeps writing. What
// used to come back was a screen offering "Start recording" while the recording was still running,
// with no way to stop it, hash it, or attach it. That is the deliverable itself, unreachable.
//
// The tests are written as the reload: the session is started, everything the client knew is thrown
// away, and what the server can answer on its own has to be enough to close the recording out.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Set before live-capture is asked anything: captureSessionRoot() reads it, and without it the
// orphan scan would read the machine's real depositions.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "depo-recover-"));
process.env.DEPO_PRO_DEPOSITIONS_ROOT = ROOT;

const { createCaptureSession, recoverableCaptureSessions, startCaptureSession, stopCaptureSession } =
  await import("../server/live-capture.mjs");
const { CHOOSE, chooseRecovery, NONE, orphanedNotice, REATTACH } =
  await import("../app/live-recovery.mjs");

const DEPOSITION = "DEP-20260821-RECOV";
function depositionFolder(name = "witness") {
  const directory = path.join(ROOT, "reporter", "cause", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"),
    JSON.stringify({ id: DEPOSITION, caseStyle: "A v. B", witness: "Witness" }));
  return directory;
}

/** ffmpeg, minus ffmpeg: writes the channel file when told to quit, then exits. */
function fakeSpawn() {
  return (_command, args) => {
    const file = args[args.length - 1], handlers = [];
    return {
      stderr: { on() {} },
      stdin: { write() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "RIFF....WAVEfake"); for (const handler of handlers) handler(0); } },
      once(event, handler) { if (event === "exit") handlers.push(handler); },
      kill() {},
    };
  };
}

function recording(sources = [{ id: "ch1", role: "LOCAL_MICROPHONE", deviceId: "mic" }, { id: "ch2", role: "VIRTUAL_MEETING_AUDIO", deviceId: "mix" }]) {
  depositionFolder();
  const session = createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: ROOT, sources });
  startCaptureSession(null, { depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot: ROOT, spawnProcess: fakeSpawn() });
  return session.sessionId;
}
const ask = () => recoverableCaptureSessions(null, { storageRoot: ROOT });

// ---------------------------------------------------------------------------------------------
// The decision, on its own
// ---------------------------------------------------------------------------------------------

test("nothing running means nothing to do", () => {
  assert.equal(chooseRecovery({ recoverable: [], orphaned: [] }).kind, NONE);
  assert.equal(chooseRecovery(null).kind, NONE);
});

test("one running recording is picked back up without asking", () => {
  const one = { sessionId: "LIVE-1", depositionId: null, label: null, state: "RECORDING", startedAt: "2026-08-21T09:00:00Z" };
  const decision = chooseRecovery({ recoverable: [one] });
  assert.equal(decision.kind, REATTACH);
  assert.equal(decision.session, one);
});

test("two running recordings are reported, never guessed between", () => {
  // Picking one silently leaves the other recording unattended, which is the failure this closes.
  const decision = chooseRecovery({ recoverable: [{ sessionId: "LIVE-1" }, { sessionId: "LIVE-2" }] });
  assert.equal(decision.kind, CHOOSE);
  assert.equal(decision.session, null);
  assert.equal(decision.sessions.length, 2);
});

test("recordings an earlier run left open are named, not hidden", () => {
  assert.equal(orphanedNotice([]), null);
  assert.match(orphanedNotice([{ sessionId: "LIVE-1" }]), /1 recording was left open/);
  assert.match(orphanedNotice([{ sessionId: "LIVE-1" }, { sessionId: "LIVE-2" }]), /2 recordings were left open/);
  assert.match(orphanedNotice([{ sessionId: "LIVE-1" }]), /cannot be stopped or attached/);
});

// ---------------------------------------------------------------------------------------------
// The reload
// ---------------------------------------------------------------------------------------------

test("a running recording is offered back after everything the client knew is gone", async () => {
  const sessionId = recording();
  // The reload: no sessionId in hand, nothing in storage, only what the server can answer.
  const answer = ask();
  assert.equal(answer.recoverable.length, 1);
  assert.equal(answer.recoverable[0].sessionId, sessionId);
  assert.equal(answer.recoverable[0].depositionId, DEPOSITION, "and it carries its own deposition, which need not be the one on screen");
  assert.equal(answer.orphaned.length, 0);
  assert.equal(chooseRecovery(answer).kind, REATTACH);
  await stopCaptureSession(null, { sessionId });
});

test("a recording picked back up can still be closed out, and both channels finalize", async () => {
  recording(); // the id is deliberately not kept: the client no longer has it after a reload
  const decision = chooseRecovery(ask());
  assert.equal(decision.kind, REATTACH);

  const stopped = await stopCaptureSession(null, { sessionId: decision.session.sessionId });
  assert.equal(stopped.state, "FINALIZED");
  assert.equal(stopped.sources.length, 2);
  for (const source of stopped.sources) {
    assert.equal(source.state, "FINALIZED");
    assert.match(source.artifact.sha256, /^[0-9a-f]{64}$/, "hashed, or it cannot become evidence");
    assert.equal(source.artifact.finalized, true);
  }
  assert.ok(stopped.events.some(event => event.type === "LOCAL_RECORDING_STOPPED"));
  assert.equal(ask().recoverable.length, 0, "and it is no longer offered");
});

test("a stopped recording is neither recoverable nor orphaned", async () => {
  const sessionId = recording();
  await stopCaptureSession(null, { sessionId });
  const answer = ask();
  assert.equal(answer.recoverable.length, 0);
  assert.equal(answer.orphaned.length, 0, "the ending was written, so nothing was left open");
});

// ---------------------------------------------------------------------------------------------
// What a manifest cannot tell you
// ---------------------------------------------------------------------------------------------

/** A session left at RECORDING by a run of the application that is no longer here. */
function abandoned(name, sessionId) {
  const directory = path.join(depositionFolder(name), "live-capture", sessionId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "capture-session.json"), JSON.stringify({
    sessionId, depositionId: DEPOSITION, label: null, state: "RECORDING", createdAt: "2026-08-20T21:24:13.290Z",
    sources: [{ id: "ch1", role: "LOCAL_MICROPHONE", state: "RECORDING" }], events: [{ type: "LOCAL_RECORDING_STARTED" }],
  }));
  return path.join(directory, "capture-session.json");
}

test("a manifest that says RECORDING is never offered as something to pick up", () => {
  // It is not evidence that anything is recording -- only that nobody wrote the ending, which is
  // also what an unclean shutdown leaves. Reattaching would show a live screen for a recording that
  // stopped hours ago, and the stop control would throw when pressed.
  abandoned("abandoned-witness", "LIVE-20260820212413-DEAD01");
  const answer = ask();
  assert.equal(answer.recoverable.length, 0, "the runtime map is the only thing that knows");
  assert.deepEqual(answer.orphaned.map(item => item.sessionId), ["LIVE-20260820212413-DEAD01"]);
  assert.equal(chooseRecovery(answer).kind, NONE);
  assert.match(orphanedNotice(answer.orphaned), /left open by an earlier run/);
});

test("an abandoned recording inside a deposition is found, not only the unassigned ones", () => {
  // listCaptureSessions only reads the session root, so a recording started with a deposition open
  // is invisible to it -- and that is the one attached to real work.
  const answer = ask();
  assert.ok(answer.orphaned.length >= 1);
  assert.ok(answer.orphaned.every(item => item.depositionId === DEPOSITION));
});

test("writing the ending clears it, without anything else changing", () => {
  const manifest = abandoned("closed-witness", "LIVE-20260820212413-DEAD02");
  const before = ask().orphaned.map(item => item.sessionId);
  assert.ok(before.includes("LIVE-20260820212413-DEAD02"));
  const value = JSON.parse(fs.readFileSync(manifest, "utf8"));
  value.events.push({ type: "LOCAL_RECORDING_STOPPED" });
  fs.writeFileSync(manifest, JSON.stringify(value));
  assert.equal(ask().orphaned.some(item => item.sessionId === "LIVE-20260820212413-DEAD02"), false,
    "state alone does not decide it: a stopped session is DEGRADED when a channel failed");
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
