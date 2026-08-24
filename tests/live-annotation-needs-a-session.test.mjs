import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCaptureSession } from "../server/live-capture.mjs";
import { recordLiveAnnotation } from "../server/deepgram-live.mjs";

const DEPOSITION = "DEP-20260822-ANNOT";

function scratch() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-annot-"));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: DEPOSITION, caseStyle: "A v. B", witness: "W" }));
  return { storageRoot, folder, cleanup: () => fs.rmSync(storageRoot, { recursive: true, force: true }) };
}

const liveCaptureDirs = (s) => {
  const directory = path.join(s.folder, "live-capture");
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
};

const mark = (s, sessionId, depositionId = DEPOSITION) =>
  recordLiveAnnotation(null, { depositionId, sessionId, storageRoot: s.storageRoot, action: "MARK", paragraphId: "p1", wordIds: ["e1:w0"] });

test("a mark against a session that never existed is refused", () => {
  // appendLiveAnnotation creates the directory it writes into. Without a guard, one POST naming any
  // session id conjured the folder and the log -- and with a depositionId, inside that deposition's
  // own record, for a session that never ran. Nothing downstream reads it, which is exactly why it
  // could sit there unnoticed.
  const s = scratch();
  assert.throws(() => mark(s, "LIVE-fabricated-0001"), /live session that exists/);
  assert.deepEqual(liveCaptureDirs(s), [], "nothing may be written into a deposition for a session that never ran");
  s.cleanup();
});

test("a mark against a real session is stored", () => {
  // The positive control: the guard must refuse the fabricated case without refusing the real one.
  const s = scratch();
  const session = createCaptureSession(null, {
    depositionId: DEPOSITION, storageRoot: s.storageRoot,
    sources: [{ id: "ch1", role: "LOCAL_MICROPHONE", deviceId: "mic", deviceName: "Mic" }],
  });
  // The live record startDeepgramLive would have written once the aid connected.
  fs.writeFileSync(path.join(s.folder, "live-capture", session.sessionId, "live-session.json"),
    JSON.stringify({ sessionId: session.sessionId, state: "OPEN", errors: [] }));
  const result = mark(s, session.sessionId);
  assert.equal(result.annotations.length, 1);
  assert.deepEqual(result.annotations[0].wordIds, ["e1:w0"]);
  assert.deepEqual(liveCaptureDirs(s), [session.sessionId]);
  assert.ok(fs.existsSync(path.join(s.folder, "live-capture", session.sessionId, "live-annotations.jsonl")));
  s.cleanup();
});

test("an unassigned session is checked the same way, in its own root", () => {
  // An unassigned session lives under the capture root, which comes from the environment rather
  // than the arguments -- so the root is redirected here. Without that, this test writes into the
  // real deposition storage the moment the guard it is testing is absent, which is exactly what
  // happened while mutation-testing it.
  const s = scratch();
  const previous = process.env.DEPO_PRO_DEPOSITIONS_ROOT;
  process.env.DEPO_PRO_DEPOSITIONS_ROOT = s.storageRoot;
  try {
    assert.throws(() => mark(s, "LIVE-no-such-session", null), /live session that exists/);
  } finally {
    if (previous === undefined) delete process.env.DEPO_PRO_DEPOSITIONS_ROOT;
    else process.env.DEPO_PRO_DEPOSITIONS_ROOT = previous;
    s.cleanup();
  }
});
