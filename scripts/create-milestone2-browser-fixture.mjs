// Deterministic synthetic complete-transcript fixture. It never reads real deposition data.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCanonicalDepositionRecord, field } from "../server/canonical-deposition-record.mjs";
import { appendReporterOperations } from "../server/transcription-jobs.mjs";
import { ASSEMBLY_SCHEMA_VERSION, writeAssembly } from "../server/complete-transcript-assembly.mjs";
import { EVIDENCE, WORKING } from "../tests/fixtures/etminan-evidence.mjs";

const root=path.resolve(process.argv[2]??"");if(!root)throw new Error("Provide an isolated deposition storage root.");
const directory=path.join(root,"milestone2_reporter","m2-cause","synthetic_complete_transcript"),id="DEP-20260826-M2FIX";
if(fs.existsSync(directory))throw new Error(`Fixture already exists: ${directory}`);
for(const name of ["intake","transcript",`deepgram/jobs/${EVIDENCE.jobIdentity}`,"audio/original"])fs.mkdirSync(path.join(directory,...name.split("/")),{recursive:true});
// One semantic copy only. The original browser fixture cloned this same evidence eight times to
// make a long pagination specimen; the visible repetition was therefore source-fixture content,
// not section assembly. Page-volume stress belongs in paginator fixtures, not in the Human Gate.
const copies=1,words=[],segments=[];
for(let copy=0;copy<copies;copy++){const offset=copy*12,map=new Map();for(const [index,word] of EVIDENCE.words.entries()){const wordId=`${EVIDENCE.jobIdentity}:m2:${copy+1}:word:${index+1}`;map.set(word.id,wordId);words.push({...word,id:wordId,start:(word.start??0)+offset,end:(word.end??0)+offset})}for(const [index,segment] of WORKING.segments.entries())segments.push({...segment,id:`${EVIDENCE.jobIdentity}:m2:segment:${copy*WORKING.segments.length+index+1}`,asrWordIds:segment.asrWordIds.map(wordId=>map.get(wordId)),start:(segment.start??0)+offset,end:(segment.end??0)+offset})}
const evidence={...EVIDENCE,words},working={...WORKING,segments,derivedFrom:[EVIDENCE.jobIdentity],updatedAt:"2026-08-26T12:00:00.000Z"};
const seconds=copies*12+15,sampleRate=16000,dataBytes=seconds*sampleRate*2,wav=Buffer.alloc(44+dataBytes);wav.write("RIFF",0);wav.writeUInt32LE(36+dataBytes,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(dataBytes,40);
const audioPath="audio/original/milestone2-silence.wav",audioFile=path.join(directory,...audioPath.split("/"));fs.writeFileSync(audioFile,wav);const audioSha256=crypto.createHash("sha256").update(wav).digest("hex"),uploadId=crypto.randomUUID();
const record=createCanonicalDepositionRecord({jurisdictionType:"texas-state",court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS",causeNumber:"2026-CI-10001",caseStyle:"Alex Plaintiff v. Delta Company",witness:"Dr. Synthetic Witness",depositionDate:"2026-08-26",remote:false,location:"San Antonio, Texas",parties:[{name:"Alex Plaintiff",role:"Plaintiff"},{name:"Delta Company",role:"Defendant"}],attorneys:[{id:"counsel-bentley",name:"Dennis J. Bentley",honorific:"MR.",firm:"Plaintiff Firm",address:"100 Main, San Antonio, Texas",phone:"210-555-0101",represents:["Alex Plaintiff"],side:"PLAINTIFF",appearanceRole:"QUESTIONING_ATTORNEY",actualAppearance:true},{id:"counsel-ramon",name:"Christian R. Ramon",honorific:"MR.",firm:"Defense Firm",address:"200 Main, San Antonio, Texas",phone:"210-555-0102",represents:["Delta Company"],side:"DEFENDANT",appearanceRole:"DEFENDING_ATTORNEY",actualAppearance:true}],reporterProfile:{name:"Riley Reporter",licenseNumber:"1234",csrExpiration:"2027-12-31",company:"Reporter Firm",firmRegistrationNumber:"5678",address:"300 Main, San Antonio, Texas",phone:"210-555-0103"}});
record.counsel[0].honorific=field("MS.",{source:"REPORTER_ENTERED",state:"REPORTER_ADDED"});record.counsel[1].honorific=field("MR.",{source:"REPORTER_ENTERED",state:"REPORTER_ADDED"});
record.participants.videographers=[{id:"videographer",fullName:field("Synthetic Videographer",{source:"REPORTER_ENTERED",state:"REPORTER_ADDED"})}];
const operator={jurisdiction:"texas-state",signatureDisposition:"requested",signatureDispositionBasis:"Stated on the synthetic record",examiningCounselId:"counsel-bentley",courtHeadingLine:"IN THE DISTRICT COURT OF",countyCourtLine:"BEXAR COUNTY, TEXAS",judicialDistrictLine:"45TH JUDICIAL DISTRICT",proceedingHeading:"ORAL DEPOSITION OF",titleNarrative:["Dr. Synthetic Witness, produced as a witness and duly sworn,","was taken in San Antonio, Texas before Riley Reporter,","Certified Shorthand Reporter in and for Texas."],certification:{custodialAttorney:"Dennis J. Bentley",charges:"500.00",chargesResponsibleParty:"Plaintiff",serviceDate:"August 26, 2026",certificationDate:"August 26, 2026",furtherCertificationDate:"August 30, 2026",returnStatus:"Returned August 29, 2026"},timeUsed:{totalOnRecordMinutes:96,parties:[{name:"Dennis J. Bentley",minutes:48},{name:"Christian R. Ramon",minutes:48}]}};
const audio=[{uploadId,source:"original",operationId:null,sha256:audioSha256,path:audioPath,name:"milestone2-silence.wav"}],now="2026-08-26T12:00:00.000Z",deposition={schemaVersion:"1.2.0",id,caseStyle:"Alex Plaintiff v. Delta Company - Synthetic Complete Transcript",witness:"Dr. Synthetic Witness",deponentType:"Fact witness",depositionDate:"2026-08-26",courtReporterId:"m2-reporter",courtReporterName:"Riley Reporter",causeNumber:"2026-CI-10001",creationMode:"existing_recording",workflowStatus:"review",storagePath:"milestone2_reporter/m2-cause/synthetic_complete_transcript",intakeNotes:"Synthetic Milestone 2 verification only",noticeName:"",courtOrderName:"",audioFiles:[audio[0].name],audioIntakeIds:[uploadId],audio,keytermCount:0,keyterms:[],paths:{intake:"intake/intake.json",canonicalData:"intake/canonical-deposition-record.json",workingTranscript:"transcript/working.json"},createdAt:now,updatedAt:now};
fs.writeFileSync(path.join(directory,"deposition.json"),JSON.stringify(deposition,null,2));fs.writeFileSync(path.join(directory,"intake","intake.json"),JSON.stringify({schemaVersion:"1.0.0",counselOfRecord:["Dennis J. Bentley","Christian R. Ramon"],keyterms:[],deepgramArtifact:{wire:[]},audio},null,2));fs.writeFileSync(path.join(directory,"intake","canonical-deposition-record.json"),JSON.stringify(record,null,2));fs.writeFileSync(path.join(directory,"transcript","working.json"),JSON.stringify(working,null,2));fs.writeFileSync(path.join(directory,"deepgram","jobs",EVIDENCE.jobIdentity,"asr-evidence.json"),JSON.stringify(evidence,null,2));
const doctor=words.find(word=>word.punctuatedWord==="Doctor."),can=words.find((word,index)=>word.punctuatedWord==="Can"&&words[index-1]?.id===doctor?.id);
if(!doctor||!can)throw new Error("Synthetic correction anchors were not found.");
appendReporterOperations(process.cwd(),{depositionId:id,storageRoot:root,operations:[{op:"replace",wordId:doctor.id,text:"Doctor,"},{op:"replace",wordId:can.id,text:"can"}]});
// The assembly authority goes through the one writer, not around it.
//
// This script used to write intake/complete-transcript-assembly.json with fs directly, which made
// a fixture generator the second writer of document-assembly authority -- and the only writer that
// could produce a file with no revision and no author. Calling writeAssembly makes it a caller of
// the single writer, so no assembly file in the tree lacks provenance.
//
// The author is deliberately unmistakable. Anything readable as a person attesting to this
// preparation would be worse than useless on a record: it has to be obvious at a glance that a
// script produced it.
writeAssembly(process.cwd(),{depositionId:id,storageRoot:root,expectedRevision:0,
  actor:{preparedBy:"FIXTURE — scripts/create-milestone2-browser-fixture.mjs",preparedAt:now},
  assembly:{schemaVersion:ASSEMBLY_SCHEMA_VERSION,generatedAt:now,operator}});
console.log(JSON.stringify({id,directory,copies,words:words.length,audioSha256},null,2));
