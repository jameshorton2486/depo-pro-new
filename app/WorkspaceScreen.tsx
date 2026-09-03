"use client";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { speakerBuckets } from "./transcript-paragraphs.mjs";

import { LOCAL_API_BASE_URL as API } from "./api-client";
import { DOCUMENT_STATUS, deriveDocumentStatus, documentControlLabel, generationNotice } from "./document-status.mjs";
import CounselEditor from "./CounselEditor";
import { splitWithSpeakerControl, splitWithSpeakerOperation } from "./split-with-speaker-control.mjs";
import { overlayHistoryRequest, overlayMutationRequest, rangeAcceptanceRequest } from "./overlay-mutation.mjs";
import { emptyRangeListMessage, rangeProposalKey, rangeProposalSummary, remainingAfterAcceptance, remainingAfterRejection } from "./range-review.mjs";
import { currentSpeakerDescription, deleteSelectedParagraphOperations, globalScopeOption, speakerScopeChoices, strikeParagraphOperations, proposalScopeDescription, reviewCategories, reviewStep, selectedParagraphSummary, speakerActions, speakerReviewLocations, structureActions } from "./transcript-tools.mjs";

// One empty set, so "no low-confidence marks" is the same reference on every render.
const EMPTY_WORD_IDS: Set<string> = new Set();
import PartiesEditor from "./PartiesEditor";
import ProceedingEditor from "./ProceedingEditor";
import PrepareCompleteTranscript from "./PrepareCompleteTranscript";
import WorkspaceDocumentPages, { type DocumentPage } from "./WorkspaceDocumentPages";
import { EXAMINATION_TYPE_CHOICES, examinationControl, examinationOperation, examinationSummary } from "./examination-control.mjs";
import { examinerColloquyControl, examinerColloquyLabel, examinerColloquyOperation } from "./examiner-colloquy-control.mjs";
import { paragraphEditTransaction, wordCharacterRanges } from "./paragraph-edit-transaction.mjs";

type Word = { id:string; text:string; display?:string; styled?:boolean; start:number|null; end:number|null; confidence:number|null; deepgramSpeaker:number|null; edited?:boolean; deleted?:boolean; authored?:boolean; originalText?:string; flagged?:boolean; flaggedFrom?:string; lowConfidence?:boolean; reviewDisposition?:"CORRECTED"|"APPROVED"|null };
type Paragraph = { id:string; elementType:string; label:string|null; byLine:string|null; speakerIdentity:string|null; transcriptRole:string|null; deepgramSpeaker:number|null; unlabeledSpeaker:boolean; examinerColloquy?:boolean; start:number|null; end:number|null; text:string; words:Word[]; segmentIds:string[]; asrWordIds:string[] };
type Finding = { code:string; message:string; speakerIdentity?:string; name?:string };
type Examination = { examinerPersonId:string; type:string; atWordId:string|null; implicit:boolean };
type Rendered = { transcriptContentHash:string|null; derivedFrom?:string[]; paragraphs:Paragraph[]; findings:Finding[]; diarized:boolean; labels:Record<string,string>; examinations?:Examination[]; counts:{ paragraphs:number; words:number; operations:number; redoTransactions:number; orphaned:number; flags:number; lowConfidenceUnresolved:number }; speakerMap:{ status:string; assignments:{ sourceJobIdentity:string; deepgramSpeaker:number; speakerIdentity:string; transcriptRole:string }[] }|null };
type Candidate = { id:string; label:string; defaultRole:string; honorific?:string|null };
type PrintModel = { recordType?:string; pages:DocumentPage[]; source:{reviewStateHash:string}; layoutProfile:import("./WorkspaceDocumentPages").LayoutProfile; findings:{print?:Finding[];assembly?:Finding[]} };

// One paragraph, memoized, because without this a single word click reconciles every word in the
// deposition -- measured at 150-200ms of blocked main thread per click on ETM01's 12,174 words.
//
// Every prop here is a primitive or an identity that only changes when this paragraph's appearance
// actually changes. That is the whole trick, and it is easy to get wrong: passing `selected` or an
// `inRange` closure would be correct-looking and would re-render all 306 paragraphs on every click,
// because both change identity whenever the selection moves anywhere in the transcript.
//
//   selectedWordId is null for every paragraph except the one holding the selection, so moving the
//   selection re-renders exactly two paragraphs: the one losing it and the one gaining it.
//
//   rangeFirst/rangeLast are -1 unless the range actually overlaps this paragraph's words, so a
//   range selection re-renders the paragraphs it spans rather than all of them.
//
// wordOrder is a Map memoized on `rendered`, so its identity is stable between renders.
const TranscriptParagraph = memo(function TranscriptParagraph({
  paragraph, wordOrder, isSelected, selectedWordId, rangeFirst, rangeLast, onSeek, onSelect, onEdit,
}:{
  paragraph:Paragraph; wordOrder:Map<string,number>; isSelected:boolean; selectedWordId:string|null;
  rangeFirst:number; rangeLast:number;
  onSeek:(seconds:number|null)=>void;
  onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void;
  onEdit:(wordId:string,text:string)=>void;
}){
  const inRange = (wordId:string)=>{ if(rangeFirst<0)return false; const index=wordOrder.get(wordId); return index!==undefined&&index>=rangeFirst&&index<=rangeLast; };
  return (
    <article className={`wp ${paragraph.elementType.toLowerCase()} ${isSelected?"selected":""}`}>
      <button type="button" className="wp-time" onClick={()=>onSeek(paragraph.start)} aria-label={`Play from ${clock(paragraph.start)}`}>{clock(paragraph.start)}</button>
      <span className="wp-label">{paragraph.label ?? (paragraph.unlabeledSpeaker ? `Speaker ${paragraph.deepgramSpeaker ?? "?"}` : "")}</span>
      <p className="wp-text">
        {paragraph.byLine && <em className="wp-byline">{paragraph.byLine} </em>}
        {paragraph.words.map((word,index)=>(
          <Fragment key={word.id}>
          {/* A real space, not a CSS margin. Each word is its own button so it can be
              selected and split at, and adjacent inline-block buttons touch with no gap
              -- the transcript rendered as "Goodafternoon.Weareontherecord." A margin
              would look right and still copy and read aloud without spaces. */}
          {index>0 && " "}
          {/* shiftKey rather than a separate control: the click event carries it for
              Enter and Space on a focused button too, so extending the selection works
              from the keyboard without a second affordance to find. */}
          {/* display, not text: the styled form is what the certified transcript shows --
              "April 24, 2026" for "04/24/2026". Editing below still seeds from word.text,
              because the reporter corrects the word the recording produced, not its
              styling; a correction typed over a display form would be a correction to
              something the evidence never contained. */}
          <button
            type="button"
            id={`w-${word.id}`}
            className={`wp-word ${word.flagged?"flagged":""} ${word.deleted?"struck":""} ${word.edited?"edited":""} ${word.authored?"authored":""} ${inRange(word.id)?"in-range":""} ${selectedWordId===word.id?"picked":""}`}
            aria-label={`${word.display ?? word.text}${word.flagged?", flagged for another listen":""}${word.deleted?", struck":""}${word.edited?", corrected":""}${inRange(word.id)?", in the selected range":""}. Select to edit or split here, or hold shift to extend the selection to here.`}
            onClick={event=>onSelect(paragraph.id,word.id,event.shiftKey)}
            onDoubleClick={()=>{ if(!word.authored) onEdit(word.id,word.text); }}
          >{word.display ?? word.text}</button>
          </Fragment>
        ))}
      </p>
    </article>
  );
});

type Operation = Record<string,unknown>;
type Bucket = { key:string; jobIdentity:string; deepgramSpeaker:number; words:number; sample:string };
type Audit = { uploadId:string; originalName:string; selectedSource:string };
type Job = { jobId:string; uploadId:string; startedAt?:string; status:"processing"|"completed"|"failed"; keyterms?:{ count:number }; failure?:{ message:string }; response?:{ deliveredAudio?:{ converted?:boolean } } };
type NameProposal = { wordId:string; proposedValue:string; confidenceScore:number; evidenceSource:string };
type SpeakerSuggestion = { sourceJobIdentity:string; deepgramSpeaker:number; speakerIdentity:string|null; missingParticipantName:string|null; transcriptRole:string|null; confidence:number; evidence:string };
// A range proposal and a bucket proposal are different claims, so they are different types. A
// SpeakerSuggestion says "cluster 3 is this person"; a RangeProposal says "these words are". The
// reporter is owed the difference, and a shared type would have hidden it.
type RangeProposal = { wordId:string; endWordId:string; speakerIdentity:string; correctionType:string; confidenceScore:number; evidenceSource:string; reviewStateHash:string; text:string; wordCount:number; startTime:number|null; endTime:number|null; deepgramSpeakers:number[]; currentSpeakerIdentity:string|null };
type CorrectionResult = { names:{ accepted:NameProposal[]; declined:unknown[]; failures:unknown[] }|null; speakers:{ proposals:SpeakerSuggestion[] }|null; ranges:{ accepted:RangeProposal[] }|null; errors:string[] };
export type WorkspaceDeposition = { id:string; audioFiles:string[]; audioIntakeIds?:string[]; keyterms?:string[]; courtReporterName?:string };

// Tool-language only. This never reaches the transcript renderer or its stored labels: it gives
// the reporter the familiar deposition designation while they decide who spoke.
const ROLE_FOR = (role:string) => ({
  COURT_REPORTER:"THE REPORTER",
  VIDEOGRAPHER:"THE VIDEOGRAPHER",
  INTERPRETER:"THE INTERPRETER",
  WITNESS:"THE WITNESS (A. during Q&A)",
}[role.toUpperCase()] ?? role.replaceAll("_"," ").toLowerCase());
function clock(seconds:number|null){ if(seconds===null||!Number.isFinite(seconds))return "--:--"; const total=Math.floor(seconds); return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`; }

export default function WorkspaceScreen({ deposition, audioIndex = 0, onBack }:{ deposition:WorkspaceDeposition; audioIndex?:number; onBack:()=>void }) {
  const depositionId = deposition.id;
  const [rendered,setRendered] = useState<Rendered|null>(null);
  const [printModel,setPrintModel] = useState<PrintModel|null>(null);
  // Set the moment a mutation succeeds, cleared only when the refreshed model lands. Every mutation
  // control is disabled while it is set, because the hash a second edit would carry is the hash of a
  // transcript that has already moved -- which the server refuses, correctly, as stale. Rapid
  // corrections were failing exactly that way during the boundary measurement, and the screen went
  // on looking ready. The authoritative state comes from the server; nothing here advances the hash
  // optimistically.
  const [awaitingRecord,setAwaitingRecord] = useState(false);
  const [documentState,setDocumentState] = useState<{state:string;reason:string;absentSections:string[]}|null>(null);
  const [candidates,setCandidates] = useState<Candidate[]>([]);
  const [roles,setRoles] = useState<string[]>([]);
  const [examiner,setExaminer] = useState<string>("");
  // Anchor and extent, not a point. wordId stays the anchor so every existing single-word
  // operation keeps addressing exactly what it addressed before; extentWordId is null until the
  // reporter extends. A range may cross paragraphs -- turn boundaries are the thing a correction
  // pass is meant to question, so a selection that could not span them would be useless for it.
  const [selected,setSelected] = useState<{ paragraphId:string; wordId:string; extentWordId:string|null }|null>(null);
  const [editing,setEditing] = useState<{ wordId:string; text:string }|null>(null);
  // Both facts the reporter states. Neither is preselected: a boundary names a person and a kind
  // of examination, and a default that prints a heading nobody chose is the §247 mistake in a new
  // place.
  const [examinationType,setExaminationType] = useState("");
  const [examinationExaminer,setExaminationExaminer] = useState("");
  const [error,setError] = useState("");
  const [errorCode,setErrorCode] = useState("");
  const [busy,setBusy] = useState(false);
  const [showSpeakers,setShowSpeakers] = useState(false);
  const [toolsCollapsed,setToolsCollapsed] = useState(false);
  const [lowConfidenceMode,setLowConfidenceMode] = useState(false);
  const [searchOpen,setSearchOpen]=useState(false),[replaceOpen,setReplaceOpen]=useState(false),[searchText,setSearchText]=useState(""),[replaceText,setReplaceText]=useState(""),[matchCase,setMatchCase]=useState(false),[wholeWords,setWholeWords]=useState(false),[excludedMatches,setExcludedMatches]=useState<Set<string>>(new Set()),[searchIndex,setSearchIndex]=useState(0);
  // Saving the map changed the transcript and said nothing. The only existing signal was the
  // toggle's own label flipping to "Speakers assigned" on status "reconciled" -- which never
  // fired here, because two source jobs left the map "partially_reconciled" however many
  // speakers were assigned. Two causes, one symptom: a button that looked dead.
  const [savedNote,setSavedNote] = useState("");
  // Transcription state, moved here from the Transcript screen. The Workspace is where a
  // deposition is worked, so it is where the transcript gets made -- and until one exists there
  // is nothing else for this screen to show.
  const [audits,setAudits] = useState<Audit[]>([]);
  const [jobs,setJobs] = useState<Job[]>([]);
  const [overrideReason,setOverrideReason] = useState("");
  const [transcribing,setTranscribing] = useState("");
  const [notice,setNotice] = useState("");
  const [assignments,setAssignments] = useState<Record<string,{ speakerIdentity:string; transcriptRole:string }>>({});
  const player = useRef<HTMLAudioElement|null>(null);
  const playbackEnd = useRef<number|null>(null);
  const [playbackTime,setPlaybackTime]=useState<number|null>(null);
  const [playbackError,setPlaybackError]=useState("");
  const [correctionOpen,setCorrectionOpen]=useState(false);
  const [correctionInstructions,setCorrectionInstructions]=useState("");
  const [correcting,setCorrecting]=useState(false);
  const [correctionResult,setCorrectionResult]=useState<CorrectionResult|null>(null);
  const [selectedCorrections,setSelectedCorrections]=useState<Set<string>>(new Set());

  // A token rather than a callback, so the effect owns the fetch and every setState happens
  // inside the promise rather than in the effect body -- which also gives the cancellation the
  // previous shape lacked: switching examiner mid-flight would otherwise let a stale response
  // overwrite a fresh one.
  const [reloadToken,setReloadToken] = useState(0);
  const reload = useCallback(()=>setReloadToken(token=>token+1),[]);
  // Two reload signals, because an overlay edit and a record edit invalidate different things.
  //
  // A correction used to refetch seven endpoints. Four of them cannot be affected by an overlay
  // operation at all -- the audio audit, the playback metadata, the transcription jobs, and the
  // speaker candidates, which getSpeakerCandidates derives from the canonical record and never from
  // the overlay. Measured at about 1.4 seconds of a 4 second correction cycle.
  //
  // reloadToken still means "everything moved" and is what the counsel, parties, proceeding,
  // honorific and speaker-map writers use. reloadTranscript means "the transcript moved", which is
  // all an overlay mutation can do.
  const [transcriptToken,setTranscriptToken] = useState(0);
  const reloadTranscript = useCallback(()=>setTranscriptToken(token=>token+1),[]);
  const [media,setMedia] = useState<{ needsProxy:boolean; proxy:{ alignment?:{ aligned:boolean; message:string } }|null; sourceMedia:{ codec:string } }|null>(null);
  const [building,setBuilding] = useState(false);
  const playbackSource = media
    ? (media.proxy ? `${API}/api/depositions/playback?id=${encodeURIComponent(depositionId)}&index=${audioIndex}`
      : media.needsProxy ? null : `${API}/api/depositions/audio?id=${encodeURIComponent(depositionId)}&index=${audioIndex}`)
    : null;
  async function buildProxy() {
    setBuilding(true); setError("");
    try {
      const response = await fetch(`${API}/api/depositions/playback`,{ method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ depositionId, index:audioIndex }) });
      const payload = await response.json();
      if(!response.ok) throw new Error(payload.error||"The playback copy could not be prepared.");
      reload();
    } catch(e){ setError(e instanceof Error?e.message:"The playback copy could not be prepared."); }
    finally { setBuilding(false); }
  }
  useEffect(()=>{
    let cancelled = false;
    void (async ()=>{
      try {
        const [renderRes,printOutcome] = await Promise.all([
          fetch(`${API}/api/transcript/rendered?depositionId=${encodeURIComponent(depositionId)}${examiner?`&examinerIdentity=${encodeURIComponent(examiner)}`:""}`),
          // The fallback stays -- a reporter with no assembly authority still needs to see and
          // work the testimony -- but the reason the complete model refused no longer goes in
          // the bin. It was the only thing that could tell the reporter what to do about it,
          // and discarding it is what made the degrade silent.
          fetch(`${API}/api/transcript/complete-document-model?depositionId=${encodeURIComponent(depositionId)}${examiner?`&examinerIdentity=${encodeURIComponent(examiner)}`:""}`,{cache:"no-store"}).then(async response=>{
            if(response.ok) return { response, blockedReason:"" };
            const blockedReason = await response.json().then(payload=>String(payload?.error||"")).catch(()=>"");
            return { response: await fetch(`${API}/api/transcript/print-model?depositionId=${encodeURIComponent(depositionId)}${examiner?`&examinerIdentity=${encodeURIComponent(examiner)}`:""}`,{cache:"no-store"}), blockedReason };
          }),
        ]);
        const body = await renderRes.json();
        if(cancelled) return;
        if(!renderRes.ok){ setErrorCode(String(body.code||"")); throw new Error(body.error||"Could not load the transcript."); }
        setRendered(body);
        // Status comes from the record type the server actually served, never from what this
        // screen asked for. The request and the answer are different moments; deriving from the
        // request is how a stale flag says "complete" about a body-only document.
        const printRes=printOutcome.response;
        const servedModel=printRes.ok?await printRes.json():null;
        setPrintModel(servedModel);
      setAwaitingRecord(false);
        setDocumentState(deriveDocumentStatus({ servedRecordType:servedModel?.recordType??null, blockedReason:printOutcome.blockedReason }));
        if(!cancelled){ setError(""); setErrorCode(""); }
      } catch(e){ if(!cancelled) setError(e instanceof Error?e.message:"Could not load the transcript."); }
    })();
    return ()=>{ cancelled = true; };
  },[depositionId,examiner,reloadToken,transcriptToken]);

  // The participant roster and the media. Neither can be changed by an overlay operation --
  // getSpeakerCandidates derives candidates from the canonical record and never reads the overlay --
  // so this deliberately does NOT depend on transcriptToken. It reloads when the RECORD moves, which
  // is what the counsel, parties, proceeding and participant writers signal.
  useEffect(()=>{
    let cancelled=false;
    void (async ()=>{
      const [candidateRes,mediaRes]=await Promise.all([
        fetch(`${API}/api/transcript/speaker-candidates?depositionId=${encodeURIComponent(depositionId)}`),
        fetch(`${API}/api/depositions/playback?id=${encodeURIComponent(depositionId)}&index=${audioIndex}&meta=1`),
      ]);
      if(cancelled) return;
      if(mediaRes.ok) setMedia(await mediaRes.json());
      if(candidateRes.ok){ const data=await candidateRes.json(); if(!cancelled){ setCandidates(data.candidates||[]); setRoles(data.roles||[]); } }
    })();
    return ()=>{ cancelled=true; };
  },[depositionId,audioIndex,reloadToken]);

  // Audio and job state load independently of the transcript. When there is no transcript the
  // render effect above fails by design, and this is the only thing left to show -- so it must
  // not share that failure.
  useEffect(()=>{
    let cancelled=false;
    void (async ()=>{
      const uploads=deposition.audioIntakeIds||[];
      const [auditValues,jobResult]=await Promise.all([
        Promise.all(uploads.map(async uploadId=>{
          try{ const response=await fetch(`${API}/api/audio/audit?uploadId=${encodeURIComponent(uploadId)}`); return response.ok?await response.json():null; }
          catch{ return null; }
        })),
        (async()=>{ try{ const response=await fetch(`${API}/api/transcription/jobs?depositionId=${encodeURIComponent(depositionId)}`); return response.ok?await response.json():{ jobs:[] }; }catch{ return { jobs:[] }; } })(),
      ]);
      if(cancelled) return;
      setAudits(auditValues.filter(Boolean) as Audit[]);
      setJobs(jobResult.jobs||[]);
    })();
    return ()=>{ cancelled=true; };
  },[depositionId,deposition.audioIntakeIds,reloadToken]);

  const uploads = useMemo(()=>deposition.audioIntakeIds ?? [],[deposition.audioIntakeIds]);
  // Keyed on the server's own code for this one condition, not on a proxy for it. The first
  // version suppressed whenever audio was present and no job had completed, which also swallowed
  // a genuine read failure on an existing transcript -- the reporter would have seen a clean
  // transcribe control and no sign that a stored transcript could not be read. Anything other
  // than WORKING_TRANSCRIPT_NOT_CREATED now surfaces.
  const notTranscribedYet = errorCode === "WORKING_TRANSCRIPT_NOT_CREATED";
  const auditByUpload = useMemo(()=>new Map(audits.map(audit=>[audit.uploadId,audit])),[audits]);

  const jobByUpload = useMemo(()=>{
    // Newest job wins, chosen by startedAt rather than by position. Building this with new Map()
    // over the list keeps whichever entry comes last, which made the Transcript screen show a
    // superseded job beside a current transcript. Reversing the list fixes that only while the
    // server keeps sorting newest-first -- an invisible contract that would fail silently and in
    // the same direction if that sort ever changed. Comparing the timestamp depends on nothing.
    const found=new Map<string,Job>();
    for(const job of jobs){
      const held=found.get(job.uploadId);
      if(!held || String(job.startedAt ?? "") > String(held.startedAt ?? "")) found.set(job.uploadId,job);
    }
    return found;
  },[jobs]);

  async function createTranscript(uploadId:string) {
    setTranscribing(uploadId); setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/api/audio/transcribe`,{ method:"POST", headers:{ "content-type":"application/json" },
        body:JSON.stringify({ depositionId, uploadId, keytermOverrideReason:overrideReason }) });
      const body = await response.json();
      if(!response.ok) throw new Error(body.error||"Deepgram transcription failed.");
      setNotice(body.cached ? "Loaded the preserved, integrity-verified transcription. No Deepgram request was made."
        : "Deepgram evidence was preserved and the transcript was updated.");
      reload();
    } catch(e){ setError(e instanceof Error?e.message:"Deepgram transcription failed."); }
    finally { setTranscribing(""); }
  }

  // Deepgram speaker buckets with their word counts. The counts are what make the roles obvious:
  // in the observed run two buckets held ~5,900 words each (examiner and witness) while three
  // held a few hundred or fewer (videographer, reporter, defending counsel).
  // Keyed by job AND speaker number, not by speaker number alone. Deepgram numbers speakers per
  // request, so a deposition recorded in several volumes has an unrelated speaker 0 in each, and
  // collapsing them merged three people into one row that assigned one identity to all of them.
  // The key matches the one reconcileSpeakerMap validates against server-side.
  const buckets = useMemo(()=>speakerBuckets(rendered?.paragraphs ?? []) as Bucket[],[rendered]);

  // scope says what the write can have invalidated. "transcript" refetches the rendered transcript
  // and the document model; "record" refetches everything, including the participant roster.
  async function post(path:string, payload:Record<string,unknown>, scope:"record"|"transcript"="record") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}${path}`,{ method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(payload) });
      const body = await response.json();
      if(!response.ok) throw new Error(body.error||"The edit could not be saved.");
      setAwaitingRecord(true);
      if(scope==="transcript") reloadTranscript(); else reload();
      return true;
    } catch(e){ setError(e instanceof Error?e.message:"The edit could not be saved."); return false; }
    finally { setBusy(false); }
  }
  // The notice is built from result.documentKind -- the server's report of what it actually
  // rendered -- not from the record type this screen happened to be holding. Those can disagree,
  // and when they do the server is right. "Word proof generated from the shared pages" is gone:
  // it was true of a certified transcript and of a bare testimony body alike, which is exactly
  // what made it useless to the person deciding whether to send the file.
  async function generateDocx(){setBusy(true);setError("");try{const endpoint=documentState?.state===DOCUMENT_STATUS.READY?"/api/transcript/complete-document-docx":"/api/transcript/final-document-docx";const response=await fetch(`${API}${endpoint}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({depositionId,examinerIdentity:examiner||null})}),result=await response.json();if(!response.ok)throw new Error(result.error||"The Word document could not be generated.");setNotice(generationNotice({producedKind:result.documentKind,outputPath:result.outputPath}))}catch(reason){setError(reason instanceof Error?reason.message:"The Word document could not be generated.")}finally{setBusy(false)}}
  async function generatePdf(){setBusy(true);setError("");try{const response=await fetch(`${API}/api/transcript/complete-document-pdf`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({depositionId,examinerIdentity:examiner||null})}),result=await response.json();if(!response.ok)throw new Error(result.error||"The PDF could not be generated.");const download=await fetch(`${API}${result.downloadUrl}`);if(!download.ok)throw new Error("The PDF was generated but could not be downloaded.");const objectUrl=URL.createObjectURL(await download.blob()),link=document.createElement("a");link.href=objectUrl;link.download="complete-transcript.pdf";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(objectUrl);setNotice(`Searchable complete transcript PDF generated: ${result.outputPath}`)}catch(reason){setError(reason instanceof Error?reason.message:"The PDF could not be generated.")}finally{setBusy(false)}}
  // Every overlay mutation is built in one place, where a missing review-state hash throws instead
  // of producing a request the server is certain to refuse. This helper used to send no hash at all,
  // so six reporter actions -- label and speaker correction, split-with-speaker, marking for another
  // listen, clearing a mark, correcting a word, striking a word -- failed every time while the
  // buttons looked available.
  const append = (operations:Operation[]) =>
    post("/api/transcript/overlay", overlayMutationRequest({ depositionId, operations, reviewStateHash:printModel?.source.reviewStateHash }), "transcript");
  const saveParagraph = useCallback(async (paragraphId:string,before:string,after:string,caret:number) => {
    const paragraph=rendered?.paragraphs.find(item=>item.id===paragraphId);
    if(!paragraph||!printModel){setError("The paragraph is no longer current. Reload it before saving.");return false}
    if(paragraph.text!==before){setError("The transcript changed while this paragraph was open. Its draft was not saved.");return false}
    let operations:Operation[];
    try{operations=paragraphEditTransaction(paragraph,after) as Operation[]}catch(reason){setError(reason instanceof Error?reason.message:"This paragraph edit is outside the Phase 5 boundary.");return false}
    if(!operations.length)return true;
    setBusy(true);setError("");
    try{
      const response=await fetch(`${API}/api/transcript/overlay`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(overlayMutationRequest({depositionId,operations,reviewStateHash:printModel.source.reviewStateHash}))});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"The paragraph edit could not be saved.");
        setAwaitingRecord(true);
      setSelected(previous=>previous?.paragraphId===paragraphId?previous:{paragraphId,wordId:paragraph.words[0]?.id??previous?.wordId??"",extentWordId:null});
      reloadTranscript();
      requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-token-id="${paragraph.words[0]?.id}"]`)?.scrollIntoView({block:"center"}));
      void caret;
      return true;
    }catch(reason){setError(reason instanceof Error?reason.message:"The paragraph edit could not be saved.");return false}
    finally{setBusy(false)}
  },[depositionId,printModel,reloadTranscript,rendered]);

  // useCallback with no dependencies, because every one of these is passed to a memoized paragraph.
  // A callback rebuilt each render would give all 306 paragraphs a new prop and defeat the memo
  // entirely -- the component would still be "memoized" and still re-render everything.
  // Refused rather than guessed. The player is hardcoded to audio index 0, which is only correct
  // while a deposition has exactly one transcribed recording; renderTranscript raises
  // MULTI_VOLUME_UNSUPPORTED when it does not. Seeking anyway would play confident, wrong audio
  // against the right text -- the failure a reporter is least able to catch by reading.
  const multiVolume = useMemo(()=>(rendered?.findings ?? []).some(finding=>finding.code==="MULTI_VOLUME_UNSUPPORTED"),[rendered]);
  const playAt = useCallback(async(seconds:number|null)=>{
    if(seconds===null||multiVolume){setPlaybackError(multiVolume?"Playback by transcript timestamp is unavailable for a multi-volume transcript.":"This transcript position has no audio timestamp.");return}
    const audio=player.current;if(!audio||!playbackSource){setPlaybackError("No playable audio source is available. Prepare the playback copy if offered.");return}
    setPlaybackError("");
    try{audio.currentTime=Math.max(0,seconds);await audio.play()}catch(reason){setPlaybackError(reason instanceof Error?`Audio could not play: ${reason.message}`:"Audio could not play. Check the preserved source or prepare a playback copy.")}
  },[multiVolume,playbackSource]);
  // Keep the refusal at this public seek boundary as well as inside playAt. Besides documenting
  // the invariant where timestamp clicks enter, this prevents a future playAt refactor from
  // silently enabling index-zero audio against a multi-volume transcript.
  const seek = useCallback((seconds:number|null)=>{if(multiVolume){setPlaybackError("Playback by transcript timestamp is unavailable for a multi-volume transcript.");return}void playAt(seconds)},[multiVolume,playAt]);
  const playParagraph = useCallback((paragraph:Paragraph|null)=>{if(!paragraph)return;playbackEnd.current=null;void playAt(paragraph.start===null?null:Math.max(0,paragraph.start-.5))},[playAt]);
  // The functional form of setSelected is what keeps this stable: reading `selected` directly would
  // make the callback depend on the selection, which changes on exactly the interaction this is
  // meant to make cheap.
  const selectWord = useCallback((paragraphId:string,wordId:string,shiftKey:boolean)=>{
    setSelected(previous=>shiftKey&&previous?{...previous,extentWordId:wordId}:{paragraphId,wordId,extentWordId:null});
    setEditing(null);
  },[]);
  const selectPageFragment = useCallback((paragraphId:string,wordId:string,shiftKey:boolean)=>selectWord(paragraphId,wordId,shiftKey),[selectWord]);
  const editWord = useCallback((wordId:string,text:string)=>setEditing({wordId,text}),[]);

  // The reporter's core move: pick the word a new paragraph should start at, then choose what
  // that paragraph is. Splitting at the first word would produce an empty half, so the label is
  // applied to the paragraph itself in that case rather than creating one.
  // Both operations address a word, never a segment. A rendered paragraph can span several
  // segments and the client cannot tell which one holds a given word; addressing by word lets
  // the server resolve it, and after a split the segment holding the anchor is the new tail.
  //
  // Two things one control does, chosen by WHERE the reporter clicked. Select the word a paragraph
  // already begins at and this relabels that paragraph. Select any later word and it starts a new
  // paragraph there, belonging to the speaker chosen -- which is what the hint beside these buttons
  // has always promised and what the buttons did not do.
  //
  // The second case is the Etminan repair. Deepgram ran two turns together across most of the
  // deposition, so roughly 224 boundaries are missing; before the overlay could carry a speaker on a
  // split, each one cost a split and then a label addressed at a derived id the caller had to
  // rebuild. One click, one operation, one undo.
  function relabel(paragraph:Paragraph, speakerIdentity:string|null, transcriptRole:string|null) {
    // Scope is what the reporter CHOSE, not where they happened to click. Passing the selected word
    // unconditionally is what turned "this paragraph is the witness" into "cut counsel's question in
    // half and give the second half away" on the real record.
    const cutAt = speakerScope === "here" ? (selected?.wordId ?? null) : null;
    const startsHere = splitWithSpeakerOperation({ paragraph, selectedWordId:cutAt, speakerIdentity, transcriptRole });
    if (startsHere) { setSelected(null); void append([startsHere]); return; }
    const anchor = paragraph.words.find(word=>!word.authored)?.id;
    if(!anchor) return;
    setSelected(null);
    void append([{ op:"label", wordId:anchor, speakerIdentity, transcriptRole }]);
  }

  const structuralTransaction=useCallback(async(operations:Operation[])=>{
    if(!printModel)return false;
    setBusy(true);setError("");
    try{
      const response=await fetch(`${API}/api/transcript/overlay`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(overlayMutationRequest({depositionId,operations,reviewStateHash:printModel.source.reviewStateHash}))});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"The structural edit could not be saved.");setAwaitingRecord(true);reloadTranscript();return true;
    }catch(reason){setError(reason instanceof Error?reason.message:"The structural edit could not be saved.");return false}finally{setBusy(false)}
  },[depositionId,printModel,reloadTranscript]);
  const joinParagraph=useCallback(async(paragraphId:string,direction:"previous"|"next")=>{
    const paragraphs=rendered?.paragraphs??[],index=paragraphs.findIndex(item=>item.id===paragraphId);
    const left=direction==="previous"?paragraphs[index-1]:paragraphs[index],right=direction==="previous"?paragraphs[index]:paragraphs[index+1];
    const leadingWordId=left?.asrWordIds.at(-1),trailingWordId=right?.asrWordIds[0],leadingFirstWordId=left?.asrWordIds[0],trailingLastWordId=right?.asrWordIds.at(-1);
    if(!leadingWordId||!trailingWordId){setError("These paragraphs do not share a safely traceable evidence boundary.");return false}
    return structuralTransaction([{op:"join",leadingWordId,trailingWordId,leadingFirstWordId,trailingLastWordId}]);
  },[rendered,structuralTransaction]);
  // Editing no longer hides the tools, and the browser gate is why the old behaviour had to go.
  //
  // It collapsed the panel the moment an edit opened, which made sense while the editor was a
  // floating box that needed the room. The editor now sits in the paragraph's own lines and the
  // panel is sticky, so collapsing it took away the speaker and structure controls at exactly the
  // moment the reporter had chosen the paragraph to use them on.
  //
  // Pausing playback stays: typing over audio that keeps running is its own problem.
  const editingChange=useCallback((value:boolean)=>{if(value)player.current?.pause()},[]);
  const activePlaybackWordId=useMemo(()=>{if(playbackTime===null)return null;for(const paragraph of rendered?.paragraphs??[])for(const word of paragraph.words)if(word.start!==null&&word.end!==null&&playbackTime>=word.start&&playbackTime<word.end)return word.id;return null},[rendered,playbackTime]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{const target=event.target as HTMLElement|null;if(event.code!=="Space"||target?.matches("input,textarea,select,[contenteditable=true]"))return;if(!player.current||!playbackSource)return;event.preventDefault();if(player.current.paused)void player.current.play().catch(()=>{});else player.current.pause()};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[playbackSource]);

  const active = rendered?.paragraphs.find(paragraph => paragraph.id===selected?.paragraphId) ?? null;
  // Stable identities so the transcript pages below can be held back. Both read through a ref rather
  // than listing their function as a dependency: those functions are rebuilt every render, so a
  // dependency would hand every page a new handler again and defeat the comparator.
  const playParagraphRef=useRef(playParagraph),playAtRef=useRef(playAt);
  useEffect(()=>{playParagraphRef.current=playParagraph;playAtRef.current=playAt});
  const playParagraphById = useCallback((id:string)=>playParagraphRef.current(rendered?.paragraphs.find(item=>item.id===id)??null),[rendered]);
  const playAtSeconds = useCallback((seconds:number)=>{void playAtRef.current(seconds)},[]);
  // Who the reporter may say spoke, built from this deposition's record. speakerChoices above still
  // serves split-with-speaker; this is the panel's own list and it includes procedural roles nobody
  // on the roster holds -- the videographer Trial #1 could name a role for and never a person.
  const speakerList = useMemo(()=>speakerActions({ candidates, labels:rendered?.labels ?? {}, examinerIdentity:examiner || null }),[candidates,examiner,rendered]);
  const [showDetails,setShowDetails] = useState(false);
  const [showSetup,setShowSetup] = useState(false);
  // Always the safe reading after a selection moves. A destructive scope that persisted across
  // clicks would be the same defect wearing a different hat.
  //
  // Derived from the selection rather than reset by an effect: the choice is remembered against the
  // selection it was made for, so moving the selection returns to "this whole paragraph" without
  // anything having to fire.
  const [scopeChoice,setScopeChoice] = useState<{ key:string; scope:"paragraph"|"here" }|null>(null);
  const selectionKey = `${selected?.paragraphId ?? ""}:${selected?.wordId ?? ""}`;
  const speakerScope = scopeChoice?.key === selectionKey ? scopeChoice.scope : "paragraph";
  const setSpeakerScope = (scope:"paragraph"|"here") => setScopeChoice({ key:selectionKey, scope });
  const scopeChoices = useMemo(()=>speakerScopeChoices({ paragraph:active, selectedWordId:selected?.wordId ?? null }),[active,selected]);
  // What the paragraph prints as now, and how big the other scope would be. Both read from the
  // record rather than being spelled here.
  const currentSpeaker = useMemo(()=>currentSpeakerDescription({ paragraph:active, labels:rendered?.labels ?? {} }),[active,rendered]);
  const globalScope = useMemo(()=>globalScopeOption({ paragraph:active, paragraphs:rendered?.paragraphs ?? [] }),[active,rendered]);
  const selectedSummary = useMemo(()=>selectedParagraphSummary({ paragraph:active, pages:printModel?.pages??[], labels:rendered?.labels??{}, saveState:(busy||awaitingRecord)?"saving":"saved" }),[active,printModel,rendered,busy,awaitingRecord]);
  // What the examination button will record, so it can be checked against the screen before it is
  // pressed. A control reading "Record" leaves the reporter to remember which two lists they set.
  const examinationSummaryText = useMemo(()=>examinationSummary({ type:examinationType, examinerPersonId:examinationExaminer, labels:rendered?.labels ?? {}, candidates }),[examinationType,examinationExaminer,rendered,candidates]);
  const [reviewKey,setReviewKey] = useState("");
  // Speaker findings from a pass run earlier, so the worklist survives closing the screen. Loaded
  // ONLY when the pass was generated against the transcript as it stands now: a proposal made
  // against a transcript that has since moved points at words that have moved with it, and putting
  // it in a worklist would send the reporter somewhere the finding no longer applies.
  const [storedRanges,setStoredRanges] = useState<RangeProposal[]>([]);
  const [reviewIndex,setReviewIndex] = useState(-1);
  const currentReviewStateHash = printModel?.source.reviewStateHash ?? null;
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      if(!currentReviewStateHash){if(!cancelled)setStoredRanges([]);return}
      try{
        const list=await fetch(`${API}/api/correction/passes?depositionId=${encodeURIComponent(depositionId)}`).then(response=>response.json()) as { passes?:Array<{ passId:string; passType:string }> };
        const latest=(list.passes??[]).find(item=>item.passType==="speaker-range");
        if(!latest){if(!cancelled)setStoredRanges([]);return}
        const record=await fetch(`${API}/api/correction/pass?depositionId=${encodeURIComponent(depositionId)}&passId=${encodeURIComponent(latest.passId)}`).then(response=>response.json()) as { reviewStateHash?:string; accepted?:RangeProposal[] };
        if(cancelled)return;
        setStoredRanges(record.reviewStateHash===currentReviewStateHash?(record.accepted??[]):[]);
      }catch{ if(!cancelled)setStoredRanges([]) }
    })();
    return()=>{cancelled=true};
  },[depositionId,currentReviewStateHash]);
  // Where the selected paragraph sits, so the two join controls can refuse at the ends of the
  // transcript rather than calling joinParagraph and letting it fail. The first paragraph has
  // nothing above it and the last has nothing below.
  const activeIndex = active ? (rendered?.paragraphs ?? []).findIndex(paragraph => paragraph.id===active.id) : -1;
  const speakerMapStatus = rendered?.speakerMap?.status ?? "unreconciled";
  // A transcript with paragraphs and no speaker map renders entirely as colloquy. That is
  // correct -- Q. and A. require knowing who is examining, and nothing should infer it from the
  // presence of a roster -- but on screen it is indistinguishable from labelling being broken.
  // Saying so is the difference between working-as-designed and apparently-failing.
  const awaitingSpeakerMap = Boolean(rendered?.counts.paragraphs) && speakerMapStatus === "unreconciled";
  const unassignedSpeakers = useMemo(()=>(rendered?.paragraphs ?? []).filter(paragraph=>paragraph.unlabeledSpeaker).length,[rendered]);
  const unresolvedHonorifics=useMemo(()=>(rendered?.findings??[]).filter(finding=>finding.code==="HONORIFIC_MISSING"),[rendered]);
  async function resolveHonorific(participantId:string,honorific:string|null){await post("/api/deposition/honorific",{depositionId,participantId,honorific})}
  // The panel held only the reporter's unsaved changes and never the saved map, so every select
  // read "Unassigned" against a fully reconciled transcript -- and "Save speaker map" then sent
  // an empty array and un-reconciled it. A destructive click that looked idempotent. Local state
  // stays an overlay of changes; the displayed and submitted value is the change when there is
  // one and the saved assignment otherwise. Matched on job as well as speaker index, because the
  // map is keyed by both and a bucket already knows which job it came from.
  const savedAssignment = useCallback((bucket:Bucket) =>
    rendered?.speakerMap?.assignments.find(item => item.deepgramSpeaker===bucket.deepgramSpeaker && item.sourceJobIdentity===bucket.jobIdentity) ?? null,
  [rendered]);
  const effectiveAssignment = useCallback((bucket:Bucket) => {
    const saved = savedAssignment(bucket), local = assignments[bucket.key];
    // ?? not ||: choosing "Unassigned" stores "", which must override the saved value rather
    // than falling through to it, or the reporter could never clear an assignment.
    return { speakerIdentity: local?.speakerIdentity ?? saved?.speakerIdentity ?? "", transcriptRole: local?.transcriptRole ?? saved?.transcriptRole ?? "" };
  },[assignments,savedAssignment]);
  const speakerOptions = useMemo(()=>buckets.map(bucket=>({key:bucket.key,label:`Speaker ${bucket.deepgramSpeaker}${buckets.some(other=>other.deepgramSpeaker===bucket.deepgramSpeaker&&other.key!==bucket.key)?` · job ${bucket.jobIdentity.slice(0,8)}`:""} · ${bucket.words} words`})),[buckets]);
  const speakerAssignmentForCounsel = useCallback((counselId:string)=>buckets.find(bucket=>effectiveAssignment(bucket).speakerIdentity===counselId)?.key??"",[buckets,effectiveAssignment]);
  const assignCounselSpeaker = useCallback((counselId:string,bucketKey:string,transcriptRole:string)=>{
    setSavedNote("");
    setAssignments(current=>{
      const next={...current};
      for(const bucket of buckets){
        const saved=savedAssignment(bucket),local=current[bucket.key];
        const effective={speakerIdentity:local?.speakerIdentity??saved?.speakerIdentity??"",transcriptRole:local?.transcriptRole??saved?.transcriptRole??""};
        if(effective.speakerIdentity===counselId)next[bucket.key]={speakerIdentity:"",transcriptRole:""};
      }
      if(bucketKey)next[bucketKey]={speakerIdentity:counselId,transcriptRole};
      return next;
    });
  },[buckets,savedAssignment]);

  async function correctTranscript(){
    setCorrecting(true);setCorrectionResult(null);setSelectedCorrections(new Set());setRangeApplied(false);setError("");
    const request=(path:string)=>fetch(`${API}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({depositionId,additionalInstructions:correctionInstructions})}).then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error||"The AI correction check failed.");return payload});
    const [names,speakers,ranges]=await Promise.allSettled([request("/api/correction/entity-pass"),request("/api/transcript/speaker-suggestions"),request("/api/correction/speaker-range-pass")]);
    const errors:string[]=[];
    if(names.status==="rejected")errors.push(`Names: ${names.reason instanceof Error?names.reason.message:String(names.reason)}`);
    if(speakers.status==="rejected")errors.push(`Speakers: ${speakers.reason instanceof Error?speakers.reason.message:String(speakers.reason)}`);
    if(ranges.status==="rejected")errors.push(`Speaker ranges: ${ranges.reason instanceof Error?ranges.reason.message:String(ranges.reason)}`);
    const result:CorrectionResult={names:names.status==="fulfilled"?names.value:null,speakers:speakers.status==="fulfilled"?speakers.value:null,ranges:ranges.status==="fulfilled"?ranges.value:null,errors};
    setCorrectionResult(result);setSelectedCorrections(new Set(result.names?.accepted.map(item=>item.wordId)??[]));setCorrecting(false);
  }
  function proposalOriginal(proposal:NameProposal){for(const paragraph of rendered?.paragraphs??[]){const word=paragraph.words.find(item=>item.id===proposal.wordId);if(word)return word.text}return "(word unavailable)"}
  async function applySelectedCorrections(){
    const proposals=(correctionResult?.names?.accepted??[]).filter(item=>selectedCorrections.has(item.wordId));
    if(!proposals.length)return;
    if(await structuralTransaction(proposals.map(item=>({op:"replace",wordId:item.wordId,text:item.proposedValue})))){
      setCorrectionResult(current=>current?{...current,names:current.names?{...current.names,accepted:current.names.accepted.filter(item=>!selectedCorrections.has(item.wordId))}:null}:null);
      setSelectedCorrections(new Set());
    }
  }
  // Accepting sends WHICH proposal, and nothing else. No operations are built here: the server
  // plans them against the projection the proposal was analyzed against, and applies the whole plan
  // as one transaction. A client that worked out its own operations would be deciding how the
  // record is written from the side of the wire that cannot check the transcript has not moved.
  const [acceptingRange,setAcceptingRange]=useState("");
  const [rangeApplied,setRangeApplied]=useState(false);
  const rangeKey=(proposal:RangeProposal)=>rangeProposalKey(proposal);
  function dropRange(proposal:RangeProposal){
    setCorrectionResult(current=>current?{...current,ranges:current.ranges?{...current.ranges,accepted:remainingAfterRejection(current.ranges.accepted,proposal)}:null}:null);
  }
  async function acceptRange(proposal:RangeProposal){
    if(!printModel)return;
    setAcceptingRange(rangeKey(proposal));setError("");
    try{
      const response=await fetch(`${API}/api/transcript/range-proposal/accept`,{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify(rangeAcceptanceRequest({depositionId,proposal,reviewStateHash:printModel.source.reviewStateHash}))});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"This speaker proposal could not be applied.");
      // Every remaining proposal was generated against the state this acceptance just changed, so
      // they are all stale now. Clearing them is honest; leaving them offers a button that refuses.
      setRangeApplied(true);
      setCorrectionResult(current=>current?{...current,ranges:{accepted:remainingAfterAcceptance()}}:null);
      setAwaitingRecord(true);reloadTranscript();
    }catch(reason){setError(reason instanceof Error?reason.message:"This speaker proposal could not be applied.")}
    finally{setAcceptingRange("")}
  }
  function acceptSpeakerSuggestion(suggestion:SpeakerSuggestion){
    const key=`${suggestion.sourceJobIdentity}:${suggestion.deepgramSpeaker}`;
    if(!suggestion.speakerIdentity)return;
    setSavedNote("");setShowSpeakers(true);
    setAssignments(current=>({...current,[key]:{speakerIdentity:suggestion.speakerIdentity!,transcriptRole:suggestion.transcriptRole??candidates.find(item=>item.id===suggestion.speakerIdentity)?.defaultRole??""}}));
  }

  // Transcript order across every paragraph, so a range can be resolved without caring which
  // paragraph either end lives in. Rebuilt only when the render changes.
  const wordOrder = useMemo(()=>{
    const order = new Map<string,number>();
    let index = 0;
    for(const paragraph of rendered?.paragraphs ?? []) for(const word of paragraph.words) order.set(word.id,index++);
    return order;
  },[rendered]);
  // Null unless the extent is a different word that still exists in the current render: an
  // extent left over from a paragraph that an edit removed collapses back to a point selection
  // rather than highlighting an arbitrary span.
  const range = useMemo(()=>{
    if(!selected?.extentWordId || selected.extentWordId===selected.wordId) return null;
    const from = wordOrder.get(selected.wordId), to = wordOrder.get(selected.extentWordId);
    if(from===undefined || to===undefined) return null;
    return { first:Math.min(from,to), last:Math.max(from,to) };
  },[selected,wordOrder]);
  const rangeWords = range ? range.last-range.first+1 : 0;
  const paragraphDeleteOperations = useMemo(()=>deleteSelectedParagraphOperations({ paragraphs:rendered?.paragraphs??[], selectedParagraphId:selected?.paragraphId??null, wordIndexes:wordOrder, range }),[rendered,selected,wordOrder,range]);
  const paragraphDeleteCount = useMemo(()=>new Set(paragraphDeleteOperations.map(operation=>{
    for(const paragraph of rendered?.paragraphs??[]) if(paragraph.words.some(word=>word.id===operation.wordId)) return paragraph.id;
    return null;
  }).filter(Boolean)).size,[paragraphDeleteOperations,rendered]);
  function deleteSelectedParagraphs(){
    if(!paragraphDeleteOperations.length)return;
    const label=paragraphDeleteCount===1?"this paragraph":`these ${paragraphDeleteCount} paragraphs`;
    if(!window.confirm(`Delete ${label} from the transcript? The original audio, source words, and timestamps remain preserved. One Undo restores the entire action.`))return;
    setSelected(null);void append(paragraphDeleteOperations);
  }

  // Every flagged word in transcript order, and the passage each belongs to. The scopist works
  // through places rather than words, so the walker steps to the next passage, not the next word.
  const flaggedWords = useMemo(()=>{
    const list:{ id:string; from:string }[] = [];
    for(const paragraph of rendered?.paragraphs ?? []) for(const word of paragraph.words) if(word.flagged&&word.flaggedFrom) list.push({ id:word.id, from:word.flaggedFrom });
    return list;
  },[rendered]);
  const selectedWord = useMemo(()=>{
    if(!selected) return null;
    for(const paragraph of rendered?.paragraphs ?? []) for(const word of paragraph.words) if(word.id===selected.wordId) return word;
    return null;
  },[rendered,selected]);
  const lowConfidenceWords=useMemo(()=>(rendered?.paragraphs??[]).flatMap(paragraph=>paragraph.words.filter(word=>word.lowConfidence).map(word=>({paragraphId:paragraph.id,wordId:word.id}))),[rendered]);
  // Rebuilt inline on every render before this, including the empty branch -- `new Set()` is a new
  // reference each time, which alone was enough to defeat memo on all 63 transcript pages.
  const lowConfidenceWordIdSet = useMemo(
    ()=>lowConfidenceMode?new Set(lowConfidenceWords.map(item=>item.wordId)):EMPTY_WORD_IDS,
    [lowConfidenceMode,lowConfidenceWords]);
  const searchMatches=useMemo(()=>{
    if(!searchText)return[];
    const escaped=searchText.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),pattern=wholeWords?`\\b${escaped}\\b`:escaped,flags=matchCase?"g":"gi",matches:{id:string;paragraphId:string;start:number;end:number;context:string}[]=[];
    for(const paragraph of rendered?.paragraphs??[]){const regex=new RegExp(pattern,flags);for(const found of paragraph.text.matchAll(regex)){const start=found.index??0;matches.push({id:`${paragraph.id}:${start}`,paragraphId:paragraph.id,start,end:start+found[0].length,context:paragraph.text.slice(Math.max(0,start-35),Math.min(paragraph.text.length,start+found[0].length+35))})}}
    return matches;
  },[rendered,searchText,matchCase,wholeWords]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(!(event.ctrlKey||event.metaKey))return;if(event.key.toLowerCase()==="f"){event.preventDefault();setSearchOpen(true);setReplaceOpen(false);setToolsCollapsed(false)}if(event.key.toLowerCase()==="h"){event.preventDefault();setSearchOpen(true);setReplaceOpen(true);setToolsCollapsed(false)}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[]);
  function navigateMatch(index:number){if(!searchMatches.length)return;const bounded=(index+searchMatches.length)%searchMatches.length,match=searchMatches[bounded],paragraph=rendered?.paragraphs.find(item=>item.id===match.paragraphId),word=paragraph&&wordCharacterRanges(paragraph).find(range=>range.end>match.start)?.word;if(!word)return;setSearchIndex(bounded);setSelected({paragraphId:paragraph.id,wordId:word.id,extentWordId:null});document.querySelector<HTMLElement>(`[data-token-id="${word.id}"]`)?.scrollIntoView({block:"center",behavior:"smooth"})}
  async function replaceMatches(matches:typeof searchMatches){const byParagraph=new Map<string,typeof searchMatches>();for(const match of matches){const list=byParagraph.get(match.paragraphId)??[];list.push(match);byParagraph.set(match.paragraphId,list)}const operations:Operation[]=[];for(const [paragraphId,list] of byParagraph){const paragraph=rendered?.paragraphs.find(item=>item.id===paragraphId);if(!paragraph)continue;let value=paragraph.text;for(const match of [...list].sort((a,b)=>b.start-a.start))value=`${value.slice(0,match.start)}${replaceText}${value.slice(match.end)}`;operations.push(...paragraphEditTransaction(paragraph,value) as Operation[])}if(operations.length)await structuralTransaction(operations)}
  // The worklist. Speaker findings are grouped by printed paragraph rather than listed per
  // proposal: Trial #1 produced 173 proposals sitting in 62 paragraphs, and a reporter visits
  // paragraphs. Sending them back to the same one eleven times is not a worklist.
  const speakerLocations = useMemo(()=>speakerReviewLocations({
    proposals:correctionResult?.ranges?.accepted?.length?correctionResult.ranges.accepted:storedRanges,
    paragraphs:rendered?.paragraphs??[],
  }),[correctionResult,storedRanges,rendered]);
  const markedWords = useMemo(()=>(rendered?.paragraphs??[]).flatMap(paragraph=>paragraph.words.filter(word=>word.flagged).map(word=>({paragraphId:paragraph.id,wordId:word.id}))),[rendered]);
  const unlabelledParagraphs = useMemo(()=>(rendered?.paragraphs??[]).filter(paragraph=>!paragraph.speakerIdentity).map(paragraph=>({paragraphId:paragraph.id,wordId:paragraph.words.find(word=>!word.authored)?.id??null})),[rendered]);
  const reviewList = useMemo(()=>reviewCategories({
    speakerLocations, lowConfidenceWords, markedWords, unlabelledParagraphs,
    wordCorrections:correctionResult?.names?.accepted??[],
  }),[speakerLocations,lowConfidenceWords,markedWords,unlabelledParagraphs,correctionResult]);

  /** Moves to the next place in a category and puts it on screen. Selection is how the panel follows. */
  function stepReview(category:{items:Array<{paragraphId?:string;wordId?:string|null}>},direction:1|-1){
    const { index, item } = reviewStep({ items:category.items, index:reviewIndex, direction });
    setReviewIndex(index);
    if(!item)return;
    const wordId=item.wordId??null;
    if(item.paragraphId&&wordId)setSelected({paragraphId:item.paragraphId,wordId,extentWordId:null});
    const target=wordId?document.querySelector<HTMLElement>(`[data-token-id="${wordId}"]`):null;
    target?.scrollIntoView({block:"center",behavior:"smooth"});
  }


  // The mark. One button, one meaning: this passage needs another listen. A range marks the range,
  // a single word marks that word -- validation turns the second into a range of one, so there is
  // one shape on the wire.
  function flagSelection() {
    if(!selected) return;
    const anchor = range ? [...wordOrder.entries()].find(([,index])=>index===range.first)?.[0] : selected.wordId;
    const end = range ? [...wordOrder.entries()].find(([,index])=>index===range.last)?.[0] : selected.wordId;
    if(!anchor||!end) return;
    void append([{ op:"flag", fromWordId:anchor, toWordId:end }]);
  }

  // Steps to the first word of the next flagged passage after the selection, wrapping at the end.
  // Without this the marks are only findable by scrolling, and a mark you have to hunt for saves
  // the scopist nothing.
  function nextFlag() {
    if(!flaggedWords.length) return;
    const starts = flaggedWords.filter((word,index)=>index===0||flaggedWords[index-1].from!==word.from);
    const here = selected ? wordOrder.get(selected.wordId) ?? -1 : -1;
    const target = starts.find(word=>(wordOrder.get(word.id) ?? -1) > here) ?? starts[0];
    const paragraph = rendered?.paragraphs.find(item=>item.words.some(word=>word.id===target.id));
    if(!paragraph) return;
    setSelected({ paragraphId:paragraph.id, wordId:target.id, extentWordId:null });
    document.getElementById(`w-${target.id}`)?.scrollIntoView({ block:"center", behavior:"smooth" });
  }

  return (
    <main className="workspace">
      <header className="workspace-top">
        <button type="button" className="back-button" onClick={onBack}>← Back</button>
        {/* The proxy when the original is not browser-decodable, the original otherwise. The
            Etminan recording is 24-bit PCM, which Chrome refuses -- it reported a format error
            and a duration of zero, which reads as broken audio rather than an unsupported one. */}
        {/* crossOrigin is load-bearing, not decoration. Without it the element issues a no-cors
            request, which carries no Origin header, and the API's origin gate 403s anything
            without one -- the element then reports MEDIA_ERR_SRC_NOT_SUPPORTED, which reads as
            "this audio is the wrong format" and sent an entire investigation down a codec path.
            With it the request is CORS and carries the Origin the gate expects. */}
        <audio ref={player} controls preload="metadata" crossOrigin="anonymous" src={playbackSource ?? undefined} onLoadedMetadata={()=>setPlaybackError("")} onError={()=>{const code=player.current?.error?.code;setPlaybackError(code?`The browser could not load this audio (media error ${code}). Prepare a playback copy or verify the preserved source.`:"The browser could not load this audio.")}} onTimeUpdate={()=>{if(player.current){setPlaybackTime(player.current.currentTime);if(playbackEnd.current!==null&&player.current.currentTime>=playbackEnd.current){player.current.pause();playbackEnd.current=null}}}} onEnded={()=>setPlaybackTime(null)}>
          <track kind="captions" label="No captions" src="data:text/vtt,WEBVTT" default />
        </audio>
        <button type="button" disabled={!playbackSource} onClick={()=>{if(!player.current)return;player.current.pause();player.current.currentTime=0;setPlaybackTime(null)}}>Stop</button>
        {!playbackSource && media?.needsProxy && (
          <button type="button" onClick={()=>{ void buildProxy(); }} disabled={building}>
            {building ? "Preparing audio… (about a minute)" : "Prepare audio for playback"}
          </button>
        )}
        {playbackError&&<span className="workspace-audio-error" role="alert">{playbackError}</span>}
        <span className="workspace-counts">
          {rendered ? `${rendered.counts.paragraphs} paragraphs · ${rendered.counts.words} words · ${rendered.counts.operations} edits and marks` : "Loading…"}
          {busy && " · saving…"}
          {/* Carried over when the Read-through screen was retired. The content hash is the
              transcript's identity -- what a correction pass invalidates against and what a
              reporter would cite for a certified page -- and it was shown on no other surface.
              The unassigned count is here because a transcript with unlabelled speakers is not
              finished, and the source-job count because more than one is how a duplicate
              transcription became visible. */}
          {rendered && unassignedSpeakers > 0 && <span className="workspace-flag"> · {unassignedSpeakers} unassigned</span>}
          {/* Passages, not words: what is left to do is places to listen to again. */}
          {rendered && rendered.counts.flags > 0 && <span className="workspace-marked"> · {rendered.counts.flags} to re-listen</span>}
          {rendered && (rendered.derivedFrom?.length ?? 0) > 1 && <span className="workspace-flag"> · {rendered.derivedFrom?.length} source jobs</span>}
          {rendered?.transcriptContentHash && <span className="workspace-hash" title={rendered.transcriptContentHash}> · {rendered.transcriptContentHash.slice(0,12)}</span>}
        </span>
        <button type="button" onClick={nextFlag} disabled={!rendered?.counts.flags}>Next marked passage</button>
        {/* The hash sent is the one from the model on screen -- the state the reporter is looking
            at when they press the button. Fetching a fresh hash here would satisfy the server and
            defeat the check: a stale tab would undo an edit it had never displayed. For the same
            reason both controls are inert without a model: there is no observed state to act on. */}
        <button type="button" onClick={()=>setCorrectionOpen(value=>!value)} disabled={!rendered||correcting} aria-expanded={correctionOpen}>{correcting?"Correcting transcript…":"Correct Transcript"}</button>
        <button type="button" onClick={()=>void generateDocx()} disabled={busy||awaitingRecord||!printModel}>{documentControlLabel(documentState?.state ?? "")}</button>
        <button type="button" onClick={()=>void generatePdf()} disabled={busy||awaitingRecord||!printModel||documentState?.state!==DOCUMENT_STATUS.READY}>Generate Working PDF</button>
      </header>

      {correctionOpen&&<section className="workspace-correction-panel" aria-label="AI transcript correction review">
        <div><h2>Correct Transcript</h2><p>AI checks proper-name spellings and proposes speaker identities and Q./A./colloquy roles. Nothing changes until you review and apply it.</p></div>
        <label htmlFor="workspace-correction-instructions">Additional things AI should check</label>
        <textarea id="workspace-correction-instructions" value={correctionInstructions} onChange={event=>setCorrectionInstructions(event.target.value)} placeholder="Example: Check whether Lucia Zahn self-identifies as Speaker 3. Check a recurring phrase that may have been misheard." />
        <p className="workspace-hint">These instructions guide the enabled checks. Future correction types can be added as separate validated passes without changing this review workflow.</p>
        <button type="button" className="primary-button" disabled={correcting||!rendered} onClick={()=>void correctTranscript()}>{correcting?"Sending transcript evidence to AI…":"Run AI correction check"}</button>
        {correctionResult?.errors.map(message=><p className="analysis-error" role="alert" key={message}>{message}</p>)}
        {correctionResult&&<div className="workspace-correction-results">
          <section><h3>Word corrections ({correctionResult.names?.accepted.length??0})</h3>
            {!correctionResult.names?.accepted.length&&<p>No supported proper-name corrections were proposed.</p>}
            {correctionResult.names?.accepted.map(proposal=><div className="workspace-correction-proposal" key={proposal.wordId}>
              <input type="checkbox" aria-label={`Apply correction from ${proposalOriginal(proposal)} to ${proposal.proposedValue}`} checked={selectedCorrections.has(proposal.wordId)} onChange={event=>setSelectedCorrections(current=>{const next=new Set(current);if(event.target.checked)next.add(proposal.wordId);else next.delete(proposal.wordId);return next})}/>
              <span><strong>{proposalOriginal(proposal)} → {proposal.proposedValue}</strong><small>{Math.round(proposal.confidenceScore*100)}% confidence · {proposal.evidenceSource}</small></span>
            </div>)}
            <button type="button" disabled={!selectedCorrections.size||busy} onClick={()=>void applySelectedCorrections()}>Apply selected word corrections ({selectedCorrections.size})</button>
          </section>
          {/* Range proposals sit in their own section and say so in their heading, because a
              reporter accepting one is being asked to believe something narrower than a whole
              cluster: THESE words, which they can read here, were spoken by this person. A
              surface that mixed the two would be asking the wrong question about half of them.

              Every proposal is accepted or rejected on its own. There is no Select All: a bulk
              action over speaker attributions is a reporter agreeing to claims they did not read. */}
          <section><h3>Speaker range proposals ({correctionResult.ranges?.accepted.length??0})</h3>
            <p className="workspace-hint">Each of these covers a specific stretch of words, not a whole machine speaker. Accepting one changes only the words selectedSummary.</p>
            {!correctionResult.ranges?.accepted.length&&<p>{emptyRangeListMessage({accepted:rangeApplied})}</p>}
            {correctionResult.ranges?.accepted.map(proposal=>{const shown=rangeProposalSummary(proposal,candidates);return <div className="workspace-range-proposal" key={shown.key}>
              <p className="workspace-range-words">&ldquo;{shown.text}&rdquo;</p>
              <p><strong>{shown.speakerLabel}</strong>{shown.speakerRole?` · ${ROLE_FOR(shown.speakerRole)}`:""}{shown.currentSpeakerLabel?` · currently ${shown.currentSpeakerLabel}`:" · currently unattributed"}</p>
              <small>
                {clock(shown.startTime)}&ndash;{clock(shown.endTime)} · {shown.wordCount} {shown.wordCount===1?"word":"words"}
                {shown.deepgramSpeakers.length?` · machine speaker ${shown.deepgramSpeakers.join(", ")}`:""}
                {` · ${Math.round((shown.confidenceScore??0)*100)}% confidence · ${shown.evidenceSource}`}
              </small>
              <div className="workspace-range-actions">
                <button type="button" className="primary-button" disabled={busy||acceptingRange===rangeKey(proposal)} onClick={()=>void acceptRange(proposal)}>{acceptingRange===rangeKey(proposal)?"Applying…":"Accept"}</button>
                <button type="button" disabled={busy} onClick={()=>dropRange(proposal)}>Reject</button>
              </div>
            </div>})}
          </section>
          <section><h3>Speaker and label proposals ({correctionResult.speakers?.proposals.length??0})</h3>
            {correctionResult.speakers?.proposals.map(proposal=>{const candidate=candidates.find(item=>item.id===proposal.speakerIdentity);return <div className="workspace-speaker-proposal" key={`${proposal.sourceJobIdentity}:${proposal.deepgramSpeaker}`}>
              <p><strong>Speaker {proposal.deepgramSpeaker}: {candidate?.label??proposal.missingParticipantName??"Unresolved"}</strong>{proposal.transcriptRole?` · ${ROLE_FOR(proposal.transcriptRole)}`:""}</p>
              <small>{Math.round(proposal.confidence*100)}% confidence · {proposal.evidence}</small>
              {proposal.speakerIdentity?<button type="button" onClick={()=>acceptSpeakerSuggestion(proposal)}>Use this assignment</button>:proposal.missingParticipantName?<button type="button" onClick={()=>{document.getElementById("workspace-add-missing-counsel")?.click();document.getElementById("workspace-counsel-editor")?.scrollIntoView({behavior:"smooth",block:"start"})}}>Add {proposal.missingParticipantName} to participants</button>:null}
            </div>})}
            <p className="workspace-hint">Speaker proposals update the unsaved speaker-map controls. Review them there, then select Save speaker map.</p>
          </section>
        </div>}
      </section>}

      {/* A deposition that has not been transcribed yet is not a deposition that failed. The
          render endpoint reports a missing working transcript as an error because for every
          other caller it is one; here it is the ordinary starting state, and the panel below
          already says what to do about it. Suppressed only when there is audio waiting -- with
          no audio at all, something really is wrong and the reporter should see it. */}
      {error && !notTranscribedYet && <p className="analysis-error" role="alert">{error}</p>}
      {rendered && rendered.findings.some(finding=>finding.code!=="HONORIFIC_MISSING") && (
        <ul className="workspace-findings" role="alert">
          {rendered.findings.filter(finding=>finding.code!=="HONORIFIC_MISSING").slice(0,6).map((finding,index)=><li key={`${finding.code}:${index}`}>{finding.message}</li>)}
        </ul>
      )}

      {/* Shown only once a model has actually been served: a deposition with no transcript yet
          has no document to be blocked about, and the transcribe panel below already says so.
          Gated on printModel rather than on documentState so the banner cannot appear before
          there is a served answer to derive it from. */}
      {printModel && documentState && (
        <section className={`workspace-document-status ${documentState.state===DOCUMENT_STATUS.READY?"ready":"blocked"}`} role="status">
          <strong>{documentState.state}</strong>
          {documentState.state!==DOCUMENT_STATUS.READY && (
            <>
              <p>{documentState.reason}</p>
              <p>Generating now produces the testimony body only. It will not contain {documentState.absentSections.join(", ")}.</p>
            </>
          )}
        </section>
      )}

      {/* The way out of the blocked state the banner above reports. Not gated on printModel: the
          preparation is administrative authority and a reporter can record it before there is a
          transcript to assemble. preparedBy is passed as the record holds it and is not defaulted --
          a deposition with no reporter name is refused by the server, which is the honest answer. */}
      {/* In the main column, not the tools rail. It was mounted beside the counsel editor, which
          put a four-field form in a 262px column that scrolls independently of the page -- present
          in the DOM, and not reachable in practice. Three save attempts were lost to that. It sits
          with the preparation panel now because they are the same kind of thing: filled once per
          deposition, before generation, and never touched again. */}
      <ProceedingEditor depositionId={depositionId} onSaved={reload} />
      <PrepareCompleteTranscript depositionId={depositionId} preparedBy={deposition.courtReporterName ?? ""} />

      {notice && <p className="analysis-note" role="status">{notice}</p>}

      {/* The transcribe step, moved here from the Transcript screen. It sits above the transcript
          because that is its order: a deposition with no transcript has nothing else on this
          screen, and one with a transcript still needs a way to verify the preserved result or
          retry a failed job. */}
      {awaitingSpeakerMap && (
        <p className="workspace-awaiting" role="status">
          No speakers assigned yet, so every paragraph reads as colloquy. Assign the Deepgram
          speakers below and the Q. and A. structure appears.
        </p>
      )}

      {uploads.length > 0 && (
        <section className="workspace-transcribe" aria-label="Transcription">
          {(deposition.keyterms?.length||0) > 50 && (
            <label className="workspace-hint" htmlFor="workspace-keyterm-override">
              Required keyterm override reason
              <input id="workspace-keyterm-override" value={overrideReason} onChange={event=>setOverrideReason(event.target.value)}
                placeholder="Record why more than 50 terms are necessary" />
            </label>
          )}
          {uploads.map((uploadId,index)=>{
            const audit = auditByUpload.get(uploadId);
            const job = jobByUpload.get(uploadId);
            return (
              <div className="workspace-transcribe-row" key={uploadId}>
                <div>
                  <strong>{deposition.audioFiles[index] || audit?.originalName || "Audio file"}</strong>
                  <small>
                    {job ? `Job ${job.status} · ${job.jobId.slice(0,12)}…` : audit ? `Frozen ${audit.selectedSource} source ready` : "Ready to transcribe"}
                    {job?.keyterms?.count !== undefined && ` · ${job.keyterms.count} keyterms`}
                    {job?.response?.deliveredAudio?.converted ? " · lossless WAV fallback" : job ? " · frozen deposition audio" : ""}
                  </small>
                  {job?.failure && <small className="workspace-transcribe-failure">{job.failure.message}</small>}
                </div>
                <button type="button" className="primary-button" disabled={transcribing===uploadId||job?.status==="processing"}
                  onClick={()=>{ void createTranscript(uploadId); }}>
                  {transcribing===uploadId ? "Transcribing…"
                    : job?.status==="completed" ? "Verify preserved result"
                    : job?.status==="failed" ? "Retry failed job"
                    : "Create transcript"}
                </button>
              </div>
            );
          })}
        </section>
      )}

      <div className={`workspace-body ${toolsCollapsed?"tools-collapsed":""}`}>
        <div className="workspace-stage">
          {printModel?<WorkspaceDocumentPages pages={printModel.pages} profile={printModel.layoutProfile} paragraphs={rendered?.paragraphs??[]} selectedParagraphId={selected?.paragraphId??null} selectedWordId={selected?.wordId||null} activePlaybackWordId={activePlaybackWordId} lowConfidenceWordIds={lowConfidenceWordIdSet} onSelect={selectPageFragment} onSaveParagraph={saveParagraph} onJoinParagraph={joinParagraph} onPlayParagraph={playParagraphById} onPlayAt={playAtSeconds} onEditingChange={editingChange}/>
            :<section className="workspace-transcript" aria-label="Transcript">{rendered?.paragraphs.map(paragraph=>{
            const first=wordOrder.get(paragraph.words[0]?.id ?? ""),last=wordOrder.get(paragraph.words[paragraph.words.length-1]?.id ?? ""),touches=Boolean(range)&&first!==undefined&&last!==undefined&&!(range!.last<first||range!.first>last),mine=selected?.paragraphId===paragraph.id;
            return <TranscriptParagraph key={paragraph.id} paragraph={paragraph} wordOrder={wordOrder} isSelected={mine} selectedWordId={mine?selected!.wordId:null} rangeFirst={touches?range!.first:-1} rangeLast={touches?range!.last:-1} onSeek={seek} onSelect={selectWord} onEdit={editWord}/>})}</section>}

          <aside className="workspace-quick-tools" aria-label="Quick transcript actions">
            <strong>Quick tools</strong>
            <span>{active ? "Selected paragraph" : "Select a word"}</span>
            <button type="button" title="Play selected paragraph" aria-label="Play selected paragraph" disabled={!active||multiVolume||!playbackSource} onClick={()=>playParagraph(active)}>▶<small>Play</small></button>
            <button type="button" title="Correct selected word" aria-label="Correct selected word" disabled={!selected||!active||busy||awaitingRecord||Boolean(range)} onClick={()=>{const word=active?.words.find(item=>item.id===selected?.wordId);if(word)setEditing({wordId:word.id,text:word.text})}}>Aa<small>Edit</small></button>
            <button type="button" title="Split paragraph at selected word" aria-label="Split paragraph at selected word" disabled={!active||busy||awaitingRecord||!splitWithSpeakerControl({paragraph:active,selectedWordId:selected?.wordId??null}).beforeWordId} onClick={()=>{if(!active)return;const anchor=splitWithSpeakerControl({paragraph:active,selectedWordId:selected?.wordId??null}).beforeWordId;if(anchor)void structuralTransaction([{op:"split",beforeWordId:anchor}])}}>↵<small>Split</small></button>
            <button type="button" title="Join with previous paragraph" aria-label="Join with previous paragraph" disabled={!active||activeIndex<=0||busy||awaitingRecord} onClick={()=>active&&void joinParagraph(active.id,"previous")}>↑<small>Join</small></button>
            <button type="button" title="Join with next paragraph" aria-label="Join with next paragraph" disabled={!active||activeIndex<0||activeIndex>=(rendered?.paragraphs.length??0)-1||busy||awaitingRecord} onClick={()=>active&&void joinParagraph(active.id,"next")}>↓<small>Join</small></button>
            <button type="button" title="Mark selection for review" aria-label="Mark selection for review" disabled={!selected||busy||awaitingRecord} onClick={flagSelection}>⚑<small>Review</small></button>
            <button type="button" title={range?`Delete ${paragraphDeleteCount} selected paragraphs`:"Delete selected paragraph"} aria-label={range?`Delete ${paragraphDeleteCount} selected paragraphs`:"Delete selected paragraph"} disabled={!paragraphDeleteOperations.length||busy||awaitingRecord} onClick={deleteSelectedParagraphs}>⌫<small>Delete</small></button>
            <button type="button" title="Undo last transcript operation" aria-label="Undo last transcript operation" disabled={busy||awaitingRecord||!printModel||!rendered?.counts.operations} onClick={()=>void post("/api/transcript/overlay/undo",overlayHistoryRequest({depositionId,reviewStateHash:printModel?.source.reviewStateHash}),"transcript")}>↶<small>Undo</small></button>
            <button type="button" title="Redo last transcript operation" aria-label="Redo last transcript operation" disabled={busy||awaitingRecord||!printModel||!rendered?.counts.redoTransactions} onClick={()=>void post("/api/transcript/overlay/redo",overlayHistoryRequest({depositionId,reviewStateHash:printModel?.source.reviewStateHash}),"transcript")}>↷<small>Redo</small></button>
            <button type="button" title={toolsCollapsed?"Open full transcript tools":"Collapse full transcript tools"} aria-label={toolsCollapsed?"Open full transcript tools":"Collapse full transcript tools"} onClick={()=>setToolsCollapsed(value=>!value)}>☷<small>{toolsCollapsed?"Open":"Close"}</small></button>
          </aside>
        </div>

        <button type="button" className="workspace-tools-toggle" onClick={()=>setToolsCollapsed(value=>!value)} aria-expanded={!toolsCollapsed}>{toolsCollapsed?"Open transcript tools":"Collapse transcript tools"}</button>
        {/* THE CORRECTION COCKPIT.
            Five sections, in the order a correction is actually made: see where you are, say who
            spoke, fix the structure, fix the words, then move to the next piece of work.

            Production Trial #1 decided the shape of the last one. The diagnostic measured 77
            genuine missing turn boundaries in Baier, none of which needed audio to locate, and
            found that accepting AI proposals one at a time costs a 195-second re-analysis each --
            about 580 times slower than correcting the same locations by hand with these controls.
            So REVIEW points at the work and these controls do it. */}
        <aside className="workspace-menu" aria-label="Transcript tools" hidden={toolsCollapsed}>
          {/* Beside the corrections, because undoing one is part of making them. */}
          <div className="workspace-history">
            <button type="button" onClick={()=>void post("/api/transcript/overlay/undo", overlayHistoryRequest({ depositionId, reviewStateHash:printModel?.source.reviewStateHash }), "transcript")} disabled={busy||awaitingRecord||!printModel||!rendered?.counts.operations}>Undo</button>
            <button type="button" onClick={()=>void post("/api/transcript/overlay/redo", overlayHistoryRequest({ depositionId, reviewStateHash:printModel?.source.reviewStateHash }), "transcript")} disabled={busy||awaitingRecord||!printModel||!rendered?.counts.redoTransactions}>Redo</button>
          </div>

          {/* ---- SELECTED PARAGRAPH ------------------------------------------------------ */}
          <h2>Selected paragraph</h2>
          {!active&&<p className="workspace-hint">Click a word in the transcript to correct its paragraph.</p>}
          {active&&selectedSummary&&
            <section className="workspace-selection-context" aria-label="Selected paragraph">
              <p className="workspace-where">
                {selectedSummary.location?<strong>Page {selectedSummary.location.page}, line {selectedSummary.location.line}</strong>:<strong>Not yet paginated</strong>}
                <span> · {clock(selectedSummary.start)}–{clock(selectedSummary.end)}</span>
              </p>
              {/* "Current: SPEAKER 3" rather than "no speaker recorded". The reporter is looking at
                  SPEAKER 3: on the page; saying something true but differently worded leaves them to
                  connect the two, which is the whole job this panel exists to do. */}
              <p className="workspace-who">
                <span className="workspace-current-label">Current</span>
                {currentSpeaker
                  ? <strong className={currentSpeaker.known?"":"workspace-unresolved"}>{currentSpeaker.text}</strong>
                  : <em>Nothing selected</em>}
                {selectedSummary.designation?<span className="workspace-designation"> · prints as {selectedSummary.designation}</span>:null}
              </p>
              <div className="workspace-row">
                <button type="button" disabled={multiVolume||!selectedSummary.playable||!playbackSource} onClick={()=>playParagraph(active)}>Play</button>
                <span className="workspace-save-state" role="status">{error?<strong className="workspace-save-failed">Not saved — {error}</strong>:selectedSummary.saveState==="saving"?"Saving…":"Saved"}</span>
              </div>
              {selectedSummary.marked&&<p className="workspace-hint">Marked for another listen.</p>}
              <button type="button" className="workspace-details-toggle" aria-expanded={showDetails} onClick={()=>setShowDetails(value=>!value)}>{showDetails?"Hide details":"Details"}</button>
              {showDetails&&<dl>
                <div><dt>Machine speaker</dt><dd>{selectedSummary.details.deepgramSpeaker??"—"}</dd></div>
                <div><dt>Role</dt><dd>{selectedSummary.details.transcriptRole?ROLE_FOR(selectedSummary.details.transcriptRole):"Unassigned"}</dd></div>
                <div><dt>Words</dt><dd>{selectedSummary.details.words}</dd></div>
                <div><dt>Average confidence</dt><dd>{selectedSummary.details.averageConfidence===null?"Not available":`${(selectedSummary.details.averageConfidence*100).toFixed(1)}%`}</dd></div>
                <div><dt>Low confidence</dt><dd>{selectedSummary.details.lowConfidenceWords}</dd></div>
                <div><dt>Reporter-authored</dt><dd>{selectedSummary.details.authored}</dd></div>
              </dl>}
            </section>}

          {/* ---- SPEAKER ---------------------------------------------------------------- */}
          {/* One place for who spoke, built from this deposition's own record. Q. and A. are not
              buttons here: they are derived from the speaker and the examination state, and a
              button offering one would be the panel deciding something the transcript decides. */}
          {/* A question, not a noun. "Speaker" names a topic; "Who spoke?" names the decision the
              reporter came here to make, and it is the first actionable thing under the paragraph
              they just clicked. The gate failed on exactly this: the control was present and could
              not be found. */}
          <h2>Who spoke?</h2>
          {/* The scope is chosen, and the safe one is chosen already. Before this the panel read it
              off the click position and said so in a sentence -- which is how counsel's question
              ended up attributed to the witness, mid-sentence, from one click. */}
          {active&&<div className="workspace-scope-choice" role="radiogroup" aria-label="What the speaker applies to">
            {range
              ? <p className="workspace-scope"><strong>These {rangeWords} words.</strong></p>
              : scopeChoices.map(choice=>(
                  <button type="button" key={choice.key} role="radio" aria-checked={speakerScope===choice.key}
                    className={`workspace-scope-option ${speakerScope===choice.key?"chosen":""}`}
                    onClick={()=>setSpeakerScope(choice.key as "paragraph"|"here")}>{choice.label}</button>
                ))}
          </div>}
          {speakerList.map(action=>action.kind==="other"
            ? <button type="button" key={action.key} className="workspace-speaker-other" disabled={busy||awaitingRecord} onClick={()=>{
                document.getElementById("workspace-add-missing-counsel")?.click();
                document.getElementById("workspace-counsel-editor")?.scrollIntoView({behavior:"smooth",block:"start"});
              }}>{action.label} <small>{action.note}</small></button>
            : <button type="button" key={action.key} className="workspace-speaker-choice" disabled={!active||busy||awaitingRecord}
                title={action.role?ROLE_FOR(action.role):undefined}
                onClick={()=>active&&relabel(active,action.speakerIdentity,action.transcriptRole)}>
                {action.label}
                {action.note?<small>{action.note}</small>:action.role?<small>{ROLE_FOR(action.role)}{action.examiner?" · examining":""}</small>:null}
              </button>)}

          {/* The OTHER scope, named with its size and deliberately not a one-click action here.
              Trial #1's cluster 3 holds 86 passages and at least four of them are not the witness,
              including opposing counsel reserving questions. A reporter who clicked a name should
              never discover afterwards that they moved 86 passages. */}
          {globalScope&&<p className="workspace-global-scope">
            All {globalScope.passages} passages the recording grouped as <strong>{globalScope.label}</strong>?{" "}
            <button type="button" className="workspace-linklike" onClick={()=>{setShowSetup(true);setShowSpeakers(true);window.setTimeout(()=>document.getElementById("workspace-speakers")?.scrollIntoView({behavior:"smooth",block:"center"}),0)}}>Map the whole speaker in Speaker setup</button>
          </p>}

          {/* ---- STRUCTURE -------------------------------------------------------------- */}
          <h2>Structure</h2>
          {!active&&<p className="workspace-hint">Select a paragraph to change its structure.</p>}
          {active&&structureActions({
            paragraph:active, index:activeIndex, total:rendered?.paragraphs.length??0, selectedWordId:selected?.wordId??null,
            examinerColloquyAvailable:!examinerColloquyControl({paragraph:active}).disabledReason,
            examinationAvailable:!examinationControl({paragraph:active,candidates,examinations:rendered?.examinations??[],labels:rendered?.labels??{}}).disabledReason,
          }).map(item=>{
            if(item.key==="examination")return item.available?<Fragment key={item.key}>
              <label className="workspace-field" htmlFor="examination-type">What begins here
                <select id="examination-type" value={examinationType} disabled={busy||awaitingRecord} onChange={event=>setExaminationType(event.target.value)}>
                  <option value="">Choose…</option>
                  {EXAMINATION_TYPE_CHOICES.map(choice=>(<option key={choice.value} value={choice.value}>{choice.label}</option>))}
                </select>
              </label>
              <label className="workspace-field" htmlFor="examination-examiner">Who is examining
                <select id="examination-examiner" value={examinationExaminer} disabled={busy||awaitingRecord} onChange={event=>setExaminationExaminer(event.target.value)}>
                  <option value="">Choose…</option>
                  {examinationControl({paragraph:active,candidates,examinations:rendered?.examinations??[],labels:rendered?.labels??{}}).examiners.map(person=>(<option key={person.id} value={person.id}>{person.label}</option>))}
                </select>
              </label>
              {/* The button says what it will record, so it can be checked against the screen. */}
              <button type="button" disabled={busy||awaitingRecord||!examinationSummaryText} onClick={()=>{
                const operation=examinationOperation({ paragraph:active, type:examinationType, examinerPersonId:examinationExaminer });
                if(!operation)return;
                setExaminationType(""); setExaminationExaminer(""); setSelected(null);
                void structuralTransaction([operation]);
              }}>{examinationSummaryText||"Choose what begins here and who is examining"}</button>
            </Fragment>:null;
            if(item.key==="examiner-colloquy")return item.available?<button type="button" key={item.key} disabled={busy||awaitingRecord} onClick={()=>{
              const operation=examinerColloquyOperation({ paragraph:active });
              if(!operation)return;
              setSelected(null);
              void structuralTransaction([operation]);
            }}>{examinerColloquyLabel({ paragraph:active, labels:rendered?.labels??{} })}</button>:null;
            // Striking removes testimony, so it asks first and says how much. It is one transaction
            // whatever the paragraph's length, so one Undo brings all of it back.
            const onClick=item.key==="strike"?()=>{
              const operations=strikeParagraphOperations({paragraph:active});
              if(!operations.length)return;
              const preview=active.words.filter(word=>!word.deleted).map(word=>word.text).join(" ");
              if(!window.confirm(`Strike ${operations.length} word${operations.length===1?"":"s"} from the transcript?

${preview.length>160?`${preview.slice(0,160)}…`:preview}

The recording is not changed, and Undo restores this in one step.`))return;
              setSelected(null);
              void structuralTransaction(operations);
            }
              :item.key==="split"?()=>{const anchor=splitWithSpeakerControl({paragraph:active,selectedWordId:selected?.wordId??null}).beforeWordId;if(anchor)void structuralTransaction([{op:"split",beforeWordId:anchor}])}
              :item.key==="join-previous"?()=>void joinParagraph(active.id,"previous")
              :item.key==="join-next"?()=>void joinParagraph(active.id,"next")
              :flagSelection;
            const label=item.key==="mark"&&range?`Mark these ${rangeWords} words for another listen`:item.label;
            return <button type="button" key={item.key} className={item.destructive?"workspace-destructive":undefined} disabled={!item.available||busy||awaitingRecord} title={item.available?undefined:item.unavailable??undefined} onClick={onClick}>{label}</button>;
          })}
          {selectedWord?.flagged&&<button type="button" disabled={busy||awaitingRecord} onClick={()=>{const from=selectedWord.flaggedFrom;if(from)void append([{ op:"unflag", fromWordId:from }])}}>Clear this mark</button>}

          {/* ---- TEXT ------------------------------------------------------------------- */}
          <h2>Text</h2>
          {editing&&<form className="workspace-edit" onSubmit={event=>{ event.preventDefault(); const text=editing.text.trim(); setEditing(null); if(text) void append([{ op:"replace", wordId:editing.wordId, text }]); }}>
            <label htmlFor="workspace-word-edit">Correct this word</label>
            <input id="workspace-word-edit" value={editing.text} ref={node=>{ node?.focus(); }} onChange={event=>setEditing({ ...editing, text:event.target.value })} />
            <button type="submit" className="primary-button" disabled={busy||awaitingRecord}>Save</button>
            <button type="button" onClick={()=>setEditing(null)}>Cancel</button>
          </form>}
          {/* Word controls appear when a word is selected. Hidden while a range is: a range is not
              a word, and leaving "Strike the word" pointing at the anchor invites striking one
              word when eleven look selected. */}
          {selected&&!editing&&!range&&<>
            <button type="button" disabled={busy||awaitingRecord} onClick={()=>{ const word=active?.words.find(item=>item.id===selected.wordId); if(word) setEditing({ wordId:word.id, text:word.text }); }}>Correct the word</button>
            <button type="button" disabled={busy||awaitingRecord} onClick={()=>{ const id=selected.wordId; setSelected(null); void append([{ op:"delete", wordId:id }]); }}>Strike the word</button>
          </>}
          <button type="button" onClick={()=>setSearchOpen(value=>!value)} aria-expanded={searchOpen}>Find / Replace (Ctrl+F)</button>
          {searchOpen&&<>
            <label>Find<input value={searchText} onChange={event=>setSearchText(event.target.value)}/></label>
            <label><input type="checkbox" checked={matchCase} onChange={event=>setMatchCase(event.target.checked)}/> Match case</label>
            <label><input type="checkbox" checked={wholeWords} onChange={event=>setWholeWords(event.target.checked)}/> Whole words</label>
            {/* An empty box has not failed to find anything. Reporting "No matches" before a word
                has been typed reads as a broken search, which is exactly how it was reported. */}
            <p className="workspace-hint">{!searchText.trim()?"Type to search all testimony."
              :searchMatches.length?`${Math.min(searchIndex+1,searchMatches.length)} of ${searchMatches.length} matches across all testimony`
              :`No match for “${searchText}”.`}</p>
            <div className="workspace-row"><button type="button" disabled={!searchMatches.length} onClick={()=>navigateMatch(searchIndex-1)}>Previous</button><button type="button" disabled={!searchMatches.length} onClick={()=>navigateMatch(searchIndex+1)}>Next</button></div>
            <button type="button" onClick={()=>setReplaceOpen(value=>!value)} aria-expanded={replaceOpen}>Replace (Ctrl+H)</button>
            {replaceOpen&&<><label>Replace with<input value={replaceText} onChange={event=>setReplaceText(event.target.value)}/></label>
              <div className="workspace-match-list">{searchMatches.map(match=><label key={match.id}><input type="checkbox" checked={!excludedMatches.has(match.id)} onChange={event=>setExcludedMatches(current=>{const next=new Set(current);if(event.target.checked)next.delete(match.id);else next.add(match.id);return next})}/><span>…{match.context}…</span></label>)}</div>
              <button type="button" disabled={!searchMatches.length||busy} onClick={()=>{const match=searchMatches[searchIndex];if(match)void replaceMatches([match])}}>Replace current</button>
              <button type="button" disabled={!searchMatches.some(match=>!excludedMatches.has(match.id))||busy} onClick={()=>{const chosen=searchMatches.filter(match=>!excludedMatches.has(match.id));if(window.confirm(`Replace ${chosen.length} selected occurrence${chosen.length===1?"":"s"} as one undoable action?`))void replaceMatches(chosen)}}>Replace selected ({searchMatches.filter(match=>!excludedMatches.has(match.id)).length})</button>
            </>}
          </>}

          {/* ---- REVIEW ----------------------------------------------------------------- */}
          {/* A worklist, not an acceptance queue. AI says where to look; everything above does the
              work. The counts are outstanding items, so a category that is finished disappears
              rather than reading zero. */}
          <h2>Review</h2>
          <label className="workspace-review-marks"><input type="checkbox" checked={lowConfidenceMode} onChange={event=>setLowConfidenceMode(event.target.checked)}/> Show review marks in the transcript</label>
          {!reviewList.length&&<p className="workspace-hint">Nothing outstanding. Run Correct Transcript to look for speaker and spelling issues.</p>}
          {reviewList.map(category=><div className="workspace-review-category" key={category.key}>
            <button type="button" className={`workspace-review-open ${reviewKey===category.key?"chosen":""}`} aria-expanded={reviewKey===category.key}
              onClick={()=>{setReviewKey(current=>current===category.key?"":category.key);setReviewIndex(-1)}}>
              <span>{category.label}</span><strong>{category.count}</strong>
            </button>
            {reviewKey===category.key&&<div className="workspace-review-body">
              <div className="workspace-row">
                <button type="button" onClick={()=>stepReview(category,-1)}>Previous</button>
                <button type="button" onClick={()=>stepReview(category,1)}>Next</button>
                <span className="workspace-hint">{reviewIndex>=0?`${reviewIndex+1} of ${category.count}`:`${category.count} ${category.unit}`}</span>
              </div>
              {category.key==="speaker"&&reviewIndex>=0&&(()=>{
                const item=category.items[reviewIndex];
                const first=item?.proposals?.[0];
                if(!first)return null;
                const scope=proposalScopeDescription(first,{labels:rendered?.labels??{}});
                return <div className="workspace-review-reason">
                  <p><strong>{scope.headline}</strong></p>
                  <p className="workspace-hint">{scope.detail}</p>
                  <p className="workspace-review-words">“{first.text}”</p>
                  <p className="workspace-hint">{Math.round((first.confidenceScore??0)*100)}% confidence · {first.evidenceSource}{(item.proposals?.length??0)>1?` · ${item.proposals?.length} findings in this paragraph`:""}</p>
                </div>;
              })()}
            </div>}
          </div>)}

          {/* ---- SPEAKER SETUP ------------------------------------------------------------ */}
          {/* Deposition-level work: who was in the room, which voice is which, how each name is
              titled. None of it is per-paragraph, and all of it used to sit in the same scroll as
              the correction controls -- which is how a reporter looking for "who spoke this
              paragraph" ended up reading a Counsel Editor. Collapsed by default; the correction
              controls above never move because of what is in here. */}
          <h2>Speaker setup</h2>
          <button type="button" className="workspace-setup-toggle" aria-expanded={showSetup} onClick={()=>setShowSetup(value=>!value)}>
            {showSetup?"Hide participants and speaker map":"Participants, speaker map and honorifics"}
          </button>
          {showSetup&&<>
          {showSetup&&unresolvedHonorifics.length>0&&<section className="workspace-review-tools" aria-label="Unresolved participant honorifics">
            {/* Beside the participants rather than in the per-paragraph tools: an honorific is a
                fact about a person, settled once, not a decision made per paragraph. */}
            <h3>Honorifics</h3>
            <p className="workspace-hint">{unresolvedHonorifics.length} unresolved participant{unresolvedHonorifics.length===1?"":"s"}</p>
            {unresolvedHonorifics.map(finding=><div className="workspace-honorific" key={finding.speakerIdentity}>
              <strong>{finding.name||finding.speakerIdentity}</strong>
              {["MR.","MS.","MRS.","DR."].map(value=><button type="button" key={value} disabled={busy||awaitingRecord} onClick={()=>finding.speakerIdentity&&void resolveHonorific(finding.speakerIdentity,value)}>{value}</button>)}
              <button type="button" disabled={busy||awaitingRecord} onClick={()=>{const value=window.prompt("Enter the participant's honorific");if(value&&finding.speakerIdentity)void resolveHonorific(finding.speakerIdentity,value)}}>Other</button>
              <button type="button" disabled={busy||awaitingRecord} onClick={()=>finding.speakerIdentity&&void resolveHonorific(finding.speakerIdentity,null)}>None</button>
            </div>)}
          </section>}
          <h2>Counsel</h2>
          <CounselEditor depositionId={depositionId} onSaved={reload} speakerOptions={speakerOptions} speakerAssignmentForCounsel={speakerAssignmentForCounsel} onSpeakerAssignment={assignCounselSpeaker} />

          {/* And the parties, because the caption names them and nothing else in the application
              could. A deposition made from an existing recording reaches finalization with an empty
              parties list and a certified caption with nothing under PLAINTIFF or DEFENDANT. */}
          <h2>Parties</h2>
          <PartiesEditor depositionId={depositionId} onSaved={reload} />

          <h2>Speakers</h2>
          <button type="button" className="secondary-button" onClick={()=>{
            document.getElementById("workspace-add-missing-counsel")?.click();
            document.getElementById("workspace-counsel-editor")?.scrollIntoView({behavior:"smooth",block:"start"});
          }}>Add a missing counsel speaker</button>
          <button type="button" onClick={()=>setShowSpeakers(value=>!value)} aria-expanded={showSpeakers} aria-controls="workspace-speakers">
            {rendered?.speakerMap?.status==="reconciled" ? "Speakers assigned" : "Assign Deepgram speakers"}
          </button>
          <div id="workspace-speakers" hidden={!showSpeakers}>
            {/* Bulk mapping, not an overlay operation. A mapping decision says who speaker 2 is
                throughout; a label op corrects one paragraph. Collapsing them would make the two
                indistinguishable in the record. */}
            <p className="workspace-hint">Mapping applies to every paragraph from that Deepgram speaker. To fix a single paragraph, use the labels above instead.</p>
            {buckets.map(bucket=>(
              <div key={bucket.key} className="workspace-bucket">
                {/* Labelled by job as well as number, because two buckets can both be "Speaker 0"
                    and the reporter has to be able to tell which recording each belongs to. */}
                <strong>Speaker {bucket.deepgramSpeaker}</strong> <small>{bucket.words} words{buckets.some(other=>other.deepgramSpeaker===bucket.deepgramSpeaker&&other.key!==bucket.key)?` · job ${bucket.jobIdentity.slice(0,8)}`:""}</small>
                <label htmlFor={`bucket-identity-${bucket.key}`} className="visually-hidden">Identity for Deepgram speaker {bucket.deepgramSpeaker} in job {bucket.jobIdentity.slice(0,8)}</label>
                <select id={`bucket-identity-${bucket.key}`} value={effectiveAssignment(bucket).speakerIdentity} onChange={event=>{
                  const candidate=candidates.find(item=>item.id===event.target.value);
                  setSavedNote("");
                  setAssignments(current=>({ ...current, [bucket.key]:{ speakerIdentity:event.target.value, transcriptRole:candidate?.defaultRole ?? effectiveAssignment(bucket).transcriptRole } }));
                }}>
                  <option value="">Unassigned</option>
                  {candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
                <label htmlFor={`bucket-role-${bucket.key}`} className="visually-hidden">Transcript role for Deepgram speaker {bucket.deepgramSpeaker} in job {bucket.jobIdentity.slice(0,8)}</label>
                <select id={`bucket-role-${bucket.key}`} value={effectiveAssignment(bucket).transcriptRole} onChange={event=>{ setSavedNote(""); setAssignments(current=>({ ...current, [bucket.key]:{ speakerIdentity:effectiveAssignment(bucket).speakerIdentity, transcriptRole:event.target.value } })); }}>
                  <option value="">Role</option>
                  {roles.map(role=><option key={role} value={role}>{ROLE_FOR(role)}</option>)}
                </select>
                <small className="workspace-sample">{bucket.sample}…</small>
              </div>
            ))}
            <button type="button" className="primary-button" disabled={busy||awaitingRecord} onClick={()=>{ void (async ()=>{
              // Each bucket carries the job its paragraphs came from. The previous payload took
              // one job identity from the first rendered paragraph and stamped it on every
              // assignment, which is right only while a single job is in the transcript.
              const payload = buckets
                .map(bucket=>({ sourceJobIdentity:bucket.jobIdentity, deepgramSpeaker:bucket.deepgramSpeaker, ...effectiveAssignment(bucket) }))
                .filter(item=>item.speakerIdentity&&item.transcriptRole);
              setSavedNote("");
              // The count comes from what was sent, not from the reload: post() throws on a
              // non-ok response, so reaching here means the server accepted exactly these.
              // Reading it back off `rendered` would race the refetch and could report the
              // previous save as though it were this one.
              if(await post("/api/transcript/speaker-map",{ depositionId, assignments:payload })) {
                setSavedNote(`Saved ${payload.length} of ${buckets.length} Deepgram speakers.`);
              }
            })(); }}>Save speaker map</button>
            {/* One element, and the server's answer rather than the app's hope: the transient
                note while it stands, the persisted state otherwise. The note is cleared by any
                change to an assignment, so "Saved" is never displayed next to an unsaved edit. */}
            <p className="workspace-hint" role="status">
              {savedNote ? savedNote
                : speakerMapStatus==="reconciled" ? `Speaker map saved. All ${rendered?.speakerMap?.assignments.length ?? 0} Deepgram speakers are assigned.`
                : speakerMapStatus==="partially_reconciled" ? `Speaker map partly saved: ${rendered?.speakerMap?.assignments.length ?? 0} assigned, some Deepgram speakers still unassigned.`
                : "Speaker map not saved yet."}
            </p>
            <label htmlFor="workspace-examiner">Examining attorney</label>
            <select id="workspace-examiner" value={examiner} onChange={event=>setExaminer(event.target.value)}>
              <option value="">Not set</option>
              {candidates.filter(candidate=>candidate.defaultRole.includes("ATTORNEY")).map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </select>
          </div>
          </>}
        </aside>
      </div>
    </main>
  );
}
