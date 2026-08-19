import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const DEPOSITION = "DEP-20260819-ASSGN";
const sha = buffer => crypto.createHash("sha256").update(buffer).digest("hex");

/**
 * A finished unassigned recording, written where an unassigned capture writes: beside the
 * depositions, not inside one.
 */
async function fixture({ states = ["FINALIZED", "FINALIZED"], assigned = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-unassigned-"));
  process.env.DEPO_PRO_DEPOSITIONS_ROOT = root;
  const { captureSessionRoot } = await import("../server/storage-config.mjs");
  const sessionId = "LIVE-20260819010000-ABC123";
  const sessions = captureSessionRoot();
  fs.mkdirSync(path.join(sessions, sessionId, "channels"), { recursive: true });

  const sources = states.map((state, index) => {
    const relative = `${sessionId}/channels/${String(index + 1).padStart(2, "0")}-ch${index + 1}.wav`;
    const bytes = Buffer.from(`channel ${index + 1} lossless audio`);
    if (state === "FINALIZED") fs.writeFileSync(path.join(sessions, ...relative.split("/")), bytes);
    return {
      id: `ch${index + 1}`, ordinal: index, role: index ? "EXAMINING_ATTORNEY" : "WITNESS",
      deviceId: `d${index}`, deviceName: `Device ${index}`, state,
      artifact: state === "FINALIZED" ? { relativePath: relative, bytes: bytes.length, sha256: sha(bytes), finalized: true } : null,
    };
  });

  fs.writeFileSync(path.join(sessions, sessionId, "capture-session.json"), JSON.stringify({
    sessionId, depositionId: null, label: "Garza — Herber depo", assignedDepositionId: assigned, assignedAt: null,
    state: "FINALIZED", sources, events: [], createdAt: "2026-08-19T01:00:00.000Z",
  }));

  const directory = path.join(root, "reporter", "cause", "deposition");
  fs.mkdirSync(path.join(directory, "audio", "original"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: DEPOSITION, caseStyle: "Garza v. Home Depot", witness: "Heath Thomas", audio: [], audioFiles: [], audioIntakeIds: [] }));
  return { root, storageRoot: root, sessions, sessionId, directory };
}

const cleanup = value => { fs.rmSync(value.root, { recursive: true, force: true }); delete process.env.DEPO_PRO_DEPOSITIONS_ROOT; };
const deposition = value => JSON.parse(fs.readFileSync(path.join(value.directory, "deposition.json"), "utf8"));
const manifest = value => JSON.parse(fs.readFileSync(path.join(value.sessions, value.sessionId, "capture-session.json"), "utf8"));

test("a recording can be made before anyone decides which deposition it belongs to",async()=>{
  const value = await fixture();
  try {
    const { createCaptureSession, listCaptureSessions } = await import("../server/live-capture.mjs");
    const created = createCaptureSession(null, { label: "Tues AM Rodriguez", sources: [{ id: "ch1", role: "WITNESS", deviceId: "m", deviceName: "Mic" }] });
    assert.equal(created.depositionId, null);
    assert.equal(created.label, "Tues AM Rodriguez");
    assert.equal(created.assignedDepositionId, null);
    // It is findable by the one thing the reporter typed.
    const listed = listCaptureSessions();
    assert.ok(listed.some(item => item.label === "Tues AM Rodriguez"));
    assert.ok(listed.some(item => item.label === "Garza — Herber depo"));
  } finally { cleanup(value); }
});

test("a recording can start without a name, and is still findable",async()=>{
  // RULING, 2026-08-19, reversing the earlier requirement. A reporter pressing record is not in a
  // position to name anything yet, and requiring it put a text field between them and the one
  // action that must not be delayed. The session still gets a label -- the start time, which is
  // always true -- and renameCaptureSession gives it a useful one afterwards.
  const value = await fixture();
  try {
    const { createCaptureSession, renameCaptureSession, listCaptureSessions } = await import("../server/live-capture.mjs");
    const sources = [{ id: "ch1", role: "LOCAL_MICROPHONE", deviceId: "m", deviceName: "Mic" }];
    const unnamed = createCaptureSession(null, { sources });
    assert.match(unnamed.label, /^Recording \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "a default name that is a fact, not a guess");
    assert.equal(createCaptureSession(null, { label: "   ", sources }).label.startsWith("Recording "), true, "whitespace is not a name");

    const renamed = renameCaptureSession(null, { sessionId: unnamed.sessionId, label: "  Tues AM Horton — James  " });
    assert.equal(renamed.label, "Tues AM Horton — James");
    assert.ok(renamed.events.some(event => event.type === "RENAMED"), "and the change is recorded");
    assert.throws(() => renameCaptureSession(null, { sessionId: unnamed.sessionId, label: "  " }), /needs a name/);
    assert.ok(listCaptureSessions().some(item => item.label === "Tues AM Horton — James"));
  } finally { cleanup(value); }
});

test("assigning moves the audio into the deposition and proves it arrived intact",async()=>{
  const value = await fixture();
  try {
    const { assignCaptureSession } = await import("../server/live-capture.mjs");
    const before = manifest(value).sources.map(source => source.artifact.sha256);
    const result = await assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot });

    assert.equal(result.added.length, 2);
    const record = deposition(value);
    assert.equal(record.audio.length, 2);
    for (const [index, item] of record.audio.entries()) {
      assert.match(item.path, /^audio\/original\//, "a deposition's audio lives inside the deposition");
      const file = path.join(value.directory, ...item.path.split("/"));
      assert.ok(fs.existsSync(file));
      assert.equal(sha(fs.readFileSync(file)), before[index], "the bytes that arrived are the bytes that were recorded");
      assert.equal(item.sha256, before[index]);
    }
    // Moved, not copied: nothing is left behind to drift out of step.
    assert.equal(fs.existsSync(path.join(value.sessions, value.sessionId, "channels", "01-ch1.wav")), false);
    const after = manifest(value);
    assert.equal(after.assignedDepositionId, DEPOSITION);
    assert.ok(after.assignedAt);
    assert.deepEqual(after.sources[0].artifact.movedTo, { depositionId: DEPOSITION, name: `${value.sessionId}-ch1.wav` });
  } finally { cleanup(value); }
});

test("a recording that changed on disk is refused before anything moves",async()=>{
  // The first of the two hash checks. A damaged channel is found while the recording is still
  // whole and in one place, rather than half-moved.
  const value = await fixture();
  try {
    const { assignCaptureSession } = await import("../server/live-capture.mjs");
    fs.writeFileSync(path.join(value.sessions, value.sessionId, "channels", "02-ch2.wav"), Buffer.from("tampered"));
    await assert.rejects(() => assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot }),
      /failed SHA-256 verification before moving/);
    assert.equal(deposition(value).audio.length, 0, "nothing was added");
    assert.ok(fs.existsSync(path.join(value.sessions, value.sessionId, "channels", "01-ch1.wav")), "and the healthy channel did not move either");
  } finally { cleanup(value); }
});

test("assigning twice is refused",async()=>{
  const value = await fixture({ assigned: "DEP-20260101-OTHER" });
  try {
    const { assignCaptureSession } = await import("../server/live-capture.mjs");
    await assert.rejects(() => assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot }),
      /already part of deposition DEP-20260101-OTHER/);
  } finally { cleanup(value); }
});

test("a channel that failed does not stop the ones that finished",async()=>{
  const value = await fixture({ states: ["FINALIZED", "FAILED"] });
  try {
    const { assignCaptureSession } = await import("../server/live-capture.mjs");
    const result = await assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot });
    assert.equal(result.added.length, 1);
    assert.deepEqual(result.skipped, [{ id: "ch2", role: "EXAMINING_ATTORNEY", state: "FAILED" }]);
  } finally { cleanup(value); }
});

test("a still-running recording cannot be assigned, and a name collision is refused",async()=>{
  const value = await fixture();
  try {
    const { assignCaptureSession } = await import("../server/live-capture.mjs");
    const running = manifest(value); running.state = "RECORDING";
    fs.writeFileSync(path.join(value.sessions, value.sessionId, "capture-session.json"), JSON.stringify(running));
    await assert.rejects(() => assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot }), /Stop and finalize/);

    const finished = manifest(value); finished.state = "FINALIZED";
    fs.writeFileSync(path.join(value.sessions, value.sessionId, "capture-session.json"), JSON.stringify(finished));
    fs.writeFileSync(path.join(value.directory, "audio", "original", `${value.sessionId}-ch1.wav`), Buffer.from("already here"));
    await assert.rejects(() => assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot }), /already exists in this deposition/);
    assert.equal(deposition(value).audio.length, 0, "and the collision stopped it before any move");
  } finally { cleanup(value); }
});

test("unassigned sessions are not scanned as depositions",async()=>{
  // The leading dot on the sessions folder is what keeps a recording out of the deposition library
  // rather than appearing there as a malformed one.
  const value = await fixture();
  try {
    const { scanDepositions } = await import("../server/deposition-store.mjs");
    const scan = scanDepositions(null, { storageRoot: value.storageRoot });
    assert.deepEqual(scan.issues, [], "an unassigned recording is not an orphaned folder");
    assert.deepEqual(scan.depositions.map(item => item.id), [DEPOSITION], "only the real deposition is listed");
  } finally { cleanup(value); }
});

test("a move that damages the audio is caught, and nothing is registered",async()=>{
  // The second of the two hash checks. A rename on one volume cannot corrupt, so this is the case
  // no ordinary run reaches -- and it is the one that decides whether the deposition ends up
  // holding audio nobody verified after it arrived.
  const value = await fixture();
  try {
    const { assignCaptureSession } = await import("../server/live-capture.mjs");
    const damaging = (from, to) => { fs.writeFileSync(to, Buffer.from("not what was recorded")); fs.rmSync(from, { force: true }); };
    await assert.rejects(() => assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot, rename: damaging }),
      error => {
        assert.match(error.message, /failed SHA-256 verification after moving/);
        assert.deepEqual(error.movedFiles, ["audio/original/LIVE-20260819010000-ABC123-ch1.wav"], "and says exactly what was moved, so it can be recovered");
        return true;
      });
    assert.equal(deposition(value).audio.length, 0, "a damaged move registers nothing");
    assert.equal(manifest(value).assignedDepositionId, null, "and the session is not marked assigned");
  } finally { cleanup(value); }
});

test("only finalized channels are attached",async()=>{
  // Asserted against assignCaptureSession specifically: a channel with no artifact must be skipped
  // rather than reached for.
  const value = await fixture({ states: ["FINALIZED", "FAILED"] });
  try {
    const { assignCaptureSession } = await import("../server/live-capture.mjs");
    const result = await assignCaptureSession(null, { sessionId: value.sessionId, depositionId: DEPOSITION, storageRoot: value.storageRoot });
    assert.deepEqual(result.added.map(item => item.name), [`${value.sessionId}-ch1.wav`]);
    assert.equal(deposition(value).audio.length, 1);
    assert.equal(fs.existsSync(path.join(value.directory, "audio", "original", `${value.sessionId}-ch2.wav`)), false, "the failed channel produced no file");
  } finally { cleanup(value); }
});
