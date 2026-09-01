import crypto from "node:crypto";
import { EXAMINATION_INDEX_LABELS } from "./transcript-labels.mjs";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";
import { assembleInsertionInput } from "./insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "./insertion-pages/build-pages.mjs";
import { horizontalOverflowFindings } from "./insertion-pages/page-model.mjs";
import { loadTemplateVariant } from "./insertion-pages/templates.mjs";
import { validateInsertionInput } from "./insertion-pages/validate.mjs";
import { selectInsertionVariant } from "./insertion-pages/variants.mjs";
import { getTranscriptPrintModel } from "./transcript-print-model.mjs";

export const COMPLETE_TRANSCRIPT_MODEL_VERSION="1.0.0";
const FRONT_ROLES=new Set(["title","appearances","index"]);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const value=field=>field&&typeof field==="object"&&"value" in field?field.value:field;

function normalizeAdministrativePage(page,pageNumber){
  return {id:`admin-${page.role}-${pageNumber}`,pageNumber,role:page.role,sectionKind:"administrative",editable:false,
    lines:page.lines.map((line,index)=>({position:index+1,content:String(line.text??""),occupied:Boolean(line.text),paragraphId:null,fragments:[],fields:[...(line.fields??[])]}))};
}

function shiftTestimonyPage(page,pageNumber){
  return {...page,id:`testimony-${pageNumber}`,pageNumber,role:"testimony",sectionKind:"testimony",editable:true,
    lines:page.lines.map(line=>({...line,modelTestimonyPage:page.pageNumber}))};
}

/**
 * The examining attorney, resolved from the canonical id the assembly stores.
 *
 * The assembly holds `operator.examiningCounselId` and never a typed name, so the name printed in
 * the index is looked up here rather than carried alongside the id -- two places holding the same
 * name is how they come to disagree. The honorific is included when the record has one.
 *
 * Returns null when nothing was chosen. It does not invent anybody: the index used to fall back to
 * a literal "EXAMINING ATTORNEY", which printed confident placeholder prose on a certified page
 * that nothing in the suite asserted against and no reader would recognise as a defect.
 */
function examinerName(record, operator) {
  return counselDisplayName(record, operator?.examiningCounselId);
}

/**
 * The name the index prints for a counsel id.
 *
 * One lookup for both the examiner the reporter chose in Prepare and the examiners the transcript
 * resolved, because they are the same kind of fact read from the same record. Speaker identities
 * for counsel ARE canonical counsel ids -- getSpeakerCandidates maps `{id: item.id}` -- so an
 * examination boundary names something this record can find.
 */
function counselDisplayName(record, rawId) {
  const id = String(rawId ?? "").trim();
  if (!id) return null;
  const entry = (record?.counsel ?? []).find(item => item.id === id);
  // Two different causes, said differently. A reporter who removed an attorney in the counsel
  // editor has broken the preparation that named them, and needs to be told that rather than shown
  // a generic missing-examiner error: the removal and the refusal are screens apart.
  if (!entry) {
    throw new Error(`COMPLETE_TRANSCRIPT_EXAMINER_UNRESOLVED:${id}: the preparation names a counsel record this deposition no longer has. If that attorney was removed, choose the examining attorney again in Prepare Complete Transcript.`);
  }
  const name = String(value(entry.fullName) ?? "").trim();
  if (!name) {
    throw new Error(`COMPLETE_TRANSCRIPT_EXAMINER_UNNAMED:${id}: the counsel record the preparation names has no name recorded, so the index has nothing to print.`);
  }
  const honorific = String(value(entry.honorific) ?? "").trim();
  return honorific ? `${honorific} ${name}` : name;
}

/**
 * Places the examinations the transcript resolved, using the pages the paginator actually laid out.
 *
 * This is what §122 refused to do, and the reason it refused is gone: "nothing here knows where one
 * examination ends and the next begins" was true until the overlay carried boundaries and the print
 * model resolved each to a printed page. Nothing is supplied and nothing is stored -- an
 * examination's page is read from the line traces on every build, which is why a body one page
 * longer moves every later citation without anything being told to.
 *
 * An examination ends where the next one starts. The last runs to the end of testimony.
 */
function placeResolvedExaminations(resolved, record, testimonyStart, testimonyEnd) {
  const ordered = [...resolved].sort((left, right) => (left.testimonyPage ?? 1) - (right.testimonyPage ?? 1));
  return ordered.map((examination, index) => {
    if (!Number.isInteger(examination.testimonyPage))
      throw new Error(`COMPLETE_TRANSCRIPT_EXAMINATION_PAGE_UNRESOLVED:${examination.type}: the transcript could not say which page this examination begins on, so the index cannot cite it.`);
    const name = counselDisplayName(record, examination.examinerPersonId);
    if (!name)
      throw new Error(`COMPLETE_TRANSCRIPT_EXAMINER_UNRESOLVED:${examination.examinerPersonId}: an examination names a counsel record this deposition no longer has.`);
    const startPage = testimonyStart + examination.testimonyPage - 1;
    const next = ordered[index + 1];
    // Clamped, because two examinations can begin on one page -- a short cross that opens and
    // closes without turning the leaf. The earlier one ends on the page it started, rather than
    // citing a range that runs backwards.
    const endPage = next ? Math.max(startPage, testimonyStart + next.testimonyPage - 2) : testimonyEnd;
    return { examiner:name, type:examination.type, examinationLabel:EXAMINATION_INDEX_LABELS[examination.type] ?? "Examination", startPage, endPage };
  });
}

/**
 * Places supplied examinations against the testimony the paginator actually laid out.
 *
 * Two refusals rather than a guess. A caller-supplied page number is rejected outright: it is not
 * information this function needs and accepting it is how a wrong citation reached a certified
 * index. And more than one examination cannot be placed at all -- where one examiner stops and the
 * next begins lives in the transcript, in BY-lines and examination headings, not in a page count.
 * Splitting the range down the middle would put a fabricated boundary on the index and look exactly
 * like a real one.
 */
function placeExaminations(examinations,testimonyStart,testimonyEnd){
  if(examinations.some(exam=>exam.startPage!==undefined||exam.endPage!==undefined))
    throw new Error("COMPLETE_TRANSCRIPT_EXAMINATION_PAGES_NOT_ACCEPTED: page numbers on the index are derived from the transcript, never supplied.");
  if(examinations.length>1)
    throw new Error("COMPLETE_TRANSCRIPT_MULTIPLE_EXAMINATIONS_UNPLACEABLE: nothing here knows where one examination ends and the next begins.");
  return examinations.map(exam=>({...exam,startPage:testimonyStart,endPage:testimonyEnd}));
}
export function completePagination({testimonyPages,signatureDisposition,examinations=[],examiner=null,frontPages=3,preCertificationPages=null,certificationPages=null,resolvedExaminations=[],record=null}){
  const testimonyStart=frontPages+1,testimonyEnd=testimonyStart+testimonyPages-1;
  const requested=signatureDisposition==="requested",beforeCertificate=preCertificationPages??(requested?2:0),certificateCount=certificationPages??(requested?3:2),changesStart=requested?testimonyEnd+1:null,certificateStart=testimonyEnd+1+beforeCertificate;
  // The reporter never enters page ranges. A single examination spans the testimony, and its bounds
  // come from the paginator that already knows where testimony starts and ends.
  //
  // That was the comment before this function enforced it. The other branch took a caller's
  // startPage and endPage verbatim, offset only by front-matter depth, and nothing compared them to
  // the transcript -- so a supplied 4-5 printed "Examination by ... 4-5" on the index of a body
  // running to 216. Latent, because only fixtures ever supplied that array, but the index is the
  // one page whose entire job is to be true about other pages.
  //
  // Page numbers are now always derived. What a caller may state is examination *structure*: who
  // examined. Supplying a page number is refused rather than ignored, because a caller who believes
  // their number matters should be told it does not, not quietly overruled.
  //
  // Refused rather than defaulted when there is no examiner. This used to emit
  // { examiner: "EXAMINING ATTORNEY" } and the index printed it.
  // The transcript's own sequence wins when it contains a handover, and only then. With a single
  // implicit examination the existing path is left exactly as it was, so every deposition that
  // renders today keeps citing what it cites -- the examiner the reporter chose in Prepare, not a
  // second answer derived from the same record.
  const explicitlyExamined = resolvedExaminations.filter(item => !item.implicit).length > 0;
  const examinationEntries = explicitlyExamined
    ? placeResolvedExaminations(resolvedExaminations, record, testimonyStart, testimonyEnd)
    : examinations.length
    ? placeExaminations(examinations, testimonyStart, testimonyEnd)
    : examiner
      ? [{ examiner, startPage:testimonyStart, endPage:testimonyEnd }]
      : null;
  if (!examinationEntries) throw new Error("COMPLETE_TRANSCRIPT_EXAMINER_REQUIRED");
  return {index:{appearances:{startPage:2},examinations:examinationEntries,
    changesAndSignature:requested?{startPage:changesStart,endPage:changesStart+1}:null,
    reportersCertification:{startPage:certificateStart,endPage:certificateStart+certificateCount-1},entries:[],actualSectionPages:{},declaredSectionPages:{}}};
}

export async function buildCompleteTranscriptModel({depositionId,printModel,record,intake={},operator={},generatedAt="1970-01-01T00:00:00.000Z"}={}){
  if(!printModel?.pages?.length)throw new Error("COMPLETE_TRANSCRIPT_TESTIMONY_REQUIRED");
  const signatureDisposition=operator.signatureDisposition??value(record?.signature?.status);
  const jurisdiction=operator.jurisdiction??value(record?.case?.jurisdictionType);
  const normalizedOperator={...operator,jurisdiction,signatureDisposition};
  const variant=selectInsertionVariant(normalizedOperator);
  if(!variant)throw new Error("COMPLETE_TRANSCRIPT_VARIANT_REQUIRED");
  const template=await loadTemplateVariant(variant);
  if(!template.available)throw new Error(`COMPLETE_TRANSCRIPT_TEMPLATE_UNAVAILABLE:${variant}`);
  let pagination=completePagination({testimonyPages:printModel.pages.length,signatureDisposition,examinations:operator.examinations??[],examiner:examinerName(record,operator),resolvedExaminations:printModel.examinations??[],record});
  let input=assembleInsertionInput({record,intake,operator:normalizedOperator,pagination,template});
  const findings=validateInsertionInput(input),blockers=findings.filter(finding=>finding.severity==="blocking");
  if(blockers.length)throw new Error(`COMPLETE_TRANSCRIPT_VALIDATION_BLOCKED:${blockers.map(item=>`${item.code}:${item.target}`).join(",")}`);
  let insertion=buildTexasInsertionPageSet(input,{setId:`complete-${depositionId}`,depositionId,generatedAt});
  const frontPages=insertion.pages.filter(page=>FRONT_ROLES.has(page.role)).length;
  const preCertificationPages=insertion.pages.filter(page=>["changes","signature"].includes(page.role)).length;
  const certificationPages=insertion.pages.filter(page=>page.role.startsWith("certification")).length;
  pagination=completePagination({testimonyPages:printModel.pages.length,signatureDisposition,examinations:operator.examinations??[],examiner:examinerName(record,operator),frontPages,preCertificationPages,certificationPages,resolvedExaminations:printModel.examinations??[],record});
  input=assembleInsertionInput({record,intake,operator:normalizedOperator,pagination,template});
  insertion=buildTexasInsertionPageSet(input,{setId:`complete-${depositionId}`,depositionId,generatedAt});
  const front=insertion.pages.filter(page=>FRONT_ROLES.has(page.role));
  const back=insertion.pages.filter(page=>!FRONT_ROLES.has(page.role));
  const pages=[];
  for(const page of front)pages.push(normalizeAdministrativePage(page,pages.length+1));
  for(const page of printModel.pages)pages.push(shiftTestimonyPage(page,pages.length+1));
  for(const page of back)pages.push(normalizeAdministrativePage(page,pages.length+1));
  const horizontalOverflow=horizontalOverflowFindings(pages,printModel.layoutProfile);
  if(horizontalOverflow.length)throw new Error(`COMPLETE_TRANSCRIPT_HORIZONTAL_OVERFLOW:${horizontalOverflow.map(item=>item.target).join(",")}`);
  const sections=[
    {id:"front-matter",kind:"administrative",roles:front.map(page=>page.role),startPage:1,endPage:front.length},
    {id:"testimony",kind:"testimony",roles:["testimony"],startPage:front.length+1,endPage:front.length+printModel.pages.length,sourceModelHash:printModel.modelHash},
    {id:"back-matter",kind:"administrative",roles:back.map(page=>page.role),startPage:front.length+printModel.pages.length+1,endPage:pages.length},
  ];
  const unsigned={schemaVersion:COMPLETE_TRANSCRIPT_MODEL_VERSION,recordType:"COMPLETE_TRANSCRIPT_DOCUMENT_MODEL",deposition:printModel.deposition,layoutProfile:printModel.layoutProfile,
    source:{testimonyModelHash:printModel.modelHash,reviewStateHash:printModel.source.reviewStateHash,insertionPageSetHash:insertion.sha256,canonicalRecordVersion:record.schemaVersion},
    variant,signatureDisposition,pagination,sections,paragraphs:printModel.paragraphs,pages,findings:{transcript:printModel.findings,assembly:findings,horizontalOverflow}};
  return {...unsigned,modelHash:hash(unsigned)};
}

export async function getCompleteTranscriptModel(root,{depositionId,storageRoot,examinerIdentity=null}={}){
  const directory=depositionDirectory(root,depositionId,{storageRoot}),assemblyFile=path.join(directory,"intake","complete-transcript-assembly.json");
  if(!fs.existsSync(assemblyFile))throw new Error("COMPLETE_TRANSCRIPT_ASSEMBLY_REQUIRED");
  const request=JSON.parse(fs.readFileSync(assemblyFile,"utf8"));
  const record=JSON.parse(fs.readFileSync(path.join(directory,"intake","canonical-deposition-record.json"),"utf8"));
  const intakeFile=path.join(directory,"intake","intake.json"),intake=fs.existsSync(intakeFile)?JSON.parse(fs.readFileSync(intakeFile,"utf8")):{};
  const printModel=getTranscriptPrintModel(root,{depositionId,storageRoot,examinerIdentity});
  return buildCompleteTranscriptModel({depositionId,printModel,record,intake:{...intake,...request.intake},operator:request.operator,generatedAt:request.generatedAt??new Date().toISOString()});
}
