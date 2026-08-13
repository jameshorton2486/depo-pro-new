import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudioItem } from "../server/audio-pipeline.mjs";

const audit = {
  selectedSource: "processed",
  selectedDerivativeOperationId: "operation-a",
  storage: {
    original: { key: "audio-intake/id/original.wav", sha256: "original" },
    derivatives: [
      { kind: "rx-asr", operationId: "operation-a", key: "audio-intake/id/a.wav", sha256: "hash-a" },
      { kind: "rx-asr", operationId: "operation-b", key: "audio-intake/id/b.wav", sha256: "hash-b" },
      { kind: "deepgram-compatibility", operationId: "compat", key: "audio-intake/id/compat.wav", sha256: "compat" },
      { kind: "playback-proxy", operationId: "proxy", key: "audio-intake/id/proxy.opus", sha256: "proxy", timelinePreserved:false, selectableForTranscription:false },
    ],
  },
};

test("processed source resolves the exact recorded operation rather than the newest derivative", () => {
  assert.equal(resolveAudioItem(audit).operationId, "operation-a");
  assert.equal(resolveAudioItem(audit, "processed", "operation-b").sha256, "hash-b");
});

test("ambiguous or missing processed identity fails closed", () => {
  assert.throws(() => resolveAudioItem({ ...audit, selectedDerivativeOperationId: null }), /specific processed-audio derivative/);
  assert.throws(() => resolveAudioItem(audit, "processed", "missing"), /operation is unavailable/);
});

test("original source always resolves to the immutable original", () => {
  assert.equal(resolveAudioItem(audit, "original").sha256, "original");
});

test("frame-changing playback proxies are structurally barred from transcription selection", () => {
  assert.throws(() => resolveAudioItem(audit,"processed","proxy"),/operation is unavailable/);
});

test("review derivatives are structurally barred from transcription selection",()=>{
  const review={...audit,storage:{...audit.storage,derivatives:[...audit.storage.derivatives,{kind:"rx-review",operationId:"review",key:"audio-intake/id/review.flac",sha256:"review"}]}};
  assert.throws(()=>resolveAudioItem(review,"processed","review"),/operation is unavailable/);
});
