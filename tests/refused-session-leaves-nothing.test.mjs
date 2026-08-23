import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCaptureSession } from "../server/live-capture.mjs";

const DEPOSITION = "DEP-20260822-LITTR";

function scratch() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-litter-"));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: DEPOSITION, caseStyle: "A v. B", witness: "W" }));
  return { storageRoot, folder, cleanup: () => fs.rmSync(storageRoot, { recursive: true, force: true }) };
}

const liveCaptureDirs = (s) => {
  const directory = path.join(s.folder, "live-capture");
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
};

// Every way a session can be refused. Each one used to run after the folder had already been made.
const REFUSALS = [
  { name: "no sources at all", sources: [], expect: /at least one independent audio source/ },
  { name: "sources that are not an array", sources: null, expect: /at least one independent audio source/ },
  { name: "two channels sharing an ID", sources: [{ id: "ch1", deviceId: "a" }, { id: "ch1", deviceId: "b" }], expect: /unique stable channel ID/ },
  { name: "a channel ID the server will not accept", sources: [{ id: "Ch One!", deviceId: "a" }], expect: /unique stable channel ID/ },
  { name: "a device name carrying a newline", sources: [{ id: "ch1", deviceId: "bad\nname" }], expect: /valid Windows audio device/ },
  { name: "a file-backed source, which cannot be requested", sources: [{ id: "ch1", kind: "file", filePath: "anywhere.wav" }], expect: /cannot be requested/ },
];

test("a refused session writes nothing into the deposition's record", () => {
  const s = scratch();
  for (const refusal of REFUSALS) {
    assert.throws(
      () => createCaptureSession(null, { depositionId: DEPOSITION, storageRoot: s.storageRoot, sources: refusal.sources }),
      refusal.expect,
      refusal.name,
    );
    assert.deepEqual(liveCaptureDirs(s), [],
      `${refusal.name}: a refusal left a folder inside the deposition record`);
  }
  s.cleanup();
});

test("a session that is accepted does create its folder", () => {
  // The other half: the guard must not have moved the creation somewhere it never happens.
  const s = scratch();
  const session = createCaptureSession(null, {
    depositionId: DEPOSITION, storageRoot: s.storageRoot,
    sources: [{ id: "ch1", role: "LOCAL_MICROPHONE", deviceId: "mic", deviceName: "Mic" }],
  });
  assert.deepEqual(liveCaptureDirs(s), [session.sessionId]);
  assert.ok(fs.existsSync(path.join(s.folder, "live-capture", session.sessionId, "channels")),
    "the channels directory is what the capture processes write into");
  assert.ok(fs.existsSync(path.join(s.folder, "live-capture", session.sessionId, "capture-session.json")));
  s.cleanup();
});
