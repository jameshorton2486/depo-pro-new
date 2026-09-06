// The client half of the currency guard.
//
// The server half is right and is already pinned by stale-mutations-are-refused: a mutation with no
// review-state hash is refused with the same code as a stale one, and neither is weakened here.
//
// What had no guard was the caller. Four Workspace call sites wrote to the overlay; three carried
// the hash and the fourth did not, and that fourth was the helper behind six reporter actions --
// label and speaker correction, split-with-speaker, marking for another listen, clearing a mark,
// correcting a word, striking a word. Every one of them failed, every time. The buttons rendered
// and enabled; nothing persisted.
//
// Found by driving a disposable copy of Etminan in a browser, not by reading the code, and it is a
// plausible explanation for why the real Etminan deposition carries four overlay operations after a
// review pass.
//
// These tests hold the request builder. What they do NOT cover is that WorkspaceScreen calls it --
// this repository has no client test harness, which is why the six actions were browser-qualified
// one at a time against the server's stored overlay rather than against what the screen displayed.
import assert from "node:assert/strict";
import test from "node:test";
import { MISSING_REVIEW_STATE_HASH, overlayHistoryRequest, overlayMutationRequest } from "../app/overlay-mutation.mjs";

const OPERATION = { op:"label", wordId:"job:word:1", speakerIdentity:"witness", transcriptRole:"WITNESS" };
const HASH = "ece936d3c76855fa51bc4c717de45cc0df6ff591e5190bbf3bdf9534e5b9f268";

test("a mutation carries the hash the server requires", () => {
  assert.deepEqual(overlayMutationRequest({ depositionId:"DEP-1", operations:[OPERATION], reviewStateHash:HASH }), {
    depositionId:"DEP-1", operations:[OPERATION], expectedReviewStateHash:HASH,
  });
});

test("a mutation with no hash throws here rather than being refused there", () => {
  // The whole point. A request the server is certain to refuse is a defect in the caller, and it
  // should be impossible to build rather than merely unsuccessful to send.
  for (const reviewStateHash of [undefined, null, "", "   "]) {
    assert.throws(() => overlayMutationRequest({ depositionId:"DEP-1", operations:[OPERATION], reviewStateHash }),
      new RegExp(MISSING_REVIEW_STATE_HASH), JSON.stringify(reviewStateHash));
  }
});

test("the refusal tells the reporter what to do", () => {
  try {
    overlayMutationRequest({ depositionId:"DEP-1", operations:[OPERATION] });
    assert.fail("should have thrown");
  } catch (error) {
    assert.match(error.message, /which version of the transcript/);
    assert.match(error.message, /Reload the record/);
  }
});

test("undo and redo are mutations too, and carry it as well", () => {
  assert.deepEqual(overlayHistoryRequest({ depositionId:"DEP-1", reviewStateHash:HASH }),
    { depositionId:"DEP-1", expectedReviewStateHash:HASH });
  assert.throws(() => overlayHistoryRequest({ depositionId:"DEP-1" }), new RegExp(MISSING_REVIEW_STATE_HASH));
});

test("an edit with nothing in it is refused before it reaches the wire", () => {
  assert.throws(() => overlayMutationRequest({ depositionId:"DEP-1", operations:[], reviewStateHash:HASH }), /at least one operation/);
  assert.throws(() => overlayMutationRequest({ depositionId:"DEP-1", operations:null, reviewStateHash:HASH }), /at least one operation/);
});

test("an edit that does not name its deposition is refused", () => {
  assert.throws(() => overlayMutationRequest({ operations:[OPERATION], reviewStateHash:HASH }), /name its deposition/);
  assert.throws(() => overlayHistoryRequest({ reviewStateHash:HASH }), /name its deposition/);
});

test("the operations are passed through untouched", () => {
  // The builder's job is currency, not content. Anything it normalised here would be a second
  // opinion about an operation the overlay validator already governs.
  const operations = [OPERATION, { op:"split", beforeWordId:"job:word:2", speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" }];
  const request = overlayMutationRequest({ depositionId:"DEP-1", operations, reviewStateHash:HASH });
  assert.equal(request.operations, operations);
});
