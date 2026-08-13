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
const sample=path.resolve("C:/Users/james/OneDrive/Documents 1/ChatGPT/Depo-Pro-New/.e2e/rx-ui-test.wav");

for(const profile of Object.values(RX_PROFILES)) test(`installed ${profile.module} profile renders sample-aligned disposable audio`,{skip:!enabled,timeout:120000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-rx-module-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId),originalPath=path.join(directory,"original.wav"); fs.mkdirSync(directory,{recursive:true}); fs.copyFileSync(sample,originalPath);
  const sha256=crypto.createHash("sha256").update(fs.readFileSync(originalPath)).digest("hex"),audit={uploadId,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,immutable:true,sha256},derivatives:[]}};
  const result=await createRxDerivative(root,audit,{originalPath,profileId:profile.id,recordAuditEvent:async()=>{}});
  const derivativePath=path.join(root,"data",...result.key.split("/"));assert.equal(result.profileId,profile.id); assert.equal(result.module,profile.module); assert.equal(result.sampleAligned,true); assert.equal(result.sourceSha256,sha256); assert.match(result.key,/\.flac$/); assert.equal(result.outputEncoding.container,"flac"); assert.equal(result.outputEncoding.lossless,true); assert.equal(result.media.sampleFrames,result.sourceMedia.sampleFrames); assert.ok(result.measurementDelta.some(item=>item.status!=="unavailable")); assert.ok(fs.existsSync(derivativePath));
  const probe=spawnSync("ffprobe",["-v","error","-show_entries","format_tags","-of","json",derivativePath],{encoding:"utf8",windowsHide:true});assert.equal(probe.status,0,probe.stderr);const tags=JSON.parse(probe.stdout).format.tags;assert.equal(tags.DEPO_PRO_OPERATION_ID,result.operationId);assert.equal(tags.DEPO_PRO_SOURCE_SHA256,sha256);assert.equal(tags.DEPO_PRO_TIMELINE_POLICY,"frame-aligned-no-cuts");
});
