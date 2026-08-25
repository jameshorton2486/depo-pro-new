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
import { UFM_FREELANCE_LAYOUT_PROFILE, isLayoutProfileVerified } from "./insertion-pages/layout-profile.mjs";
import { computeReviewStateHash } from "./review-state-hash.mjs";
import { buildSharedDocumentModel } from "./shared-document-model.mjs";
import { LINE_WIDTH } from "./transcript-labels.mjs";
import { renderTranscript } from "./transcript-render.mjs";
import { getSpeakerCandidates, getWorkingTranscript, readAsrEvidence, readReporterOverlay } from "./transcription-jobs.mjs";

export const TRANSCRIPT_PRINT_MODEL_VERSION = "1.0.0";
export const TRANSCRIPT_BODY_LAYOUT_PROFILE = Object.freeze({
  ...UFM_FREELANCE_LAYOUT_PROFILE,
  version:"transcript-body-preview-v1",
  scope:"transcript-body",
  charactersPerLine:LINE_WIDTH,
});

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

function withPreviewLabels(paragraphs) {
  const fallbackLabels=new Map();
  return paragraphs.map(paragraph=>{
    if(paragraph.label)return paragraph;
    const speaker=paragraph.deepgramSpeaker;
    const key=speaker===null||speaker===undefined?null:`${paragraph.sourceJobIdentity??"unknown-job"}:${speaker}`;
    if(key&&!fallbackLabels.has(key))fallbackLabels.set(key,`SPEAKER ${fallbackLabels.size+1}:`);
    return {...paragraph,label:key?fallbackLabels.get(key):"SPEAKER UNKNOWN:"};
  });
}
function previewParagraphs(rendered){return renderedProjection({...rendered,paragraphs:withPreviewLabels(rendered?.paragraphs??[])}).paragraphs}

export function buildTranscriptPrintModel({ rendered, reviewStateHash, deposition, profile=TRANSCRIPT_BODY_LAYOUT_PROFILE }={}) {
  if (!rendered?.paragraphs) throw new Error("PRINT_RENDERED_TRANSCRIPT_REQUIRED: Print Model consumes the canonical rendered transcript.");
  if (!reviewStateHash) throw new Error("PRINT_REVIEW_STATE_REQUIRED: Preview requires the canonical review-state hash.");
  const printFindings=[];
  if(!isLayoutProfileVerified(profile)) printFindings.push({ code:"PRINT_LAYOUT_PROFILE_UNVERIFIED", severity:"warning", target:"layoutProfile", message:"This is a simple readable preview. Its 25-line reading pages are not verified court-transcript geometry and are not intended for certified production output." });
  const projection=renderedProjection(rendered),paragraphs=previewParagraphs(rendered),renderedProjectionHash=hash(projection);
  const sharedDocument=buildSharedDocumentModel({rendered,paragraphs:withPreviewLabels(rendered.paragraphs),profile});
  printFindings.push(...sharedDocument.findings);
  const pages=sharedDocument.pages;
  const unsigned={
    schemaVersion:TRANSCRIPT_PRINT_MODEL_VERSION, recordType:"TRANSCRIPT_PRINT_MODEL",
    deposition:{ id:deposition?.id??null, caseStyle:deposition?.caseStyle??"", witness:deposition?.witness??"", depositionDate:deposition?.depositionDate??"", causeNumber:deposition?.causeNumber??"" },
    source:{ reviewStateHash, transcriptContentHash:rendered.transcriptContentHash??null, renderedContentHash:rendered.renderedContentHash??null, renderedProjectionHash },
    layoutProfile:profile,
    paragraphs,
    pages,
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
