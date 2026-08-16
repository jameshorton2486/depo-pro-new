import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authoritativeKeyterms, getTranscriptionJob, reconcileSpeakerMap, runTranscriptionJob, transcriptionIdentity } from "../server/transcription-jobs.mjs";
import { buildDeepgramRequest } from "../server/deepgram-service.mjs";

const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
function raw(requestId,text,speaker=0){const words=text.split(" ").map((word,index)=>({word:word.toLowerCase(),punctuated_word:word,start:index*.4,end:(index+1)*.4,confidence:.98,speaker,speaker_confidence:.93}));return JSON.stringify({metadata:{request_id:requestId,models:["nova-3"],diarize_info:{model:"v2",version:"2.0"}},results:{channels:[{alternatives:[{transcript:text,words}]}],utterances:[{speaker,start:0,end:words.at(-1).end,transcript:text}]}})}
function fixture(audioCount=1){const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-production-gates-")),storageRoot=path.join(root,"depos"),directory=path.join(storageRoot,"reporter","cause","deposition");for(const name of ["intake","deepgram","transcript","audio/original"])fs.mkdirSync(path.join(directory,name),{recursive:true});const audio=Array.from({length:audioCount},(_,index)=>{const uploadId=crypto.randomUUID(),bytes=Buffer.from(`frozen-audio-${index}`),name=`recording-${index}.wav`,relative=`audio/original/${name}`;fs.writeFileSync(path.join(directory,...relative.split("/")),bytes);return{uploadId,source:"original",operationId:null,sha256:digest(bytes),path:relative,name}});fs.writeFileSync(path.join(directory,"deposition.json"),JSON.stringify({id:"DEP-20260814-GATES",audio}));fs.writeFileSync(path.join(directory,"intake","intake.json"),JSON.stringify({deepgramArtifact:{wire:["Smith","Aviation"]}}));fs.writeFileSync(path.join(directory,"intake","canonical-deposition-record.json"),JSON.stringify({counsel:[{id:"attorney-1"}],participants:{otherAttendees:[],interpreters:[],videographers:[]}}));return{root,storageRoot,directory,audio}}
function result(keyterms,text="Hello.",requestId="request-1",speaker=0){const rawResponseText=raw(requestId,text,speaker);return{request:buildDeepgramRequest(keyterms),rawResponseBytes:Buffer.from(rawResponseText),rawResponseText,response:{status:200,headers:{"content-type":"application/json"}},normalized:{transcript:text}}}

test("submission reads and verifies the frozen deposition audio",async t=>{const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));let observed;await runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[0].uploadId,storageRoot:value.storageRoot,submit:async({audioFile,keyterms})=>{observed=fs.readFileSync(audioFile,"utf8");return result(keyterms)}});assert.equal(observed,"frozen-audio-0");fs.writeFileSync(path.join(value.directory,...value.audio[0].path.split("/")),"mutated");await assert.rejects(()=>runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[0].uploadId,storageRoot:value.storageRoot,submit:async()=>{throw new Error("must not submit")}}),/failed SHA-256 verification/)});

test("failed vendor response and attempt request remain preserved",async t=>{const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));const error=Object.assign(new Error("Vendor rejected request"),{status:400,code:"INVALID_QUERY",rawResponseBytes:Buffer.from('{"err_code":"INVALID_QUERY"}')});await assert.rejects(()=>runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[0].uploadId,storageRoot:value.storageRoot,submit:async()=>{throw error}}),/Vendor rejected/);const keyterms=authoritativeKeyterms({deepgramArtifact:{wire:["Smith","Aviation"]}}),identity=transcriptionIdentity({audioSha256:value.audio[0].sha256,keytermSetSha256:keyterms.sha256}).sha256,attempt=path.join(value.directory,"deepgram","jobs",identity,"attempts","0001");assert.ok(fs.existsSync(path.join(attempt,"request.json")));assert.equal(fs.readFileSync(path.join(attempt,"error-response.bin"),"utf8"),'{"err_code":"INVALID_QUERY"}');assert.equal(JSON.parse(fs.readFileSync(path.join(attempt,"failure.json"),"utf8")).httpStatus,400)});

test("corrupt normalized evidence rebuilds from raw response without resubmission",async t=>{const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));let calls=0,first=await runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[0].uploadId,storageRoot:value.storageRoot,submit:async({keyterms})=>{calls++;return result(keyterms)}}),evidenceFile=path.join(value.directory,first.job.response.evidencePath);fs.writeFileSync(evidenceFile,"corrupt");const loaded=getTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",jobId:first.job.jobId,storageRoot:value.storageRoot});assert.equal(loaded.integrity.valid,true);assert.equal(loaded.integrity.rebuilt,true);assert.equal(loaded.evidence.words.length,1);assert.equal(calls,1)});

test("multiple recordings keep independent speaker namespaces and ordered assembly",async t=>{const value=fixture(2);t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));const first=await runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[0].uploadId,storageRoot:value.storageRoot,submit:async({keyterms})=>result(keyterms,"First.","request-1",0)}),second=await runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[1].uploadId,storageRoot:value.storageRoot,submit:async({keyterms})=>result(keyterms,"Second.","request-2",0)});assert.deepEqual(second.workingTranscript.segments.map(item=>item.text),["First.","Second."]);const reconciled=reconcileSpeakerMap(second.workingTranscript,[{sourceJobIdentity:first.job.jobId,deepgramSpeaker:0,speakerIdentity:"witness",transcriptRole:"WITNESS"},{sourceJobIdentity:second.job.jobId,deepgramSpeaker:0,speakerIdentity:"attorney-1",transcriptRole:"QUESTIONING_ATTORNEY"}]);assert.deepEqual(reconciled.segments.map(item=>item.speakerIdentity),["witness","attorney-1"]);assert.equal(reconciled.speakerMap.status,"reconciled")});

test("a persisted interrupted processing state is retried under the same identity",async t=>{const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));const terms=authoritativeKeyterms({deepgramArtifact:{wire:["Smith","Aviation"]}}),identity=transcriptionIdentity({audioSha256:value.audio[0].sha256,keytermSetSha256:terms.sha256}).sha256,directory=path.join(value.directory,"deepgram","jobs",identity);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,"job.json"),JSON.stringify({jobId:identity,status:"processing",attempts:1,createdAt:new Date().toISOString()}));fs.writeFileSync(path.join(directory,"job.lock"),JSON.stringify({pid:99999999,identity}));let calls=0;const completed=await runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[0].uploadId,storageRoot:value.storageRoot,submit:async({keyterms})=>{calls++;return result(keyterms)}});assert.equal(completed.job.status,"completed");assert.equal(completed.job.attempts,2);assert.equal(calls,1)});

// The invariant the reproducibility claim rests on, and the one a correction seam would
// inherit: working.json is a projection of immutable evidence plus stored parameters, so
// re-deriving its segments must re-apply those parameters rather than discard them.
//
// mergeWorking is the only function that derives segments from evidence -- rebuildFromRaw
// routes through it -- and reconcileDepositionSpeakers is a second writer that stores a
// parameter rather than deriving anything. That split is what makes the claim hold, and
// nothing asserted it until now: the existing rebuild test checks evidence integrity and
// never touches the speaker map.
test("a rebuild from raw re-applies the stored speaker map to the re-derived segments",async t=>{
  const value=fixture(); t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const first=await runTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",uploadId:value.audio[0].uploadId,storageRoot:value.storageRoot,submit:async({keyterms})=>result(keyterms)});
  const workingFile=path.join(value.directory,"transcript","working.json");
  const working=JSON.parse(fs.readFileSync(workingFile,"utf8"));
  const [segment]=working.segments;
  assert.ok(segment,"the job must have produced at least one segment");

  const reconciled=reconcileSpeakerMap(working,[{sourceJobIdentity:segment.sourceJobIdentity,deepgramSpeaker:segment.deepgramSpeaker,speakerIdentity:"witness",transcriptRole:"WITNESS"}]);
  fs.writeFileSync(workingFile,JSON.stringify(reconciled));
  assert.equal(reconciled.segments[0].speakerIdentity,"witness");

  // Corrupting the normalized evidence forces every segment to be re-derived from the raw
  // response. If the stored map were baked into segments rather than re-applied, the
  // reconciliation would silently vanish here.
  fs.writeFileSync(path.join(value.directory,first.job.response.evidencePath),"corrupt");
  const rebuilt=getTranscriptionJob(value.root,{depositionId:"DEP-20260814-GATES",jobId:first.job.jobId,storageRoot:value.storageRoot});
  assert.equal(rebuilt.integrity.rebuilt,true,"the rebuild path must have run");

  const after=JSON.parse(fs.readFileSync(workingFile,"utf8"));
  assert.deepEqual(after.speakerMap.assignments,reconciled.speakerMap.assignments,"the stored parameter must survive re-derivation");
  assert.equal(after.segments[0].speakerIdentity,"witness","re-derived segments must have the stored map re-applied");
  assert.equal(after.segments[0].transcriptRole,"WITNESS");
  assert.ok(after.transcript_hash,"the rewritten transcript must carry a content hash");
  assert.notEqual(after.transcript_hash,working.transcript_hash,"applying a speaker map changes the transcript content hash");
});
