"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

export type DocumentFragment={id:string;kind:"evidence"|"authored"|"generated";role:string;text:string;sourceWordId:string|null;sourceStart?:number;sourceEnd?:number};
export type DocumentLine={position:number;occupied:boolean;content:string;paragraphId:string|null;fragments:DocumentFragment[]};
export type DocumentPage={id:string;pageNumber:number;lines:DocumentLine[]};
export type EditableParagraph={id:string;text:string};
type ActiveEdit={paragraphId:string;lineKey:string;draft:string;baseText:string;caret:number;status:"editing"|"saving"|"saved"|"conflict"};

// React renders physical lines already decided by the shared paginator. The temporary textarea
// is a controlled editor for one canonical paragraph; after save the server model repaginates it.
// It never decides permanent line or page boundaries.
export const WorkspaceDocumentPage=memo(function WorkspaceDocumentPage({page,selectedParagraphId,selectedWordId,activeEdit,onSelect,onBeginEdit,onChange,onSave,onCancel}:{page:DocumentPage;selectedParagraphId:string|null;selectedWordId:string|null;activeEdit:ActiveEdit|null;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void;onBeginEdit:(paragraphId:string,lineKey:string,offset:number)=>void;onChange:(text:string,caret:number)=>void;onSave:()=>void;onCancel:()=>void}){
  const editor=useRef<HTMLTextAreaElement|null>(null);
  useEffect(()=>{if(!editor.current||!activeEdit)return;editor.current.focus();editor.current.setSelectionRange(activeEdit.caret,activeEdit.caret)},[activeEdit]);
  return <article className="workspace-paper" data-page={page.pageNumber} aria-label={`Transcript body page ${page.pageNumber}`}>
    <ol>{page.lines.map(line=>{const lineKey=`${page.pageNumber}:${line.position}`,editing=activeEdit?.lineKey===lineKey;return <li className={`${line.occupied?"occupied":"blank"} ${line.paragraphId===selectedParagraphId?"selected":""} ${editing?"direct-editing":""}`} key={line.position}>
      <span className="workspace-line-number">{line.position}</span>
      {editing?<textarea ref={editor} className="workspace-direct-editor" aria-label="Edit selected transcript paragraph" value={activeEdit.draft}
        onChange={event=>onChange(event.target.value,event.target.selectionStart)} onSelect={event=>onChange(activeEdit.draft,event.currentTarget.selectionStart)}
        onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&(event.key==="s"||event.key==="Enter")){event.preventDefault();onSave()}if(event.key==="Escape"){event.preventDefault();onCancel()}}}/>
      :<code>{line.fragments.map((fragment,index)=>fragment.kind==="generated"
        ? <span className="workspace-generated" data-evidence="false" key={`${fragment.id}:${index}`}>{fragment.text}</span>
        : <button type="button" className={`workspace-page-token ${fragment.kind} ${selectedWordId===fragment.id?"picked":""}`}
            data-token-id={fragment.id} data-evidence={fragment.kind==="evidence"} key={`${fragment.id}:${index}`}
            onClick={event=>{event.stopPropagation();if(!line.paragraphId)return;onSelect(line.paragraphId,fragment.id,event.shiftKey);if(!event.shiftKey)onBeginEdit(line.paragraphId,lineKey,fragment.sourceStart??0)}}>{fragment.text}</button>)}</code>}
    </li>})}</ol>
    <footer>Page {page.pageNumber}</footer>
  </article>;
});

export default function WorkspaceDocumentPages({pages,paragraphs,selectedParagraphId,selectedWordId,onSelect,onSaveParagraph}:{pages:DocumentPage[];paragraphs:EditableParagraph[];selectedParagraphId:string|null;selectedWordId:string|null;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void;onSaveParagraph:(paragraphId:string,before:string,after:string,caret:number)=>Promise<boolean>}){
  const scroller=useRef<HTMLDivElement|null>(null),[currentPage,setCurrentPage]=useState(1),[storedEdit,setActiveEdit]=useState<ActiveEdit|null>(null);
  const total=pages.length,paragraphById=useMemo(()=>new Map(paragraphs.map(paragraph=>[paragraph.id,paragraph])),[paragraphs]);
  const savedCanonical=storedEdit?.status==="saved"?paragraphById.get(storedEdit.paragraphId)?.text:undefined;
  const activeEdit=storedEdit&&savedCanonical!==undefined&&savedCanonical!==storedEdit.baseText
    ?{...storedEdit,draft:savedCanonical,baseText:savedCanonical,caret:Math.min(storedEdit.caret,savedCanonical.length)}:storedEdit;
  const bounded=Math.min(Math.max(currentPage,1),Math.max(total,1));
  const pageByParagraph=useMemo(()=>{const map=new Map<string,number>();for(const page of pages)for(const line of page.lines)if(line.paragraphId&&!map.has(line.paragraphId))map.set(line.paragraphId,page.pageNumber);return map},[pages]);
  const selectedPage=selectedParagraphId?pageByParagraph.get(selectedParagraphId):null;
  function go(page:number){const value=Math.min(Math.max(page,1),total);scroller.current?.querySelector<HTMLElement>(`[data-page="${value}"]`)?.scrollIntoView({behavior:"smooth",block:"start"});setCurrentPage(value)}
  function observeScroll(){const root=scroller.current;if(!root)return;const top=root.getBoundingClientRect().top;let nearest=bounded,distance=Infinity;for(const node of root.querySelectorAll<HTMLElement>("[data-page]")){const value=Math.abs(node.getBoundingClientRect().top-top);if(value<distance){distance=value;nearest=Number(node.dataset.page)}}setCurrentPage(nearest)}
  function beginEdit(paragraphId:string,lineKey:string,offset:number){const paragraph=paragraphById.get(paragraphId);if(!paragraph||activeEdit?.status==="saving"||(activeEdit&&activeEdit.draft!==activeEdit.baseText))return;setActiveEdit({paragraphId,lineKey,draft:paragraph.text,baseText:paragraph.text,caret:Math.min(offset,paragraph.text.length),status:"editing"})}
  async function save(){const edit=activeEdit;if(!edit||edit.status==="saving"||edit.draft===edit.baseText)return;setActiveEdit({...edit,status:"saving"});const ok=await onSaveParagraph(edit.paragraphId,edit.baseText,edit.draft,edit.caret);setActiveEdit(current=>!current||current.paragraphId!==edit.paragraphId?current:{...current,baseText:ok?current.draft:current.baseText,status:ok?"saved":"conflict"})}
  return <section className="workspace-document" aria-label="Direct-edit final-document transcript">
    <nav className="workspace-page-nav" aria-label="Transcript page navigation">
      <button type="button" disabled={bounded<=1} onClick={()=>go(bounded-1)}>Previous page</button>
      <label>Page <input aria-label="Go to transcript page" type="number" min={1} max={total} value={bounded} onChange={event=>go(Number(event.target.value))}/></label>
      <span>of {total}{selectedPage&&selectedPage!==bounded?` · selection on ${selectedPage}`:""}</span>
      <button type="button" disabled={bounded>=total} onClick={()=>go(bounded+1)}>Next page</button>
      {activeEdit&&<span className={`workspace-edit-status ${activeEdit.status}`} role="status">{activeEdit.status==="saving"?"Saving paragraph…":activeEdit.status==="saved"?"Saved · authoritative pages refreshed":activeEdit.status==="conflict"?"Not saved · transcript changed":"Editing one paragraph · Ctrl+S saves"}</span>}
      <span className="workspace-geometry-note">Shared-model pages · one-paragraph editing</span>
    </nav>
    <div className="workspace-page-flow" ref={scroller} onScroll={observeScroll}>
      {pages.map(page=><WorkspaceDocumentPage key={page.id} page={page} selectedParagraphId={selectedParagraphId} selectedWordId={selectedWordId} activeEdit={activeEdit} onSelect={onSelect} onBeginEdit={beginEdit} onChange={(draft,caret)=>setActiveEdit(activeEdit?{...activeEdit,draft,caret,status:"editing"}:null)} onSave={()=>{void save()}} onCancel={()=>setActiveEdit(null)}/>) }
    </div>
  </section>;
}
