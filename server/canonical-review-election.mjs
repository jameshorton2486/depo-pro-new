import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";

export const REVIEW_ELECTION_STATUSES = Object.freeze(["REQUESTED", "NOT_REQUESTED"]);
export const REVIEW_COMPLETION_DISPOSITIONS = Object.freeze(["COMPLETED", "WITHDRAWN"]);
export const REVIEW_CORRECTION_DISPOSITIONS = Object.freeze(["SUBMITTED", "ACCEPTED", "REJECTED"]);
export const REVIEW_OVERRIDE_EFFECTS = Object.freeze(["MARK_COMPLETE", "EXTEND_DEADLINE", "ACCEPT_LATE_CORRECTION"]);
const clean = (value, limit=2000) => String(value ?? "").trim().slice(0, limit);

function fileFor(root, depositionId, storageRoot) { return path.join(depositionDirectory(root, depositionId, { storageRoot }), "intake", "canonical-deposition-record.json"); }
function atomicJson(file, value) { const temporary=`${file}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value,null,2)}\n`, "utf8"); fs.renameSync(temporary,file); }
function ledger(record) {
  record.reviewElection ??={}; record.reviewElection.schemaVersion="2.0.0";
  for (const key of ["events","notifications","completions","corrections","overrides"]) record.reviewElection[key]??=[];
  return record.reviewElection;
}
function currentEffective(events, predicate=()=>true) {
  if (!Array.isArray(events)) return null;
  const eligible=events.filter(predicate), superseded=new Set(eligible.map(item=>item.supersedesEventId).filter(Boolean));
  return [...eligible].reverse().find(item=>!superseded.has(item.id)) ?? null;
}
function requireText(value, message, limit=2000) { const result=clean(value,limit); if (!result) throw new Error(message); return result; }
function requireTime(value, message) { const text=requireText(value,message,80), time=new Date(text); if (Number.isNaN(time.valueOf())) throw new Error(message); return time.toISOString(); }
function loadForWrite(root,depositionId,storageRoot) {
  const file=fileFor(root,depositionId,storageRoot); if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record=JSON.parse(fs.readFileSync(file,"utf8")); return {file,record,review:ledger(record)};
}
function attributed(actor,input) { return {sourceAnchor:requireText(input?.sourceAnchor,"An evidence source anchor is required.",500),recordedBy:requireText(actor,"Server-established attribution is required.",300),recordedAt:new Date().toISOString()}; }

export function currentReviewElection(record) { return currentEffective(record?.reviewElection?.events); }

export function recordReviewElection(root, { depositionId, storageRoot, input, actor }={}) {
  const status=clean(input?.status,80); if (!REVIEW_ELECTION_STATUSES.includes(status)) throw new Error("Choose whether Rule 30(e) review was requested or not requested.");
  if (status === "REQUESTED" && !clean(input?.requestedBy,300)) throw new Error("Record who requested Rule 30(e) review.");
  const state=loadForWrite(root,depositionId,storageRoot), prior=currentEffective(state.review.events);
  if (prior && !clean(input?.correctionReason,1000)) throw new Error("Explain why the Rule 30(e) election is being corrected.");
  const event={id:crypto.randomUUID(),kind:"RULE_30E_REVIEW_ELECTION",jurisdiction:"federal",status,requestedBy:status === "REQUESTED" ? clean(input.requestedBy,300) : null,requestedAt:status === "REQUESTED" ? requireTime(input.requestedAt ?? new Date().toISOString(),"Record when review was requested.") : null,...attributed(actor,input),correctionReason:clean(input?.correctionReason,1000)||null,supersedesEventId:prior?.id ?? null};
  state.review.events.push(event); atomicJson(state.file,state.record); return event;
}

export function recordReviewNotification(root,{depositionId,storageRoot,input,actor}={}) {
  const state=loadForWrite(root,depositionId,storageRoot), election=currentEffective(state.review.events); if (election?.status !== "REQUESTED") throw new Error("A notification can be recorded only for a current requested-review election.");
  const prior=currentEffective(state.review.notifications,item=>item.reviewElectionId===election.id); if (prior && !clean(input?.correctionReason,1000)) throw new Error("Explain why the officer notification is being corrected.");
  const event={id:crypto.randomUUID(),kind:"RULE_30E_OFFICER_NOTIFICATION",reviewElectionId:election.id,notifiedAt:requireTime(input?.notifiedAt,"Record when the officer notified the recipient."),officerIdentity:requireText(input?.officerIdentity,"Record the notifying officer's identity.",300),recipient:requireText(input?.recipient,"Record the notification recipient or deponent.",300),method:clean(input?.method,200)||null,...attributed(actor,input),correctionReason:clean(input?.correctionReason,1000)||null,supersedesEventId:prior?.id??null};
  state.review.notifications.push(event); atomicJson(state.file,state.record); return event;
}

export function recordReviewCompletion(root,{depositionId,storageRoot,input,actor}={}) {
  const state=loadForWrite(root,depositionId,storageRoot), election=currentEffective(state.review.events); if (election?.status !== "REQUESTED") throw new Error("A review completion can be recorded only for a current requested-review election.");
  const disposition=clean(input?.disposition,80); if (!REVIEW_COMPLETION_DISPOSITIONS.includes(disposition)) throw new Error("Choose a recognized review completion disposition.");
  const prior=currentEffective(state.review.completions,item=>item.reviewElectionId===election.id); if (prior && !clean(input?.correctionReason,1000)) throw new Error("Explain why the review completion is being corrected.");
  const event={id:crypto.randomUUID(),kind:"RULE_30E_REVIEW_COMPLETION",reviewElectionId:election.id,disposition,completedAt:requireTime(input?.completedAt,"Record when the review was completed."),...attributed(actor,input),correctionReason:clean(input?.correctionReason,1000)||null,supersedesEventId:prior?.id??null};
  state.review.completions.push(event); atomicJson(state.file,state.record); return event;
}

export function recordReviewCorrection(root,{depositionId,storageRoot,input,actor}={}) {
  const state=loadForWrite(root,depositionId,storageRoot), election=currentEffective(state.review.events); if (election?.status !== "REQUESTED") throw new Error("A Rule 30(e) correction requires a current requested-review election.");
  const priorId=clean(input?.supersedesEventId,100), prior=priorId ? state.review.corrections.find(item=>item.id===priorId) : null;
  if (priorId && !prior) throw new Error("The correction to supersede was not found."); if (prior && prior.reviewElectionId!==election.id) throw new Error("A correction cannot supersede an event from another review election.");
  if (prior && !clean(input?.correctionReason,1000)) throw new Error("Explain why the Rule 30(e) correction record is being corrected.");
  const disposition=clean(input?.disposition,80)||"SUBMITTED"; if (!REVIEW_CORRECTION_DISPOSITIONS.includes(disposition)) throw new Error("Choose a recognized correction disposition.");
  const event={id:crypto.randomUUID(),kind:"RULE_30E_CORRECTION",reviewElectionId:election.id,target:requireText(input?.target,"Record the page/line or stable transcript target.",300),originalText:requireText(input?.originalText,"Record the original text or reference.",8000),proposedChange:requireText(input?.proposedChange,"Record the proposed change.",8000),reason:requireText(input?.reason,"Record the deponent's reason for the change.",4000),submittedAt:requireTime(input?.submittedAt,"Record when the correction was submitted."),disposition,...attributed(actor,input),correctionReason:clean(input?.correctionReason,1000)||null,supersedesEventId:prior?.id??null};
  state.review.corrections.push(event); atomicJson(state.file,state.record); return event;
}

export function recordReviewOverride(root,{depositionId,storageRoot,input,actor}={}) {
  const state=loadForWrite(root,depositionId,storageRoot), election=currentEffective(state.review.events); if (election?.status !== "REQUESTED") throw new Error("A review override requires a current requested-review election.");
  const effect=clean(input?.effect,80); if (!REVIEW_OVERRIDE_EFFECTS.includes(effect)) throw new Error("Choose a narrowly supported lifecycle override effect.");
  const authorityType=clean(input?.authorityType,80); if (!["RULE_29_STIPULATION","COURT_ORDER","APPROVED_POLICY"].includes(authorityType)) throw new Error("Record the governing authority type.");
  const affectedCorrectionId=effect==="ACCEPT_LATE_CORRECTION"?requireText(input?.affectedCorrectionId,"Identify the late correction governed by this override.",100):null;
  if (affectedCorrectionId && !state.review.corrections.some(item=>item.id===affectedCorrectionId && item.reviewElectionId===election.id)) throw new Error("The governed correction was not found in this review.");
  const priorId=clean(input?.supersedesEventId,100), prior=priorId?state.review.overrides.find(item=>item.id===priorId):null; if (priorId && !prior) throw new Error("The override to supersede was not found.");
  const event={id:crypto.randomUUID(),kind:"RULE_30E_GOVERNING_OVERRIDE",reviewElectionId:election.id,effect,authorityType,governingTextOrReference:requireText(input?.governingTextOrReference,"Record the exact governing text or source reference.",8000),participantsOrAuthority:requireText(input?.participantsOrAuthority,"Record the participants or issuing authority.",2000),effectiveAt:requireTime(input?.effectiveAt,"Record when the governing event became effective."),affectedRule:requireText(input?.affectedRule,"Record the specific lifecycle rule affected.",300),effectiveDeadline:effect==="EXTEND_DEADLINE"?requireTime(input?.effectiveDeadline,"Record the replacement deadline."):null,affectedCorrectionId,...attributed(actor,input),correctionReason:clean(input?.correctionReason,1000)||null,supersedesEventId:prior?.id??null};
  state.review.overrides.push(event); atomicJson(state.file,state.record); return event;
}

export function deriveReviewDeadline(notification,override=null) {
  if (!notification?.notifiedAt) return null; if (override?.effect==="EXTEND_DEADLINE" && override?.effectiveDeadline) return requireTime(override.effectiveDeadline,"The override deadline is invalid.");
  const value=new Date(notification.notifiedAt); value.setUTCDate(value.getUTCDate()+30); return value.toISOString();
}

export function resolveReviewLifecycle(record,{asOf=new Date().toISOString()}={}) {
  const source=record?.reviewElection??{}, election=currentEffective(source.events), history={events:structuredClone(source.events??[]),notifications:structuredClone(source.notifications??[]),completions:structuredClone(source.completions??[]),corrections:structuredClone(source.corrections??[]),overrides:structuredClone(source.overrides??[])};
  if (!election) return {election:null,status:"UNRESOLVED",terminal:false,deadline:null,notification:null,completion:null,qualifyingCorrections:[],lateCorrections:[],history};
  if (election.status==="NOT_REQUESTED") return {election,status:"NOT_REQUESTED",terminal:true,deadline:null,notification:null,completion:null,qualifyingCorrections:[],lateCorrections:[],history};
  const notification=currentEffective(source.notifications,item=>item.reviewElectionId===election.id), overrides=(source.overrides??[]).filter(item=>item.reviewElectionId===election.id), supersededOverrides=new Set(overrides.map(item=>item.supersedesEventId).filter(Boolean)), effectiveOverrides=overrides.filter(item=>!supersededOverrides.has(item.id));
  const deadlineOverride=[...effectiveOverrides].reverse().find(item=>item.effect==="EXTEND_DEADLINE")??null, deadline=deriveReviewDeadline(notification,deadlineOverride), completion=currentEffective(source.completions,item=>item.reviewElectionId===election.id);
  const correctionEvents=(source.corrections??[]).filter(item=>item.reviewElectionId===election.id), supersededCorrections=new Set(correctionEvents.map(item=>item.supersedesEventId).filter(Boolean)), currentCorrections=correctionEvents.filter(item=>!supersededCorrections.has(item.id)), lateAccepted=new Set(effectiveOverrides.filter(item=>item.effect==="ACCEPT_LATE_CORRECTION").map(item=>item.affectedCorrectionId));
  const resolvedCorrections=currentCorrections.map(item=>{const timely=Boolean(deadline)&&new Date(item.submittedAt)<=new Date(deadline);return {...item,timely,qualifies:(timely||lateAccepted.has(item.id))&&item.disposition!=="REJECTED"};}), qualifyingCorrections=resolvedCorrections.filter(item=>item.qualifies), lateCorrections=resolvedCorrections.filter(item=>!item.timely);
  const overrideComplete=effectiveOverrides.some(item=>item.effect==="MARK_COMPLETE"); let status="AWAITING_NOTIFICATION",terminal=false;
  if (notification) { status=new Date(asOf)>new Date(deadline)?"EXPIRED":"OPEN"; terminal=status==="EXPIRED"; }
  if (completion||overrideComplete) {status="COMPLETED";terminal=true;}
  return {election,status,terminal,deadline,notification,completion,qualifyingCorrections,lateCorrections,effectiveOverrides,history};
}
