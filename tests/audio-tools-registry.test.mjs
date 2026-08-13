import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_TOOL_PROFILES,publicAudioTools } from "../server/rx-profiles.mjs";

test("audio tool menu copy and safety decisions come from the registry",()=>{
  const tools=publicAudioTools();assert.equal(tools.length,7);
  for(const tool of tools){assert.ok(tool.displayName);assert.ok(tool.plainPurpose);assert.ok(["low","moderate","high"].includes(tool.riskLevel));assert.equal(typeof tool.asrSafe,"boolean");if(tool.riskLevel!=="low")assert.ok(tool.caution)}
  assert.equal(AUDIO_TOOL_PROFILES["low-frequency-rolloff-v2"].asrSafe,true);
  assert.equal(AUDIO_TOOL_PROFILES["rx12-voice-denoise-factory-adaptive-v1"].asrSafe,false);
  assert.deepEqual(AUDIO_TOOL_PROFILES["rx12-de-click-conservative-v1"].excludes,[]);
});

test("published repair ordering puts impulse repair before hum and broadband processing",()=>{
  const ordered=publicAudioTools().filter(tool=>tool.chainOrder!==null).sort((a,b)=>a.chainOrder-b.chainOrder);
  assert.deepEqual(ordered.slice(0,3).map(tool=>tool.displayName),["De-click","De-hum","High-pass filter"]);
});
