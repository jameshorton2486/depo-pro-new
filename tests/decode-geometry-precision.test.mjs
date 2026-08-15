import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareDecodeGeometry, _testing } from "../server/rx-processing.mjs";
import { createRxDerivative } from "../server/rx-processing.mjs";

function probeJson(stream) { return JSON.stringify({ format:{ duration:"1.0" }, streams:[{ codec_type:"audio", sample_rate:"48000", channels:1, duration_ts:48000, time_base:"1/48000", ...stream }] }); }

function fixture(extension = ".wav") {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-geometry-")),uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId);
  fs.mkdirSync(directory,{recursive:true});
  const original=Buffer.from("immutable deposition fixture"),originalPath=path.join(directory,`original${extension}`);
  fs.writeFileSync(originalPath,original);
  const dependency=path.join(root,"dependency.bin"); fs.writeFileSync(dependency,"dependency");
  return { root, originalPath, dependency, audit:{ uploadId, storage:{ original:{ key:`audio-intake/${uploadId}/original${extension}`, immutable:true, sha256:crypto.createHash("sha256").update(original).digest("hex") }, derivatives:[] } } };
}

function stubs(value, { validateAudio, workerFrames = 48000 }) {
  return {
    originalPath:value.originalPath, pythonExecutable:value.dependency, workerPath:value.dependency, pluginPath:value.dependency,
    inspectRxStatus:()=>({available:true,executable:value.dependency}), validateAudio,
    runDecoder:async(_command,args)=>{fs.writeFileSync(args.at(-1),"decoded")},
    runWorker:async(_command,args)=>{fs.writeFileSync(args[args.indexOf("--output")+1],"derivative");fs.writeFileSync(args[args.indexOf("--result")+1],JSON.stringify({worker:"spotify-pedalboard",workerVersion:"test",plugin:"RX 12 Voice De-noise",manufacturer:"iZotope",pluginVersion:"12.0.0",profileId:"rx12-voice-denoise-factory-adaptive-v1",profileVersion:"1.0.0",sourceFrames:workerFrames,framesProcessed:workerFrames,requestedRawParameters:{},appliedRawParameters:{},effectiveRawParameters:{}}))},
    runEncoder:async(_command,args)=>{fs.writeFileSync(args.at(-1),"lossless derivative")},
    measureQuality:async()=>({meanVolumeDb:-23,peakDbfs:-2,dynamicRangeDb:20,clippedSampleCount:0,lowFrequencyMeanDb:-45}),
  };
}

const media = (overrides = {}) => ({ durationSeconds:600, sampleRate:48000, channels:2, sampleFrames:28_800_000, bitDepth:16, ...overrides });

test("a decode that preserves the frame count reports no offset from the upload",()=>{
  const result=compareDecodeGeometry(media(),media());
  assert.equal(result.decodeFrameDelta,0);
  assert.equal(result.uploadedTimelinePreserved,true);
  assert.equal(result.reason,null);
});

test("encoder delay through a lossy decode is recorded, not rejected",()=>{
  // M-5: AAC and MP3 carry encoder delay and padding, so the decoded intermediate is
  // routinely longer than the upload. Most deposition recorders write compressed formats,
  // so rejecting this would fail the common path. The delta is the record.
  const result=compareDecodeGeometry(media({bitDepth:null}),media({sampleFrames:28_800_000+1024,durationSeconds:600.0213}));
  assert.equal(result.decodeFrameDelta,1024);
  assert.equal(result.uploadedTimelinePreserved,false);
  assert.match(result.reason,/Encoder delay or padding/);
  assert.ok(result.decodeDurationDeltaSeconds>0);
});

test("a decode that loses frames is recorded with a negative delta",()=>{
  const result=compareDecodeGeometry(media(),media({sampleFrames:28_799_000}));
  assert.equal(result.decodeFrameDelta,-1000);
  assert.equal(result.uploadedTimelinePreserved,false);
});

test("a decode that changes the sample rate fails closed",()=>{
  // A resample breaks the timeline claim materially rather than offsetting it, so unlike a
  // frame delta it cannot be documented and carried forward.
  assert.throws(()=>compareDecodeGeometry(media(),media({sampleRate:44100})),error=>error.code==="RX_DECODE_GEOMETRY_VIOLATION"&&/sample rate/.test(error.message));
});

test("a decode that changes the channel count fails closed",()=>{
  assert.throws(()=>compareDecodeGeometry(media(),media({channels:1})),error=>error.code==="RX_DECODE_GEOMETRY_VIOLATION"&&/channel count/.test(error.message));
});

test("bit depth is read from the probe, and a lossy stream reporting 0 becomes null",async()=>{
  const depth=async stream=>(await _testing.validateReadableAudio("file",async()=>probeJson(stream))).bitDepth;
  assert.equal(await depth({bits_per_raw_sample:"24"}),24);
  assert.equal(await depth({bits_per_sample:16}),16);
  assert.equal(await depth({bits_per_sample:0}),null,"a lossy stream has no PCM bit depth");
  assert.equal(await depth({}),null);
});

test("a 24-bit source records its depth and that precision was reduced",async t=>{
  const value=fixture(".wav"); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const result=await createRxDerivative(value.root,value.audit,{...stubs(value,{validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000,bitDepth:24})}),recordAuditEvent:async()=>{}});
  assert.equal(result.sourceBitDepth,24);
  assert.equal(result.precisionReduced,true);
  assert.match(result.precisionReductionNote,/24-bit.*16-bit/);
  assert.equal(result.outputEncoding.bitDepth,16);
});

test("a 16-bit source records no precision reduction",async t=>{
  const value=fixture(".wav"); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const result=await createRxDerivative(value.root,value.audit,{...stubs(value,{validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000,bitDepth:16})}),recordAuditEvent:async()=>{}});
  assert.equal(result.sourceBitDepth,16);
  assert.equal(result.precisionReduced,false);
  assert.equal(result.precisionReductionNote,null);
});

test("a lossy upload records the decode frame delta against the upload, not just the intermediate",async t=>{
  const value=fixture(".m4a"); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const events=[];
  const validateAudio=async file=>file===value.originalPath
    ? {durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000,bitDepth:null}
    : {durationSeconds:1.021,sampleRate:48000,channels:1,sampleFrames:49024,bitDepth:16};
  const result=await createRxDerivative(value.root,value.audit,{...stubs(value,{validateAudio,workerFrames:49024}),recordAuditEvent:async event=>events.push(event)});
  assert.equal(result.decodeFrameDelta,1024,"encoder delay through the decode is recorded");
  assert.equal(result.uploadedTimelinePreserved,false);
  assert.match(result.uploadedTimelineNote,/Encoder delay or padding/);
  assert.equal(result.sourceBitDepth,null,"a lossy upload has no source PCM bit depth");
  assert.equal(result.precisionReduced,false);
  assert.ok(events.some(item=>item.code==="DECODE_FRAME_DELTA"&&item.decodeFrameDelta===1024),"the delta is durably recorded, not only returned");
});

test("a native WAV upload needs no decode and reports the upload timeline as preserved",async t=>{
  const value=fixture(".wav"); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const events=[];
  const result=await createRxDerivative(value.root,value.audit,{...stubs(value,{validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000,bitDepth:24})}),recordAuditEvent:async event=>events.push(event)});
  assert.equal(result.decodeFrameDelta,0);
  assert.equal(result.uploadedTimelinePreserved,true);
  assert.equal(events.filter(item=>item.code==="DECODE_FRAME_DELTA").length,0);
});
