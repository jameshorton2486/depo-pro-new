"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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
export const WorkspaceDocumentPage=memo(function WorkspaceDocumentPage({page,profile,selectedParagraphId,selectedWordId,activePlaybackWordId,lowConfidenceWordIds,activeEdit,onActivate,onChange,onSave,onCancel,onSplit,onJoinPrevious,onJoinNext,onPlayAt}:{page:DocumentPage;profile:LayoutProfile;selectedParagraphId:string|null;selectedWordId:string|null;activePlaybackWordId:string|null;lowConfidenceWordIds:Set<string>;activeEdit:ActiveEdit|null;onActivate:(paragraphId:string,wordId:string,shiftKey:boolean,lineKey:string,offset:number,play:boolean)=>void;onChange:(text:string,caret:number)=>void;onSave:()=>void;onCancel:()=>void;onSplit:(caret:number)=>void;onJoinPrevious:()=>void;onJoinNext:()=>void;onPlayAt:(seconds:number)=>void}){
  const editor=useRef<HTMLTextAreaElement|null>(null);
  useEffect(()=>{if(!editor.current||!activeEdit)return;editor.current.focus();editor.current.setSelectionRange(activeEdit.caret,activeEdit.caret)},[activeEdit]);
  return <article className={`workspace-paper ${page.sectionKind??"testimony"}`} style={geometryStyle(profile)} data-layout-profile={`${profile.id}@${profile.version}`} data-page={page.pageNumber} data-page-role={page.role??"testimony"} aria-label={`${page.role??"Testimony"} page ${page.pageNumber}`}><div className="workspace-format-box" aria-hidden="true"/>
    <ol>{page.lines.map(line=>{const lineKey=`${page.pageNumber}:${line.position}`,editing=activeEdit?.lineKey===lineKey,lineAudioStart=line.fragments.find(fragment=>Number.isFinite(fragment.audioStart))?.audioStart;return <li className={`${line.occupied?"occupied":"blank"} ${line.paragraphId===selectedParagraphId?"selected":""} ${editing?"direct-editing":""}`} key={line.position}>
      <span className="workspace-line-number">{line.position}</span>
      {lineAudioStart!==null&&lineAudioStart!==undefined&&<button type="button" className="workspace-line-time" aria-label={`Save the open paragraph and play audio from ${audioClock(lineAudioStart)}`} onClick={()=>onPlayAt(lineAudioStart)}>▶ {audioClock(lineAudioStart)}</button>}
      {editing?<textarea ref={editor} className="workspace-direct-editor" aria-label="Edit selected transcript paragraph" value={activeEdit.draft}
        onChange={event=>onChange(event.target.value,event.target.selectionStart)} onBlur={onSave}
        onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==="s"){event.preventDefault();onSave();return}if(event.key==="Enter"){event.preventDefault();onSplit(event.currentTarget.selectionStart);return}if(event.key==="Backspace"&&event.currentTarget.selectionStart===0&&event.currentTarget.selectionEnd===0){event.preventDefault();onJoinPrevious();return}if(event.key==="Delete"&&event.currentTarget.selectionStart===activeEdit.draft.length&&event.currentTarget.selectionEnd===activeEdit.draft.length){event.preventDefault();onJoinNext();return}if(event.key==="Escape"){event.preventDefault();onCancel()}}}/>
      :<code>{line.fragments.length?line.fragments.map((fragment,index)=>fragment.kind==="generated"
        ? <span className="workspace-generated" data-evidence="false" key={`${fragment.id}:${index}`}>{fragment.text}</span>
        : <button type="button" className={`workspace-page-token ${fragment.kind} ${selectedWordId===fragment.id?"picked":""} ${activePlaybackWordId===fragment.id?"playing":""} ${lowConfidenceWordIds.has(fragment.id)?"low-confidence":""}`}
            data-token-id={fragment.id} data-evidence={fragment.kind==="evidence"} key={`${fragment.id}:${index}`}
            onClick={event=>{event.stopPropagation();if(page.editable===false||!line.paragraphId)return;onActivate(line.paragraphId,fragment.id,event.shiftKey,lineKey,fragment.sourceStart??0,event.altKey)}}>{fragment.text}</button>):line.content}</code>}
    </li>})}</ol>
    <footer>Page {page.pageNumber}</footer>
  </article>;
});

export default function WorkspaceDocumentPages({pages,profile,paragraphs,selectedParagraphId,selectedWordId,activePlaybackWordId,lowConfidenceWordIds,onSelect,onSaveParagraph,onSplitParagraph,onJoinParagraph,onPlayParagraph,onPlayAt,onEditingChange}:{pages:DocumentPage[];profile:LayoutProfile;paragraphs:EditableParagraph[];selectedParagraphId:string|null;selectedWordId:string|null;activePlaybackWordId:string|null;lowConfidenceWordIds:Set<string>;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void;onSaveParagraph:(paragraphId:string,before:string,after:string,caret:number)=>Promise<boolean>;onSplitParagraph:(paragraphId:string,caret:number)=>Promise<boolean>;onJoinParagraph:(paragraphId:string,direction:"previous"|"next")=>Promise<boolean>;onPlayParagraph:(paragraphId:string)=>void;onPlayAt:(seconds:number)=>void;onEditingChange:(editing:boolean)=>void}){
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
  async function structural(kind:"split"|"previous"|"next",caret=activeEdit?.caret??0){const edit=activeEdit;if(!edit||edit.status==="saving")return;if(edit.draft!==edit.baseText){await save();return}const ok=kind==="split"?await onSplitParagraph(edit.paragraphId,caret):await onJoinParagraph(edit.paragraphId,kind);if(ok)setActiveEdit(null)}
  return <section className="workspace-document" aria-label="Direct-edit final-document transcript">
    <nav className="workspace-page-nav" aria-label="Transcript page navigation">
      <button type="button" disabled={bounded<=1} onClick={()=>go(bounded-1)}>Previous page</button>
      <label>Page <input aria-label="Go to transcript page" type="number" min={1} max={total} value={bounded} onChange={event=>go(Number(event.target.value))}/></label>
      <span>of {total}{selectedPage&&selectedPage!==bounded?` · selection on ${selectedPage}`:""}</span>
      <button type="button" disabled={bounded>=total} onClick={()=>go(bounded+1)}>Next page</button>
      {activeEdit&&<span className={`workspace-edit-status ${activeEdit.status}`} role="status">{activeEdit.status==="saving"?"Saving…":activeEdit.status==="saved"?"Saved ✓":activeEdit.status==="conflict"?"Conflict detected · local draft preserved":activeEdit.status==="failed"?"Save failed · local draft preserved":"Editing · autosave on"}</span>}
      <span className="workspace-geometry-note">Shared-model pages · one-paragraph editing</span>
    </nav>
    <p className="workspace-direct-edit-help">Click any testimony word to edit its complete paragraph. Clicking another word, paragraph, or timestamp saves the open paragraph before moving. Press Enter at the cursor to split there; Backspace at the beginning or Delete at the end joins paragraphs. Alt-click plays the paragraph.</p>
    <div className="workspace-page-flow" ref={scroller} onScroll={observeScroll}>
      {pages.map(page=><WorkspaceDocumentPage key={page.id} page={page} profile={profile} selectedParagraphId={selectedParagraphId} selectedWordId={selectedWordId} activePlaybackWordId={activePlaybackWordId} lowConfidenceWordIds={lowConfidenceWordIds} activeEdit={activeEdit} onActivate={(...args)=>{void activate(...args)}} onChange={(draft,caret)=>setActiveEdit(activeEdit?{...activeEdit,draft,caret,status:"editing"}:null)} onSave={()=>{void save()}} onCancel={()=>setActiveEdit(null)} onSplit={caret=>{void structural("split",caret)}} onJoinPrevious={()=>{void structural("previous")}} onJoinNext={()=>{void structural("next")}} onPlayAt={seconds=>{void playAt(seconds)}}/>) }
    </div>
  </section>;
}
