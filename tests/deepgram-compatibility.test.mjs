import assert from "node:assert/strict";
import test from "node:test";
import { buildDeepgramRequest, DEEPGRAM_PLAYGROUND_OPTIONS, DeepgramRequestError, isDeepgramMediaError } from "../server/deepgram-service.mjs";

test("Deepgram explicitly enables speaker diarization",()=>{
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize,undefined);
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize_model,"v2");
});

test("Deepgram request preserves ordered keyterms",()=>{const request=buildDeepgramRequest(["Beta","Alpha"]);assert.deepEqual(request.keyterms,["Beta","Alpha"]);assert.deepEqual(new URL(request.url).searchParams.getAll("keyterm"),["Beta","Alpha"])});

test("retries only Deepgram media decoding failures", () => {
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Unable to decode audio format", { status: 400, code: "INVALID_AUDIO" })), true);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Invalid API key", { status: 401, code: "INVALID_AUTH" })), false);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Bad request", { status: 400, code: "INVALID_QUERY" })), false);
});
