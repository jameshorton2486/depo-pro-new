import assert from "node:assert/strict";
import test from "node:test";
import { buildDeepgramRequest, DEEPGRAM_PLAYGROUND_OPTIONS, DeepgramRequestError, isDeepgramMediaError } from "../server/deepgram-service.mjs";

test("Deepgram enables diarization via diarize_model, not the deprecated diarize flag",()=>{
  // Renamed, not re-asserted. The old name -- "Deepgram explicitly enables speaker
  // diarization" -- read as though `diarize` were missing, and I briefly "restored" it on
  // that reading. It was the name that had drifted, not the assertion.
  //
  // The vendor contract: `diarize_model` both enables diarization and selects the version, so
  // it is a complete request on its own. `diarize=true` is deprecated and, on batch, routes to
  // the v1 diarizer to preserve behaviour for existing integrations. Sending both is two
  // conflicting selectors with no documented precedence -- a 400, or worse, a silent downgrade
  // to v1, which yields a transcript that looks right and mislabels speakers more often on a
  // legal record.
  //
  // The general lesson, since this cost a round trip: when a test's name and its assertion
  // disagree, the assertion is the record of what the code does and the name is a comment that
  // drifted. Check the vendor contract before treating the assertion as the defect.
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize,undefined,"the deprecated flag would route batch requests to the v1 diarizer");
  assert.equal(DEEPGRAM_PLAYGROUND_OPTIONS.diarize_model,"v2","pinned rather than `latest`, which is v2 today and will not always be");
});

test("the diarizer cannot be requested down a streaming path",()=>{
  // diarize_model=v2 is not supported on streaming and returns a validation error. Pre-recorded
  // upload is batch, which is what this builder produces -- asserted rather than assumed.
  const url = new URL(buildDeepgramRequest([]).url);
  assert.equal(url.protocol,"https:","a wss: endpoint would be streaming, where diarize_model is rejected");
  assert.equal(url.host,"api.deepgram.com");
  assert.equal(url.pathname,"/v1/listen");
});

test("Deepgram request preserves ordered keyterms",()=>{const request=buildDeepgramRequest(["Beta","Alpha"]);assert.deepEqual(request.keyterms,["Beta","Alpha"]);assert.deepEqual(new URL(request.url).searchParams.getAll("keyterm"),["Beta","Alpha"])});

test("retries only Deepgram media decoding failures", () => {
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Unable to decode audio format", { status: 400, code: "INVALID_AUDIO" })), true);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Invalid API key", { status: 401, code: "INVALID_AUTH" })), false);
  assert.equal(isDeepgramMediaError(new DeepgramRequestError("Bad request", { status: 400, code: "INVALID_QUERY" })), false);
});
