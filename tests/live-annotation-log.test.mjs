// A red mark has to still be there after the reload.
//
// The reporter marks a passage at hour two so they can find it again for read-back. If the tab
// reloads -- and over eight hours it will, for any reason -- a mark held only in the browser is
// gone, and gone silently: the reporter believes the passage is marked and has stopped holding it
// in their head. That is worse than never offering the mark. So the test that matters here is not
// that marking works, it is that marking survives everything in memory being thrown away.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendLiveAnnotation, readLiveAnnotations } from "../server/live-annotation-log.mjs";
import { getDeepgramLive, liveSessionPaths, recordLiveAnnotation } from "../server/deepgram-live.mjs";
import { redWordIds } from "../app/live-annotations.mjs";

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-marks-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const logFile = t => path.join(temporary(t), "live-annotations.jsonl");
/** Everything in memory is discarded; only the file remains. This is the reload. */
const afterReload = file => redWordIds(readLiveAnnotations(file).annotations);

test("a mark is on disk before anything reports that it exists", t => {
  const file = logFile(t);
  const written = appendLiveAnnotation(file, { action: "MARK", paragraphId: "e1:0", wordIds: ["e1:w0"] });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const stored = JSON.parse(lines[0]);
  assert.equal(stored.annotationId, written.annotationId);
  assert.deepEqual(stored.wordIds, ["e1:w0"]);
  assert.equal(stored.value, "RED");
  assert.equal(stored.recordType, "LIVE_ANNOTATION");
});

test("the marks come back when everything in memory is gone", t => {
  const file = logFile(t);
  appendLiveAnnotation(file, { action: "MARK", paragraphId: "e1:0", wordIds: ["e1:w0", "e1:w1"] });
  appendLiveAnnotation(file, { action: "MARK", paragraphId: "e9:0", wordIds: ["e9:w3"] });
  assert.deepEqual([...afterReload(file)].sort(), ["e1:w0", "e1:w1", "e9:w3"]);
});

test("clearing red survives the reload, and narrows the phrase rather than dropping it", t => {
  const file = logFile(t);
  appendLiveAnnotation(file, { action: "MARK", paragraphId: "e1:0", wordIds: ["e1:w0", "e1:w1", "e1:w2"] });
  appendLiveAnnotation(file, { action: "UNMARK", paragraphId: "e1:0", wordIds: ["e1:w1"] });
  assert.deepEqual([...afterReload(file)].sort(), ["e1:w0", "e1:w2"], "the rest of the phrase is still red");
});

test("the log assigns the id, and no two marks share one across a reload", t => {
  const file = logFile(t);
  const first = appendLiveAnnotation(file, { action: "MARK", paragraphId: "e1:0", wordIds: ["e1:w0"] });
  // A second process, a second tab, a second day: the client-side counter would restart at one.
  const second = appendLiveAnnotation(file, { action: "MARK", paragraphId: "e2:0", wordIds: ["e2:w0"] });
  assert.notEqual(first.annotationId, second.annotationId);
  for (const id of [first.annotationId, second.annotationId]) assert.match(id, /^AN-[0-9A-F]{8}$/);
  const restored = readLiveAnnotations(file).annotations.map(item => item.annotationId);
  assert.deepEqual(restored, [first.annotationId, second.annotationId], "the ids in the file are the ids that come back");
});

test("a mark that could not be written is not reported as a mark", t => {
  const directory = temporary(t);
  // A file where the session directory should be, so the append cannot succeed.
  const blocked = path.join(directory, "not-a-directory");
  fs.writeFileSync(blocked, "");
  assert.throws(() => appendLiveAnnotation(path.join(blocked, "live-annotations.jsonl"),
    { action: "MARK", paragraphId: "e1:0", wordIds: ["e1:w0"] }));
});

test("a mark with no words, or no paragraph, is refused rather than stored empty", t => {
  const file = logFile(t);
  assert.throws(() => appendLiveAnnotation(file, { action: "MARK", paragraphId: "e1:0", wordIds: [] }));
  assert.throws(() => appendLiveAnnotation(file, { action: "MARK", wordIds: ["e1:w0"] }));
  assert.throws(() => appendLiveAnnotation(file, { action: "SHOUT", paragraphId: "e1:0", wordIds: ["e1:w0"] }));
  assert.equal(fs.existsSync(file), false, "nothing was written");
});

test("one torn line does not take the other marks with it, and is counted rather than hidden", t => {
  const file = logFile(t);
  appendLiveAnnotation(file, { action: "MARK", paragraphId: "e1:0", wordIds: ["e1:w0"] });
  fs.appendFileSync(file, "{\"recordType\":\"LIVE_ANNOTATION\",\"action\":\"MARK\",\"word\n");
  appendLiveAnnotation(file, { action: "MARK", paragraphId: "e2:0", wordIds: ["e2:w0"] });
  const read = readLiveAnnotations(file);
  assert.deepEqual([...redWordIds(read.annotations)].sort(), ["e1:w0", "e2:w0"]);
  assert.equal(read.unreadableLines, 1, "the reporter is told the restored set is incomplete");
});

// ---------------------------------------------------------------------------------------------
// The tail. The screen shows a window of the event log; the marks are not windowed.
// ---------------------------------------------------------------------------------------------

/** A finished live session with `count` finalized events on disk. */
function sessionWith(t, count) {
  const root = temporary(t);
  const storageRoot = path.join(root, "depos"), directory = path.join(storageRoot, "r", "c", "d");
  const sessionId = "LIVE-20260821000000-AAAAAA", depositionId = "DEP-20260821-MARKS";
  const live = path.join(directory, "live-capture", sessionId);
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: depositionId }));
  fs.writeFileSync(path.join(live, "live-session.json"), JSON.stringify({
    schemaVersion: "1.0.0", sessionId, depositionId, state: "CLOSED",
    canonicalTranscriptAuthority: false, channels: [], interimByChannel: {}, errors: [],
  }));
  fs.writeFileSync(path.join(live, "live-events.jsonl"), Array.from({ length: count }, (unusedValue, index) =>
    JSON.stringify({ id: `e${index}`, channelId: "ch1", sessionOffsetSeconds: 0, start: index, duration: 1,
      words: [{ word: "word", punctuatedWord: "Word", start: index, end: index + 0.4, speaker: 0, confidence: 0.9 }] })
  ).join("\n") + "\n");
  return { storageRoot, depositionId, sessionId };
}

test("a mark made hours before the visible window still comes back", t => {
  // 500 events, and the live screen only ever renders the last 400. The marked word is off the top
  // of what the poll returns -- which is where every mark ends up by mid-morning.
  const value = sessionWith(t, 500);
  const marked = "e0:w0";
  recordLiveAnnotation(null, { ...value, action: "MARK", paragraphId: "e0:0", wordIds: [marked] });

  const read = getDeepgramLive(null, value);
  assert.equal(read.finalizedEvents.length, 400, "the events are tailed");
  assert.equal(read.finalizedEvents.some(item => item.id === "e0"), false,
    "and the marked word is outside the window, which is the case under test");
  assert.ok(redWordIds(read.annotations).has(marked), "the mark is returned whole, not tailed with the events");
  assert.equal(read.annotationLogLength, 1);
});

test("marks are read from the log the poll already carries, in the session's own directory", t => {
  const value = sessionWith(t, 2);
  recordLiveAnnotation(null, { ...value, action: "MARK", paragraphId: "e1:0", wordIds: ["e1:w0"] });
  const paths = liveSessionPaths(null, value.depositionId, value.sessionId, value.storageRoot);
  assert.equal(path.dirname(paths.annotations), path.dirname(paths.events), "beside the events it annotates");
  assert.equal(path.basename(paths.annotations), "live-annotations.jsonl");
  assert.ok(fs.existsSync(paths.annotations));
  // Nothing was written into the session manifest or the event log.
  assert.equal(fs.readFileSync(paths.events, "utf8").includes("LIVE_ANNOTATION"), false);
  assert.equal(fs.readFileSync(paths.file, "utf8").includes("LIVE_ANNOTATION"), false);
});
