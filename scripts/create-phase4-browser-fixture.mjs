// Creates an isolated synthetic deposition for browser verification. It never reads or copies a
// real deposition and refuses to overwrite an existing fixture.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE, WORKING } from "../tests/fixtures/etminan-evidence.mjs";

const root=path.resolve(process.argv[2]??"");
if(!root)throw new Error("Provide the isolated deposition storage root.");
const directory=path.join(root,"phase4_reporter","phase4-cause","synthetic_long_deposition"),id="DEP-20260825-PH4QA";
if(fs.existsSync(directory))throw new Error(`Fixture already exists: ${directory}`);
for(const name of ["intake","transcript",`deepgram/jobs/${EVIDENCE.jobIdentity}`,"audio/original"])fs.mkdirSync(path.join(directory,...name.split("/")),{recursive:true});

const copies=30,words=[],segments=[];
for(let copy=0;copy<copies;copy++){
  const offset=copy*12,map=new Map();
  for(const [index,word] of EVIDENCE.words.entries()){
    const wordId=`${EVIDENCE.jobIdentity}:phase4:${copy+1}:word:${index+1}`;map.set(word.id,wordId);
    words.push({...word,id:wordId,start:(word.start??0)+offset,end:(word.end??0)+offset});
  }
  for(const [index,segment] of WORKING.segments.entries())segments.push({...segment,id:`${EVIDENCE.jobIdentity}:phase4:segment:${copy*WORKING.segments.length+index+1}`,asrWordIds:segment.asrWordIds.map(wordId=>map.get(wordId)),start:(segment.start??0)+offset,end:(segment.end??0)+offset});
}
const evidence={...EVIDENCE,words},working={...WORKING,segments,derivedFrom:[EVIDENCE.jobIdentity],updatedAt:new Date().toISOString()};

const seconds=copies*12+15,sampleRate=16000,dataBytes=seconds*sampleRate*2,wav=Buffer.alloc(44+dataBytes);
wav.write("RIFF",0);wav.writeUInt32LE(36+dataBytes,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(dataBytes,40);
const audioPath="audio/original/phase4-silence.wav",audioFile=path.join(directory,...audioPath.split("/"));fs.writeFileSync(audioFile,wav);const audioSha256=crypto.createHash("sha256").update(wav).digest("hex"),uploadId=crypto.randomUUID();
const envelope=(value,source="REPORTER_ENTERED")=>({value,source,state:value===null?"MISSING":"REPORTER_ADDED",confidence:null,citations:[]});
const canonical={schemaVersion:"1.0.0",recordType:"CANONICAL_DEPOSITION_DATA_RECORD",reporter:{fullName:envelope("Phase Four Reporter")},deposition:{witness:envelope("Dr. Synthetic Witness")},counsel:[{id:"counsel-bentley",fullName:envelope("Ms. Bentley"),displayLabel:envelope("MS. BENTLEY:"),appearanceRole:envelope("QUESTIONING_ATTORNEY"),actualAppearance:envelope(true),remoteAppearance:envelope(false)},{id:"counsel-ramon",fullName:envelope("Mr. Ramon"),displayLabel:envelope("MR. RAMON:"),appearanceRole:envelope("DEFENDING_ATTORNEY"),actualAppearance:envelope(true),remoteAppearance:envelope(true)}],participants:{otherAttendees:[],interpreters:[],videographers:[{id:"videographer",fullName:envelope("Synthetic Videographer"),actualAppearance:envelope(true)}]}};
const audio=[{uploadId,source:"original",operationId:null,sha256:audioSha256,path:audioPath,name:"phase4-silence.wav"}],now=new Date().toISOString();
const deposition={schemaVersion:"1.2.0",id,caseStyle:"Synthetic Long Deposition — Phase 4 Browser Gate",witness:"Dr. Synthetic Witness",deponentType:"Fact witness",depositionDate:"2026-08-25",courtReporterId:"phase4-reporter",courtReporterName:"Phase Four Reporter",causeNumber:"PHASE4-TEST-001",creationMode:"existing_recording",workflowStatus:"review",storagePath:"phase4_reporter/phase4-cause/synthetic_long_deposition",intakeNotes:"Synthetic browser verification only",noticeName:"",courtOrderName:"",audioFiles:[audio[0].name],audioIntakeIds:[uploadId],audio,keytermCount:0,keyterms:[],paths:{intake:"intake/intake.json",canonicalData:"intake/canonical-deposition-record.json",workingTranscript:"transcript/working.json"},createdAt:now,updatedAt:now};
fs.writeFileSync(path.join(directory,"deposition.json"),JSON.stringify(deposition,null,2));
fs.writeFileSync(path.join(directory,"intake","intake.json"),JSON.stringify({schemaVersion:"1.0.0",keyterms:[],deepgramArtifact:{wire:[]},audio},null,2));
fs.writeFileSync(path.join(directory,"intake","canonical-deposition-record.json"),JSON.stringify(canonical,null,2));
fs.writeFileSync(path.join(directory,"transcript","working.json"),JSON.stringify(working,null,2));
fs.writeFileSync(path.join(directory,"deepgram","jobs",EVIDENCE.jobIdentity,"asr-evidence.json"),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({id,directory,paragraphCopies:copies,words:words.length,audioSha256},null,2));
