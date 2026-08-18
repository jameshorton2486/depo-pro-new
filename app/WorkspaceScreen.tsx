"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = "http://127.0.0.1:4317";

type Word = { id:string; text:string; start:number|null; end:number|null; confidence:number|null; deepgramSpeaker:number|null; edited?:boolean; deleted?:boolean; authored?:boolean; originalText?:string };
type Paragraph = { id:string; elementType:string; label:string|null; byLine:string|null; speakerIdentity:string|null; transcriptRole:string|null; deepgramSpeaker:number|null; unlabeledSpeaker:boolean; start:number|null; end:number|null; text:string; words:Word[]; segmentIds:string[]; asrWordIds:string[] };
type Finding = { code:string; message:string };
type Rendered = { paragraphs:Paragraph[]; findings:Finding[]; diarized:boolean; labels:Record<string,string>; counts:{ paragraphs:number; words:number; operations:number; orphaned:number }; speakerMap:{ status:string; assignments:{ sourceJobIdentity:string; deepgramSpeaker:number; speakerIdentity:string; transcriptRole:string }[] }|null };
type Candidate = { id:string; label:string; defaultRole:string };
type Operation = Record<string,unknown>;

const ROLE_FOR = (role:string) => role.replaceAll("_"," ").toLowerCase();
function clock(seconds:number|null){ if(seconds===null||!Number.isFinite(seconds))return "--:--"; const total=Math.floor(seconds); return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`; }

export default function WorkspaceScreen({ depositionId, audioIndex = 0, onBack }:{ depositionId:string; audioIndex?:number; onBack:()=>void }) {
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
  const [busy,setBusy] = useState(false);
  const [showSpeakers,setShowSpeakers] = useState(false);
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
        if(!renderRes.ok) throw new Error(body.error||"Could not load the transcript.");
        setRendered(body);
        if(candidateRes.ok){ const data=await candidateRes.json(); if(!cancelled){ setCandidates(data.candidates||[]); setRoles(data.roles||[]); } }
        if(!cancelled) setError("");
      } catch(e){ if(!cancelled) setError(e instanceof Error?e.message:"Could not load the transcript."); }
    })();
    return ()=>{ cancelled = true; };
  },[depositionId,examiner,audioIndex,reloadToken]);

  // Deepgram speaker buckets with their word counts. The counts are what make the roles obvious:
  // in the observed run two buckets held ~5,900 words each (examiner and witness) while three
  // held a few hundred or fewer (videographer, reporter, defending counsel).
  const buckets = useMemo(()=>{
    const counts = new Map<number,{ words:number; jobIdentity:string; sample:string }>();
    for(const paragraph of rendered?.paragraphs??[]){
      if(paragraph.deepgramSpeaker===null) continue;
      const entry = counts.get(paragraph.deepgramSpeaker) ?? { words:0, jobIdentity:paragraph.segmentIds[0]?.split(":")[0] ?? "", sample:paragraph.text.slice(0,60) };
      entry.words += paragraph.words.length;
      counts.set(paragraph.deepgramSpeaker,entry);
    }
    return [...counts.entries()].sort((a,b)=>b[1].words-a[1].words);
  },[rendered]);

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
        </span>
        <button type="button" onClick={()=>void post("/api/transcript/overlay/undo",{ depositionId })} disabled={busy||!rendered?.counts.operations}>Undo last edit</button>
      </header>

      {error && <p className="analysis-error" role="alert">{error}</p>}
      {rendered && rendered.findings.length>0 && (
        <ul className="workspace-findings" role="alert">
          {rendered.findings.slice(0,6).map((finding,index)=><li key={`${finding.code}:${index}`}>{finding.message}</li>)}
        </ul>
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
                  <button
                    type="button"
                    className={`wp-word ${word.deleted?"struck":""} ${word.edited?"edited":""} ${word.authored?"authored":""} ${inRange(word.id)?"in-range":""} ${selected?.wordId===word.id?"picked":""}`}
                    aria-label={`${word.text}${word.deleted?", struck":""}${word.edited?", corrected":""}${inRange(word.id)?", in the selected range":""}. Select to edit or split here, or hold shift to extend the selection to here.`}
                    onClick={event=>{ if(event.shiftKey && selected) setSelected({ ...selected, extentWordId:word.id }); else setSelected({ paragraphId:paragraph.id, wordId:word.id, extentWordId:null }); setEditing(null); }}
                    onDoubleClick={()=>{ if(!word.authored) setEditing({ wordId:word.id, text:word.text }); }}
                  >{word.text}</button>
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
            {buckets.map(([speaker,info])=>(
              <div key={speaker} className="workspace-bucket">
                <strong>Speaker {speaker}</strong> <small>{info.words} words</small>
                <label htmlFor={`bucket-identity-${speaker}`} className="visually-hidden">Identity for Deepgram speaker {speaker}</label>
                <select id={`bucket-identity-${speaker}`} value={assignments[speaker]?.speakerIdentity??""} onChange={event=>{
                  const candidate=candidates.find(item=>item.id===event.target.value);
                  setAssignments(current=>({ ...current, [speaker]:{ speakerIdentity:event.target.value, transcriptRole:candidate?.defaultRole ?? current[speaker]?.transcriptRole ?? "" } }));
                }}>
                  <option value="">Unassigned</option>
                  {candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
                <label htmlFor={`bucket-role-${speaker}`} className="visually-hidden">Transcript role for Deepgram speaker {speaker}</label>
                <select id={`bucket-role-${speaker}`} value={assignments[speaker]?.transcriptRole??""} onChange={event=>setAssignments(current=>({ ...current, [speaker]:{ speakerIdentity:current[speaker]?.speakerIdentity??"", transcriptRole:event.target.value } }))}>
                  <option value="">Role</option>
                  {roles.map(role=><option key={role} value={role}>{ROLE_FOR(role)}</option>)}
                </select>
                <small className="workspace-sample">{info.sample}…</small>
              </div>
            ))}
            <button type="button" className="primary-button" disabled={busy} onClick={()=>{
              const jobIdentity = rendered?.paragraphs.find(paragraph=>paragraph.segmentIds.length)?.segmentIds[0]?.split(":")[0] ?? "";
              const payload = Object.entries(assignments).filter(([,value])=>value.speakerIdentity&&value.transcriptRole)
                .map(([speaker,value])=>({ sourceJobIdentity:jobIdentity, deepgramSpeaker:Number(speaker), ...value }));
              void post("/api/transcript/speaker-map",{ depositionId, assignments:payload });
            }}>Save speaker map</button>
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
