"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { pageRenderEqual } from "./workspace-page-render.mjs";
import { guardAction } from "./unsaved-edit-guard.mjs";

export type DocumentFragment={id:string;kind:"evidence"|"authored"|"generated";role:string;text:string;sourceWordId:string|null;sourceStart?:number;sourceEnd?:number;audioStart?:number|null;audioEnd?:number|null};
export type DocumentLine={position:number;occupied:boolean;content:string;paragraphId:string|null;fragments:DocumentFragment[]};
export type DocumentPage={id:string;pageNumber:number;role?:string;sectionKind?:"administrative"|"testimony";editable?:boolean;lines:DocumentLine[]};
export type EditableParagraph={id:string;text:string};
type ActiveEdit={paragraphId:string;lineKey:string;draft:string;baseText:string;caret:number;status:"editing"|"saving"|"saved"|"conflict"|"failed"};
export type LayoutProfile={id:string;version:string;linesPerPage:number;font:{family:string;pointSize:number};formatBox:{leftInches:number;rightClearanceInches:number;widthInches:number;topInches:number;heightInches:number;borderPoints:number};text:{leftMarginTwips:number;rightMarginTwips:number;topMarginTwips:number;lineSpacingTwips:number};lineNumbers:{distanceTwips:number}};
function geometryStyle(profile:LayoutProfile):CSSProperties{return {"--page-font":profile.font.family,"--page-font-size":`${profile.font.pointSize}pt`,"--box-left":`${profile.formatBox.leftInches}in`,"--box-top":`${profile.formatBox.topInches}in`,"--box-width":`${profile.formatBox.widthInches}in`,"--box-height":`${profile.formatBox.heightInches}in`,"--box-border":`${profile.formatBox.borderPoints}pt`,"--text-left":`${profile.text.leftMarginTwips/1440}in`,"--text-top":`${profile.text.topMarginTwips/1440}in`,"--line-height":`${profile.text.lineSpacingTwips/20}pt`,"--line-number-gap":`${profile.lineNumbers.distanceTwips/1440}in`,"--page-number-right":`${profile.formatBox.rightClearanceInches}in`} as CSSProperties}
function audioClock(seconds:number){const total=Math.max(0,Math.floor(seconds));return `${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`}

// React renders physical lines already decided by the shared paginator. The temporary textarea
// is a controlled editor for one canonical paragraph; after save the server model repaginates it.
// It never decides permanent line or page boundaries.
// memo has always been here and never once prevented a render: the container below handed every page
// eight freshly built arrow handlers and a new Set, so the shallow comparison failed nine ways and
// all 63 pages of a real deposition reconciled on every keystroke and every click -- 856ms of
// blocked main thread, measured, for a click that only moved the selection.
//
// pageRenderEqual compares what the page actually draws. It is deliberately strict about the
// handlers too: if the container regresses to unstable ones the screen gets slow again, rather than
// drawing pages that hold a stale closure over the open edit.
export const WorkspaceDocumentPage=memo(function WorkspaceDocumentPage({page,profile,selectedParagraphId,selectedWordId,activePlaybackWordId,lowConfidenceWordIds,activeEdit,onActivate,onChange,onSave,onCancel,onJoinPrevious,onJoinNext,onPlayAt}:{page:DocumentPage;profile:LayoutProfile;selectedParagraphId:string|null;selectedWordId:string|null;activePlaybackWordId:string|null;lowConfidenceWordIds:Set<string>;activeEdit:ActiveEdit|null;onActivate:(paragraphId:string,wordId:string,shiftKey:boolean,lineKey:string,offset:number,play:boolean)=>void;onChange:(text:string,caret:number)=>void;onSave:()=>void;onCancel:()=>void;onJoinPrevious:()=>void;onJoinNext:()=>void;onPlayAt:(seconds:number)=>void}){
  const editor=useRef<HTMLTextAreaElement|null>(null);
  useEffect(()=>{if(!editor.current||!activeEdit)return;editor.current.focus();editor.current.setSelectionRange(activeEdit.caret,activeEdit.caret)},[activeEdit]);
  return <article className={`workspace-paper ${page.sectionKind??"testimony"}`} style={geometryStyle(profile)} data-layout-profile={`${profile.id}@${profile.version}`} data-page={page.pageNumber} data-page-role={page.role??"testimony"} aria-label={`${page.role??"Testimony"} page ${page.pageNumber}`}><div className="workspace-format-box" aria-hidden="true"/>
    {/* How many physical lines this paragraph already occupies here. The editor is sized to
        exactly that, so it sits in the paragraph's own place instead of over the testimony below
        it. Before this it was a fixed 108px box with a drop shadow -- anchored to the line, but
        covering four or five lines of the surrounding record while the reporter typed, which is
        the one thing a reporter correcting a deposition cannot afford to lose sight of. */}
    <ol>{page.lines.map(line=>{const lineKey=`${page.pageNumber}:${line.position}`,editing=activeEdit?.lineKey===lineKey,lineAudioStart=line.fragments.find(fragment=>Number.isFinite(fragment.audioStart))?.audioStart,editedLines=editing?Math.max(1,page.lines.filter(item=>item.paragraphId===activeEdit.paragraphId).length):1;return <li className={`${line.occupied?"occupied":"blank"} ${line.paragraphId&&line.paragraphId===selectedParagraphId?"selected":""} ${editing?"direct-editing":""}`} key={line.position}>
      <span className="workspace-line-number">{line.position}</span>
      {lineAudioStart!==null&&lineAudioStart!==undefined&&<button type="button" className="workspace-line-time" aria-label={`Save the open paragraph and play audio from ${audioClock(lineAudioStart)}`} onClick={()=>onPlayAt(lineAudioStart)}>▶ {audioClock(lineAudioStart)}</button>}
      {editing?<textarea ref={editor} className="workspace-direct-editor" aria-label="Edit selected transcript paragraph" value={activeEdit.draft}
        style={{height:`calc(${editedLines} * var(--line-height))`}}
        onChange={event=>onChange(event.target.value,event.target.selectionStart)} onBlur={onSave}
        onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==="s"){event.preventDefault();onSave();return}if(event.key==="Enter"&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();return}if(event.key==="Backspace"&&event.currentTarget.selectionStart===0&&event.currentTarget.selectionEnd===0){event.preventDefault();onJoinPrevious();return}if(event.key==="Delete"&&event.currentTarget.selectionStart===activeEdit.draft.length&&event.currentTarget.selectionEnd===activeEdit.draft.length){event.preventDefault();onJoinNext();return}if(event.key==="Escape"){event.preventDefault();onCancel()}}}/>
      :<code>{line.fragments.length?line.fragments.map((fragment,index)=>fragment.kind==="generated"
        // The designation -- SPEAKER 4:, Q., THE WITNESS: -- selects the paragraph it belongs to.
        //
        // The reporter reported this as "the WHO SPOKE? buttons are disabled". They had clicked
        // SPEAKER 4:, which is exactly where you aim when you want to change who spoke, and it was
        // generated text with no handler: the click did nothing, and dragging across it left a grey
        // browser text-selection that reads as a selection. Nothing was wrong with the controls.
        // Nothing had been selected.
        //
        // Only the fragment carrying the designation. The generated single spaces between words are
        // left as text, because a button per space is not a target, it is a hazard.
        ? (line.paragraphId&&fragment.text.trim()&&page.editable!==false
          ? <button type="button" className="workspace-page-label" data-evidence="false" key={`${fragment.id}:${index}`}
              title="Select this paragraph"
              onClick={event=>{event.stopPropagation();const first=line.fragments.find(item=>item.kind!=="generated");if(first)onActivate(line.paragraphId as string,first.id,false,lineKey,0,false)}}>{fragment.text}</button>
          : <span className="workspace-generated" data-evidence="false" key={`${fragment.id}:${index}`}>{fragment.text}</span>)
        : <button type="button" className={`workspace-page-token ${fragment.kind} ${selectedWordId===fragment.id?"picked":""} ${activePlaybackWordId===fragment.id?"playing":""} ${lowConfidenceWordIds.has(fragment.id)?"low-confidence":""}`}
            data-token-id={fragment.id} data-evidence={fragment.kind==="evidence"} key={`${fragment.id}:${index}`}
            onClick={event=>{event.stopPropagation();if(page.editable===false||!line.paragraphId)return;onActivate(line.paragraphId,fragment.id,event.shiftKey,lineKey,fragment.sourceStart??0,event.altKey)}}>{fragment.text}</button>):line.content}</code>}
    </li>})}</ol>
    <footer>Page {page.pageNumber}</footer>
  </article>;
},pageRenderEqual);

export default function WorkspaceDocumentPages({pages,profile,paragraphs,selectedParagraphId,selectedWordId,activePlaybackWordId,lowConfidenceWordIds,onSelect,onSaveParagraph,onJoinParagraph,onPlayParagraph,onPlayAt,onEditingChange}:{pages:DocumentPage[];profile:LayoutProfile;paragraphs:EditableParagraph[];selectedParagraphId:string|null;selectedWordId:string|null;activePlaybackWordId:string|null;lowConfidenceWordIds:Set<string>;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void;onSaveParagraph:(paragraphId:string,before:string,after:string,caret:number)=>Promise<boolean>;onJoinParagraph:(paragraphId:string,direction:"previous"|"next")=>Promise<boolean>;onPlayParagraph:(paragraphId:string)=>void;onPlayAt:(seconds:number)=>void;onEditingChange:(editing:boolean)=>void}){
  const scroller=useRef<HTMLDivElement|null>(null),saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),activeEditRef=useRef<ActiveEdit|null>(null),savePromise=useRef<Promise<boolean>|null>(null),[currentPage,setCurrentPage]=useState(1),[storedEdit,setActiveEdit]=useState<ActiveEdit|null>(null);
  const total=pages.length,paragraphById=useMemo(()=>new Map(paragraphs.map(paragraph=>[paragraph.id,paragraph])),[paragraphs]);
  const savedCanonical=storedEdit?.status==="saved"?paragraphById.get(storedEdit.paragraphId)?.text:undefined;
  const activeEdit=useMemo(()=>storedEdit&&savedCanonical!==undefined&&savedCanonical!==storedEdit.baseText
    ?{...storedEdit,draft:savedCanonical,baseText:savedCanonical,caret:Math.min(storedEdit.caret,savedCanonical.length)}:storedEdit,[storedEdit,savedCanonical]);
  const saveRef=useRef<()=>Promise<void>>(async()=>{});
  const bounded=Math.min(Math.max(currentPage,1),Math.max(total,1));
  const pageByParagraph=useMemo(()=>{const map=new Map<string,number>();for(const page of pages)for(const line of page.lines)if(line.paragraphId&&!map.has(line.paragraphId))map.set(line.paragraphId,page.pageNumber);return map},[pages]);
  const selectedPage=selectedParagraphId?pageByParagraph.get(selectedParagraphId):null;
  function go(page:number){const value=Math.min(Math.max(page,1),total);scroller.current?.querySelector<HTMLElement>(`[data-page="${value}"]`)?.scrollIntoView({behavior:"smooth",block:"start"});setCurrentPage(value)}
  function observeScroll(){const root=scroller.current;if(!root)return;const top=root.getBoundingClientRect().top;let nearest=bounded,distance=Infinity;for(const node of root.querySelectorAll<HTMLElement>("[data-page]")){const value=Math.abs(node.getBoundingClientRect().top-top);if(value<distance){distance=value;nearest=Number(node.dataset.page)}}setCurrentPage(nearest)}
  useEffect(()=>{onEditingChange(Boolean(activeEdit));return()=>onEditingChange(false)},[activeEdit,onEditingChange]);
  useEffect(()=>{activeEditRef.current=activeEdit},[activeEdit]);
  useEffect(()=>{if(saveTimer.current)clearTimeout(saveTimer.current);if(activeEdit?.status==="editing"&&activeEdit.draft!==activeEdit.baseText)saveTimer.current=setTimeout(()=>{void saveRef.current()},1200);return()=>{if(saveTimer.current)clearTimeout(saveTimer.current)}},[activeEdit?.draft,activeEdit?.baseText,activeEdit?.status]);
  // The debounce above leaves up to 1.2 seconds of typing uncommitted, and a closing tab does not
  // wait for it. Two listeners, doing deliberately different things -- see unsaved-edit-guard.mjs
  // for why saving during unload is not one of the options.
  //
  // Hiding is where the save happens: visibilitychange fires when the tab is backgrounded or
  // closed and still permits asynchronous work, so the existing save runs. No second save path --
  // the same saveRef, so nothing can commit a paragraph a different way.
  //
  // Unloading only warns. If the edit is somehow still dirty by then the browser is asked to
  // confirm, which does not preserve the text but does stop it disappearing without a word.
  useEffect(()=>{
    const onHide=()=>{if(document.visibilityState==="hidden"&&guardAction("hide",activeEditRef.current)==="flush")void saveRef.current()};
    const onUnload=(event:BeforeUnloadEvent)=>{if(guardAction("unload",activeEditRef.current)!=="warn")return;event.preventDefault();event.returnValue=""};
    document.addEventListener("visibilitychange",onHide);
    window.addEventListener("beforeunload",onUnload);
    return()=>{document.removeEventListener("visibilitychange",onHide);window.removeEventListener("beforeunload",onUnload)};
  },[]);
  function openEdit(paragraphId:string,lineKey:string,offset:number){const paragraph=paragraphById.get(paragraphId);if(!paragraph)return;setActiveEdit({paragraphId,lineKey,draft:paragraph.text,baseText:paragraph.text,caret:Math.min(offset,paragraph.text.length),status:"editing"})}
  async function save(){
    if(savePromise.current)return savePromise.current;
    const edit=activeEditRef.current;
    if(!edit||edit.draft===edit.baseText)return true;
    const pending=(async()=>{setActiveEdit(current=>current?.paragraphId===edit.paragraphId?{...current,status:"saving"}:current);const ok=await onSaveParagraph(edit.paragraphId,edit.baseText,edit.draft,edit.caret);setActiveEdit(current=>!current||current.paragraphId!==edit.paragraphId?current:{...current,baseText:ok?current.draft:current.baseText,status:ok?"saved":"conflict"});return ok})();
    savePromise.current=pending;try{return await pending}finally{savePromise.current=null}
  }
  useEffect(()=>{saveRef.current=async()=>{await save()}});
  async function activate(paragraphId:string,wordId:string,shiftKey:boolean,lineKey:string,offset:number,play:boolean){
    if(!(await save()))return;
    setActiveEdit(null);
    onSelect(paragraphId,wordId,shiftKey);
    if(play){onPlayParagraph(paragraphId);return}
    if(!shiftKey)openEdit(paragraphId,lineKey,offset);
  }
  async function playAt(seconds:number){if(!(await save()))return;setActiveEdit(null);onPlayAt(seconds)}
  // Joining only. Splitting is the tools panel's Split here, anchored to the selected word rather
  // than to a caret offset -- bare Enter used to do it, and a structural change to a court record
  // is not something a reflex during typing should cause.
  async function structural(kind:"previous"|"next"){const edit=activeEdit;if(!edit||edit.status==="saving")return;if(edit.draft!==edit.baseText){await save();return}const ok=await onJoinParagraph(edit.paragraphId,kind);if(ok)setActiveEdit(null)}

  // Stable handler identities, so pageRenderEqual can hold back the pages that did not change.
  //
  // They are refs rather than useCallback dependencies on purpose. Every one of these reads the
  // CURRENT open edit, and a callback that listed activeEdit as a dependency would get a new
  // identity on every keystroke -- which is exactly the thing being fixed. Reading through
  // activeEditRef keeps the identity fixed and the value fresh; a stale closure here would save one
  // paragraph's text over another's.
  const structuralRef=useRef(structural),activateRef=useRef(activate),playAtRef=useRef(playAt);
  // Assigned in an effect, not during render -- the same rule saveRef above already follows.
  useEffect(()=>{structuralRef.current=structural;activateRef.current=activate;playAtRef.current=playAt});
  const onPageActivate=useCallback((...args:[string,string,boolean,string,number,boolean])=>{void activateRef.current(...args)},[]);
  const onPageChange=useCallback((draft:string,caret:number)=>setActiveEdit(current=>current?{...current,draft,caret,status:"editing"}:null),[]);
  const onPageSave=useCallback(()=>{void saveRef.current()},[]);
  const onPageCancel=useCallback(()=>setActiveEdit(null),[]);
  const onPageJoinPrevious=useCallback(()=>{void structuralRef.current("previous")},[]);
  const onPageJoinNext=useCallback(()=>{void structuralRef.current("next")},[]);
  const onPagePlayAt=useCallback((seconds:number)=>{void playAtRef.current(seconds)},[]);
  return <section className="workspace-document" aria-label="Direct-edit final-document transcript">
    <nav className="workspace-page-nav" aria-label="Transcript page navigation">
      <button type="button" disabled={bounded<=1} onClick={()=>go(bounded-1)}>Previous page</button>
      <label>Page <input aria-label="Go to transcript page" type="number" min={1} max={total} value={bounded} onChange={event=>go(Number(event.target.value))}/></label>
      <span>of {total}{selectedPage&&selectedPage!==bounded?` · selection on ${selectedPage}`:""}</span>
      <button type="button" disabled={bounded>=total} onClick={()=>go(bounded+1)}>Next page</button>
      {activeEdit&&<span className={`workspace-edit-status ${activeEdit.status}`} role="status">{activeEdit.status==="saving"?"Saving…":activeEdit.status==="saved"?"Saved ✓":activeEdit.status==="conflict"?"Conflict detected · local draft preserved":activeEdit.status==="failed"?"Save failed · local draft preserved":"Editing · autosave on"}</span>}
      <span className="workspace-geometry-note">Shared-model pages · one-paragraph editing</span>
    </nav>
    {/* This still told the reporter that the Enter key would split a paragraph, after Enter stopped
        doing so. That is worse than saying nothing: it instructs somebody to press a key that now
        does nothing, and they would reasonably conclude the application was broken. Caught by
        looking at the screen, not by a test -- so the test below pins the absence. */}
    <p className="workspace-direct-edit-help">Click any testimony word to edit its complete paragraph. Clicking another word, paragraph, or timestamp saves the open paragraph before moving. Ctrl+S saves; Escape cancels. Use Split here in the transcript tools to start a new paragraph at the selected word; Backspace at the beginning or Delete at the end joins paragraphs. Alt-click plays the paragraph.</p>
    <div className="workspace-page-flow" ref={scroller} onScroll={observeScroll}>
      {pages.map(page=><WorkspaceDocumentPage key={page.id} page={page} profile={profile} selectedParagraphId={selectedParagraphId} selectedWordId={selectedWordId} activePlaybackWordId={activePlaybackWordId} lowConfidenceWordIds={lowConfidenceWordIds} activeEdit={activeEdit} onActivate={onPageActivate} onChange={onPageChange} onSave={onPageSave} onCancel={onPageCancel} onJoinPrevious={onPageJoinPrevious} onJoinNext={onPageJoinNext} onPlayAt={onPagePlayAt}/>) }
    </div>
  </section>;
}
