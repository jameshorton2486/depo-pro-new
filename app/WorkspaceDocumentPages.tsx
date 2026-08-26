"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export type DocumentFragment={id:string;kind:"evidence"|"authored"|"generated";role:string;text:string;sourceWordId:string|null;sourceStart?:number;sourceEnd?:number};
export type DocumentLine={position:number;occupied:boolean;content:string;paragraphId:string|null;fragments:DocumentFragment[]};
export type DocumentPage={id:string;pageNumber:number;role?:string;sectionKind?:"administrative"|"testimony";editable?:boolean;lines:DocumentLine[]};
export type EditableParagraph={id:string;text:string};
type ActiveEdit={paragraphId:string;lineKey:string;draft:string;baseText:string;caret:number;status:"editing"|"saving"|"saved"|"conflict"|"failed"};
export type LayoutProfile={id:string;version:string;linesPerPage:number;font:{family:string;pointSize:number};formatBox:{leftInches:number;rightClearanceInches:number;widthInches:number;topInches:number;heightInches:number;borderPoints:number};text:{leftMarginTwips:number;rightMarginTwips:number;topMarginTwips:number;lineSpacingTwips:number};lineNumbers:{distanceTwips:number}};
function geometryStyle(profile:LayoutProfile):CSSProperties{return {"--page-font":profile.font.family,"--page-font-size":`${profile.font.pointSize}pt`,"--box-left":`${profile.formatBox.leftInches}in`,"--box-top":`${profile.formatBox.topInches}in`,"--box-width":`${profile.formatBox.widthInches}in`,"--box-height":`${profile.formatBox.heightInches}in`,"--box-border":`${profile.formatBox.borderPoints}pt`,"--text-left":`${profile.text.leftMarginTwips/1440}in`,"--text-top":`${profile.text.topMarginTwips/1440}in`,"--line-height":`${profile.text.lineSpacingTwips/20}pt`,"--line-number-gap":`${profile.lineNumbers.distanceTwips/1440}in`,"--page-number-right":`${profile.formatBox.rightClearanceInches}in`} as CSSProperties}

// React renders physical lines already decided by the shared paginator. The temporary textarea
// is a controlled editor for one canonical paragraph; after save the server model repaginates it.
// It never decides permanent line or page boundaries.
export const WorkspaceDocumentPage=memo(function WorkspaceDocumentPage({page,profile,selectedParagraphId,selectedWordId,activePlaybackWordId,lowConfidenceWordIds,activeEdit,onSelect,onBeginEdit,onChange,onSave,onCancel,onSplit,onJoinPrevious,onJoinNext,onPlay}:{page:DocumentPage;profile:LayoutProfile;selectedParagraphId:string|null;selectedWordId:string|null;activePlaybackWordId:string|null;lowConfidenceWordIds:Set<string>;activeEdit:ActiveEdit|null;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void;onBeginEdit:(paragraphId:string,lineKey:string,offset:number)=>void;onChange:(text:string,caret:number)=>void;onSave:()=>void;onCancel:()=>void;onSplit:(caret:number)=>void;onJoinPrevious:()=>void;onJoinNext:()=>void;onPlay:(paragraphId:string)=>void}){
  const editor=useRef<HTMLTextAreaElement|null>(null);
  const clickTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{if(!editor.current||!activeEdit)return;editor.current.focus();editor.current.setSelectionRange(activeEdit.caret,activeEdit.caret)},[activeEdit]);
  return <article className={`workspace-paper ${page.sectionKind??"testimony"}`} style={geometryStyle(profile)} data-layout-profile={`${profile.id}@${profile.version}`} data-page={page.pageNumber} data-page-role={page.role??"testimony"} aria-label={`${page.role??"Testimony"} page ${page.pageNumber}`}><div className="workspace-format-box" aria-hidden="true"/>
    <ol>{page.lines.map(line=>{const lineKey=`${page.pageNumber}:${line.position}`,editing=activeEdit?.lineKey===lineKey;return <li className={`${line.occupied?"occupied":"blank"} ${line.paragraphId===selectedParagraphId?"selected":""} ${editing?"direct-editing":""}`} key={line.position}>
      <span className="workspace-line-number">{line.position}</span>
      {editing?<textarea ref={editor} className="workspace-direct-editor" aria-label="Edit selected transcript paragraph" value={activeEdit.draft}
        onChange={event=>onChange(event.target.value,event.target.selectionStart)} onBlur={onSave}
        onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==="s"){event.preventDefault();onSave();return}if(event.key==="Enter"){event.preventDefault();onSplit(event.currentTarget.selectionStart);return}if(event.key==="Backspace"&&event.currentTarget.selectionStart===0&&event.currentTarget.selectionEnd===0){event.preventDefault();onJoinPrevious();return}if(event.key==="Delete"&&event.currentTarget.selectionStart===activeEdit.draft.length&&event.currentTarget.selectionEnd===activeEdit.draft.length){event.preventDefault();onJoinNext();return}if(event.key==="Escape"){event.preventDefault();onCancel()}}}/>
      :<code>{line.fragments.length?line.fragments.map((fragment,index)=>fragment.kind==="generated"
        ? <span className="workspace-generated" data-evidence="false" key={`${fragment.id}:${index}`}>{fragment.text}</span>
        : <button type="button" className={`workspace-page-token ${fragment.kind} ${selectedWordId===fragment.id?"picked":""} ${activePlaybackWordId===fragment.id?"playing":""} ${lowConfidenceWordIds.has(fragment.id)?"low-confidence":""}`}
            data-token-id={fragment.id} data-evidence={fragment.kind==="evidence"} key={`${fragment.id}:${index}`}
            onClick={event=>{event.stopPropagation();if(page.editable===false||!line.paragraphId)return;onSelect(line.paragraphId,fragment.id,event.shiftKey);if(!event.shiftKey){if(clickTimer.current)clearTimeout(clickTimer.current);clickTimer.current=setTimeout(()=>onBeginEdit(line.paragraphId!,lineKey,fragment.sourceStart??0),220)}}} onDoubleClick={event=>{event.preventDefault();if(clickTimer.current)clearTimeout(clickTimer.current);clickTimer.current=null;if(page.editable!==false&&line.paragraphId)onPlay(line.paragraphId)}}>{fragment.text}</button>):line.content}</code>}
    </li>})}</ol>
    <footer>Page {page.pageNumber}</footer>
  </article>;
});

export default function WorkspaceDocumentPages({pages,profile,paragraphs,selectedParagraphId,selectedWordId,activePlaybackWordId,lowConfidenceWordIds,onSelect,onSaveParagraph,onSplitParagraph,onJoinParagraph,onPlayParagraph,onEditingChange}:{pages:DocumentPage[];profile:LayoutProfile;paragraphs:EditableParagraph[];selectedParagraphId:string|null;selectedWordId:string|null;activePlaybackWordId:string|null;lowConfidenceWordIds:Set<string>;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void;onSaveParagraph:(paragraphId:string,before:string,after:string,caret:number)=>Promise<boolean>;onSplitParagraph:(paragraphId:string,caret:number)=>Promise<boolean>;onJoinParagraph:(paragraphId:string,direction:"previous"|"next")=>Promise<boolean>;onPlayParagraph:(paragraphId:string)=>void;onEditingChange:(editing:boolean)=>void}){
  const scroller=useRef<HTMLDivElement|null>(null),saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),[currentPage,setCurrentPage]=useState(1),[storedEdit,setActiveEdit]=useState<ActiveEdit|null>(null);
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
  useEffect(()=>{if(saveTimer.current)clearTimeout(saveTimer.current);if(activeEdit?.status==="editing"&&activeEdit.draft!==activeEdit.baseText)saveTimer.current=setTimeout(()=>{void saveRef.current()},1200);return()=>{if(saveTimer.current)clearTimeout(saveTimer.current)}},[activeEdit?.draft,activeEdit?.baseText,activeEdit?.status]);
  function beginEdit(paragraphId:string,lineKey:string,offset:number){const paragraph=paragraphById.get(paragraphId);if(!paragraph||activeEdit?.status==="saving")return;if(activeEdit&&activeEdit.paragraphId!==paragraphId&&activeEdit.draft!==activeEdit.baseText){void save();return}setActiveEdit({paragraphId,lineKey,draft:paragraph.text,baseText:paragraph.text,caret:Math.min(offset,paragraph.text.length),status:"editing"})}
  async function save(){const edit=activeEdit;if(!edit||edit.status==="saving"||edit.draft===edit.baseText)return;setActiveEdit({...edit,status:"saving"});const ok=await onSaveParagraph(edit.paragraphId,edit.baseText,edit.draft,edit.caret);setActiveEdit(current=>!current||current.paragraphId!==edit.paragraphId?current:{...current,baseText:ok?current.draft:current.baseText,status:ok?"saved":"conflict"})}
  saveRef.current=save;
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
    <div className="workspace-page-flow" ref={scroller} onScroll={observeScroll}>
      {pages.map(page=><WorkspaceDocumentPage key={page.id} page={page} profile={profile} selectedParagraphId={selectedParagraphId} selectedWordId={selectedWordId} activePlaybackWordId={activePlaybackWordId} lowConfidenceWordIds={lowConfidenceWordIds} activeEdit={activeEdit} onSelect={onSelect} onBeginEdit={beginEdit} onChange={(draft,caret)=>setActiveEdit(activeEdit?{...activeEdit,draft,caret,status:"editing"}:null)} onSave={()=>{void save()}} onCancel={()=>setActiveEdit(null)} onSplit={caret=>{void structural("split",caret)}} onJoinPrevious={()=>{void structural("previous")}} onJoinNext={()=>{void structural("next")}} onPlay={onPlayParagraph}/>) }
    </div>
  </section>;
}
