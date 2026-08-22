import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FILE_CAPTURE_FLAG,
  assignCaptureSession,
  createCaptureSession,
  registerCaptureAudio,
  startCaptureSession,
} from "../server/live-capture.mjs";

const DEPOSITION = "DEP-20260822-FIXTR";

// The flag is read at call time, so it is set and cleared around each case rather than for the
// process -- otherwise one test turning it on would quietly license every test after it.
function withFileCapture(allowed, run) {
  const previous = process.env[FILE_CAPTURE_FLAG];
  if (allowed) process.env[FILE_CAPTURE_FLAG] = "1";
  else delete process.env[FILE_CAPTURE_FLAG];
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env[FILE_CAPTURE_FLAG];
    else process.env[FILE_CAPTURE_FLAG] = previous;
  }
}

function scratch({ channels = 4 } = {}) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-fixture-"));
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

test("a file-backed source is refused unless the flag is set", () => {
  const s = scratch();
  withFileCapture(false, () => {
    assert.throws(
      () => createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot, sources: fileSources(s.fixture, 1) }),
      new RegExp(FILE_CAPTURE_FLAG),
      "a reporter's machine must not be able to reach this at all",
    );
  });
  s.cleanup();
});

test("four channels of one fixture become four distinct sources", () => {
  const s = scratch();
  withFileCapture(true, () => {
    const session = createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot, sources: fileSources(s.fixture, 4) });
    assert.equal(session.sources.length, 4);
    assert.equal(new Set(session.sources.map((source) => source.deviceId)).size, 4,
      "the preflight signature and the duplicate checks both key on deviceId, so four channels of one file must not collapse to one");
    assert.deepEqual(session.sources.map((source) => source.sourceFile.channelIndex), [0, 1, 2, 3]);
    assert.ok(session.sources.every((source) => source.backend === "file"));
    assert.equal(session.sources[0].sourceFile.bytes, fs.statSync(s.fixture).size);
    assert.equal(session.sources[0].sourceFile.sha256, null, "the content hash is taken at stop, not guessed at configure");
  });
  s.cleanup();
});

test("a session with a file source is marked synthetic and says so in its timeline", () => {
  const s = scratch();
  withFileCapture(true, () => {
    const session = createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot, sources: fileSources(s.fixture, 2) });
    assert.equal(session.synthetic, true);
    assert.equal(session.timeline.channelsSampleAligned, true, "every channel is read from position zero of one file");
    assert.match(session.timeline.doNotUseFor, /synthetic/i);
    assert.match(session.timeline.doNotUseFor, /cannot be attached/i);
  });
  s.cleanup();
});

test("a microphone session is untouched by any of this", () => {
  const s = scratch();
  const session = createCaptureSession(null, {
    depositionId: DEPOSITION, storageRoot: s.storageRoot,
    sources: [{ id: "ch1", role: "LOCAL_MICROPHONE", deviceId: "mic", deviceName: "Mic" }],
  });
  assert.equal(session.synthetic, false);
  assert.equal(session.sources[0].backend, "windows-directshow");
  assert.equal(session.sources[0].sourceFile, null);
  assert.equal(session.timeline.channelsSampleAligned, false, "independent processes on independent devices are still not aligned");
  assert.match(session.timeline.reason, /independent process/);
  s.cleanup();
});

test("the capture process is paced in real time and given one channel of the file", () => {
  // The claim that makes this usable is that ten minutes of fixture takes ten minutes. Dropping
  // -re would still produce four correct recordings, in seconds, exercising none of the live path.
  const s = scratch();
  withFileCapture(true, () => {
    const session = createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot, sources: fileSources(s.fixture, 4) });
    const spawned = [];
    const spawnProcess = (command, args) => { spawned.push({ command, args }); return { stderr: { on() {} }, once() {}, kill() {} }; };
    startCaptureSession(null, { depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot: s.storageRoot, spawnProcess });

    assert.equal(spawned.length, 4, "one process per channel, as with four microphones");
    for (const [index, { command, args }] of spawned.entries()) {
      assert.equal(command, "ffmpeg");
      assert.ok(args.includes("-re"), "without -re the fixture is consumed as fast as the disk allows");
      assert.ok(args.includes(s.fixture), "the input is the file itself");
      assert.ok(!args.includes("dshow"), "a file source must not reach for an audio device");
      const filter = args[args.indexOf("-af") + 1];
      assert.ok(filter.startsWith(`pan=mono|c0=c${index}`), `channel ${index} is taken from the fixture, not the whole mix`);
      assert.ok(/astats/.test(filter), "levels are still measured, so the meters behave as they do on a microphone");
      assert.ok(args.includes("pcm_s24le"), "same codec as a captured channel");
    }
  });
  s.cleanup();
});

// Builds a session that is finished, hashed and in every other way valid, so a refusal can only be
// on the ground that it is synthetic. `home` decides whether it lives in the deposition (which
// registerCaptureAudio reads) or in the unassigned capture root (which assignCaptureSession reads).
function finishedSession(s, { depositionId, home }) {
  const session = createCaptureSession(null, { depositionId, storageRoot: s.storageRoot, sources: fileSources(s.fixture, 2) });
  const directory = depositionId ? path.join(home, "live-capture", session.sessionId) : path.join(home, session.sessionId);
  const manifestPath = path.join(directory, "capture-session.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.state = "FINALIZED";
  for (const source of manifest.sources) {
    const channel = path.join(directory, "channels", `${String(source.ordinal + 1).padStart(2, "0")}-${source.id}.wav`);
    fs.mkdirSync(path.dirname(channel), { recursive: true });
    fs.copyFileSync(s.fixture, channel);
    source.state = "FINALIZED";
    source.artifact = { relativePath: path.relative(depositionId ? home : path.dirname(directory), channel).replaceAll("\\", "/"), bytes: fs.statSync(channel).size, sha256: "0".repeat(64), finalized: true };
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return session;
}

test("synthetic audio cannot be registered as a deposition's audio", () => {
  const s = scratch();
  withFileCapture(true, () => {
    const session = finishedSession(s, { depositionId: DEPOSITION, home: s.folder });
    assert.throws(
      () => registerCaptureAudio(null, { depositionId: DEPOSITION, sessionId: session.sessionId, storageRoot: s.storageRoot }),
      /Synthetic audio cannot be attached/);
  });
  s.cleanup();
});

test("synthetic audio cannot be attached to a deposition", async () => {
  // The guard this change exists to carry. Everything else is convenience; this is the part that
  // has to hold, because the file being read is a fixture of invented dialogue.
  const s = scratch();
  const previousRoot = process.env.DEPO_PRO_DEPOSITIONS_ROOT;
  process.env.DEPO_PRO_DEPOSITIONS_ROOT = s.storageRoot;
  try {
    const { captureSessionRoot } = await import("../server/storage-config.mjs");
    await withFileCapture(true, async () => {
      const session = finishedSession(s, { depositionId: null, home: captureSessionRoot() });
      await assert.rejects(
        assignCaptureSession(null, { sessionId: session.sessionId, depositionId: DEPOSITION, storageRoot: s.storageRoot }),
        /Synthetic audio cannot be attached/);
    });
  } finally {
    if (previousRoot === undefined) delete process.env.DEPO_PRO_DEPOSITIONS_ROOT;
    else process.env.DEPO_PRO_DEPOSITIONS_ROOT = previousRoot;
    s.cleanup();
  }
});

test("a file that is not there, and a channel that is not a channel, are both refused", () => {
  const s = scratch();
  withFileCapture(true, () => {
    assert.throws(
      () => createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot,
        sources: [{ id: "ch1", kind: "file", filePath: path.join(s.storageRoot, "absent.wav") }] }),
      /was not found/);
    assert.throws(
      () => createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot,
        sources: [{ id: "ch1", kind: "file", filePath: s.fixture, channelIndex: -1 }] }),
      /non-negative integer/);
    assert.throws(
      () => createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot,
        sources: [{ id: "ch1", kind: "file", filePath: "  " }] }),
      /requires the path/);
  });
  s.cleanup();
});

test("the live aid reads one channel of the fixture, not a mix of all four", async () => {
  // -ac 1 downmixes whatever it is handed. Without the pan in front of it every stream would get
  // the same sum of four people talking at once -- four sockets, one indistinguishable feed, and a
  // four-channel run that looks like it worked.
  const { feedArgs } = await import("../server/deepgram-live.mjs");
  const s = scratch();
  withFileCapture(true, () => {
    const session = createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot, sources: fileSources(s.fixture, 4) });
    for (const [index, source] of session.sources.entries()) {
      const args = feedArgs(source);
      assert.ok(args.includes("-re"), "the feed is paced like the room it stands in for");
      assert.ok(!args.includes("dshow"), "a file source must not reach for an audio device");
      assert.equal(args[args.indexOf("-af") + 1], `pan=mono|c0=c${index}`);
      assert.ok(args.indexOf("-af") < args.indexOf("-ac"), "the channel is selected before the downmix, or the downmix sums all four");
      assert.equal(args[args.indexOf("-ar") + 1], "16000", "the streaming rate is unchanged by any of this");
    }
    // A microphone source still reaches dshow exactly as before.
    const mic = createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot,
      sources: [{ id: "ch1", role: "LOCAL_MICROPHONE", deviceId: "mic", deviceName: "Mic" }] });
    const micArgs = feedArgs(mic.sources[0]);
    assert.ok(micArgs.includes("dshow"));
    assert.ok(!micArgs.includes("-re"), "a live device is already paced by the clock it runs on");
  });
  s.cleanup();
});
