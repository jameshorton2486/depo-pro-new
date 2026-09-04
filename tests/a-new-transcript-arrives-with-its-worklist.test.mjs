// A newly transcribed deposition should reach the reporter with the AI review worklist already
// prepared.
//
// E2E-034, found during the Heath Thomas production run. The correction subsystem was complete --
// twelve modules, four routes, twelve test files -- and reachable only by pressing "Correct
// Transcript". So 2h27m of deposition arrived as 900 paragraphs of SPEAKER 0 / SPEAKER 1 with the
// oath mis-recognised, and the work the passes exist to do never happened. Nothing was broken. The
// wire was missing.
//
// What is wired is RUNNING, not APPLYING. The passes propose; the reporter decides. That boundary
// is the reason the subsystem is trustworthy and this must not blur it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PRECORRECTION_STATUS, alreadyPreparedFor, preparePrecorrection } from "../server/precorrection-trigger.mjs";

const API = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
const ok = accepted => async () => ({ accepted });
const boom = message => async () => { throw new Error(message); };
const noPasses = () => [];

test("transcribing prepares the worklist without being asked", async () => {
  const result = await preparePrecorrection(null, {
    depositionId: "DEP-1", apiKey: "key", listPasses: noPasses,
    entityPass: ok([{ wordId: "w1" }, { wordId: "w2" }]),
    speakerRangePass: ok([{ wordId: "w3" }]),
  });
  assert.equal(result.status, PRECORRECTION_STATUS.RAN);
  assert.deepEqual(result.ran, ["names", "speaker-ranges"]);
  assert.equal(result.proposals, 3);
  assert.match(result.message, /Nothing has been applied/);

  // And it is actually called from the transcription route, not merely available.
  assert.match(API, /preparePrecorrection\(root, \{/, "the transcribe route must invoke it");
});

test("it proposes and never applies", async () => {
  // The trigger has no access to the overlay, and must not acquire one. If this file ever imports
  // an operation writer, the boundary that keeps AI out of the authoritative record is gone.
  const source = fs.readFileSync(new URL("../server/precorrection-trigger.mjs", import.meta.url), "utf8");
  for (const forbidden of ["appendReporterOperations", "acceptRangeProposal", "applyOverlay", "writeWorking", "reporter-overlay"]) {
    assert.equal(source.includes(forbidden), false, `the trigger must not reach ${forbidden}`);
  }
});

test("a transcript still arrives when there is no API key", async () => {
  const result = await preparePrecorrection(null, { depositionId: "DEP-1", apiKey: "", listPasses: noPasses });
  assert.equal(result.status, PRECORRECTION_STATUS.NO_CREDENTIAL);
  assert.equal(result.proposals, 0);
  assert.match(result.message, /transcript is complete/, "and says so, rather than reading as a transcription failure");
});

test("a failing pass cannot fail the transcription", async () => {
  const result = await preparePrecorrection(null, {
    depositionId: "DEP-1", apiKey: "key", listPasses: noPasses,
    entityPass: boom("Anthropic timed out"), speakerRangePass: boom("Anthropic timed out"),
  });
  assert.equal(result.status, PRECORRECTION_STATUS.FAILED);
  assert.match(result.message, /transcript is complete/);
  assert.match(result.message, /Correct Transcript/, "the manual route is still offered");
  assert.equal(result.failures.length, 2);
});

test("one pass failing keeps the other's proposals", async () => {
  const result = await preparePrecorrection(null, {
    depositionId: "DEP-1", apiKey: "key", listPasses: noPasses,
    entityPass: ok([{ wordId: "w1" }]), speakerRangePass: boom("rate limited"),
  });
  assert.equal(result.status, PRECORRECTION_STATUS.RAN);
  assert.deepEqual(result.ran, ["names"]);
  assert.equal(result.proposals, 1);
  assert.equal(result.failures.length, 1, "and the failure is reported rather than hidden");
});

test("it does not re-run for a transcript state already prepared", async () => {
  // Pass ids come from the start time, so they cannot recognise repeated work. The review-state
  // hash can: a pass recorded against this state analysed exactly this transcript.
  let calls = 0;
  const counting = async () => { calls++; return { accepted: [] }; };
  const result = await preparePrecorrection(null, {
    depositionId: "DEP-1", apiKey: "key", reviewStateHash: "state-A",
    listPasses: () => [{ passId: "p1", reviewStateHash: "state-A" }],
    entityPass: counting, speakerRangePass: counting,
  });
  assert.equal(result.status, PRECORRECTION_STATUS.ALREADY_PREPARED);
  assert.equal(calls, 0, "no Claude call is spent regenerating the same worklist");
});

test("it does run when the transcript has moved on", async () => {
  let calls = 0;
  const counting = async () => { calls++; return { accepted: [] }; };
  const result = await preparePrecorrection(null, {
    depositionId: "DEP-1", apiKey: "key", reviewStateHash: "state-B",
    listPasses: () => [{ passId: "p1", reviewStateHash: "state-A" }],
    entityPass: counting, speakerRangePass: counting,
  });
  assert.equal(result.status, PRECORRECTION_STATUS.RAN);
  assert.equal(calls, 2);
});

test("an unreadable pass directory does not block preparation", async () => {
  const result = await preparePrecorrection(null, {
    depositionId: "DEP-1", apiKey: "key", reviewStateHash: "state-A",
    listPasses: () => { throw new Error("ENOENT"); },
    entityPass: ok([]), speakerRangePass: ok([]),
  });
  assert.equal(result.status, PRECORRECTION_STATUS.RAN, "worst case is a duplicate worklist, not a missing one");
});

test("alreadyPreparedFor needs a state to compare", () => {
  assert.equal(alreadyPreparedFor([{ reviewStateHash: "A" }], "A"), true);
  assert.equal(alreadyPreparedFor([{ reviewStateHash: "A" }], "B"), false);
  assert.equal(alreadyPreparedFor([{ reviewStateHash: "A" }], null), false, "an unknown state is not a match");
  assert.equal(alreadyPreparedFor([], "A"), false);
  assert.equal(alreadyPreparedFor(undefined, "A"), false);
});
