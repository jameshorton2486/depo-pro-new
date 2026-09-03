// Transcript-body layout and pagination, downstream of the canonical rendered transcript.
//
// This module is intentionally incapable of deciding what was said, who said it, how a speaker
// is labelled, or where a paragraph begins. Those decisions belong to renderTranscript(). Its
// only input text is the reporter-visible rendered payload; its only output is a page projection
// carrying references back to that payload and, through it, immutable ASR evidence.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";
import { isLayoutProfileVerified } from "./insertion-pages/layout-profile.mjs";
import { computeReviewStateHash } from "./review-state-hash.mjs";
import { buildSharedDocumentModel } from "./shared-document-model.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "./texas-freelance-deposition-profile.mjs";
import { renderTranscript } from "./transcript-render.mjs";
import { getSpeakerCandidates, getWorkingTranscript, readAsrEvidence, readReporterOverlay } from "./transcription-jobs.mjs";

export const TRANSCRIPT_PRINT_MODEL_VERSION = "1.0.0";
export const TRANSCRIPT_BODY_LAYOUT_PROFILE = TEXAS_FREELANCE_DEPOSITION_V1;

const CACHE = new Map();

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function renderedProjection(rendered) {
  return {
    schemaVersion:rendered?.schemaVersion??null,
    renderedContentHash:rendered?.renderedContentHash??null,
    paragraphs:(rendered?.paragraphs??[]).map(paragraph=>({
      id:paragraph.id, elementType:paragraph.elementType, label:paragraph.label, byLine:paragraph.byLine,
      layout:paragraph.layout, text:paragraph.text, start:paragraph.start, end:paragraph.end,
      segmentIds:paragraph.segmentIds, asrWordIds:paragraph.asrWordIds,
      sourceJobIdentity:paragraph.sourceJobIdentity, deepgramSpeaker:paragraph.deepgramSpeaker,
    })),
  };
}

// A label for a speaker the record cannot name.
//
// This is a PREVIEW device and its name says so. A reporter reading a transcript before the speaker
// map is reconciled needs to see who is who by number rather than a wall of blank labels, and that
// is worth having. What is not worth having is the same substitution reaching a certified page: it
// prints "SPEAKER 1:" over testimony under the reporter's CSR number, and it looks like a label
// rather than like a gap.
//
// So the substitution is marked where it happens. The finalization boundary refuses on the mark
// rather than on the transcript's speaker-map status, because those are not the same condition --
// measured, a transcript can read `reconciled` and still hold paragraphs with no label at all when
// a participant is in the transcript but not in the canonical record. That is exactly the case the
// Word gate found, and a status check alone would have passed it.
function withPreviewLabels(paragraphs) {
  const fallbackLabels=new Map();
  return paragraphs.map(paragraph=>{
    if(paragraph.label)return paragraph;
    // A heading and a BY-line are structural content the reporter's record states, not speech
    // somebody was recorded making. Giving them a fallback speaker printed
    // "SPEAKER UNKNOWN:BY MS. WHITFIELD:" into the Word document -- found by reopening the file,
    // because every stage before that was the application describing its own output.
    if(paragraph.derived)return paragraph;
    const speaker=paragraph.deepgramSpeaker;
    const key=speaker===null||speaker===undefined?null:`${paragraph.sourceJobIdentity??"unknown-job"}:${speaker}`;
    // The number is the Deepgram cluster index, not a counter over first appearances.
    //
    // It used to be `fallbackLabels.size+1`, and that made "Speaker N" mean two different things on
    // one screen: the transcript numbered by order of appearance while the Counsel Editor's selector
    // numbers by cluster index. On Production Trial #1 it showed Pablo Rivera as "SPEAKER 5:" in the
    // body while the selector correctly read "Speaker 1 - 109 words". Cluster 5 is a different voice,
    // two words long and still unidentified. The reporter compared the two and concluded the
    // application had assigned the wrong speaker; it had not. A number that cannot be carried from one
    // control to another is worse than no number.
    //
    // Two recordings can each have a cluster 0, which is the ambiguity the counter avoided. That is
    // disambiguated rather than renumbered, so the index read in the selector is the index read here.
    if(key&&!fallbackLabels.has(key)){
      const sharesIndex=[...fallbackLabels.keys()].some(other=>other.endsWith(`:${speaker}`));
      fallbackLabels.set(key,sharesIndex?`SPEAKER ${speaker} (${String(paragraph.sourceJobIdentity??"").slice(0,8)}):`:`SPEAKER ${speaker}:`);
    }
    return {...paragraph,label:key?fallbackLabels.get(key):"SPEAKER UNKNOWN:",previewLabel:true};
  });
}
function previewParagraphs(rendered){return renderedProjection({...rendered,paragraphs:withPreviewLabels(rendered?.paragraphs??[]).filter(paragraph=>paragraph.text||paragraph.derived)}).paragraphs}

export function buildTranscriptPrintModel({ rendered, reviewStateHash, deposition, profile=TRANSCRIPT_BODY_LAYOUT_PROFILE }={}) {
  if (!rendered?.paragraphs) throw new Error("PRINT_RENDERED_TRANSCRIPT_REQUIRED: Print Model consumes the canonical rendered transcript.");
  if (!reviewStateHash) throw new Error("PRINT_REVIEW_STATE_REQUIRED: Preview requires the canonical review-state hash.");
  const printFindings=[];
  if(!isLayoutProfileVerified(profile)) printFindings.push({ code:"PRINT_LAYOUT_PROFILE_UNVERIFIED", severity:"warning", target:"layoutProfile", message:"This is a simple readable preview. Its 25-line reading pages are not verified court-transcript geometry and are not intended for certified production output." });
  const projection=renderedProjection(rendered),paragraphs=previewParagraphs(rendered),renderedProjectionHash=hash(projection);
  const sharedDocument=buildSharedDocumentModel({rendered,paragraphs:withPreviewLabels(rendered.paragraphs).filter(paragraph=>paragraph.text||paragraph.derived),profile});
  printFindings.push(...sharedDocument.findings);
  const pages=sharedDocument.pages;
  // Which paragraphs are only readable because the preview named their speaker for them. Carried as
  // data, not as a refusal: Preview is entitled to show them, and the Final Document Model is the
  // layer that decides a certified page may not.
  const previewLabelled=withPreviewLabels(rendered.paragraphs).filter(paragraph=>paragraph.previewLabel)
    .map(paragraph=>({id:paragraph.id,label:paragraph.label,speakerIdentity:paragraph.speakerIdentity??null,deepgramSpeaker:paragraph.deepgramSpeaker??null}));
  // Where each examination actually begins, in testimony pages -- Phase D3.
  //
  // Read out of the paginator's own output rather than counted alongside it. Every printed line
  // carries a trace naming the paragraph and the source words behind it, so an examination's page
  // is a lookup, never an arithmetic guess that could drift from what was laid out. The implicit
  // first examination begins on testimony page 1 by definition: it starts where testimony starts.
  //
  // No page number is stored anywhere. This is recomputed on every build, which is exactly why a
  // body one page longer moves every later citation without anything being told to.
  const pageHoldingParagraph=id=>pages.find(page=>page.lines.some(line=>line.paragraphId===id))?.pageNumber??null;
  const pageHoldingWord=wordId=>pages.find(page=>page.lines.some(line=>line.trace?.sourceWordIds?.includes(wordId)))?.pageNumber??null;
  const examinations=(rendered.examinations??[]).map(examination=>{
    if(examination.implicit||!examination.atWordId)return{...examination,testimonyPage:1};
    // The heading is where the examination begins on the page, so it is preferred over the anchor
    // word: a heading at the foot of one page and its first question at the head of the next are
    // one page apart, and the index should cite where the reader sees the examination start.
    const testimonyPage=pageHoldingParagraph(`examination:${examination.type}:${examination.atWordId}`)??pageHoldingWord(examination.atWordId);
    return{...examination,testimonyPage};
  });
  for(const examination of examinations){
    if(examination.testimonyPage!==null)continue;
    printFindings.push({code:"PRINT_EXAMINATION_PAGE_UNRESOLVED",severity:"warning",target:examination.atWordId,
      message:`The ${examination.type} examination could not be located on a printed page, so the index cannot cite it.`});
  }
  const unsigned={
    schemaVersion:TRANSCRIPT_PRINT_MODEL_VERSION, recordType:"TRANSCRIPT_PRINT_MODEL",
    deposition:{ id:deposition?.id??null, caseStyle:deposition?.caseStyle??"", witness:deposition?.witness??"", depositionDate:deposition?.depositionDate??"", causeNumber:deposition?.causeNumber??"" },
    source:{ reviewStateHash, transcriptContentHash:rendered.transcriptContentHash??null, renderedContentHash:rendered.renderedContentHash??null, renderedProjectionHash },
    layoutProfile:profile,
    paragraphs,
    pages,
    examinations,
    speakerMap:rendered.speakerMap??null,
    previewLabelled,
    findings:{ transcript:[...(rendered.findings??[])], print:printFindings },
  };
  return { ...unsigned, modelHash:hash(unsigned) };
}

export function getTranscriptPrintModel(root,{depositionId,storageRoot,examinerIdentity=null}={}) {
  const store={depositionId,storageRoot},directory=depositionDirectory(root,depositionId,{storageRoot});
  const working=getWorkingTranscript(root,store),overlay=readReporterOverlay(root,store),evidence=readAsrEvidence(root,store);
  const candidates=getSpeakerCandidates(root,store).candidates;
  const rendered=renderTranscript({working,evidence,speakerCandidates:candidates,examinerIdentity,overlay});
  const reviewStateHash=computeReviewStateHash({transcript:working,overlay}),projectionHash=hash(renderedProjection(rendered));
  const cacheKey=hash({reviewStateHash,projectionHash,layoutProfileVersion:TRANSCRIPT_BODY_LAYOUT_PROFILE.version});
  if(CACHE.has(cacheKey))return CACHE.get(cacheKey);
  const model=buildTranscriptPrintModel({rendered,reviewStateHash,deposition:readJson(path.join(directory,"deposition.json"))});
  CACHE.set(cacheKey,model);
  if(CACHE.size>20)CACHE.delete(CACHE.keys().next().value);
  return model;
}

export const _testing={CACHE,hash,previewParagraphs,renderedProjection,withPreviewLabels};
