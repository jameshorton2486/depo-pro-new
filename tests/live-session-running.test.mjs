// A degraded session is still writing. startCaptureSession sets DEGRADED from the ffmpeg exit
// handler when one channel dies mid-recording; the surviving channels keep recording and the
// reporter still has to be able to stop them. stopCaptureSession sets the same state when a
// channel failed to finalize, which is terminal. The screen tested state alone, so a degraded
// live session read as finished -- Stop hidden, polling stopped, Back unlocked, no path to
// finalize the surviving audio on a feature where the audio is the deliverable.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "..", "app", "LiveCaptureScreen.tsx"), "utf8");
const isRunning = new Function("session", `
  ${source.match(/const isRunning=\(session[^;]+;/s)[0].replace(/:Session\|null/, "").replace(/session!/g, "session").replace("const isRunning=", "const fn=")}
  return fn(session);
`);

const session = (state, events = []) => ({ sessionId:"s1", state, sources:[], events });

test("a recording session is running", () => {
  assert.equal(isRunning(session("RECORDING")), true);
});

test("a session degraded by a lost channel is still running", () => {
  // The whole point: one channel's ffmpeg exited, the others are still writing.
  assert.equal(isRunning(session("DEGRADED")), true);
});

test("a session degraded on stop is not running", () => {
  assert.equal(isRunning(session("DEGRADED", [{ type:"LOCAL_RECORDING_STOPPED" }])), false);
});

test("a finalized session is not running", () => {
  assert.equal(isRunning(session("FINALIZED", [{ type:"LOCAL_RECORDING_STOPPED" }])), false);
});

test("a configured session that has not started is not running", () => {
  assert.equal(isRunning(session("CONFIGURED")), false);
});

test("no session is not running", () => {
  assert.equal(isRunning(null), false);
});

test("every audio element served by the local API is cross-origin", () => {
  // The read-back player was added without crossOrigin and was blocked by the origin gate -- the
  // same defect this branch already diagnosed once, wrote a retraction for, and fixed on the
  // preflight element. Asserting the class rather than the instance is what stops the next new
  // audio element from repeating it.
  const elements = source.match(/<audio[^>]*>/g) ?? [];
  assert.ok(elements.length >= 2, "expected the preflight and read-back players");
  const bare = elements.filter(element => /\$\{API\}/.test(element) && !/crossOrigin=/.test(element));
  assert.deepEqual(bare, [], "an <audio> element pointing at the local API needs crossOrigin=\"anonymous\" or the origin gate returns 403");
});
