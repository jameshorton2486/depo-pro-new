import assert from "node:assert/strict";
import test from "node:test";
import { compareTranscripts } from "../server/transcript-quality.mjs";
import { inspectRx } from "../server/rx-adapter.mjs";

test("calculates WER and critical legal term errors", () => {
  const result = compareTranscripts("Jane Doe did not attend", "Jane Doe did attend", ["Jane Doe", "did not"]);
  assert.equal(result.wer, 0.2);
  assert.equal(result.criticalLegalErrorRate, 0.5);
  assert.deepEqual(result.criticalTermsMissed, ["did not"]);
  assert.equal(result.depositionMetrics.negations.missed, 1);
  assert.equal(result.depositionMetrics.properNames.expected, 0);
});

test("calculates deposition-specific recognition metrics", () => {
  const result = compareTranscripts(
    "Yes. Dr. Koepke prescribed 15 milligrams on August 15, 2026 for exhibit 12.",
    "Yes. Doctor Cop key prescribed 50 milligrams on August 5, 2026 for exhibit 20.",
    ["Dr. Koepke", "exhibit 12"],
    { properNames:["Dr. Koepke"], medicalTerms:["15 milligrams"], exhibitTerms:["exhibit 12"] },
  );
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.depositionMetrics.properNames.missed, 1);
  assert.equal(result.depositionMetrics.medicalTerms.missed, 1);
  assert.equal(result.depositionMetrics.exhibitTerms.missed, 1);
  assert.ok(result.depositionMetrics.numbers.missed >= 1);
  assert.equal(result.depositionMetrics.dates.missed, 1);
  assert.equal(result.depositionMetrics.measurements.missed, 1);
});

test("RX adapter preserves the unattended-editor safety boundary", () => {
  const status = inspectRx();
  assert.equal(status.automationEnabled, false);
  assert.equal(status.capabilities.unattendedEditorProcessing, false);
  assert.match(status.fallback, /FFmpeg profiles remain available/);
});
