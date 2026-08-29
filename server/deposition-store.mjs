import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readAudioAudit, resolveAudioItem } from "./audio-pipeline.mjs";
import { depositionStorageRoot, resolveDefaultDepositionsRoot } from "./storage-config.mjs";
import { counselEntry, createCanonicalDepositionRecord, field, partyEntry } from "./canonical-deposition-record.mjs";
import { applyCorrection, parseCorrectionLog, serializeCorrectionLog, validateCorrection } from "./canonical-corrections.mjs";

const ID_PATTERN=/^DEP-\d{8}-[A-Z0-9]{5}$/;
function base(_root,{storageRoot}={}){return storageRoot?path.resolve(storageRoot):depositionStorageRoot()}
function within(candidate,parent){const relative=path.relative(path.resolve(parent),path.resolve(candidate));return relative&&!relative.startsWith("..")&&!path.isAbsolute(relative)}
function safeName(value,fallback){return path.basename(String(value||fallback)).replace(/[^a-zA-Z0-9._ -]/g,"_")}
function pathPart(value,label){const normalized=String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/[^a-z0-9-]+/g,"_").replace(/_+/g,"_").replace(/^[-_]+|[-_]+$/g,"");if(!normalized)throw new Error(`${label} is required to create the deposition folder.`);return normalized}
function personName(value,label){const name=String(value||"").trim();if(!name)throw new Error(`${label} is required to create the deposition folder.`);const suffixes=new Set(["jr","jr.","sr","sr.","ii","iii","iv"]);let first,last;if(name.includes(",")&&!suffixes.has(name.split(",").at(-1).trim().toLowerCase())){const parts=name.split(",");last=parts[0];first=parts.slice(1).join(" ").trim()}else{const parts=name.replace(/,/g,"").split(/\s+/).filter(Boolean);while(parts.length>1&&suffixes.has(parts.at(-1).toLowerCase()))parts.pop();first=parts[0];last=parts.at(-1)}return{first:pathPart(first,`${label} first name`),last:pathPart(last,`${label} last name`)}}
function reporterFolder(value){const {first,last}=personName(value,"Court reporter");return `${last}_${first[0]}`}
function causeFolder(metadata){return pathPart(metadata?.causeNumber||metadata?.ufmData?.cause_number||metadata?.ufmData?.causeNumber,"Cause number")}
function depositionFolder(metadata){const {first,last}=personName(metadata?.witness,"Deponent"),date=pathPart(requiredText(metadata?.depositionDate,"Deposition date"),"Deposition date");return `${last}_${first}_${date}`}
function atomicText(file,text){const temporary=`${file}.${crypto.randomUUID()}.tmp`,descriptor=fs.openSync(temporary,"wx");try{fs.writeFileSync(descriptor,text);fs.fsyncSync(descriptor)}finally{fs.closeSync(descriptor)}fs.renameSync(temporary,file)}
function atomicJson(file,value){const temporary=`${file}.${crypto.randomUUID()}.tmp`,descriptor=fs.openSync(temporary,"wx");try{fs.writeFileSync(descriptor,JSON.stringify(value,null,2));fs.fsyncSync(descriptor)}finally{fs.closeSync(descriptor)}fs.renameSync(temporary,file)}
function commitDirectory(source,target,{rename=fs.renameSync,wait=milliseconds=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds),attempts=8,delayBaseMs=350}={}){for(let attempt=1;attempt<=attempts;attempt++){try{rename(source,target);return}catch(error){if(!["EPERM","EBUSY","EACCES"].includes(error?.code))throw error;if(attempt===attempts){const blocked=new Error(`Windows blocked the completed deposition folder rename after ${attempts} attempts. Close programs using the deposition files or check folder permissions, then try again.`,{cause:error});blocked.code="DEPOSITION_COMMIT_BLOCKED";throw blocked}wait(delayBaseMs*attempt)}}}
function requiredText(value,label){const text=String(value||"").trim();if(!text)throw new Error(`${label} is required.`);return text}
export function depositionDirectories(root,options={}){const directory=base(root,options);fs.mkdirSync(directory,{recursive:true});const found=[];for(const reporter of fs.readdirSync(directory,{withFileTypes:true})){if(!reporter.isDirectory()||reporter.name.startsWith("."))continue;const reporterPath=path.join(directory,reporter.name);for(const cause of fs.readdirSync(reporterPath,{withFileTypes:true})){if(!cause.isDirectory()||cause.name.startsWith("."))continue;const causePath=path.join(reporterPath,cause.name);for(const deposition of fs.readdirSync(causePath,{withFileTypes:true})){if(deposition.isDirectory()&&!deposition.name.startsWith("."))found.push(path.join(causePath,deposition.name))}}}return found}
export function depositionDirectory(root,id,options={}){if(!ID_PATTERN.test(String(id)))throw new Error("Invalid deposition ID.");for(const directory of depositionDirectories(root,options)){const record=path.join(directory,"deposition.json");if(!fs.existsSync(record))continue;try{if(JSON.parse(fs.readFileSync(record,"utf8")).id===id)return directory}catch{continue}}throw new Error("Deposition was not found.")}

export function scanDepositions(root,options={}){const storageRoot=base(root,options),depositions=[],issues=[];for(const folder of depositionDirectories(root,options)){
  const relative=path.relative(storageRoot,folder),record=path.join(folder,"deposition.json");
  if(!fs.existsSync(record)){issues.push({folder:relative,code:"ORPHANED_FOLDER",message:"deposition.json is missing."});continue}
  try{const value=JSON.parse(fs.readFileSync(record,"utf8"));if(!ID_PATTERN.test(value.id)||!value.caseStyle||!value.witness)throw new Error("Required identity fields are missing or inconsistent.");depositions.push(value)}catch(error){issues.push({folder:relative,code:"MALFORMED_DEPOSITION",message:error instanceof Error?error.message:"Invalid deposition metadata."})}
 }depositions.sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));return{depositions,issues}}

function writeArtifact(directory,relative,artifact){if(!artifact?.base64)return null;const target=path.join(directory,...relative.split("/"));if(!within(target,directory))throw new Error("Intake artifact path escaped the deposition folder.");fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(artifact.base64,"base64"),{flag:"wx"});return relative}

export function createDeposition(root,input,options={}){const metadata=input?.deposition||{},id=String(metadata.id||"");if(!ID_PATTERN.test(id))throw new Error("Invalid deposition ID.");const rootDirectory=base(root,options),reporter=reporterFolder(metadata.courtReporterName),cause=causeFolder(metadata),deposition=depositionFolder(metadata),causeDirectory=path.join(rootDirectory,reporter,cause),finalDirectory=path.join(causeDirectory,deposition);if(!within(finalDirectory,rootDirectory))throw new Error("Deposition path escaped its storage root.");fs.mkdirSync(causeDirectory,{recursive:true});if(fs.existsSync(finalDirectory))throw new Error(`A deposition already exists for ${metadata.witness} on ${metadata.depositionDate} in cause number ${metadata.causeNumber}.`);const staging=path.join(causeDirectory,`.creating-${deposition}-${crypto.randomUUID()}`);fs.mkdirSync(staging,{recursive:false});
 try{
  for(const name of ["intake","audio/original","audio/processed","deepgram","transcript","exhibits","ufm","certification/history"])fs.mkdirSync(path.join(staging,...name.split("/")),{recursive:true});
  const artifacts=input.artifacts||{},noticeName=artifacts.notice?safeName(artifacts.notice.name,"notice.bin"):"",courtOrderName=artifacts.courtOrder?safeName(artifacts.courtOrder.name,"court-order.bin"):"";
  if(artifacts.notice)writeArtifact(staging,`intake/${noticeName}`,artifacts.notice);if(artifacts.courtOrder)writeArtifact(staging,`intake/${courtOrderName}`,artifacts.courtOrder);
  const supporting=(artifacts.supportingFiles||[]).map((artifact,index)=>writeArtifact(staging,`intake/supporting/${String(index+1).padStart(2,"0")}-${safeName(artifact.name,"document.bin")}`,artifact));
  const audio=[];for(const uploadId of metadata.audioIntakeIds||[]){const audit=readAudioAudit(root,uploadId),item=resolveAudioItem(audit),source=path.resolve(root,"data",item.key);const category=audit.selectedSource==="processed"?"processed":"original",name=safeName(audit.selectedSource==="processed"?path.basename(item.key):audit.originalName,path.basename(item.key)),relative=`audio/${category}/${name}`,target=path.join(staging,...relative.split("/"));fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);/* copyFileSync returns only after its internal handles are closed. */audio.push({uploadId,source:audit.selectedSource,operationId:audit.selectedDerivativeOperationId||null,sha256:item.sha256,path:relative,name})}
  const canonicalData=createCanonicalDepositionRecord({...metadata,...(metadata.canonicalSeed||{}),caseStyle:metadata.caseStyle,witness:metadata.witness,causeNumber:metadata.causeNumber,depositionDate:metadata.depositionDate,deponentType:metadata.deponentType},{noticeSupplied:Boolean(noticeName)});
  const creationMode=metadata.creationMode==="live"?"live":"existing_recording",workflowStatus=String(metadata.workflowStatus||(creationMode==="live"?"scheduled":"review"));
  const now=new Date().toISOString(),record={schemaVersion:"1.2.0",id,caseStyle:requiredText(metadata.caseStyle,"Case style"),witness:requiredText(metadata.witness,"Witness"),deponentType:String(metadata.deponentType||"Fact witness"),depositionDate:requiredText(metadata.depositionDate,"Deposition date"),courtReporterId:String(metadata.courtReporterId||""),courtReporterName:String(metadata.courtReporterName||""),causeNumber:requiredText(metadata.causeNumber,"Cause number"),creationMode,workflowStatus,canonicalData,storagePath:`${reporter}/${cause}/${deposition}`,intakeNotes:String(metadata.intakeNotes||""),noticeName,courtOrderName,audioFiles:audio.map(item=>item.name),audioIntakeIds:audio.map(item=>item.uploadId),audio,keytermCount:Array.isArray(metadata.keyterms)?metadata.keyterms.length:0,keyterms:Array.isArray(metadata.keyterms)?metadata.keyterms:[],paths:{intake:"intake/intake.json",canonicalData:"intake/canonical-deposition-record.json",workingTranscript:"transcript/working.json"},createdAt:now,updatedAt:now};
  atomicJson(path.join(staging,"intake","intake.json"),{schemaVersion:"1.0.0",notice:noticeName||null,courtOrder:courtOrderName||null,supporting,keyterms:record.keyterms,deepgramArtifact:metadata.deepgramArtifact||{},ufmData:metadata.ufmData||{},warnings:metadata.warnings||[],audio});
  atomicJson(path.join(staging,"audio","audit.json"),{schemaVersion:"1.0.0",items:audio});atomicJson(path.join(staging,"intake","canonical-deposition-record.json"),canonicalData);atomicJson(path.join(staging,"deposition.json"),record);commitDirectory(staging,finalDirectory);return record;
 }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error}}

// The browser-playable copy, beside the frozen audio and never in place of it.
//
// It lives under audio/playback/ with a sidecar record so the alignment measurement, encoder
// versions and declared pre-skip travel with the file. resolveDepositionAudio still returns the
// original for every other purpose; nothing here changes what can be transcribed, and
// PLAYBACK_PROXY is absent from ASR_ELIGIBLE_KINDS so it never could.
export function playbackProxyPaths(root,id,index,options={}){const directory=depositionDirectory(root,id,options),base=path.join(directory,"audio","playback");return{directory,file:path.join(base,`${Number(index)}.ogg`),record:path.join(base,`${Number(index)}.json`)}}
export function readPlaybackProxy(root,id,index,options={}){const paths=playbackProxyPaths(root,id,index,options);if(!fs.existsSync(paths.file)||!fs.existsSync(paths.record))return null;try{return{...JSON.parse(fs.readFileSync(paths.record,"utf8")),file:paths.file}}catch{return null}}
export function writePlaybackProxyRecord(root,id,index,record,options={}){const paths=playbackProxyPaths(root,id,index,options);fs.mkdirSync(path.dirname(paths.record),{recursive:true});atomicJson(paths.record,record);return{...record,file:paths.file}}

const APPEARANCE_ROLES = Object.freeze(["QUESTIONING_ATTORNEY", "DEFENDING_ATTORNEY", "OTHER"]);

/**
 * Adds audio to a deposition that already exists.
 *
 * Until this, audio[] could only be written by createDeposition, which meant a recording made for
 * a deposition could never reach it -- the same structural defect counsel had before
 * writeDepositionCounsel, and fixed the same way: a narrow endpoint rather than a wider intake.
 * Losing a recording is a lost record, not an inconvenience, so this is the seam that matters.
 *
 * The file is registered where it already lies rather than copied. A capture session writes inside
 * the deposition folder, resolveDepositionAudio resolves any path within that folder, and copying
 * would double the disk cost of every deposition to gain nothing.
 *
 * The SHA-256 is recomputed here rather than taken from the caller. The hash recorded when the
 * recording was finalized says what was captured; recomputing it at registration says the bytes on
 * disk are still those. A caller that supplies a hash is checked against the file and refused on
 * mismatch -- registering audio is exactly the moment to find out, not the moment to assume.
 */
export function appendDepositionAudio(root, { depositionId, entries, storageRoot } = {}) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("At least one audio entry is required.");
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "deposition.json");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const known = new Set((record.audio ?? []).map(item => item.uploadId));
  const added = [];

  for (const entry of entries) {
    const uploadId = String(entry?.uploadId ?? "").trim();
    if (!uploadId) throw new Error("Every audio entry requires an upload id.");
    if (known.has(uploadId)) throw new Error(`Audio ${uploadId} is already part of this deposition.`);
    const relative = String(entry?.path ?? "").replaceAll("\\", "/");
    if (!relative) throw new Error("Every audio entry requires a path.");
    const target = path.resolve(directory, ...relative.split("/"));
    if (!within(target, directory)) throw new Error("Audio path escaped the deposition folder.");
    if (!fs.existsSync(target)) throw new Error(`Audio file was not found: ${relative}`);
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    if (entry.sha256 && entry.sha256 !== sha256) throw new Error(`Audio ${relative} failed SHA-256 verification; the file on disk is not the one that was recorded.`);
    known.add(uploadId);
    added.push({ uploadId, source: String(entry.source ?? "original"), operationId: entry.operationId ?? null, sha256, path: relative, name: String(entry.name ?? path.basename(target)) });
  }

  const audio = [...(record.audio ?? []), ...added];
  atomicJson(file, { ...record, workflowStatus: "recorded", audio, audioFiles: audio.map(item => item.name), audioIntakeIds: audio.map(item => item.uploadId), updatedAt: new Date().toISOString() });
  return { depositionId, added };
}

/**
 * Replaces parties[] on an existing deposition, and touches nothing else.
 *
 * Narrow for the same reason writeDepositionCounsel is narrow: a party entry cannot orphan a word
 * id or invalidate a transcript hash, and it should not be able to reach anything that could.
 *
 * The rule this exists to hold: PARTY STATUS IS NOT ATTENDANCE. Writing a party never makes anyone
 * a speaker candidate. getSpeakerCandidates reads the witness, the reporter, counsel who actually
 * appeared, interpreters and videographers -- it does not read parties[], and must not begin to.
 * A defendant who never attended is still a defendant; a corporation cannot attend at all. If
 * party status were allowed to imply eligibility, a speaker map could attribute testimony to an
 * entity that was never in the room, which is a defect in the record rather than in the interface.
 */
export function writeDepositionParties(root, { depositionId, parties, storageRoot, source = "REPORTER_ENTERED" } = {}) {
  if (!Array.isArray(parties)) throw new Error("Parties must be an array.");
  const entries = parties.map((party, index) => {
    if (!String(party?.name ?? "").trim()) throw new Error("Every party entry requires a name.");
    return partyEntry(party, index, { source });
  });
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`Party id ${entry.id} appears more than once.`);
    seen.add(entry.id);
  }
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  atomicJson(file, { ...record, parties:entries });
  return { depositionId, parties:entries };
}

/**
 * Replaces counsel[] on an existing deposition with reporter-typed entries.
 *
 * Deliberately narrow. It reads the canonical record, replaces one key, and writes it back --
 * it never touches the transcript, the overlay, the audio audit or any other field of the
 * record. That narrowness is the whole reason this is safer than the hand-edits it replaces:
 * a counsel entry cannot orphan a word id or invalidate a transcript hash.
 *
 * Entries are written REPORTER_ENTERED / REPORTER_ADDED. Counsel that came off the Notice keep
 * NOD_EXTRACTED, so the record shows which attorneys the document supplied and which a person
 * typed.
 *
 * Attorney of record and attorney who appeared are separate facts, and actualAppearance is where
 * they part company. A Notice seeds the roster; the transcript settles who was in the room, and
 * they disagree more often than the roster suggests. On DEP-20260814-LQ9R6 the Notice named Karen
 * M. Alvarado for Home Depot and Lucia D. Zhan appeared in her place, stating her appearance on
 * the record -- a substitution within the same firm. Writing the Notice's roster alone would have
 * recorded an attorney who was not there and omitted the one who defended the deposition.
 *
 * So both go in. Counsel who did not appear stay in counsel[] because the appearance page names
 * counsel of record, and getSpeakerCandidates filters them out because someone who was not there
 * cannot have spoken. That is the whole reason the two facts are stored separately rather than
 * one being inferred from the other. Ids are regenerated as attorney-1..n: a speaker map keyed to an id that this call
 * removes would be reconciling against someone who is no longer in the record, and
 * reconcileSpeakerMap already refuses an identity the canonical record does not contain.
 */
/**
 * The counsel roster, for a caller that needs to name one of them by canonical id.
 *
 * A complete-transcript assembly stores `operator.examiningCounselId` and never a typed name, so a
 * screen offering that choice has to be handed the same ids the record holds. Speaker candidates
 * will not do: that list merges counsel with the witness, the reporter, interpreters and
 * videographers, and once `appearanceRole` is unset -- which it is for manually entered counsel --
 * nothing in it distinguishes an attorney from anyone else.
 */
export function readDepositionCounsel(root, { depositionId, storageRoot } = {}) {
  const file = path.join(depositionDirectory(root, depositionId, { storageRoot }), "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = field => field && typeof field === "object" && "value" in field ? field.value : field;
  return {
    depositionId,
    counsel: (record.counsel ?? []).map(entry => ({
      // Every editable field, so a screen amending one attorney can send the rest back unchanged
      // rather than reconstructing them. Chief among them the id: counselEntry falls back to
      // `attorney-${index + 1}` when none is supplied, so an editor that dropped it would renumber
      // counsel by position and leave the examiner reference and every speaker mapping pointing at
      // an id that no longer exists -- while the save looked entirely successful.
      id: entry.id,
      name: String(value(entry.fullName) ?? "").trim(),
      honorific: value(entry.honorific) ?? "",
      firm: String(value(entry.firm) ?? "").trim(),
      represents: value(entry.represents) ?? [],
      appearanceRole: value(entry.appearanceRole) ?? "",
      side: value(entry.side) ?? "",
      sideOther: value(entry.sideOther) ?? "",
      actualAppearance: value(entry.actualAppearance),
    })),
  };
}

export function writeDepositionCounsel(root, { depositionId, counsel, storageRoot } = {}) {
  if (!Array.isArray(counsel)) throw new Error("Counsel must be an array.");
  const entries = counsel.map((attorney, index) => {
    const name = String(attorney?.name ?? attorney?.fullName ?? "").trim();
    if (!name) throw new Error("Every counsel entry requires a name.");
    const role = String(attorney?.appearanceRole ?? "").trim().toUpperCase().replaceAll(" ", "_");
    if (role && !APPEARANCE_ROLES.includes(role)) throw new Error(`Unsupported appearance role: ${attorney.appearanceRole}`);
    return counselEntry({ ...attorney, name, appearanceRole:role || null }, index, { source:"REPORTER_ENTERED" });
  });
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`Counsel id ${entry.id} appears more than once.`);
    seen.add(entry.id);
  }
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  atomicJson(file, { ...record, counsel:entries });
  return { depositionId, counsel:entries };
}

/**
 * Records the certificate facts only a reporter can supply, on an existing deposition.
 *
 * Narrow in the same way writeDepositionCounsel is: it reads the canonical record, merges six
 * named keys across two blocks, and writes it back. It cannot touch the transcript, the audio
 * audit, or any certification field it does not name.
 *
 * Six, not the nine the certificate prints. submittedToWitnessDate, dueDate and serviceDate are
 * declared WORKFLOW_DERIVED -- they are facts about what the system did, and no workflow produces
 * them yet. A reporter typing one and the record answering NOD-style that a workflow derived it is
 * the provenance defect this application already fixed once. They stay MISSING and keep blocking.
 *
 * An untouched control is MISSING, not "". A blank string would be an answer nobody gave, and
 * validateFields cannot tell it from an omission -- isBlank collapses them, so the certificate
 * would render a dropped clause with a clean bill of health, which is what UNEXPECTED_BLANK exists
 * to prevent. null with state MISSING is the honest record of a field left alone.
 */
const CERTIFICATION_FIELDS = Object.freeze(["custodialAttorney", "officerCharges", "chargesResponsibleParty", "certificationDate", "furtherCertificationDate"]);

/**
 * The stored certificate, as the strings a form has to show.
 *
 * writeDepositionCertification rewrites every field it owns, setting anything absent to MISSING --
 * correct for a form that shows everything, and a data-loss path for one that shows nothing.
 * InsertionPagesScreen initialised to EMPTY_CERTIFICATE and never read, so Preview on a screen
 * that always looked blank erased values already on the record. The route is not the defect; a
 * merge-only route would mean a reporter could never clear a value entered by mistake, turning a
 * display bug into a permanent one. The screen has to load first, and this is what it loads.
 *
 * MISSING reads back as "" because that is what an empty control holds, and "" written back
 * becomes MISSING again -- so a form the reporter never touches round-trips to exactly the record
 * it started from.
 */
export function readDepositionCertification(root, { depositionId, storageRoot } = {}) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const text = (envelope) => (envelope && envelope.value !== null && envelope.value !== undefined ? String(envelope.value) : "");
  const certification = Object.fromEntries(CERTIFICATION_FIELDS.map((key) => [key, text(record.certification?.[key])]));
  return { depositionId, certification: { ...certification, returnedDate: text(record.signature?.returnedDate) } };
}

export function writeDepositionCertification(root, { depositionId, certification = {}, storageRoot } = {}) {
  if (!certification || typeof certification !== "object" || Array.isArray(certification)) throw new Error("Certification must be an object.");
  const unknown = Object.keys(certification).filter((key) => key !== "returnedDate" && !CERTIFICATION_FIELDS.includes(key));
  if (unknown.length) throw new Error(`Unsupported certification field: ${unknown.join(", ")}`);
  const entry = (value) => {
    const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    return text ? field(text, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" }) : field(null, { source: "REPORTER_ENTERED", state: "MISSING" });
  };

  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));

  const certified = { ...record.certification };
  for (const key of CERTIFICATION_FIELDS) certified[key] = entry(certification[key]);
  // cert.returnStatus renders after "returned to the deposition officer on", so it is a date, and
  // the record already calls that signature.returnedDate. The template field keeps its name; the
  // record keeps its meaning.
  const signature = { ...record.signature, returnedDate: entry(certification.returnedDate) };

  atomicJson(file, { ...record, certification: certified, signature });
  return { depositionId, certification: certified, signature: { returnedDate: signature.returnedDate } };
}

/**
 * The time each party used, as the certificate has to state it.
 *
 * certification-1 prints "That the amount of time used by each party at the deposition is as
 * follows:" and then ^cert.timeUsedLines^. Until now the only thing that could fill that line was
 * operator.timeUsed -- a fixture construction path -- so on every real deposition the certificate
 * made that statement over an empty line, and nothing raised it. The blank guard could not: the
 * line is composed in build-pages and never reaches fieldValues, so it is named in no inventory.
 *
 * This is the writer that gives the clause a source. It records what the certificate attributes to
 * a party and nothing else -- not the total, which is a fact about the recording rather than about
 * any party, and not the reconciliation between them, which validate.mjs already reports and can
 * only report once both exist.
 *
 * Minutes are whole and may be zero. A party who used none is an answer the certificate can state
 * -- "Dana Counsel - 00 HOURS:00 MINUTES" -- so the check is `>= 0` rather than truthiness.
 * Dropping a zero would remove a party from a certified list on the strength of their number.
 *
 * Order is preserved as written. The certificate lists parties, and a list a reporter ordered is
 * not the store's to re-sort.
 */
const attorneyTimeEntries = (attorneyTime) => {
  if (!Array.isArray(attorneyTime)) throw new Error("Attorney time must be an array.");
  return attorneyTime.map((party, index) => {
    const unknown = Object.keys(party ?? {}).filter((key) => key !== "name" && key !== "minutes");
    if (unknown.length) throw new Error(`Unsupported attorney time field: ${unknown.join(", ")}`);
    const name = String(party?.name ?? "").trim();
    if (!name) throw new Error(`Attorney time entry ${index + 1} requires a name.`);
    const minutes = typeof party?.minutes === "string" && party.minutes.trim() !== "" ? Number(party.minutes) : party?.minutes;
    if (!Number.isInteger(minutes) || minutes < 0) throw new Error(`Attorney time for ${name} must be a whole number of minutes, and not negative.`);
    return {
      name: field(name, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" }),
      minutes: field(minutes, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" }),
    };
  });
};

/**
 * What a form has to show, in the shape it shows it.
 *
 * Same rule as readDepositionCertification above: a screen that writes without loading first
 * erases what it never displayed, and this writer replaces the whole list rather than merging into
 * it -- a merge-only writer would mean a party entered by mistake could never be removed.
 */
export function readDepositionAttorneyTime(root, { depositionId, storageRoot } = {}) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const attorneyTime = (record.certification?.attorneyTime ?? []).map((party) => ({
    name: party?.name?.value ?? "",
    minutes: party?.minutes?.value ?? null,
  }));
  return { depositionId, attorneyTime };
}

export function writeDepositionAttorneyTime(root, { depositionId, attorneyTime, storageRoot } = {}) {
  const entries = attorneyTimeEntries(attorneyTime);
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  atomicJson(file, { ...record, certification: { ...record.certification, attorneyTime: entries } });
  return { depositionId, attorneyTime: entries };
}

/**
 * Where the deposition was taken, and in what court.
 *
 * These four have slots in the canonical record and a place on the certified page, and until now
 * no screen could set any of them. They are written only by buildCanonicalRecord at intake, from a
 * Notice the manual route does not have -- so a deposition created by the manual route could never
 * produce a complete transcript, at any point in its life. This is the missing writer.
 *
 * `remote` is three-state and stays that way. A boolean defaulting to false records "taken in
 * person" when nobody said so, which is the defect the note at the top of
 * canonical-deposition-record.mjs already names: an unticked checkbox becoming a finding of the
 * source document. Undefined means unrecorded and keeps blocking, which is correct -- validate.mjs
 * refuses rather than guessing, because "a certificate that guesses is worse than one that is
 * refused".
 *
 * An untouched text control writes null with state MISSING, never "". isBlank collapses the two,
 * so an empty string would render a dropped clause with a clean bill of health -- exactly what
 * UNEXPECTED_BLANK exists to catch. Same rule as writeDepositionCertification above, for the same
 * reason.
 */
const PROCEEDING_TEXT_FIELDS = Object.freeze(["court", "location", "remotePlatform"]);

export function writeDepositionProceeding(root, { depositionId, proceeding = {}, storageRoot } = {}) {
  if (!proceeding || typeof proceeding !== "object" || Array.isArray(proceeding)) throw new Error("Proceeding must be an object.");
  const unknown = Object.keys(proceeding).filter((key) => key !== "remote" && !PROCEEDING_TEXT_FIELDS.includes(key));
  if (unknown.length) throw new Error(`Unsupported proceeding field: ${unknown.join(", ")}`);
  if (proceeding.remote !== undefined && proceeding.remote !== null && typeof proceeding.remote !== "boolean") {
    throw new Error("Whether the deposition was remote must be true, false, or null for unrecorded.");
  }

  const entry = (value) => {
    const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    return text ? field(text, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" }) : field(null, { source: "REPORTER_ENTERED", state: "MISSING" });
  };
  // Not entry(). entry() reads false as blank and would erase an answer of "in person" into
  // MISSING, which is the same field saying the reporter never answered.
  const method = (value) => typeof value === "boolean"
    ? field(value, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" })
    : field(null, { source: "REPORTER_ENTERED", state: "MISSING" });

  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));

  const nextCase = { ...record.case, court: entry(proceeding.court) };
  const nextDeposition = {
    ...record.deposition,
    remote: method(proceeding.remote),
    location: entry(proceeding.location),
    remotePlatform: entry(proceeding.remotePlatform),
  };

  atomicJson(file, { ...record, case: nextCase, deposition: nextDeposition });
  return { depositionId, court: nextCase.court, remote: nextDeposition.remote, location: nextDeposition.location, remotePlatform: nextDeposition.remotePlatform };
}

export function readDepositionRecord(root,id,options={}){const file=path.join(depositionDirectory(root,id,options),"deposition.json");if(!fs.existsSync(file))throw new Error("Deposition record was not found.");return JSON.parse(fs.readFileSync(file,"utf8"))}
/**
 * Appends corrections to the canonical record, and to the log beside it.
 *
 * The store boundary is where append-only is enforced, because it is the only place that touches
 * the file. There is deliberately no update, no delete, and no compaction: not "none implemented
 * yet" but none, so that a later caller reaching for one finds nothing to reach for. The log is
 * evidence about a certified record; a history that can be rewritten is not one.
 *
 * The whole file is rewritten temp-then-rename rather than opened for append. An interrupted
 * append can leave a half-written final line, and a truncated JSONL log is one that parseCorrection
 * Log will refuse to read at all -- losing every prior correction to save one.
 */
export function appendDepositionCorrections(root, { depositionId, corrections, who, at = new Date().toISOString(), storageRoot } = {}) {
  const proposed = Array.isArray(corrections) ? corrections : [corrections].filter(Boolean);
  if (!proposed.length) throw new Error("At least one correction is required.");
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const recordFile = path.join(directory, "intake", "canonical-deposition-record.json");
  const logFile = path.join(directory, "intake", "canonical-corrections.jsonl");
  if (!fs.existsSync(recordFile)) throw new Error("The Canonical Deposition Data Record was not found.");

  let record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  const existing = fs.existsSync(logFile) ? parseCorrectionLog(fs.readFileSync(logFile, "utf8")) : [];
  const seen = new Set(existing.map(entry => entry.id));
  const appended = [];

  // Validated against the record as it stands after the previous correction in this batch, so two
  // corrections to one field in a single call are checked in the order they will be applied.
  for (const input of proposed) {
    const result = validateCorrection(record, { ...input, depositionId, who: input.who ?? who, at: input.at ?? at });
    if (!result.ok) throw new Error(result.message);
    if (seen.has(result.entry.id)) throw new Error(`This correction to ${result.entry.path} is already in the log.`);
    seen.add(result.entry.id);
    record = applyCorrection(record, result.entry);
    appended.push(result.entry);
  }

  atomicText(logFile, serializeCorrectionLog([...existing, ...appended]));
  atomicJson(recordFile, record);
  return { depositionId, appended, corrections: [...existing, ...appended].length };
}

export function readDepositionCorrections(root, id, options = {}) {
  const file = path.join(depositionDirectory(root, id, options), "intake", "canonical-corrections.jsonl");
  return fs.existsSync(file) ? parseCorrectionLog(fs.readFileSync(file, "utf8")) : [];
}

/** Resolves one generated transcript designation through the existing canonical correction log. */
export function writeParticipantHonorific(root,{depositionId,participantId,honorific,who="Workspace reporter",storageRoot}={}){
  const directory=depositionDirectory(root,depositionId,{storageRoot}),file=path.join(directory,"intake","canonical-deposition-record.json");
  if(!fs.existsSync(file))throw new Error("The Canonical Deposition Data Record was not found.");
  const record=JSON.parse(fs.readFileSync(file,"utf8")),index=(record.counsel||[]).findIndex(item=>item.id===participantId);
  if(index<0)throw new Error("Honorific resolution currently requires a canonical counsel participant.");
  const current=record.counsel[index]?.honorific?.value??null,next=honorific===null?"NONE":String(honorific??"").trim().toUpperCase().replace(/\.?$/,".");
  if(next!=="NONE"&&!/^[A-Z][A-Z .'-]{0,19}\.$/.test(next))throw new Error("Enter a short honorific containing letters, spaces, apostrophes, or hyphens.");
  // Records created before counsel honorifics entered the canonical schema legitimately lack the
  // envelope. Add only that declared field, as MISSING, before using the ordinary append-only
  // correction path. This is not an inferred title and does not touch testimony or evidence.
  if(!record.counsel[index].honorific){record.counsel[index]={...record.counsel[index],honorific:field(null,{source:"REPORTER_ENTERED",state:"MISSING"})};atomicJson(file,record)}
  return appendDepositionCorrections(root,{depositionId,storageRoot,who,corrections:[{path:`counsel.${index}.honorific`,from:current,to:next,why:"Reporter resolved the generated transcript speaker designation."}]});
}

export function readDepositionIntake(root,id,options={}){const file=path.join(depositionDirectory(root,id,options),"intake","intake.json");if(!fs.existsSync(file))throw new Error("Deposition intake record was not found.");return JSON.parse(fs.readFileSync(file,"utf8"))}
export function resolveDepositionAudio(root,id,index,options={}){const directory=depositionDirectory(root,id,options),record=JSON.parse(fs.readFileSync(path.join(directory,"deposition.json"),"utf8")),item=record.audio?.[Number(index)];if(!item)throw new Error("Deposition audio was not found.");const file=path.resolve(directory,...String(item.path).split("/"));if(!within(file,directory)||!fs.existsSync(file))throw new Error("Deposition audio reference is invalid.");return{file,item}}

export const _testing={within,safeName,pathPart,personName,reporterFolder,causeFolder,depositionFolder,atomicJson,commitDirectory,ID_PATTERN,resolveDefaultDepositionsRoot};
