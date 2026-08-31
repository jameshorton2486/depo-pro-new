import test from "node:test";
import assert from "node:assert/strict";
import { SPEAKER_ATTRIBUTION_SYSTEM, speakerAttributionTool } from "../server/speaker-attribution-prompt.mjs";

test("speaker AI is proposal-only and requires evidence plus reporter confirmation",()=>{
  assert.match(SPEAKER_ATTRIBUTION_SYSTEM,/never finalize/i);
  assert.match(SPEAKER_ATTRIBUTION_SYSTEM,/accept, change, or reject/i);
  assert.deepEqual(speakerAttributionTool.input_schema.properties.proposals.items.required.includes("evidence"),true);
});

test("speaker prompt covers Q A and the exact two-space K period exception",()=>{
  assert.match(SPEAKER_ATTRIBUTION_SYSTEM,/QUESTIONING_ATTORNEY produces Q\./);
  assert.match(SPEAKER_ATTRIBUTION_SYSTEM,/WITNESS produces A\./);
  assert.match(SPEAKER_ATTRIBUTION_SYSTEM,/exactly two ordinary spaces/);
  assert.match(SPEAKER_ATTRIBUTION_SYSTEM,/K followed immediately by a period/);
});
