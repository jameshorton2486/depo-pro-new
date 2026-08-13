import assert from "node:assert/strict";
import test from "node:test";
import { compareTranscripts } from "../server/transcript-quality.mjs";
import { inspectRx } from "../server/rx-adapter.mjs";

test("calculates WER and critical legal term errors", () => {
  const result = compareTranscripts("Jane Doe did not attend", "Jane Doe did attend", ["Jane Doe", "did not"]);
  assert.equal(result.wer, 0.2);
  assert.equal(result.criticalLegalErrorRate, 0.5);
  assert.deepEqual(result.criticalTermsMissed, ["did not"]);
});

test("RX adapter preserves the unattended-editor safety boundary", () => {
  const status = inspectRx();
  assert.equal(status.automationEnabled, false);
  assert.equal(status.capabilities.unattendedEditorProcessing, false);
  assert.match(status.fallback, /FFmpeg profiles remain available/);
});
