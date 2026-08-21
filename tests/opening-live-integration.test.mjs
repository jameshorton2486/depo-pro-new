import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../app/LiveCaptureScreen.tsx", import.meta.url), "utf8");

test("Live Deposition keeps Opening scripts in the recording owner component", () => {
  assert.match(source, /api\/opening\?depositionId=/);
  assert.match(source, /\[captureDepositionId\]/);
  assert.match(source, /Read-only during Live Deposition/);
  assert.match(source, /Opening readiness never blocks or changes local recording/);
});

test("the embedded Opening reference has no persistence or capture controls", () => {
  const panel = source.slice(source.indexOf('className="live-opening-scripts"'), source.indexOf('<p>\n            Deepgram Live'));
  assert.ok(panel.length > 0);
  assert.doesNotMatch(panel, /postJson|method:\s*["']POST|startCapture|stopCapture|setSession/);
  assert.doesNotMatch(panel, /type="checkbox"/);
});
