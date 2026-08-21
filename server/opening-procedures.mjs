import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";

export const OPENING_STATE_VERSION = "1.0.0";
export const OPENING_STEPS = Object.freeze([
  "caption",
  "openingDetails",
  "appearances",
  "instructions",
  "interpreterOath",
  "witnessOath",
  "examination",
]);

const SCRIPT_DEFINITIONS = Object.freeze({
  opening: {
    title:"Opening the Record",
    classification:"APPROVED_REPORTER_TEMPLATE",
    whenToUse:"After recording begins and the proceeding is ready to be identified.",
    template:"We are on the record at [ACTUAL TIME] on [DATE] for the deposition of [DEPONENT] in [CASE STYLE], Cause Number [CAUSE NUMBER].",
  },
  instructions: {
    title:"Preliminary Instructions / Witness Admonitions",
    classification:"APPROVED_REPORTER_TEMPLATE",
    whenToUse:"Before testimony, when the reporter's approved practice calls for these instructions.",
    template:"Please answer aloud, allow each question to finish, and pause when an objection is made so the record remains clear.",
  },
  interpreterOath: {
    title:"Interpreter Oath",
    classification:"UNVERIFIED",
    whenToUse:"Only when an interpreter is participating. Confirm the approved jurisdiction-specific wording before use.",
    template:"[INTERPRETER OATH — APPROVED JURISDICTION-SPECIFIC TEXT REQUIRED]",
  },
  witnessOath: {
    title:"Witness Oath / Affirmation",
    classification:"UNVERIFIED",
    whenToUse:"Before testimony. Select and confirm the approved jurisdiction-specific oath or affirmation.",
    template:"[WITNESS OATH OR AFFIRMATION — APPROVED JURISDICTION-SPECIFIC TEXT REQUIRED]",
  },
  examination: {
    title:"Examination Commencement",
    classification:"APPLICATION_POLICY",
    whenToUse:"When the first examining attorney begins questioning.",
    template:"Examination by [EXAMINING ATTORNEY] begins. Capture the transition; transcript headings and by-lines remain renderer-owned.",
  },
});

function atomicJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${crypto.randomUUID()}.tmp`,descriptor=fs.openSync(temporary,"wx");
  try{fs.writeFileSync(descriptor,JSON.stringify(value,null,2));fs.fsyncSync(descriptor)}finally{fs.closeSync(descriptor)}
  fs.renameSync(temporary,file);
}
const envelope=value=>value&&typeof value==="object"&&"value" in value?value:{value:null,source:"REPORTER_ENTERED",state:"MISSING"};
const valueAt=(record,pathText)=>pathText.split(".").reduce((value,key)=>value?.[key],record);
const workflowFile=(root,depositionId,storageRoot)=>path.join(depositionDirectory(root,depositionId,{storageRoot}),"workflow","opening-procedures.json");
const canonicalFile=(root,depositionId,storageRoot)=>path.join(depositionDirectory(root,depositionId,{storageRoot}),"intake","canonical-deposition-record.json");

function blankState(depositionId){return{
  schemaVersion:OPENING_STATE_VERSION,
  recordType:"DEPOSITION_OPENING_WORKFLOW",
  depositionId,
  verifiedFields:{},
  verifiedParticipants:{},
  scripts:Object.fromEntries(Object.keys(SCRIPT_DEFINITIONS).map(id=>[id,{completedOnRecord:false,note:""}])),
  interpreterDisposition:"UNRESOLVED",
  witnessOathSelection:"UNRESOLVED",
  examiningAttorneyId:null,
  updatedAt:null,
}}

function readCanonical(root,depositionId,storageRoot){
  const file=canonicalFile(root,depositionId,storageRoot);
  if(!fs.existsSync(file))throw new Error("The Canonical Deposition Data Record was not found.");
  return JSON.parse(fs.readFileSync(file,"utf8"));
}

export function readOpeningState(root,{depositionId,storageRoot}={}){
  const file=workflowFile(root,depositionId,storageRoot);
  return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):blankState(depositionId);
}

function cleanMap(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return{};
  return Object.fromEntries(Object.entries(value).filter(([key,item])=>/^[a-zA-Z0-9_.-]+$/.test(key)&&item===true));
}

export function saveOpeningState(root,{depositionId,state,storageRoot}={}){
  readCanonical(root,depositionId,storageRoot);
  const current=readOpeningState(root,{depositionId,storageRoot}),input=state&&typeof state==="object"?state:{};
  const scripts={...current.scripts};
  for(const id of Object.keys(SCRIPT_DEFINITIONS)){
    const supplied=input.scripts?.[id];
    if(supplied)scripts[id]={completedOnRecord:supplied.completedOnRecord===true,note:String(supplied.note||"").slice(0,2000)};
  }
  const interpreterDisposition=["UNRESOLVED","REQUIRED","NOT_APPLICABLE"].includes(input.interpreterDisposition)?input.interpreterDisposition:current.interpreterDisposition;
  const witnessOathSelection=["UNRESOLVED","OATH","AFFIRMATION"].includes(input.witnessOathSelection)?input.witnessOathSelection:current.witnessOathSelection;
  const next={...current,verifiedFields:cleanMap(input.verifiedFields??current.verifiedFields),verifiedParticipants:cleanMap(input.verifiedParticipants??current.verifiedParticipants),scripts,interpreterDisposition,witnessOathSelection,examiningAttorneyId:input.examiningAttorneyId===null?null:String(input.examiningAttorneyId??current.examiningAttorneyId??"").slice(0,200)||null,updatedAt:new Date().toISOString()};
  atomicJson(workflowFile(root,depositionId,storageRoot),next);
  return next;
}

const FIELD_ROWS=Object.freeze([
  ["case.caseStyle","Case style"],["case.causeNumber","Cause number"],["case.court","Court"],["case.county","County"],
  ["deposition.witness","Deponent"],["deposition.depositionDate","Deposition date"],["deposition.scheduledStart","Scheduled start"],
  ["deposition.actualStart","Actual start"],["deposition.location","Location"],["deposition.remote","Remote proceeding"],
  ["deposition.remotePlatform","Remote platform"],["reporter.fullName","Court reporter"],["reporter.csrNumber","Reporter credential"],
  ["deposition.reportingMethod","Reporting method"],
]);

function tokenValues(canonical,state){
  const get=pathText=>envelope(valueAt(canonical,pathText)).value;
  const examiner=canonical.counsel?.find(item=>item.id===state.examiningAttorneyId);
  return {
    "ACTUAL TIME":get("deposition.actualStart"),DATE:get("deposition.depositionDate"),DEPONENT:get("deposition.witness"),
    "CASE STYLE":get("case.caseStyle"),"CAUSE NUMBER":get("case.causeNumber"),COURT:get("case.court"),COUNTY:get("case.county"),
    REPORTER:get("reporter.fullName"),"EXAMINING ATTORNEY":envelope(examiner?.fullName).value,
  };
}

function renderScript(definition,tokens){
  const missing=[];
  const text=definition.template.replace(/\[([^\]]+)\]/g,(_match,name)=>{
    const value=tokens[name];
    if(value===null||value===undefined||value===""){missing.push(name);return `[${name}]`}
    return String(value);
  });
  return{text,missing};
}

export function getOpeningProjection(root,{depositionId,storageRoot}={}){
  const canonical=readCanonical(root,depositionId,storageRoot),state=readOpeningState(root,{depositionId,storageRoot}),tokens=tokenValues(canonical,state);
  const fields=FIELD_ROWS.map(([pathText,label])=>{const item=envelope(valueAt(canonical,pathText));return{path:pathText,label,...item,verified:state.verifiedFields[pathText]===true}});
  const participants=[
    ...(canonical.counsel||[]).map(item=>({id:item.id,type:"COUNSEL",name:envelope(item.fullName),role:envelope(item.appearanceRole),firm:envelope(item.firm),represents:envelope(item.represents),actualAppearance:envelope(item.actualAppearance),remoteAppearance:envelope(item.remoteAppearance)})),
    ...(canonical.participants?.interpreters||[]).map(item=>({id:item.id,type:"INTERPRETER",name:envelope(item.fullName)})),
    ...(canonical.participants?.videographers||[]).map(item=>({id:item.id,type:"VIDEOGRAPHER",name:envelope(item.fullName)})),
    ...(canonical.participants?.otherAttendees||[]).map(item=>({id:item.id,type:"OTHER",name:envelope(item.fullName)})),
  ].map(item=>({...item,verified:state.verifiedParticipants[item.id]===true}));
  const scripts=Object.entries(SCRIPT_DEFINITIONS).map(([id,definition])=>({id,...definition,...renderScript(definition,tokens),...state.scripts[id],applicable:id!=="interpreterOath"||state.interpreterDisposition!=="NOT_APPLICABLE"}));
  const captionPaths=["case.caseStyle","case.causeNumber","case.court","deposition.witness"],openingPaths=["deposition.depositionDate","deposition.actualStart","deposition.location","reporter.fullName"];
  const allVerified=paths=>paths.every(item=>state.verifiedFields[item]===true);
  const readiness={
    caption:allVerified(captionPaths),openingDetails:allVerified(openingPaths),appearances:participants.length>0&&participants.every(item=>item.verified),
    instructions:scripts.find(item=>item.id==="instructions").missing.length===0,
    interpreterOath:state.interpreterDisposition==="NOT_APPLICABLE"||(state.interpreterDisposition==="REQUIRED"&&scripts.find(item=>item.id==="interpreterOath").missing.length===0),
    witnessOath:state.witnessOathSelection!=="UNRESOLVED",examination:Boolean(state.examiningAttorneyId),
  };
  return{depositionId,canonical,state,fields,participants,scripts,readiness,completeCount:OPENING_STEPS.filter(id=>readiness[id]).length,totalCount:OPENING_STEPS.length};
}
