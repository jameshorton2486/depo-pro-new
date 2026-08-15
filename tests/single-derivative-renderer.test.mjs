import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as audioPipeline from "../server/audio-pipeline.mjs";
import { createRxDerivative } from "../server/rx-processing.mjs";
import { AUDIO_TOOL_PROFILES } from "../server/rx-profiles.mjs";

const UNAVAILABLE = () => ({ available:false, executable:null, fallback:"iZotope RX 12 is unavailable." });

function intake(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-single-renderer-")),uploadId=crypto.randomUUID();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,"data","audio-intake",uploadId),originalPath=path.join(directory,"original.wav");
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(originalPath,Buffer.alloc(2048,7));
  const sha256=crypto.createHash("sha256").update(fs.readFileSync(originalPath)).digest("hex");
  return { root, originalPath, audit:{ uploadId, storage:{ original:{ key:`audio-intake/${uploadId}/original.wav`, immutable:true, sha256 }, derivatives:[] } } };
}

test("audio-pipeline exports no second renderer for tool profiles",()=>{
  // C-3/C-4: `low-frequency-rolloff-v2` rendered through ffmpeg here and through Pedalboard's
  // HighpassFilter in the worker, both recording the same profileId and profileVersion. Two
  // files, identical stated provenance, different SHA-256, different phase response.
  assert.equal(audioPipeline.createDerivative,undefined);
  assert.equal(audioPipeline.profileFilter,undefined);
});

test("the recommended candidate profile resolves through the shared catalog",()=>{
  const profile=AUDIO_TOOL_PROFILES["low-frequency-rolloff-v2"];
  assert.ok(profile,"the only profile recommendProcessing can return must exist in the shared catalog");
  assert.equal(profile.engine,"ffmpeg");
  assert.equal(profile.version,"2.0.0");
});

test("a chain with no RX-engine profile renders without the RX editor installed",async t=>{
  // Gating the high-pass filter on RX availability is what forced a second ffmpeg renderer
  // to exist. With RX reported unavailable, the chain must still reach the worker.
  const { root, originalPath, audit }=intake(t);
  let workerCalled=false;
  await assert.rejects(
    createRxDerivative(root,audit,{ originalPath, profileIds:["low-frequency-rolloff-v2"], recordAuditEvent:async()=>{},
      inspectRxStatus:UNAVAILABLE, validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000}),
      runWorker:async()=>{workerCalled=true} }),
    // It gets past the RX gate and fails later, on the worker producing nothing.
    error=>!/iZotope RX 12 is unavailable/.test(error.message),
  );
  assert.equal(workerCalled,true,"the worker must be reached even though RX is unavailable");
});

test("an RX-engine chain still refuses to render without the RX editor",async t=>{
  const { root, originalPath, audit }=intake(t);
  let workerCalled=false;
  await assert.rejects(
    createRxDerivative(root,audit,{ originalPath, profileIds:["rx12-de-hum-dynamic-v1"], recordAuditEvent:async()=>{},
      inspectRxStatus:UNAVAILABLE, validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000}),
      runWorker:async()=>{workerCalled=true} }),
    /iZotope RX 12 is unavailable/,
  );
  assert.equal(workerCalled,false,"an RX module must never be rendered without RX present");
});
