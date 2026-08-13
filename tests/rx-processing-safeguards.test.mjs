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
  const value=fixture(); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const result=await createRxDerivative(value.root,value.audit,{originalPath:value.originalPath,recordAuditEvent:async()=>{},pythonExecutable:value.dependency,workerPath:value.dependency,pluginPath:value.dependency,
    runWorker:async(_command,args)=>{fs.writeFileSync(args[args.indexOf("--output")+1],"derivative");fs.writeFileSync(args[args.indexOf("--result")+1],JSON.stringify({worker:"spotify-pedalboard",workerVersion:"test",plugin:"RX 12 Voice De-noise",manufacturer:"iZotope",pluginVersion:"12.0.0",profileId:"rx12-voice-denoise-factory-adaptive-v1",profileVersion:"1.0.0",sourceFrames:48000,framesProcessed:48000,requestedRawParameters:{},appliedRawParameters:{},effectiveRawParameters:{}}));},
    validateAudio:async()=>({durationSeconds:1,sampleRate:48000,channels:1,sampleFrames:48000})});
  assert.deepEqual(fs.readFileSync(value.originalPath),value.original); assert.equal(result.sourceSha256,value.audit.storage.original.sha256); assert.equal(result.sourceImmutable,true);
});

test("RX processing rejects an original hash mismatch before worker execution", async t => {
  const value=fixture(); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true})); value.audit.storage.original.sha256="0".repeat(64); let workerCalled=false; const incidents=[];
  await assert.rejects(createRxDerivative(value.root,value.audit,{originalPath:value.originalPath,recordAuditEvent:async event=>incidents.push(event),pythonExecutable:value.dependency,workerPath:value.dependency,pluginPath:value.dependency,runWorker:async()=>{workerCalled=true}}),error=>error.code==="RX_INTEGRITY_VIOLATION");
  assert.equal(workerCalled,false); assert.equal(incidents[0].code,"SOURCE_HASH_MISMATCH_BEFORE_PROCESSING"); assert.deepEqual(fs.readFileSync(value.originalPath),value.original);
});
