import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudioItem } from "../server/audio-pipeline.mjs";

const audit = {
  selectedSource: "processed",
  selectedDerivativeOperationId: "operation-a",
  storage: {
    original: { key: "audio-intake/id/original.wav", sha256: "original" },
    derivatives: [
      { kind: "processing", operationId: "operation-a", key: "audio-intake/id/a.wav", sha256: "hash-a" },
      { kind: "processing", operationId: "operation-b", key: "audio-intake/id/b.wav", sha256: "hash-b" },
      { kind: "deepgram-compatibility", operationId: "compat", key: "audio-intake/id/compat.wav", sha256: "compat" },
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
