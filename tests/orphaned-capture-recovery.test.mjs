import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {createCaptureSession,finalizeOrphanedSession,registerCaptureAudio} from "../server/live-capture.mjs";

const ROOT=process.cwd(),DEPOSITION="DEP-20260821-ORPHN";

// A real WAV rather than a stub, because recovery decides FINALIZED against FAILED by asking
// ffprobe whether the file decodes. Bytes that only look like audio would pass a test that the
// production path would fail.
function wav({seconds=1,rate=8000}={}){
  const samples=seconds*rate,data=Buffer.alloc(samples*2);
  for(let index=0;index<samples;index++)data.writeInt16LE(Math.round(8000*Math.sin(index/12)),index*2);
  const header=Buffer.alloc(44);
  header.write("RIFF",0);header.writeUInt32LE(36+data.length,4);header.write("WAVE",8);
  header.write("fmt ",12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
  header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write("data",36);header.writeUInt32LE(data.length,40);
  return Buffer.concat([header,data]);
}

// A session left exactly as a dead application instance leaves one: state RECORDING, channels
// RECORDING, audio on disk, nothing hashed and nothing finalized.
function orphan({channels=[{id:"ch1",role:"LOCAL_MICROPHONE",deviceId:"mic"}],contents=null}={}){
  const storageRoot=fs.mkdtempSync(path.join(os.tmpdir(),"depo-orphan-"));
  const folder=path.join(storageRoot,"reporter","cause","witness");
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,"deposition.json"),JSON.stringify({id:DEPOSITION,caseStyle:"A v. B",witness:"Witness"}));
  const session=createCaptureSession(ROOT,{depositionId:DEPOSITION,storageRoot,sources:channels});
  const directory=path.join(folder,"live-capture",session.sessionId),manifest=path.join(directory,"capture-session.json");
  const record=JSON.parse(fs.readFileSync(manifest,"utf8"));
  fs.mkdirSync(path.join(directory,"channels"),{recursive:true});
  const files=record.sources.map((source,index)=>{
    const file=path.join(directory,"channels",`${String(source.ordinal+1).padStart(2,"0")}-${source.id}.wav`);
    fs.writeFileSync(file,contents?contents(index):wav());
    source.state="RECORDING";
    source.artifact={relativePath:path.relative(folder,file).replaceAll("\\","/"),bytes:null,sha256:null,finalized:false};
    return file;
  });
  record.state="RECORDING";
  record.events.push({type:"LOCAL_RECORDING_STARTED",at:new Date().toISOString()});
  fs.writeFileSync(manifest,JSON.stringify(record,null,2));
  return {storageRoot,sessionId:session.sessionId,manifest,files,cleanup:()=>fs.rmSync(storageRoot,{recursive:true,force:true})};
}

const read=manifest=>JSON.parse(fs.readFileSync(manifest,"utf8"));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const settled=()=>Promise.resolve();

test("an interrupted capture is finalized and hashed from the file on disk",async()=>{
  const scenario=orphan();
  const result=await finalizeOrphanedSession(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot,wait:settled});
  const source=result.sources[0];
  assert.equal(source.state,"FINALIZED");
  assert.equal(source.artifact.finalized,true);
  assert.equal(source.artifact.sha256,sha(scenario.files[0]),"the hash is of the file that is actually on disk");
  assert.equal(source.artifact.bytes,fs.statSync(scenario.files[0]).size);
  assert.equal(source.format.sampleRate,8000,"the format is read back from the recording, not assumed");
  assert.equal(read(scenario.manifest).sources[0].artifact.sha256,source.artifact.sha256,"and it is persisted, not only returned");
  scenario.cleanup();
});

test("a recovered capture is never reported as one that was stopped cleanly",async()=>{
  const scenario=orphan();
  const result=await finalizeOrphanedSession(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot,wait:settled});
  assert.equal(result.state,"DEGRADED","a recovered session must be distinguishable from a clean stop");
  assert.notEqual(result.state,"FINALIZED");
  const types=result.events.map(event=>event.type);
  assert.ok(types.includes("LOCAL_RECORDING_RECOVERED"));
  assert.ok(!types.includes("LOCAL_RECORDING_STOPPED"),"nothing observed the stop, so nothing may record one");
  assert.equal(result.sources[0].timing.captureEndMonotonicNs,null,"the moment capture ended is unknown and must stay unknown");
  assert.ok(/was not observed/.test(result.events.at(-1).reason),"the record says why it is degraded");
  scenario.cleanup();
});

test("recovery refuses while a channel is still being written",async()=>{
  const scenario=orphan();
  // The writer that is still attached: the file grows across the settle window, exactly as
  // constant-bitrate PCM does while ffmpeg is recording it.
  const growing=()=>{fs.appendFileSync(scenario.files[0],Buffer.alloc(4096));return Promise.resolve()};
  await assert.rejects(
    finalizeOrphanedSession(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot,wait:growing}),
    /Still being recorded: ch1/);
  assert.equal(read(scenario.manifest).state,"RECORDING","a refused recovery changes nothing");
  assert.equal(read(scenario.manifest).sources[0].artifact.sha256,null);
  scenario.cleanup();
});

test("a channel whose file will not decode is failed rather than hashed",async()=>{
  const scenario=orphan({contents:()=>Buffer.from("this is not audio")});
  const result=await finalizeOrphanedSession(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot,wait:settled});
  assert.equal(result.sources[0].state,"FAILED");
  assert.equal(result.sources[0].artifact.finalized,false);
  assert.equal(result.sources[0].artifact.sha256,null,"an unplayable file must not carry a hash that implies it is evidence");
  assert.match(result.sources[0].health.errors.at(-1).message,/could not be decoded/);
  assert.throws(()=>registerCaptureAudio(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot}),/no finalized channels/);
  scenario.cleanup();
});

test("a missing file is reported as missing rather than silently finalized",async()=>{
  const scenario=orphan();
  fs.rmSync(scenario.files[0]);
  const result=await finalizeOrphanedSession(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot,wait:settled});
  assert.equal(result.sources[0].state,"FAILED");
  assert.match(result.sources[0].health.errors.at(-1).message,/missing/);
  scenario.cleanup();
});

test("recovery is refused for a session that was not interrupted",async()=>{
  const scenario=orphan();
  const record=read(scenario.manifest);record.state="FINALIZED";
  fs.writeFileSync(scenario.manifest,JSON.stringify(record,null,2));
  await assert.rejects(
    finalizeOrphanedSession(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot,wait:settled}),
    /This session is FINALIZED/);
  scenario.cleanup();
});

test("the point of all of it: a recovered capture can be attached to its deposition",async()=>{
  const scenario=orphan({channels:[{id:"ch1",role:"LOCAL_MICROPHONE",deviceId:"mic"},{id:"ch2",role:"ROOM",deviceId:"mix"}]});
  assert.throws(
    ()=>registerCaptureAudio(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot}),
    /Stop and finalize the recording/,
    "before recovery the audio exists and is unusable, which is the whole defect");
  await finalizeOrphanedSession(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot,wait:settled});
  const registered=registerCaptureAudio(ROOT,{depositionId:DEPOSITION,sessionId:scenario.sessionId,storageRoot:scenario.storageRoot});
  assert.equal(registered.skipped.length,0,"both channels survived recovery");
  assert.equal(registered.sessionId,scenario.sessionId);
  scenario.cleanup();
});
