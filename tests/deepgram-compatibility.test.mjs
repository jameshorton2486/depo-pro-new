import assert from "node:assert/strict";
import test from "node:test";
import { DeepgramRequestError, isDeepgramMediaError } from "../server/deepgram-service.mjs";

test("retries only Deepgram media decoding failures", () => {
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Unable to decode audio format", { status: 400, code: "INVALID_AUDIO" })), true);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Invalid API key", { status: 401, code: "INVALID_AUTH" })), false);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Bad request", { status: 400, code: "INVALID_QUERY" })), false);
});