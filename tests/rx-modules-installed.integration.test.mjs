import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRxDerivative } from "../server/rx-processing.mjs";
import { RX_PROFILES } from "../server/rx-profiles.mjs";

const enabled=process.env.RUN_RX_INTEGRATION==="1";
const sample=process.env.DEPO_PRO_RX_TEST_AUDIO?path.resolve(process.env.DEPO_PRO_RX_TEST_AUDIO):null;

// A bare `skip:true` prints "# SKIP" with nothing after it, which reads identically to a test
// that was never written. These name the artifact that is missing, so a run that covers no
// installed RX profile says so rather than looking complete.
const unavailable=!enabled
  ? "RUN_RX_INTEGRATION=1 is required: these tests drive the installed RX 12 plug-ins, not a mock."
  : !sample
    ? "DEPO_PRO_RX_TEST_AUDIO must point at the disposable RX fixture; no profile is qualified without it."
    : false;

for(const profile of Object.values(RX_PROFILES)) test(`installed ${profile.module} profile renders sample-aligned disposable audio`,{skip:unavailable,timeout:120000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-rx-module-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId),originalPath=path.join(directory,"original.wav"); fs.mkdirSync(directory,{recursive:true}); fs.copyFileSync(sample,originalPath);
  const sha256=crypto.createHash("sha256").update(fs.readFileSync(originalPath)).digest("hex"),audit={uploadId,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,immutable:true,sha256},derivatives:[]}};
  const result=await createRxDerivative(root,audit,{originalPath,profileId:profile.id,recordAuditEvent:async()=>{}});
  const derivativePath=path.join(root,"data",...result.key.split("/"));assert.equal(result.profileId,profile.id); assert.equal(result.module,profile.module); assert.equal(result.sampleAligned,true); assert.equal(result.sourceSha256,sha256); assert.match(result.key,/\.flac$/); assert.equal(result.outputEncoding.container,"flac"); assert.equal(result.outputEncoding.lossless,true); assert.equal(result.media.sampleFrames,result.sourceMedia.sampleFrames); assert.ok(result.measurementDelta.some(item=>item.status!=="unavailable")); assert.ok(fs.existsSync(derivativePath));
  const probe=spawnSync("ffprobe",["-v","error","-show_entries","format_tags","-of","json",derivativePath],{encoding:"utf8",windowsHide:true});assert.equal(probe.status,0,probe.stderr);const tags=JSON.parse(probe.stdout).format.tags;assert.equal(tags.DEPO_PRO_OPERATION_ID,result.operationId);assert.equal(tags.DEPO_PRO_SOURCE_SHA256,sha256);assert.equal(tags.DEPO_PRO_TIMELINE_POLICY,"frame-aligned-no-cuts");
});

test("installed De-click and De-hum render together with complete provenance",{skip:unavailable,timeout:180000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-rx-chain-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId),originalPath=path.join(directory,"original.wav"); fs.mkdirSync(directory,{recursive:true}); fs.copyFileSync(sample,originalPath);
  const sha256=crypto.createHash("sha256").update(fs.readFileSync(originalPath)).digest("hex"),audit={uploadId,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,immutable:true,sha256},derivatives:[]}},profileIds=["rx12-de-click-conservative-v1","rx12-de-hum-dynamic-v1"];
  const result=await createRxDerivative(root,audit,{originalPath,profileIds,recordAuditEvent:async()=>{}}),derivativePath=path.join(root,"data",...result.key.split("/"));
  assert.deepEqual(result.profileIds,profileIds); assert.equal(result.module,"De-click → De-hum"); assert.equal(result.modules.length,2); assert.deepEqual(result.modules.map(item=>item.profileId),profileIds); assert.ok(result.modules.every(item=>item.manufacturer==="iZotope"&&String(item.pluginVersion).startsWith("12."))); assert.equal(result.sampleAligned,true); assert.equal(result.media.sampleFrames,result.sourceMedia.sampleFrames); assert.equal(result.media.sampleRate,result.sourceMedia.sampleRate); assert.equal(result.media.channels,result.sourceMedia.channels); assert.equal(result.sourceSha256,sha256); assert.ok(fs.existsSync(derivativePath));
  const probe=spawnSync("ffprobe",["-v","error","-show_entries","format_tags","-of","json",derivativePath],{encoding:"utf8",windowsHide:true}); assert.equal(probe.status,0,probe.stderr); const tags=JSON.parse(probe.stdout).format.tags; assert.equal(tags.DEPO_PRO_PROFILE_ID,profileIds.join("+")); assert.equal(tags.DEPO_PRO_SOURCE_SHA256,sha256);
});

test("installed De-hum and High-pass render together with complete mixed-engine provenance",{skip:unavailable,timeout:180000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-rx-mixed-chain-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId),originalPath=path.join(directory,"original.wav"); fs.mkdirSync(directory,{recursive:true}); fs.copyFileSync(sample,originalPath);
  const sha256=crypto.createHash("sha256").update(fs.readFileSync(originalPath)).digest("hex"),audit={uploadId,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,immutable:true,sha256},derivatives:[]}},profileIds=["rx12-de-hum-dynamic-v1","low-frequency-rolloff-v2"];
  const result=await createRxDerivative(root,audit,{originalPath,profileIds,recordAuditEvent:async()=>{}}),derivativePath=path.join(root,"data",...result.key.split("/"));
  assert.deepEqual(result.profileIds,profileIds); assert.equal(result.module,"De-hum → High-pass filter"); assert.equal(result.modules.length,2); assert.deepEqual(result.modules.map(item=>item.profileId),profileIds); assert.equal(result.modules[0].manufacturer,"iZotope"); assert.match(String(result.modules[0].pluginVersion),/^12\./); assert.equal(result.modules[1].plugin,"Pedalboard HighpassFilter"); assert.equal(result.modules[1].manufacturer,"Spotify"); assert.equal(result.sampleAligned,true); assert.equal(result.media.sampleFrames,result.sourceMedia.sampleFrames); assert.equal(result.media.sampleRate,result.sourceMedia.sampleRate); assert.equal(result.media.channels,result.sourceMedia.channels); assert.equal(result.sourceSha256,sha256); assert.ok(fs.existsSync(derivativePath));
  const probe=spawnSync("ffprobe",["-v","error","-show_entries","format_tags","-of","json",derivativePath],{encoding:"utf8",windowsHide:true}); assert.equal(probe.status,0,probe.stderr); const tags=JSON.parse(probe.stdout).format.tags; assert.equal(tags.DEPO_PRO_PROFILE_ID,profileIds.join("+")); assert.equal(tags.DEPO_PRO_SOURCE_SHA256,sha256);
});
