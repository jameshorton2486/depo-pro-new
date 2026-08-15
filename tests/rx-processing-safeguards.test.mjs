import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRxDerivative } from "../server/rx-processing.mjs";

function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-rx-safety-")),uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId);
  fs.mkdirSync(directory,{recursive:true}); const original=Buffer.from("immutable deposition fixture"),originalPath=path.join(directory,"original.wav"); fs.writeFileSync(originalPath,original);
  const dependency=path.join(root,"dependency.bin"); fs.writeFileSync(dependency,"dependency");
  return {root,directory,original,originalPath,dependency,audit:{uploadId,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,immutable:true,sha256:digest(original)},derivatives:[]}}};
}

test("RX processing preserves the immutable original", async t => {
  const value=fixture(); let encoderArgs=[]; t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const result=await createRxDerivative(value.root,value.audit,{originalPath:value.originalPath,recordAuditEvent:async()=>{},pythonExecutable:value.dependency,workerPath:value.dependency,pluginPath:value.dependency,inspectRxStatus:()=>({available:true,executable:value.dependency}),
    runWorker:async(_command,args)=>{fs.writeFileSync(args[args.indexOf("--output")+1],"derivative");fs.writeFileSync(args[args.indexOf("--result")+1],JSON.stringify({worker:"spotify-pedalboard",workerVersion:"test",plugin:"RX 12 Voice De-noise",manufacturer:"iZotope",pluginVersion:"12.0.0",profileId:"rx12-voice-denoise-factory-adaptive-v1",profileVersion:"1.0.0",sourceFrames:48000,framesProcessed:48000,requestedRawParameters:{},appliedRawParameters:{},effectiveRawParameters:{}}));},
    runEncoder:async(_command,args)=>{encoderArgs=args;fs.writeFileSync(args.at(-1),"lossless derivative")},measureQuality:async()=>({meanVolumeDb:-23,peakDbfs:-2,dynamicRangeDb:20,clippedSampleCount:0,lowFrequencyMeanDb:-45}),
    validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000})});
  assert.deepEqual(fs.readFileSync(value.originalPath),value.original); assert.equal(result.sourceSha256,value.audit.storage.original.sha256); assert.equal(result.sourceImmutable,true); assert.equal(result.kind,"rx-review"); assert.equal(result.selectableForTranscription,false); assert.match(result.key,/\.flac$/); assert.deepEqual(result.outputEncoding,{container:"flac",sampleFormat:"s16",bitDepth:16,lossless:true}); assert.equal(result.processingPrecision,"32-bit floating point");assert.equal(result.outputPcmPrecision,"signed 16-bit PCM");assert.ok(result.sourcePcmPrecision);assert.equal(result.timelinePreserved,true); assert.equal(result.timelinePolicy,"frame-aligned-no-cuts"); assert.ok(encoderArgs.includes(`DEPO_PRO_OPERATION_ID=${result.operationId}`)); assert.ok(encoderArgs.includes(`DEPO_PRO_SOURCE_SHA256=${result.sourceSha256}`));
});

test("RX processing rejects an original hash mismatch before worker execution", async t => {
  const value=fixture(); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true})); value.audit.storage.original.sha256="0".repeat(64); let workerCalled=false; const incidents=[];
  await assert.rejects(createRxDerivative(value.root,value.audit,{originalPath:value.originalPath,recordAuditEvent:async event=>incidents.push(event),pythonExecutable:value.dependency,workerPath:value.dependency,pluginPath:value.dependency,inspectRxStatus:()=>({available:true,executable:value.dependency}),runWorker:async()=>{workerCalled=true}}),error=>error.code==="RX_INTEGRITY_VIOLATION");
  assert.equal(workerCalled,false); assert.equal(incidents[0].code,"SOURCE_HASH_MISMATCH_BEFORE_PROCESSING"); assert.deepEqual(fs.readFileSync(value.originalPath),value.original);
});

test("multi-tool processing renders and records the complete ordered chain", async t => {
  const value=fixture(),requested=["low-frequency-rolloff-v2","rx12-de-click-conservative-v1"]; t.after(()=>fs.rmSync(value.root,{recursive:true,force:true})); let renderedProfiles=[];
  const result=await createRxDerivative(value.root,value.audit,{originalPath:value.originalPath,profileIds:requested,recordAuditEvent:async()=>{},pythonExecutable:value.dependency,workerPath:value.dependency,pluginPath:value.dependency,inspectRxStatus:()=>({available:true,executable:value.dependency}),
    runWorker:async(_command,args)=>{renderedProfiles=JSON.parse(fs.readFileSync(args[args.indexOf("--profile")+1],"utf8"));fs.writeFileSync(args[args.indexOf("--output")+1],"derivative");fs.writeFileSync(args[args.indexOf("--result")+1],JSON.stringify({worker:"spotify-pedalboard",workerVersion:"test",sourceFrames:48000,framesProcessed:48000,modules:[{profileId:"rx12-de-click-conservative-v1",profileVersion:"2.0.0",plugin:"RX 12 De-click",manufacturer:"iZotope",pluginVersion:"12.0.0"},{profileId:"low-frequency-rolloff-v2",profileVersion:"2.0.0",plugin:"Pedalboard HighpassFilter",manufacturer:"Spotify",pluginVersion:"test"}]}));},
    runEncoder:async(_command,args)=>fs.writeFileSync(args.at(-1),"lossless derivative"),measureQuality:async()=>({meanVolumeDb:-23,peakDbfs:-2,dynamicRangeDb:20,clippedSampleCount:0,lowFrequencyMeanDb:-45}),validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000})});
  assert.deepEqual(renderedProfiles.map(profile=>profile.id),["rx12-de-click-conservative-v1","low-frequency-rolloff-v2"]); assert.deepEqual(result.profileIds,["rx12-de-click-conservative-v1","low-frequency-rolloff-v2"]); assert.equal(result.module,"De-click → High-pass filter"); assert.equal(result.profileId,"rx12-de-click-conservative-v1+low-frequency-rolloff-v2");
});
