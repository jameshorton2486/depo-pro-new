import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_TOOL_PROFILES, publicAudioTools } from "../server/rx-profiles.mjs";

test("the browser receives the measured render rate for every tool",()=>{
  const tools=publicAudioTools();
  assert.ok(tools.length>0);
  for(const tool of tools) assert.ok("measuredRealTimeFactor" in tool,`${tool.id} must carry a render rate field`);
});

test("an unmeasured tool reports null, never zero",()=>{
  // Zero would render as "instant" in the UI. The high-pass filter has never been timed, and
  // the operator needs to be told that rather than shown a fast number.
  const highpass=publicAudioTools().find(tool=>tool.id==="low-frequency-rolloff-v2");
  assert.equal(highpass.measuredRealTimeFactor,null);
  assert.notEqual(highpass.measuredRealTimeFactor,0);
});

test("the exposed rates match the qualification measurements",()=>{
  const rate=id=>publicAudioTools().find(tool=>tool.id===id).measuredRealTimeFactor;
  assert.equal(rate("rx12-de-hum-dynamic-v1"),0.016);
  assert.equal(rate("rx12-de-click-conservative-v1"),0.022);
  assert.equal(rate("rx12-voice-denoise-factory-adaptive-v1"),0.030);
  assert.equal(rate("rx12-de-reverb-conservative-v1"),0.032);
  assert.equal(rate("rx12-repair-assistant-voice-light-v1"),0.190);
  assert.equal(rate("rx12-dialogue-isolate-conservative-v1"),0.194);
});

test("the two slowest modules are the ones an operator must be warned about",()=>{
  // A six-hour deposition through either is over an hour of render. This is the number that
  // previously existed only inside qualification records on disk.
  for(const id of ["rx12-dialogue-isolate-conservative-v1","rx12-repair-assistant-voice-light-v1"]){
    const sixHourMinutes=AUDIO_TOOL_PROFILES[id].measuredRealTimeFactor*6*60;
    assert.ok(sixHourMinutes>60,`${id} should exceed an hour on a six-hour recording, got ${sixHourMinutes}`);
  }
  assert.ok(AUDIO_TOOL_PROFILES["rx12-de-hum-dynamic-v1"].measuredRealTimeFactor*6*60<10,"De-hum should be effectively invisible");
});

test("the render rate does not leak plug-in file paths to the browser",()=>{
  for(const tool of publicAudioTools()){
    assert.equal("pluginFile" in tool,false);
    assert.equal("rawParameters" in tool,false);
  }
});
