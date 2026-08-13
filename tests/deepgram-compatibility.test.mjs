import assert from "node:assert/strict";
import test from "node:test";
import { DEEPGRAM_PLAYGROUND_OPTIONS, DeepgramRequestError, isDeepgramMediaError } from "../server/deepgram-service.mjs";

test("Deepgram explicitly enables speaker diarization",()=>{
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize,"true");
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize_model,"latest");
});

test("retries only Deepgram media decoding failures", () => {
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Unable to decode audio format", { status: 400, code: "INVALID_AUDIO" })), true);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Invalid API key", { status: 401, code: "INVALID_AUTH" })), false);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Bad request", { status: 400, code: "INVALID_QUERY" })), false);
});
