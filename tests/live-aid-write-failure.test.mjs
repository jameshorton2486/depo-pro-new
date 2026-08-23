import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { _testing } from "../server/deepgram-live.mjs";

const { persist, appendEvent } = _testing;

// A runtime shaped as startDeepgramLive builds one, pointed at a directory that is about to stop
// existing -- which is how this was found: a session folder moved while its writer was attached.
function runtimeIn(directory) {
  return {
    paths: { directory, file: path.join(directory, "live-session.json"), events: path.join(directory, "live-events.jsonl") },
    record: { state: "OPEN", errors: [], finalizedEvents: [], updatedAt: null },
  };
}

function scratch() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-aid-"));
  return { directory, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("a manifest write that fails does not throw out of the socket handler", () => {
  // The defect. persist runs inside a WebSocket data handler; unguarded, one failed write went
  // unhandled and ended the local API process -- and with it the recording the aid may not affect.
  const s = scratch();
  const runtime = runtimeIn(s.directory);
  persist(runtime);
  assert.ok(fs.existsSync(runtime.paths.file), "it writes normally when it can");

  fs.rmSync(s.directory, { recursive: true, force: true });
  assert.doesNotThrow(() => persist(runtime), "a vanished directory must degrade the aid, not end the process");
  assert.equal(runtime.record.aidWriteFailures, 1);
  assert.match(runtime.record.errors.at(-1).message, /could not be written/);
  assert.match(runtime.record.errors.at(-1).message, /local recording is unaffected/);
  assert.equal(runtime.record.errors.at(-1).kind, "AID_WRITE");
});

test("an append that fails does not throw either, and the text still reaches the screen", () => {
  const s = scratch();
  const runtime = runtimeIn(s.directory);
  appendEvent(runtime, { id: "e1", transcript: "on the record" });
  assert.equal(runtime.record.finalizedEvents.length, 1);

  fs.rmSync(s.directory, { recursive: true, force: true });
  assert.doesNotThrow(() => appendEvent(runtime, { id: "e2", transcript: "objection" }));
  assert.equal(runtime.record.aidWriteFailures, 1);
  assert.equal(runtime.record.errors.at(-1).kind, "AID_APPEND");
  assert.deepEqual(runtime.record.finalizedEvents.map((event) => event.id), ["e1", "e2"],
    "the reporter still sees what arrived; losing the screen too would make a disk fault look like a transcription fault");
});

test("a failing disk fails on every message, and the error list stays bounded", () => {
  const s = scratch();
  const runtime = runtimeIn(s.directory);
  fs.rmSync(s.directory, { recursive: true, force: true });
  for (let message = 0; message < 500; message++) {
    persist(runtime);
    appendEvent(runtime, { id: `e${message}`, transcript: "text" });
  }
  assert.equal(runtime.record.errors.length, 1, "one entry, not one per message");
  assert.equal(runtime.record.aidWriteFailures, 1000, "the count still tells the whole story");
});

test("a failed rename leaves no temp file behind", () => {
  // atomic writes to a temp then renames. If the rename fails the temp used to remain, so a disk
  // fault during a deposition would litter the session folder with partial manifests.
  const s = scratch();
  const runtime = runtimeIn(s.directory);
  // A directory where the manifest should be: the write succeeds, the rename cannot.
  fs.mkdirSync(runtime.paths.file, { recursive: true });
  assert.doesNotThrow(() => persist(runtime));
  assert.equal(runtime.record.aidWriteFailures, 1, "the rename failure was caught and reported");
  const leftovers = fs.readdirSync(s.directory).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "the temp file is removed when the rename it was made for fails");
  s.cleanup();
});

test("nothing is reported when nothing fails", () => {
  const s = scratch();
  const runtime = runtimeIn(s.directory);
  persist(runtime);
  appendEvent(runtime, { id: "e1", transcript: "text" });
  assert.equal(runtime.record.aidWriteFailures, undefined);
  assert.deepEqual(runtime.record.errors, []);
  s.cleanup();
});
