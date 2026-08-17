import assert from "node:assert/strict";
import test from "node:test";
import { buildDeepgramRequest, DEEPGRAM_PLAYGROUND_OPTIONS, DeepgramRequestError, isDeepgramMediaError } from "../server/deepgram-service.mjs";

test("Deepgram explicitly enables speaker diarization",()=>{
  // This assertion used to read `diarize, undefined` under this same name, which is the
  // opposite of what the name claims. Git says how: 50d3f20 "Fix RX discovery, diarization,
  // and audio provenance" added `diarize: "true"` and asserted it here; af05428 "establish
  // transferred implementation baseline" replaced the module wholesale, dropped the option,
  // and the assertion was flipped to match the transferred code while the name was left alone.
  //
  // So the guard was rewritten to accommodate a regression rather than catch it. Restored.
  // `diarize` turns diarization on; `diarize_model` only chooses which diarizer. Without it
  // every word returns speaker:null and the speaker map, Q./A. mapping, and the whole
  // Workspace have nothing to key on.
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize,"true");
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize_model,"v2");
});

test("Deepgram request preserves ordered keyterms",()=>{const request=buildDeepgramRequest(["Beta","Alpha"]);assert.deepEqual(request.keyterms,["Beta","Alpha"]);assert.deepEqual(new URL(request.url).searchParams.getAll("keyterm"),["Beta","Alpha"])});

test("retries only Deepgram media decoding failures", () => {
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Unable to decode audio format", { status: 400, code: "INVALID_AUDIO" })), true);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Invalid API key", { status: 401, code: "INVALID_AUTH" })), false);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Bad request", { status: 400, code: "INVALID_QUERY" })), false);
});
