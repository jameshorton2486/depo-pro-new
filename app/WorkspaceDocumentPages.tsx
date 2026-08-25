"use client";

import { memo, useMemo, useRef, useState } from "react";

export type DocumentFragment={id:string;kind:"evidence"|"authored"|"generated";role:string;text:string;sourceWordId:string|null};
export type DocumentLine={position:number;occupied:boolean;content:string;paragraphId:string|null;fragments:DocumentFragment[]};
export type DocumentPage={id:string;pageNumber:number;lines:DocumentLine[]};

// React renders physical lines already decided by the shared paginator. No text wrapping, line
// counting, or Q/A layout is permitted here: changing CSS cannot change document authority.
export const WorkspaceDocumentPage=memo(function WorkspaceDocumentPage({page,selectedParagraphId,selectedWordId,onSelect}:{page:DocumentPage;selectedParagraphId:string|null;selectedWordId:string|null;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void}){
  return <article className="workspace-paper" data-page={page.pageNumber} aria-label={`Transcript body page ${page.pageNumber}`}>
    <ol>{page.lines.map(line=><li className={`${line.occupied?"occupied":"blank"} ${line.paragraphId===selectedParagraphId?"selected":""}`} key={line.position}>
      <span className="workspace-line-number">{line.position}</span>
      <code>{line.fragments.map((fragment,index)=>fragment.kind==="generated"
        ? <span className="workspace-generated" data-evidence="false" key={`${fragment.id}:${index}`}>{fragment.text}</span>
        : <button type="button" className={`workspace-page-token ${fragment.kind} ${selectedWordId===fragment.id?"picked":""}`}
            data-token-id={fragment.id} data-evidence={fragment.kind==="evidence"} key={`${fragment.id}:${index}`}
            onClick={event=>{event.stopPropagation();if(line.paragraphId)onSelect(line.paragraphId,fragment.id,event.shiftKey)}}>{fragment.text}</button>)}</code>
    </li>)}</ol>
    <footer>Page {page.pageNumber}</footer>
  </article>;
});

export default function WorkspaceDocumentPages({pages,selectedParagraphId,selectedWordId,onSelect}:{pages:DocumentPage[];selectedParagraphId:string|null;selectedWordId:string|null;onSelect:(paragraphId:string,wordId:string,shiftKey:boolean)=>void}){
  const scroller=useRef<HTMLDivElement|null>(null),[currentPage,setCurrentPage]=useState(1);
  const total=pages.length;
  const bounded=Math.min(Math.max(currentPage,1),Math.max(total,1));
  const pageByParagraph=useMemo(()=>{const map=new Map<string,number>();for(const page of pages)for(const line of page.lines)if(line.paragraphId&&!map.has(line.paragraphId))map.set(line.paragraphId,page.pageNumber);return map},[pages]);
  const selectedPage=selectedParagraphId?pageByParagraph.get(selectedParagraphId):null;
  function go(page:number){const value=Math.min(Math.max(page,1),total);scroller.current?.querySelector<HTMLElement>(`[data-page="${value}"]`)?.scrollIntoView({behavior:"smooth",block:"start"});setCurrentPage(value)}
  function observeScroll(){const root=scroller.current;if(!root)return;const top=root.getBoundingClientRect().top;let nearest=bounded,distance=Infinity;for(const node of root.querySelectorAll<HTMLElement>("[data-page]")){const value=Math.abs(node.getBoundingClientRect().top-top);if(value<distance){distance=value;nearest=Number(node.dataset.page)}}setCurrentPage(nearest)}
  return <section className="workspace-document" aria-label="Read-only final-document transcript">
    <nav className="workspace-page-nav" aria-label="Transcript page navigation">
      <button type="button" disabled={bounded<=1} onClick={()=>go(bounded-1)}>Previous page</button>
      <label>Page <input aria-label="Go to transcript page" type="number" min={1} max={total} value={bounded} onChange={event=>go(Number(event.target.value))}/></label>
      <span>of {total}{selectedPage&&selectedPage!==bounded?` · selection on ${selectedPage}`:""}</span>
      <button type="button" disabled={bounded>=total} onClick={()=>go(bounded+1)}>Next page</button>
      <span className="workspace-geometry-note">Read-only pages · production geometry requires Word/UFM validation</span>
    </nav>
    <div className="workspace-page-flow" ref={scroller} onScroll={observeScroll}>
      {pages.map(page=><WorkspaceDocumentPage key={page.id} page={page} selectedParagraphId={selectedParagraphId} selectedWordId={selectedWordId} onSelect={onSelect}/>) }
    </div>
  </section>;
}
