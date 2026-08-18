"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { speakerBuckets } from "./transcript-paragraphs.mjs";

const API = "http://127.0.0.1:4317";

type Word = { id:string; text:string; display?:string; styled?:boolean; start:number|null; end:number|null; confidence:number|null; deepgramSpeaker:number|null; edited?:boolean; deleted?:boolean; authored?:boolean; originalText?:string };
type Paragraph = { id:string; elementType:string; label:string|null; byLine:string|null; speakerIdentity:string|null; transcriptRole:string|null; deepgramSpeaker:number|null; unlabeledSpeaker:boolean; start:number|null; end:number|null; text:string; words:Word[]; segmentIds:string[]; asrWordIds:string[] };
type Finding = { code:string; message:string };
type Rendered = { transcriptContentHash:string|null; derivedFrom?:string[]; paragraphs:Paragraph[]; findings:Finding[]; diarized:boolean; labels:Record<string,string>; counts:{ paragraphs:number; words:number; operations:number; orphaned:number }; speakerMap:{ status:string; assignments:{ sourceJobIdentity:string; deepgramSpeaker:number; speakerIdentity:string; transcriptRole:string }[] }|null };
type Candidate = { id:string; label:string; defaultRole:string };
type Operation = Record<string,unknown>;
type Bucket = { key:string; jobIdentity:string; deepgramSpeaker:number; words:number; sample:string };
type Audit = { uploadId:string; originalName:string; selectedSource:string };
type Job = { jobId:string; uploadId:string; startedAt?:string; status:"processing"|"completed"|"failed"; keyterms?:{ count:number }; failure?:{ message:string }; response?:{ deliveredAudio?:{ converted?:boolean } } };
export type WorkspaceDeposition = { id:string; audioFiles:string[]; audioIntakeIds?:string[]; keyterms?:string[] };

const ROLE_FOR = (role:string) => role.replaceAll("_"," ").toLowerCase();
function clock(seconds:number|null){ if(seconds===null||!Number.isFinite(seconds))return "--:--"; const total=Math.floor(seconds); return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`; }

export default function WorkspaceScreen({ deposition, audioIndex = 0, onBack }:{ deposition:WorkspaceDeposition; audioIndex?:number; onBack:()=>void }) {
  const depositionId = deposition.id;
  const [rendered,setRendered] = useState<Rendered|null>(null);
  const [candidates,setCandidates] = useState<Candidate[]>([]);
  const [roles,setRoles] = useState<string[]>([]);
  const [examiner,setExaminer] = useState<string>("");
  // Anchor and extent, not a point. wordId stays the anchor so every existing single-word
  // operation keeps addressing exactly what it addressed before; extentWordId is null until the
  // reporter extends. A range may cross paragraphs -- turn boundaries are the thing a correction
  // pass is meant to question, so a selection that could not span them would be useless for it.
  const [selected,setSelected] = useState<{ paragraphId:string; wordId:string; extentWordId:string|null }|null>(null);
  const [editing,setEditing] = useState<{ wordId:string; text:string }|null>(null);
  const [error,setError] = useState("");
  const [errorCode,setErrorCode] = useState("");
  const [busy,setBusy] = useState(false);
  const [showSpeakers,setShowSpeakers] = useState(false);
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

  // A token rather than a callback, so the effect owns the fetch and every setState happens
  // inside the promise rather than in the effect body -- which also gives the cancellation the
  // previous shape lacked: switching examiner mid-flight would otherwise let a stale response
  // overwrite a fresh one.
  const [reloadToken,setReloadToken] = useState(0);
  const reload = useCallback(()=>setReloadToken(token=>token+1),[]);
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
        const [renderRes,candidateRes,mediaRes] = await Promise.all([
          fetch(`${API}/api/transcript/rendered?depositionId=${encodeURIComponent(depositionId)}${examiner?`&examinerIdentity=${encodeURIComponent(examiner)}`:""}`),
          fetch(`${API}/api/transcript/speaker-candidates?depositionId=${encodeURIComponent(depositionId)}`),
          fetch(`${API}/api/depositions/playback?id=${encodeURIComponent(depositionId)}&index=${audioIndex}&meta=1`),
        ]);
        if(mediaRes.ok && !cancelled) setMedia(await mediaRes.json());
        const body = await renderRes.json();
        if(cancelled) return;
        if(!renderRes.ok){ setErrorCode(String(body.code||"")); throw new Error(body.error||"Could not load the transcript."); }
        setRendered(body);
        if(candidateRes.ok){ const data=await candidateRes.json(); if(!cancelled){ setCandidates(data.candidates||[]); setRoles(data.roles||[]); } }
        if(!cancelled){ setError(""); setErrorCode(""); }
      } catch(e){ if(!cancelled) setError(e instanceof Error?e.message:"Could not load the transcript."); }
    })();
    return ()=>{ cancelled = true; };
  },[depositionId,examiner,audioIndex,reloadToken]);

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

  async function post(path:string, payload:Record<string,unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}${path}`,{ method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(payload) });
      const body = await response.json();
      if(!response.ok) throw new Error(body.error||"The edit could not be saved.");
      reload();
      return true;
    } catch(e){ setError(e instanceof Error?e.message:"The edit could not be saved."); return false; }
    finally { setBusy(false); }
  }
  const append = (operations:Operation[]) => post("/api/transcript/overlay",{ depositionId, operations });

  function seek(seconds:number|null){ if(seconds===null||!player.current)return; player.current.currentTime=seconds; void player.current.play().catch(()=>{}); }

  // The reporter's core move: pick the word a new paragraph should start at, then choose what
  // that paragraph is. Splitting at the first word would produce an empty half, so the label is
  // applied to the paragraph itself in that case rather than creating one.
  // Both operations address a word, never a segment. A rendered paragraph can span several
  // segments and the client cannot tell which one holds a given word; addressing by word lets
  // the server resolve it, and after a split the segment holding the anchor is the new tail.
  function relabel(paragraph:Paragraph, speakerIdentity:string|null, transcriptRole:string|null) {
    const anchor = selected?.paragraphId===paragraph.id ? selected.wordId : paragraph.words[0]?.id;
    if(!anchor) return;
    const operations:Operation[] = [];
    if(paragraph.words[0]?.id !== anchor) operations.push({ op:"split", beforeWordId:anchor });
    operations.push({ op:"label", wordId:anchor, speakerIdentity, transcriptRole });
    setSelected(null);
    void append(operations);
  }

  const active = rendered?.paragraphs.find(paragraph => paragraph.id===selected?.paragraphId) ?? null;
  const speakerMapStatus = rendered?.speakerMap?.status ?? "unreconciled";
  // A transcript with paragraphs and no speaker map renders entirely as colloquy. That is
  // correct -- Q. and A. require knowing who is examining, and nothing should infer it from the
  // presence of a roster -- but on screen it is indistinguishable from labelling being broken.
  // Saying so is the difference between working-as-designed and apparently-failing.
  const awaitingSpeakerMap = Boolean(rendered?.counts.paragraphs) && speakerMapStatus === "unreconciled";
  const unassignedSpeakers = useMemo(()=>(rendered?.paragraphs ?? []).filter(paragraph=>paragraph.unlabeledSpeaker).length,[rendered]);
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
  const inRange = useCallback((wordId:string)=>{
    if(!range) return false;
    const index = wordOrder.get(wordId);
    return index!==undefined && index>=range.first && index<=range.last;
  },[range,wordOrder]);
  const rangeWords = range ? range.last-range.first+1 : 0;

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
        <audio ref={player} controls preload="metadata" crossOrigin="anonymous" src={playbackSource ?? undefined}>
          <track kind="captions" label="No captions" src="data:text/vtt,WEBVTT" default />
        </audio>
        {!playbackSource && media?.needsProxy && (
          <button type="button" onClick={()=>{ void buildProxy(); }} disabled={building}>
            {building ? "Preparing audio… (about a minute)" : "Prepare audio for playback"}
          </button>
        )}
        <span className="workspace-counts">
          {rendered ? `${rendered.counts.paragraphs} paragraphs · ${rendered.counts.words} words · ${rendered.counts.operations} edits` : "Loading…"}
          {busy && " · saving…"}
          {/* Carried over when the Read-through screen was retired. The content hash is the
              transcript's identity -- what a correction pass invalidates against and what a
              reporter would cite for a certified page -- and it was shown on no other surface.
              The unassigned count is here because a transcript with unlabelled speakers is not
              finished, and the source-job count because more than one is how a duplicate
              transcription became visible. */}
          {rendered && unassignedSpeakers > 0 && <span className="workspace-flag"> · {unassignedSpeakers} unassigned</span>}
          {rendered && (rendered.derivedFrom?.length ?? 0) > 1 && <span className="workspace-flag"> · {rendered.derivedFrom?.length} source jobs</span>}
          {rendered?.transcriptContentHash && <span className="workspace-hash" title={rendered.transcriptContentHash}> · {rendered.transcriptContentHash.slice(0,12)}</span>}
        </span>
        <button type="button" onClick={()=>void post("/api/transcript/overlay/undo",{ depositionId })} disabled={busy||!rendered?.counts.operations}>Undo last edit</button>
      </header>

      {/* A deposition that has not been transcribed yet is not a deposition that failed. The
          render endpoint reports a missing working transcript as an error because for every
          other caller it is one; here it is the ordinary starting state, and the panel below
          already says what to do about it. Suppressed only when there is audio waiting -- with
          no audio at all, something really is wrong and the reporter should see it. */}
      {error && !notTranscribedYet && <p className="analysis-error" role="alert">{error}</p>}
      {rendered && rendered.findings.length>0 && (
        <ul className="workspace-findings" role="alert">
          {rendered.findings.slice(0,6).map((finding,index)=><li key={`${finding.code}:${index}`}>{finding.message}</li>)}
        </ul>
      )}

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

      <div className="workspace-body">
        <section className="workspace-transcript" aria-label="Transcript">
          {rendered?.paragraphs.map(paragraph=>(
            <article key={paragraph.id} className={`wp ${paragraph.elementType.toLowerCase()} ${selected?.paragraphId===paragraph.id?"selected":""}`}>
              <button type="button" className="wp-time" onClick={()=>seek(paragraph.start)} aria-label={`Play from ${clock(paragraph.start)}`}>{clock(paragraph.start)}</button>
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
                    className={`wp-word ${word.deleted?"struck":""} ${word.edited?"edited":""} ${word.authored?"authored":""} ${inRange(word.id)?"in-range":""} ${selected?.wordId===word.id?"picked":""}`}
                    aria-label={`${word.display ?? word.text}${word.deleted?", struck":""}${word.edited?", corrected":""}${inRange(word.id)?", in the selected range":""}. Select to edit or split here, or hold shift to extend the selection to here.`}
                    onClick={event=>{ if(event.shiftKey && selected) setSelected({ ...selected, extentWordId:word.id }); else setSelected({ paragraphId:paragraph.id, wordId:word.id, extentWordId:null }); setEditing(null); }}
                    onDoubleClick={()=>{ if(!word.authored) setEditing({ wordId:word.id, text:word.text }); }}
                  >{word.display ?? word.text}</button>
                  </Fragment>
                ))}
              </p>
            </article>
          ))}
        </section>

        <aside className="workspace-menu" aria-label="Paragraph labels">
          <h2>Label</h2>
          <p className="workspace-hint">
            {range ? `${rangeWords} words selected. Choosing a label still acts on the anchor word; single-word edits are unavailable while a range is selected.`
              : active ? `Selected "${active.words.find(word=>word.id===selected?.wordId)?.text ?? ""}". Choosing a label starts a new paragraph at that word. Hold shift and click another word to select a range.`
              : "Click a word, then choose what its paragraph should be."}
          </p>
          <button type="button" disabled={!active||busy} onClick={()=>active&&relabel(active,candidates.find(item=>item.defaultRole==="QUESTIONING_ATTORNEY")?.id??examiner??null,"QUESTIONING_ATTORNEY")}>Q.</button>
          <button type="button" disabled={!active||busy} onClick={()=>active&&relabel(active,candidates.find(item=>item.defaultRole==="WITNESS")?.id??null,"WITNESS")}>A.</button>
          <h3>Colloquy</h3>
          {candidates.map(candidate=>(
            <button type="button" key={candidate.id} disabled={!active||busy} onClick={()=>active&&relabel(active,candidate.id,candidate.defaultRole)}>
              {rendered?.labels?.[candidate.id] ?? candidate.label}
            </button>
          ))}
          {editing && (
            <form className="workspace-edit" onSubmit={event=>{ event.preventDefault(); const text=editing.text.trim(); setEditing(null); if(text) void append([{ op:"replace", wordId:editing.wordId, text }]); }}>
              <label htmlFor="workspace-word-edit">Correct this word</label>
              {/* Focused via a callback ref rather than autoFocus. The a11y objection to
                  autoFocus is disorientation on page load; this input appears only in response
                  to the reporter choosing "Correct the word", where moving focus to it is the
                  expected behaviour and skipping it would strand keyboard users. */}
              <input id="workspace-word-edit" value={editing.text} ref={node=>{ node?.focus(); }} onChange={event=>setEditing({ ...editing, text:event.target.value })} />
              <button type="submit" className="primary-button" disabled={busy}>Save</button>
              <button type="button" onClick={()=>setEditing(null)}>Cancel</button>
            </form>
          )}
          {/* Hidden while a range is selected: a range is not a word, and leaving "Strike the
              word" pointing at the anchor invites striking one word when eleven look selected. */}
          {selected && !editing && !range && (
            <>
              <h3>This word</h3>
              <button type="button" disabled={busy} onClick={()=>{ const word=active?.words.find(item=>item.id===selected.wordId); if(word) setEditing({ wordId:word.id, text:word.text }); }}>Correct the word</button>
              <button type="button" disabled={busy} onClick={()=>{ const id=selected.wordId; setSelected(null); void append([{ op:"delete", wordId:id }]); }}>Strike the word</button>
            </>
          )}

          <h2>Speakers</h2>
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
            <button type="button" className="primary-button" disabled={busy} onClick={()=>{ void (async ()=>{
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
        </aside>
      </div>
    </main>
  );
}
