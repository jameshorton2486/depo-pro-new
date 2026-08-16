import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRxDerivative } from "../server/rx-processing.mjs";
import { AUDIO_TOOL_PROFILES } from "../server/rx-profiles.mjs";

const DIALOGUE_ISOLATE = "rx12-dialogue-isolate-conservative-v1";

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-latency-")),uploadId=crypto.randomUUID();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,"data","audio-intake",uploadId),originalPath=path.join(directory,"original.wav");
  fs.mkdirSync(directory,{recursive:true});
  const bytes=Buffer.from("immutable deposition fixture"); fs.writeFileSync(originalPath,bytes);
  const dependency=path.join(root,"dependency.bin"); fs.writeFileSync(dependency,"dependency");
  return { root, originalPath, dependency, audit:{ uploadId, storage:{ original:{ key:`audio-intake/${uploadId}/original.wav`, immutable:true, sha256:crypto.createHash("sha256").update(bytes).digest("hex") }, derivatives:[] } } };
}

function stubs(value, profileId, { encoderCalls }) {
  const profile = AUDIO_TOOL_PROFILES[profileId];
  return {
    originalPath:value.originalPath, profileIds:[profileId],
    pythonExecutable:value.dependency, workerPath:value.dependency, pluginPath:value.dependency,
    inspectRxStatus:()=>({available:true,executable:value.dependency}),
    validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000,bitDepth:24}),
    runWorker:async(_command,args)=>{fs.writeFileSync(args[args.indexOf("--output")+1],"derivative");fs.writeFileSync(args[args.indexOf("--result")+1],JSON.stringify({worker:"spotify-pedalboard",workerVersion:"test",modules:[{profileId,profileVersion:profile.version,plugin:`RX 12 ${profile.module}`,manufacturer:"iZotope",pluginVersion:"12.0.0"}],plugin:`RX 12 ${profile.module}`,manufacturer:"iZotope",pluginVersion:"12.0.0",profileId,profileVersion:profile.version,sourceFrames:48000,framesProcessed:48000,requestedRawParameters:{},appliedRawParameters:{},effectiveRawParameters:{}}))},
    runEncoder:async(_command,args)=>{encoderCalls.push(args);fs.writeFileSync(args.at(-1),"encoded")},
    measureQuality:async()=>({meanVolumeDb:-23,peakDbfs:-2,dynamicRangeDb:20,clippedSampleCount:0,lowFrequencyMeanDb:-45}),
  };
}

test("the catalog records the measured latency rather than leaving it in a comment",()=>{
  assert.equal(AUDIO_TOOL_PROFILES[DIALOGUE_ISOLATE].measuredLatencyFrames,4096);
  assert.equal(AUDIO_TOOL_PROFILES["rx12-repair-assistant-voice-light-v1"].measuredLatencyFrames,8159);
  // Modules measured as aligned must not carry a latency figure at all.
  assert.equal(AUDIO_TOOL_PROFILES["rx12-de-hum-dynamic-v1"].measuredLatencyFrames,undefined);
  assert.equal(AUDIO_TOOL_PROFILES["rx12-voice-denoise-factory-adaptive-v1"].measuredLatencyFrames,undefined);
  // De-click and De-reverb are indeterminate, not shifted. No number may be invented.
  assert.equal(AUDIO_TOOL_PROFILES["rx12-de-click-conservative-v1"].measuredLatencyFrames,undefined);
  assert.equal(AUDIO_TOOL_PROFILES["rx12-de-reverb-conservative-v1"].measuredLatencyFrames,undefined);
});

test("a profile with measured latency is compensated, and the compensation is recorded",async t=>{
  const value=fixture(t), encoderCalls=[];
  const events=[];
  const result=await createRxDerivative(value.root,value.audit,{...stubs(value,DIALOGUE_ISOLATE,{encoderCalls}),recordAuditEvent:async event=>events.push(event)});

  // The compensation pass trims the plug-in's leading output and pads the tail back to the
  // source length, so the frame count is unchanged and the content sits where it belongs.
  const compensation=encoderCalls.find(args=>args.some(item=>String(item).includes("atrim=start_sample=")));
  assert.ok(compensation,"a compensation pass must run before encoding");
  const filter=compensation.find(item=>String(item).includes("atrim="));
  assert.match(filter,/atrim=start_sample=4096/);
  assert.match(filter,/apad=whole_len=48000/,"the tail is padded back to the source frame count");

  assert.equal(result.measuredLatencyFrames,4096);
  assert.equal(result.latencyCompensation.frames,4096);
  assert.equal(result.latencyCompensation.method,"trim-head-pad-tail");
  assert.ok(Math.abs(result.latencyCompensation.seconds-4096/48000)<1e-9);
  assert.equal(result.timelinePolicy,"frame-aligned-latency-compensated","the policy must say the timeline was restored, not that nothing happened");
  assert.equal(result.timelinePreserved,true);
  assert.ok(events.some(item=>item.code==="LATENCY_COMPENSATED"&&item.frames===4096),"the compensation is durably recorded, not only returned");
});

test("a profile with no measured latency runs no compensation pass",async t=>{
  const value=fixture(t), encoderCalls=[];
  const events=[];
  const result=await createRxDerivative(value.root,value.audit,{...stubs(value,"rx12-de-hum-dynamic-v1",{encoderCalls}),recordAuditEvent:async event=>events.push(event)});

  assert.equal(encoderCalls.some(args=>args.some(item=>String(item).includes("atrim="))),false);
  assert.equal(result.measuredLatencyFrames,null);
  assert.equal(result.latencyCompensation,null);
  assert.equal(result.timelinePolicy,"frame-aligned-no-cuts");
  assert.equal(result.timelinePreserved,true);
  assert.equal(events.some(item=>item.code==="LATENCY_COMPENSATED"),false);
});
