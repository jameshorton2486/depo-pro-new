// The AI review runs because a reporter asked for it.
//
// E2E-034, found during the Heath Thomas production run. The correction subsystem was complete --
// twelve modules, four routes, twelve test files -- and reachable only through a button labelled
// "Correct Transcript", so 2h27m of deposition arrived as 900 paragraphs of SPEAKER 0 / SPEAKER 1
// with the oath mis-recognised and the passes never ran.
//
// The first repair wired them to fire when Deepgram finished. That was wrong twice over: a paid
// analysis should begin because someone asked, and continuously re-analysing a live deposition
// while testimony is still arriving is both expensive and pointless. One reporter-initiated control
// serves prerecorded and live alike, and needs no second architecture.
//
// So the thing under test is a boundary in two directions: nothing analyses on its own, and nothing
// applies on its own.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AI_REVIEW_STATUS, existingReview, reviewExistsFor, runAiReview } from "../server/ai-review.mjs";

const API = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
const SCREEN = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
const ok = accepted => async () => ({ accepted });
const boom = message => async () => { throw new Error(message); };
const noPasses = () => [];

test("finishing a transcription does not start an AI review", () => {
  // The decisive assertion. If the transcribe route ever calls the review again, a reporter is
  // charged for an analysis they did not ask for -- and a live capture would be analysed mid-flow.
  const transcribe = API.slice(API.indexOf('req.url === "/api/audio/transcribe"'));
  const routeBody = transcribe.slice(0, transcribe.indexOf('if (\n      req.url?.startsWith("/api/transcription/jobs?")'));
  assert.equal(/runAiReview|preparePrecorrection/.test(routeBody), false,
    "transcription must not initiate a paid AI review");
});

// The propose-only path is now the SECONDARY control. The reporter's primary action applies the
// corrections in one attributable pass -- because the scopist and the reporter read the whole
// transcript against the audio afterwards regardless, so an approval queue is that reading done
// twice. That decision is tested in the-ai-pass-corrects-and-stays-accountable.test.mjs; what these
// two keep true is that the propose-only path still exists and still cannot apply anything.
test("the propose-only path is still reachable, and still reporter-initiated", () => {
  assert.match(API, /req\.url === "\/api\/correction\/ai-review" && req\.method === "POST"/);
  assert.match(API, /await runAiReview\(root, \{/);
  assert.match(SCREEN, /Propose corrections without applying them/, "offered, and named for what it does");
  assert.match(SCREEN, /Proposals awaiting review \(\$\{suggestionCount\}\)/, "and says when a worklist is waiting");
});

test("it proposes and never applies", () => {
  const source = fs.readFileSync(new URL("../server/ai-review.mjs", import.meta.url), "utf8");
  for (const forbidden of ["appendReporterOperations", "acceptRangeProposal", "applyOverlay", "reporter-overlay", "writeWorking"]) {
    assert.equal(source.includes(forbidden), false, `the review must not reach ${forbidden}`);
  }
  assert.match(SCREEN, /This transcript has already been analysed in its current state/,
    "and a second analysis is deliberate rather than accidental");
});

test("a review runs when asked", async () => {
  const result = await runAiReview(null, {
    depositionId: "DEP-1", apiKey: "key", listPasses: noPasses,
    entityPass: ok([{ wordId: "w1" }, { wordId: "w2" }]), speakerRangePass: ok([{ wordId: "w3" }]),
  });
  assert.equal(result.status, AI_REVIEW_STATUS.COMPLETED);
  assert.deepEqual(result.ran, ["names", "speaker-ranges"]);
  assert.equal(result.proposals, 3);
  assert.match(result.message, /Nothing has been applied/);
});

test("clicking twice buys one analysis", async () => {
  let calls = 0;
  const counting = async () => { calls++; return { accepted: [] }; };
  const result = await runAiReview(null, {
    depositionId: "DEP-1", apiKey: "key", reviewStateHash: "state-A",
    listPasses: () => [{ passId: "p1", reviewStateHash: "state-A", accepted: 4 }],
    entityPass: counting, speakerRangePass: counting,
  });
  assert.equal(result.status, AI_REVIEW_STATUS.ALREADY_REVIEWED);
  assert.equal(calls, 0, "no Claude call is spent on a state already reviewed");
  assert.equal(result.proposals, 4, "and the existing suggestions are reported, not lost");
});

test("but a deliberate second look is honoured", async () => {
  let calls = 0;
  const counting = async () => { calls++; return { accepted: [] }; };
  const result = await runAiReview(null, {
    depositionId: "DEP-1", apiKey: "key", reviewStateHash: "state-A", force: true,
    listPasses: () => [{ passId: "p1", reviewStateHash: "state-A", accepted: 4 }],
    entityPass: counting, speakerRangePass: counting,
  });
  assert.equal(result.status, AI_REVIEW_STATUS.COMPLETED);
  assert.equal(calls, 2, "Run AI Review Again means what it says");
});

test("a moved transcript is reviewed again without being forced", async () => {
  let calls = 0;
  const counting = async () => { calls++; return { accepted: [] }; };
  const result = await runAiReview(null, {
    depositionId: "DEP-1", apiKey: "key", reviewStateHash: "state-B",
    listPasses: () => [{ passId: "p1", reviewStateHash: "state-A" }],
    entityPass: counting, speakerRangePass: counting,
  });
  assert.equal(result.status, AI_REVIEW_STATUS.COMPLETED);
  assert.equal(calls, 2);
});

test("reopening a deposition restores its worklist without charging", () => {
  // A GET, and free. This is what Workspace calls on open; it must never be able to run a pass.
  assert.match(API, /req\.url\?\.startsWith\("\/api\/correction\/ai-review\?"\) && req\.method === "GET"/);
  const found = existingReview(null, {
    depositionId: "DEP-1", reviewStateHash: "state-A",
    listPasses: () => [{ passId: "p1", reviewStateHash: "state-A" }, { passId: "p0", reviewStateHash: "older" }],
  });
  assert.equal(found.current.length, 1, "only the review for the current state is offered");
  assert.equal(found.passes.length, 2, "while the history stays visible");
  assert.match(SCREEN, /api\/correction\/ai-review\?depositionId=/, "and Workspace loads it on open");
});

test("the transcript survives a failed review, and says it can be retried", async () => {
  const result = await runAiReview(null, {
    depositionId: "DEP-1", apiKey: "key", listPasses: noPasses,
    entityPass: boom("Anthropic timed out"), speakerRangePass: boom("Anthropic timed out"),
  });
  assert.equal(result.status, AI_REVIEW_STATUS.FAILED);
  assert.equal(result.retryable, true);
  assert.match(result.message, /transcript is unaffected/);
  assert.match(result.message, /run the review again/);
  assert.equal(result.failures.length, 2, "and the reasons are reported rather than hidden");
});

test("one pass failing keeps the other's suggestions", async () => {
  const result = await runAiReview(null, {
    depositionId: "DEP-1", apiKey: "key", listPasses: noPasses,
    entityPass: ok([{ wordId: "w1" }]), speakerRangePass: boom("rate limited"),
  });
  assert.equal(result.status, AI_REVIEW_STATUS.COMPLETED);
  assert.deepEqual(result.ran, ["names"]);
  assert.equal(result.proposals, 1);
  assert.equal(result.failures.length, 1);
});

test("no API key is a retryable condition, not a broken transcript", async () => {
  const result = await runAiReview(null, { depositionId: "DEP-1", apiKey: "", listPasses: noPasses });
  assert.equal(result.status, AI_REVIEW_STATUS.NO_CREDENTIAL);
  assert.equal(result.retryable, true);
  assert.match(result.message, /transcript is unaffected/);
});

test("an unreadable pass directory does not block a review", async () => {
  const result = await runAiReview(null, {
    depositionId: "DEP-1", apiKey: "key", reviewStateHash: "state-A",
    listPasses: () => { throw new Error("ENOENT"); },
    entityPass: ok([]), speakerRangePass: ok([]),
  });
  assert.equal(result.status, AI_REVIEW_STATUS.COMPLETED, "worst case is a duplicate worklist, not a missing one");
});

test("reviewExistsFor needs a state to compare", () => {
  assert.equal(reviewExistsFor([{ reviewStateHash: "A" }], "A"), true);
  assert.equal(reviewExistsFor([{ reviewStateHash: "A" }], "B"), false);
  assert.equal(reviewExistsFor([{ reviewStateHash: "A" }], null), false, "an unknown state is not a match");
  assert.equal(reviewExistsFor([], "A"), false);
  assert.equal(reviewExistsFor(undefined, "A"), false);
});

test("the control is not limited to prerecorded depositions", () => {
  // One architecture for both modes. If this ever branches on creationMode, a live deposition has
  // acquired a second correction path and the reason for a single control is gone.
  const source = fs.readFileSync(new URL("../server/ai-review.mjs", import.meta.url), "utf8");
  assert.equal(/creationMode|existing_recording|live_capture/.test(source), false,
    "the review must not know or care which mode produced the transcript");
  // It is gated on a rendered transcript existing, which is the state both modes reach.
  assert.match(SCREEN, /disabled=\{correcting\|\|!rendered\}/, "available whenever there is a transcript to analyse");
});
