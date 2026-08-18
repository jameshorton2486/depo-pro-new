import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authoritativeKeyterms, getSpeakerCandidates, getWorkingTranscript, listTranscriptionJobs, reconcileSpeakerMap, runTranscriptionJob, transcriptionIdentity, TRANSCRIPT_ROLES } from "../server/transcription-jobs.mjs";
import { buildDeepgramRequest } from "../server/deepgram-service.mjs";
import { buildSpeakerLabels } from "../server/transcript-labels.mjs";

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-transcription-")),storageRoot=path.join(root,"depos"),directory=path.join(storageRoot,"reporter","cause","deposition"),uploadId=crypto.randomUUID(),audioBytes=Buffer.from("frozen-audio"),audioSha256=crypto.createHash("sha256").update(audioBytes).digest("hex");for(const name of ["intake","deepgram","transcript","audio/original"])fs.mkdirSync(path.join(directory,name),{recursive:true});fs.writeFileSync(path.join(directory,"audio","original","test.wav"),audioBytes);fs.writeFileSync(path.join(directory,"deposition.json"),JSON.stringify({id:"DEP-20260814-ABCDE",audio:[{uploadId,source:"original",operationId:null,sha256:audioSha256,path:"audio/original/test.wav",name:"test.wav"}]}));fs.writeFileSync(path.join(directory,"intake","intake.json"),JSON.stringify({keyterms:["fallback"],deepgramArtifact:{wire:["Beta","Alpha"]}}));fs.writeFileSync(path.join(directory,"intake","canonical-deposition-record.json"),JSON.stringify({counsel:[{id:"attorney-1"}],participants:{otherAttendees:[],interpreters:[],videographers:[]}}));return{root,storageRoot,directory,uploadId}}
const rawText='{"metadata":{"request_id":"request-1","models":["nova-3"],"diarize_info":{"model":"v2","version":"2.1"}},"results":{"channels":[{"alternatives":[{"transcript":"Hello Smith.","words":[{"word":"hello","punctuated_word":"Hello","start":0,"end":0.4,"confidence":0.99,"speaker":0,"speaker_confidence":0.95},{"word":"smith","punctuated_word":"Smith.","start":0.4,"end":0.8,"confidence":0.98,"speaker":0,"speaker_confidence":0.94}]}]}],"utterances":[{"speaker":0,"start":0,"end":0.8,"transcript":"Hello Smith."}]}}';

test("job preserves exact raw response and reuses the same ordered request identity",async t=>{const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));let submissions=0;const submit=async({keyterms})=>{submissions++;return{request:buildDeepgramRequest(keyterms),rawResponseText:rawText,normalized:{transcript:"Hello Smith."}}};const args={depositionId:"DEP-20260814-ABCDE",uploadId:value.uploadId,storageRoot:value.storageRoot,submit};const first=await runTranscriptionJob(value.root,args),second=await runTranscriptionJob(value.root,args);assert.equal(first.cached,false);assert.equal(second.cached,true);assert.equal(submissions,1);const rawPath=path.join(value.directory,first.job.response.rawResponsePath);assert.equal(fs.readFileSync(rawPath,"utf8"),rawText);assert.equal(first.job.response.rawResponseSha256,crypto.createHash("sha256").update(Buffer.from(rawText)).digest("hex"));assert.equal(first.evidence.diarizeInfo.model,"v2");assert.equal(first.evidence.words[0].speakerConfidence,.95);assert.deepEqual(first.workingTranscript.segments[0].asrWordIds,first.evidence.words.map(word=>word.id));const request=JSON.parse(fs.readFileSync(path.join(value.directory,first.job.request.path),"utf8"));assert.deepEqual(request.keyterms,["Beta","Alpha"]);assert.match(request.url,/keyterm=Beta.*keyterm=Alpha/)});

test("ordered keyterm arrays produce different identities",()=>{const first=authoritativeKeyterms({deepgramArtifact:{wire:["A","B"]}}),second=authoritativeKeyterms({deepgramArtifact:{wire:["B","A"]}});assert.notEqual(first.sha256,second.sha256);assert.notEqual(transcriptionIdentity({audioSha256:"a",keytermSetSha256:first.sha256}).sha256,transcriptionIdentity({audioSha256:"a",keytermSetSha256:second.sha256}).sha256)});

test("more than 50 keyterms fails closed without a recorded override",()=>{const wire=Array.from({length:51},(_,index)=>`T${index}`);assert.throws(()=>authoritativeKeyterms({deepgramArtifact:{wire}}),/explicit recorded override/);assert.equal(authoritativeKeyterms({deepgramArtifact:{wire}},{overrideReason:"Reporter approved case vocabulary"}).wire.length,51)});

test("speaker reconciliation applies source-scoped canonical identities without changing ASR references",()=>{const working={segments:[{sourceJobIdentity:"job-1",deepgramSpeaker:0,asrWordIds:["word-1"],speakerIdentity:null,transcriptRole:null}]},reconciled=reconcileSpeakerMap(working,[{sourceJobIdentity:"job-1",deepgramSpeaker:0,speakerIdentity:"attorney-1",transcriptRole:"QUESTIONING_ATTORNEY"}]);assert.equal(reconciled.speakerMap.status,"reconciled");assert.equal(reconciled.segments[0].speakerIdentity,"attorney-1");assert.deepEqual(reconciled.segments[0].asrWordIds,["word-1"])});

// The canonical record this fixture writes is the shape real intake produces: every field is a
// {value,source,state} wrapper, and an absent value is a present wrapper holding null rather
// than a missing key. Three attorneys, one of whom did not appear.
function canonicalWithCounsel(directory){
  fs.writeFileSync(path.join(directory,"intake","canonical-deposition-record.json"),JSON.stringify({
    deposition:{witness:{value:"Mohammad Etminan, M.D.",source:"NOD_EXTRACTED",state:"EXTRACTED"}},
    reporter:{fullName:{value:"Miah Bardot",source:"REPORTER_PROFILE",state:"EXTRACTED"}},
    counsel:[
      {id:"attorney-1",fullName:{value:"Dennis J. Bentley",state:"REPORTER_ADDED"},honorific:{value:"MR.",state:"REPORTER_ADDED"},appearanceRole:{value:"QUESTIONING_ATTORNEY",state:"REPORTER_ADDED"},actualAppearance:{value:true,state:"REPORTER_ADDED"}},
      {id:"attorney-2",fullName:{value:"Christian R. Ramon",state:"REPORTER_ADDED"},honorific:{value:null,state:"MISSING"},appearanceRole:{value:null,source:"REPORTER_ENTERED",state:"MISSING"},actualAppearance:{value:true,state:"REPORTER_ADDED"}},
      {id:"attorney-3",fullName:{value:"Marco A. Crawford",state:"REPORTER_ADDED"},honorific:{value:null,state:"MISSING"},appearanceRole:{value:null,source:"REPORTER_ENTERED",state:"MISSING"},actualAppearance:{value:false,state:"REPORTER_ADDED"}},
    ],
    participants:{otherAttendees:[],interpreters:[],videographers:[{id:"videographer-1",fullName:{value:"Sam Woody",state:"REPORTER_ADDED"}}]},
  }));
}
function candidatesFor(value){canonicalWithCounsel(value.directory);return getSpeakerCandidates(value.root,{depositionId:"DEP-20260814-ABCDE",storageRoot:value.storageRoot}).candidates}

test("a present-but-null canonical field never becomes a speaker role",()=>{
  // An attorney with no recorded appearanceRole produced defaultRole "[OBJECT_OBJECT]": the
  // null fell through to the field wrapper and String() stringified it. It failed closed --
  // that string is not in TRANSCRIPT_ROLES, so reconciliation would have rejected the
  // assignment -- but only after the reporter picked it off a nonsense list.
  const value=fixture();
  try{
    const candidates=candidatesFor(value);
    for(const candidate of candidates)assert.ok(candidate.defaultRole===""||TRANSCRIPT_ROLES.includes(candidate.defaultRole),`${candidate.id} produced role ${candidate.defaultRole}`);
    // No role, rather than the most consequential role available. Defaulting a missing value to
    // QUESTIONING_ATTORNEY is the same shape of error as stringifying the wrapper.
    assert.equal(candidates.find(item=>item.id==="attorney-2").defaultRole,"");
    assert.equal(candidates.find(item=>item.id==="attorney-1").defaultRole,"QUESTIONING_ATTORNEY");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("an attorney who did not appear is not offered as a speaker",()=>{
  // Crawford is counsel of record who did not appear, so he cannot have spoken. He stays in
  // counsel[] for the appearance page; as a selectable candidate he is a plausible wrong
  // assignee for turns that are actually Bentley's, and the AI pass would receive him as a
  // valid target. Asserted by identity, not by count -- a length check passes for the wrong
  // reason if some other candidate goes missing at the same time.
  const value=fixture();
  try{
    const ids=candidatesFor(value).map(item=>item.id);
    assert.deepEqual(ids,["witness","reporter","attorney-1","attorney-2","videographer-1"]);
    assert.ok(!ids.includes("attorney-3"),"an attorney marked actualAppearance false must not be a candidate");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("an unrecorded appearance keeps the candidate; only an explicit false removes one",()=>{
  // Not knowing whether someone appeared is not the same as knowing they did not, and the
  // filter must not quietly drop counsel whose appearance nobody has entered yet.
  const value=fixture();
  try{
    canonicalWithCounsel(value.directory);
    const file=path.join(value.directory,"intake","canonical-deposition-record.json"),record=JSON.parse(fs.readFileSync(file,"utf8"));
    record.counsel[2].actualAppearance={value:null,source:"REPORTER_ENTERED",state:"MISSING"};
    fs.writeFileSync(file,JSON.stringify(record));
    const ids=getSpeakerCandidates(value.root,{depositionId:"DEP-20260814-ABCDE",storageRoot:value.storageRoot}).candidates.map(item=>item.id);
    assert.ok(ids.includes("attorney-3"),"an unrecorded appearance must keep the candidate");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("honorific reaches the label builder, and its absence still raises the finding",()=>{
  // The field existed on the record and never reached buildSpeakerLabels, so filling it in
  // changed nothing a reporter could see. A field with no observable effect reads as broken.
  const value=fixture();
  try{
    const candidates=candidatesFor(value);
    assert.equal(candidates.find(item=>item.id==="attorney-1").honorific,"MR.");
    assert.equal(candidates.find(item=>item.id==="attorney-2").honorific,null);
    const {labels,findings}=buildSpeakerLabels(candidates);
    assert.equal(labels["attorney-1"],"MR. BENTLEY");
    assert.equal(labels["attorney-2"],"RAMON");
    assert.deepEqual(findings.map(finding=>finding.speakerIdentity),["attorney-2"]);
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

// Two completed jobs for one audio is what doubled DEP-20260815-ETM01: the keyterm list was
// corrected and the audio re-run, and mergeWorking placed the second transcription alongside the
// first instead of replacing it. Correcting the term list is what the term-review screen exists
// to encourage, so the path is designed rather than accidental. Depo-Pro refuses instead.
async function completeJob(value,{uploadId,keyterms}){
  fs.writeFileSync(path.join(value.directory,"intake","intake.json"),JSON.stringify({deepgramArtifact:{wire:keyterms}}));
  return runTranscriptionJob(value.root,{depositionId:"DEP-20260814-ABCDE",uploadId,storageRoot:value.storageRoot,
    submit:async({keyterms:wire})=>({request:buildDeepgramRequest(wire),rawResponseText:rawText,normalized:{transcript:"Hello Smith."}})});
}

test("a second transcription of the same audio is refused, and the refusal names the first",async t=>{
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const first=await completeJob(value,{uploadId:value.uploadId,keyterms:["Alpha"]});
  assert.equal(first.cached,false);
  const error=await completeJob(value,{uploadId:value.uploadId,keyterms:["Alpha","Beta","Gamma"]}).then(()=>null,e=>e);
  assert.ok(error,"a second completed transcription of one audio must not proceed");
  assert.equal(error.code,"DUPLICATE_COMPLETED_TRANSCRIPTION");
  assert.equal(error.existingJobId,first.job.jobId);
  // The reporter has to choose between two real transcriptions; a bare conflict does not let
  // them. Job, keyterm counts both sides, and what running it would do all have to be present.
  assert.match(error.message,new RegExp(first.job.jobId.slice(0,12)));
  assert.match(error.message,/1 keyterms/);
  assert.match(error.message,/3 keyterms/);
  assert.match(error.message,/twice/);
  // Refused, not half-done: the working transcript still holds exactly the first transcription.
  const working=JSON.parse(fs.readFileSync(path.join(value.directory,"transcript","working.json"),"utf8"));
  assert.deepEqual(working.derivedFrom,[first.job.jobId]);
});

test("re-running the identical keyterm set still resumes the stored job",()=>{
  // The guard sits after the cached-resume check for this reason. If it moved above it, resuming
  // a completed transcription would start reporting a conflict with itself.
  const source=fs.readFileSync("server/transcription-jobs.mjs","utf8");
  const cached=source.indexOf('return{cached:true,...existing}');
  const guard=source.indexOf('DUPLICATE_COMPLETED_TRANSCRIPTION');
  assert.ok(cached>0&&guard>cached,"the duplicate guard must follow the cached-resume return");
});

test("a second recording in the same deposition still transcribes", async t=>{
  // The guard keys on uploadId. A deposition with two audio files is the case mergeWorking was
  // built for, and refusing there would break multi-file depositions to fix single-file ones.
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const record=JSON.parse(fs.readFileSync(path.join(value.directory,"deposition.json"),"utf8"));
  const secondBytes=Buffer.from("frozen-audio-two"),secondUpload=crypto.randomUUID();
  fs.writeFileSync(path.join(value.directory,"audio","original","second.wav"),secondBytes);
  record.audio.push({uploadId:secondUpload,source:"original",operationId:null,sha256:crypto.createHash("sha256").update(secondBytes).digest("hex"),path:"audio/original/second.wav",name:"second.wav"});
  fs.writeFileSync(path.join(value.directory,"deposition.json"),JSON.stringify(record));
  const first=await completeJob(value,{uploadId:value.uploadId,keyterms:["Alpha"]});
  const second=await completeJob(value,{uploadId:secondUpload,keyterms:["Alpha"]});
  assert.equal(second.cached,false);
  const working=JSON.parse(fs.readFileSync(path.join(value.directory,"transcript","working.json"),"utf8"));
  assert.deepEqual(working.derivedFrom.sort(),[first.job.jobId,second.job.jobId].sort());
});

test("a failed job for the same audio does not block a new transcription", async t=>{
  // The guard counts completed jobs only. A failed attempt produced no segments, so it cannot
  // double anything, and refusing after one would leave the audio permanently untranscribable.
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(value.directory,"intake","intake.json"),JSON.stringify({deepgramArtifact:{wire:["Alpha"]}}));
  const failure=await runTranscriptionJob(value.root,{depositionId:"DEP-20260814-ABCDE",uploadId:value.uploadId,storageRoot:value.storageRoot,
    submit:async()=>{throw new Error("Deepgram refused the request.")}}).then(()=>null,error=>error);
  assert.ok(failure,"the seeded attempt must fail");
  const stored=listTranscriptionJobs(value.root,{depositionId:"DEP-20260814-ABCDE",storageRoot:value.storageRoot});
  assert.equal(stored.length,1);
  assert.equal(stored[0].status,"failed");
  const retry=await completeJob(value,{uploadId:value.uploadId,keyterms:["Alpha","Beta"]});
  assert.equal(retry.cached,false);
  assert.equal(retry.job.status,"completed");
});

test("a transcript that was never made is distinguishable from one that will not read",()=>{
  // The Workspace suppresses its error banner for the first case, because a deposition awaiting
  // transcription has not failed at anything. It must not suppress the second: a stored
  // transcript that cannot be read is exactly what a reporter needs told, and the first version
  // of that suppression keyed on whether audio was present, which swallowed both.
  const value=fixture();
  try{
    const file=path.join(value.directory,"transcript","working.json");
    const absent=(()=>{ try{ getWorkingTranscript(value.root,{depositionId:"DEP-20260814-ABCDE",storageRoot:value.storageRoot}); return null }catch(error){ return error } })();
    assert.ok(absent,"a missing working transcript must throw");
    assert.equal(absent.code,"WORKING_TRANSCRIPT_NOT_CREATED");

    fs.writeFileSync(file,"{ this is not json");
    const unreadable=(()=>{ try{ getWorkingTranscript(value.root,{depositionId:"DEP-20260814-ABCDE",storageRoot:value.storageRoot}); return null }catch(error){ return error } })();
    assert.ok(unreadable,"an unreadable working transcript must throw");
    assert.notEqual(unreadable.code,"WORKING_TRANSCRIPT_NOT_CREATED","a corrupt transcript must not report as one that was never made");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});
