import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readAudioAudit, resolveAudioItem } from "./audio-pipeline.mjs";

const ID_PATTERN=/^DEP-\d{8}-[A-Z0-9]{5}$/;
function base(root){return path.resolve(root,"data","depositions")}
function within(candidate,parent){const relative=path.relative(path.resolve(parent),path.resolve(candidate));return relative&&!relative.startsWith("..")&&!path.isAbsolute(relative)}
function safeName(value,fallback){return path.basename(String(value||fallback)).replace(/[^a-zA-Z0-9._ -]/g,"_")}
function atomicJson(file,value){const temporary=`${file}.${crypto.randomUUID()}.tmp`,descriptor=fs.openSync(temporary,"wx");try{fs.writeFileSync(descriptor,JSON.stringify(value,null,2));fs.fsyncSync(descriptor)}finally{fs.closeSync(descriptor)}fs.renameSync(temporary,file)}
function commitDirectory(source,target,{rename=fs.renameSync,wait=milliseconds=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds),attempts=8,delayBaseMs=350}={}){for(let attempt=1;attempt<=attempts;attempt++){try{rename(source,target);return}catch(error){if(!["EPERM","EBUSY","EACCES"].includes(error?.code))throw error;if(attempt===attempts){const blocked=new Error(`Windows blocked the completed deposition folder rename after ${attempts} attempts. Close programs using the deposition files or check folder permissions, then try again.`,{cause:error});blocked.code="DEPOSITION_COMMIT_BLOCKED";throw blocked}wait(delayBaseMs*attempt)}}}
function requiredText(value,label){const text=String(value||"").trim();if(!text)throw new Error(`${label} is required.`);return text}
export function depositionDirectory(root,id){if(!ID_PATTERN.test(String(id)))throw new Error("Invalid deposition ID.");const directory=path.join(base(root),id);if(!within(directory,base(root)))throw new Error("Deposition path escaped its storage root.");return directory}

export function scanDepositions(root){const directory=base(root);fs.mkdirSync(directory,{recursive:true});const depositions=[],issues=[];for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  if(!entry.isDirectory())continue;const folder=path.join(directory,entry.name),record=path.join(folder,"deposition.json");
  if(!ID_PATTERN.test(entry.name)){issues.push({folder:entry.name,code:"INVALID_FOLDER_ID",message:"Folder name is not a valid deposition ID."});continue}
  if(!fs.existsSync(record)){issues.push({folder:entry.name,code:"ORPHANED_FOLDER",message:"deposition.json is missing."});continue}
  try{const value=JSON.parse(fs.readFileSync(record,"utf8"));if(value.id!==entry.name||!value.caseStyle||!value.witness)throw new Error("Required identity fields are missing or inconsistent.");depositions.push(value)}catch(error){issues.push({folder:entry.name,code:"MALFORMED_DEPOSITION",message:error instanceof Error?error.message:"Invalid deposition metadata."})}
 }depositions.sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));return{depositions,issues}}

function writeArtifact(directory,relative,artifact){if(!artifact?.base64)return null;const target=path.join(directory,...relative.split("/"));if(!within(target,directory))throw new Error("Intake artifact path escaped the deposition folder.");fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(artifact.base64,"base64"),{flag:"wx"});return relative}

export function createDeposition(root,input){const metadata=input?.deposition||{},id=String(metadata.id||"");const finalDirectory=depositionDirectory(root,id),rootDirectory=base(root);fs.mkdirSync(rootDirectory,{recursive:true});if(fs.existsSync(finalDirectory))throw new Error("A deposition with this ID already exists.");const staging=path.join(rootDirectory,`.creating-${id}-${crypto.randomUUID()}`);fs.mkdirSync(staging,{recursive:false});
 try{
  for(const name of ["intake","audio/original","audio/processed","deepgram","transcript","exhibits","ufm","certification/history"])fs.mkdirSync(path.join(staging,...name.split("/")),{recursive:true});
  const artifacts=input.artifacts||{},noticeName=artifacts.notice?safeName(artifacts.notice.name,"notice.bin"):"",courtOrderName=artifacts.courtOrder?safeName(artifacts.courtOrder.name,"court-order.bin"):"";
  if(artifacts.notice)writeArtifact(staging,`intake/${noticeName}`,artifacts.notice);if(artifacts.courtOrder)writeArtifact(staging,`intake/${courtOrderName}`,artifacts.courtOrder);
  const supporting=(artifacts.supportingFiles||[]).map((artifact,index)=>writeArtifact(staging,`intake/supporting/${String(index+1).padStart(2,"0")}-${safeName(artifact.name,"document.bin")}`,artifact));
  const audio=[];for(const uploadId of metadata.audioIntakeIds||[]){const audit=readAudioAudit(root,uploadId),item=resolveAudioItem(audit),source=path.resolve(root,"data",item.key);const category=audit.selectedSource==="processed"?"processed":"original",name=safeName(audit.selectedSource==="processed"?path.basename(item.key):audit.originalName,path.basename(item.key)),relative=`audio/${category}/${name}`,target=path.join(staging,...relative.split("/"));fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);/* copyFileSync returns only after its internal handles are closed. */audio.push({uploadId,source:audit.selectedSource,operationId:audit.selectedDerivativeOperationId||null,sha256:item.sha256,path:relative,name})}
  const now=new Date().toISOString(),record={schemaVersion:"1.0.0",id,caseStyle:requiredText(metadata.caseStyle,"Case style"),witness:requiredText(metadata.witness,"Witness"),deponentType:String(metadata.deponentType||"Fact witness"),depositionDate:requiredText(metadata.depositionDate,"Deposition date"),courtReporterId:String(metadata.courtReporterId||""),courtReporterName:String(metadata.courtReporterName||""),intakeNotes:String(metadata.intakeNotes||""),noticeName,courtOrderName,audioFiles:audio.map(item=>item.name),audioIntakeIds:audio.map(item=>item.uploadId),audio,keytermCount:Array.isArray(metadata.keyterms)?metadata.keyterms.length:0,keyterms:Array.isArray(metadata.keyterms)?metadata.keyterms:[],paths:{intake:"intake/intake.json",workingTranscript:"transcript/working.json"},createdAt:now,updatedAt:now};
  atomicJson(path.join(staging,"intake","intake.json"),{schemaVersion:"1.0.0",notice:noticeName||null,courtOrder:courtOrderName||null,supporting,keyterms:record.keyterms,deepgramArtifact:metadata.deepgramArtifact||{},ufmData:metadata.ufmData||{},warnings:metadata.warnings||[],audio});
  atomicJson(path.join(staging,"audio","audit.json"),{schemaVersion:"1.0.0",items:audio});atomicJson(path.join(staging,"deposition.json"),record);commitDirectory(staging,finalDirectory);return record;
 }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error}}

export function resolveDepositionAudio(root,id,index){const directory=depositionDirectory(root,id),record=JSON.parse(fs.readFileSync(path.join(directory,"deposition.json"),"utf8")),item=record.audio?.[Number(index)];if(!item)throw new Error("Deposition audio was not found.");const file=path.resolve(directory,...String(item.path).split("/"));if(!within(file,directory)||!fs.existsSync(file))throw new Error("Deposition audio reference is invalid.");return{file,item}}

export const _testing={within,safeName,atomicJson,commitDirectory,ID_PATTERN};
