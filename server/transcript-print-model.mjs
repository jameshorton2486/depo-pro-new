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

function hardWrapToken(token, width, findings, paragraphId) {
  findings.push({ code:"PRINT_UNBREAKABLE_TOKEN", severity:"warning", target:paragraphId,
    message:`A ${token.length}-character token exceeds the ${width}-character line area and was hard-wrapped.` });
  const lines=[];
  for (let offset=0; offset<token.length; offset+=width) lines.push(token.slice(offset, offset+width));
  return lines;
}

// Preserves whitespace inside a line, including the canonical two spaces after a sentence.
// Whitespace at a physical line boundary is layout, not transcript text, and is discarded.
function wrapVariable(text, firstWidth, continuationWidth, findings, paragraphId) {
  let remaining=String(text ?? "").trim(), width=firstWidth;
  const output=[];
  while (remaining) {
    if (remaining.length <= width) { output.push(remaining); break; }
    let at=-1;
    for (let index=Math.min(width,remaining.length-1); index>=0; index--) if (/\s/.test(remaining[index])) { at=index; break; }
    if (at<0) {
      const tokenEnd=remaining.search(/\s/), token=tokenEnd<0?remaining:remaining.slice(0,tokenEnd);
      const chunks=hardWrapToken(token,width,findings,paragraphId);
      output.push(chunks.shift());
      remaining=`${chunks.join("")} ${tokenEnd<0?"":remaining.slice(tokenEnd).trimStart()}`.trim();
    } else {
      output.push(remaining.slice(0,at).trimEnd());
      remaining=remaining.slice(at).trimStart();
    }
    width=continuationWidth;
  }
  return output.length?output:[""];
}

function spaces(count) { return " ".repeat(Math.max(0,count)); }
function centered(text) { return `${spaces(Math.floor((LINE_WIDTH-text.length)/2))}${text}`; }

function paragraphLines(paragraph, findings) {
  const layout=paragraph.layout ?? { tokenCol:0, textCol:0, wrapCol:0, centered:false };
  const trace={ paragraphId:paragraph.id, sourceSegmentIds:[...(paragraph.segmentIds??[])], sourceWordIds:[...(paragraph.asrWordIds??[])], start:paragraph.start??null, end:paragraph.end??null };
  const lines=[];
  if (paragraph.byLine) lines.push({ content:String(paragraph.byLine), paragraphId:paragraph.id, trace, kind:"by-line" });
  const text=String(paragraph.text??"");
  if (layout.centered) {
    for (const piece of wrapVariable(text,LINE_WIDTH,LINE_WIDTH,findings,paragraph.id)) lines.push({ content:centered(piece), paragraphId:paragraph.id, trace, kind:"paragraph" });
    return lines;
  }
  const tokenCol=Number.isInteger(layout.tokenCol)?layout.tokenCol:null, textCol=Number.isInteger(layout.textCol)?layout.textCol:null, wrapCol=Number.isInteger(layout.wrapCol)?layout.wrapCol:0;
  let prefix="", firstTextCol=textCol??0;
  if (paragraph.label && tokenCol!==null) {
    prefix=`${spaces(tokenCol)}${paragraph.label}`;
    if (textCol!==null) prefix+=spaces(textCol-prefix.length);
    else prefix+=String(layout.inlineAfterLabel??"  ");
    firstTextCol=prefix.length;
  } else if (textCol!==null) prefix=spaces(textCol);
  const pieces=wrapVariable(text,Math.max(1,LINE_WIDTH-firstTextCol),Math.max(1,LINE_WIDTH-wrapCol),findings,paragraph.id);
  pieces.forEach((piece,index)=>lines.push({ content:`${index===0?prefix:spaces(wrapCol)}${piece}`, paragraphId:paragraph.id, trace, kind:"paragraph" }));
  return lines;
}

function paginate(paragraphs, findings, profile) {
  const content=paragraphs.flatMap(paragraph=>paragraphLines(paragraph,findings));
  for (const line of content) if (line.content.length>profile.charactersPerLine) findings.push({ code:"PRINT_LINE_OVERFLOW", severity:"blocking", target:line.paragraphId, message:`A rendered line occupies ${line.content.length} characters; the profile permits ${profile.charactersPerLine}.` });
  const pages=[];
  for(let offset=0; offset<content.length||(!content.length&&offset===0); offset+=profile.linesPerPage){
    const occupied=content.slice(offset,offset+profile.linesPerPage);
    pages.push({ id:`transcript-body-${pages.length+1}`, role:"transcript-body", pageNumber:pages.length+1,
      lines:Array.from({length:profile.linesPerPage},(_,index)=>occupied[index]
        ? { position:index+1, occupied:true, ...occupied[index] }
        : { position:index+1, occupied:false, content:"", paragraphId:null, trace:null, kind:"blank" }) });
  }
  return pages;
}

function renderedProjection(rendered) {
  return {
    schemaVersion:rendered?.schemaVersion??null,
    renderedContentHash:rendered?.renderedContentHash??null,
    paragraphs:(rendered?.paragraphs??[]).map(paragraph=>({
      id:paragraph.id, elementType:paragraph.elementType, label:paragraph.label, byLine:paragraph.byLine,
      layout:paragraph.layout, text:paragraph.text, start:paragraph.start, end:paragraph.end,
      segmentIds:paragraph.segmentIds, asrWordIds:paragraph.asrWordIds,
    })),
  };
}

function previewParagraphs(rendered) {
  return renderedProjection(rendered).paragraphs;
}

export function buildTranscriptPrintModel({ rendered, reviewStateHash, deposition, profile=TRANSCRIPT_BODY_LAYOUT_PROFILE }={}) {
  if (!rendered?.paragraphs) throw new Error("PRINT_RENDERED_TRANSCRIPT_REQUIRED: Print Model consumes the canonical rendered transcript.");
  if (!reviewStateHash) throw new Error("PRINT_REVIEW_STATE_REQUIRED: Preview requires the canonical review-state hash.");
  const printFindings=[];
  if(!isLayoutProfileVerified(profile)) printFindings.push({ code:"PRINT_LAYOUT_PROFILE_UNVERIFIED", severity:"warning", target:"layoutProfile", message:"The 25-line body grid and 62-character transcript width are available, but final page margins and gutter geometry have not been signed off." });
  const projection=renderedProjection(rendered),paragraphs=previewParagraphs(rendered),renderedProjectionHash=hash(projection),pages=paginate(paragraphs,printFindings,profile);
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

export const _testing={CACHE,hash,paragraphLines,paginate,previewParagraphs,renderedProjection,wrapVariable};
