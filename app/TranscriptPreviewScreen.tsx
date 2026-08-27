"use client";

import { useCallback, useEffect, useState } from "react";

import { LOCAL_API_BASE_URL as API } from "./api-client";
type Finding={code:string;message:string;severity?:"blocking"|"warning"};
type Paragraph={id:string;label:string|null;byLine:string|null;text:string;start:number|null;segmentIds:string[];asrWordIds:string[]};
type PrintLine={position:number;occupied:boolean;content:string;paragraphId:string|null;trace:{sourceSegmentIds:string[];sourceWordIds:string[]}|null};
type PrintModel={
  modelHash:string;
  source:{reviewStateHash:string;renderedProjectionHash:string};
  layoutProfile:{linesPerPage:number;charactersPerLine:number};
  paragraphs:Paragraph[];
  pages:Array<{id:string;pageNumber:number;lines:PrintLine[]}>;
  findings:{transcript:Finding[];print:Finding[]};
};
export type PreviewDeposition={id:string;caseStyle:string;witness:string;depositionDate:string;causeNumber:string};

function clock(seconds:number|null){if(seconds===null||!Number.isFinite(seconds))return "--:--";const total=Math.floor(seconds);return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`}

export default function TranscriptPreviewScreen({deposition,onBack}:{deposition:PreviewDeposition;onBack:()=>void}){
  const [mode,setMode]=useState<"continuous"|"pages">("continuous"),[model,setModel]=useState<PrintModel|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const requestModel=useCallback(async()=>{const response=await fetch(`${API}/api/transcript/print-model?depositionId=${encodeURIComponent(deposition.id)}`,{cache:"no-store"}),payload=await response.json();if(!response.ok)throw new Error(payload.error||"Transcript Preview could not be generated.");return payload as PrintModel},[deposition.id]);
  const load=useCallback(async()=>{setLoading(true);setError("");try{setModel(await requestModel())}catch(reason){setModel(null);setError(reason instanceof Error?reason.message:"Transcript Preview could not be generated.")}finally{setLoading(false)}},[requestModel]);
  useEffect(()=>{let current=true;requestModel().then(payload=>{if(current)setModel(payload)}).catch(reason=>{if(current){setModel(null);setError(reason instanceof Error?reason.message:"Transcript Preview could not be generated.")}}).finally(()=>{if(current)setLoading(false)});return()=>{current=false}},[requestModel]);
  const transcriptFindings=model?.findings.transcript??[],printFindings=model?.findings.print??[];
  return <main className="print-preview">
    <header className="print-preview-header"><div><span className="eyebrow">READ-ONLY TRANSCRIPT PREVIEW</span><h1>{deposition.caseStyle}</h1><p>{deposition.witness} · Cause {deposition.causeNumber}</p></div><div className="print-preview-actions"><div className="print-preview-modes" role="group" aria-label="Preview display"><button type="button" aria-pressed={mode==="continuous"} className={mode==="continuous"?"active":""} onClick={()=>setMode("continuous")}>Continuous</button><button type="button" aria-pressed={mode==="pages"} className={mode==="pages"?"active":""} onClick={()=>setMode("pages")}>Page Preview</button></div><button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button><button type="button" className="secondary-button" disabled title="PDF and Word output follow after page geometry is verified.">Export unavailable</button></div></header>
    <section className="print-preview-layout">
      <aside className="print-preview-status"><h2>Preview status</h2>{model?<dl><div><dt>Paragraphs</dt><dd>{model.paragraphs.length}</dd></div><div><dt>Body pages</dt><dd>{model.pages.length}</dd></div><div><dt>Line positions</dt><dd>{model.layoutProfile.linesPerPage}</dd></div><div><dt>Line width</dt><dd>{model.layoutProfile.charactersPerLine}</dd></div><div><dt>Review state</dt><dd title={model.source.reviewStateHash}>{model.source.reviewStateHash.slice(0,12)}…</dd></div></dl>:null}
        {transcriptFindings.length||printFindings.length?<div className="print-preview-findings"><h3>Findings</h3>{transcriptFindings.map((finding,index)=><article className="transcript" key={`transcript-${finding.code}-${index}`}><strong>{finding.code.replaceAll("_"," ")}</strong><p>{finding.message}</p><button type="button" onClick={onBack}>Return to Workspace</button></article>)}{printFindings.map((finding,index)=><article className={finding.severity??"warning"} key={`print-${finding.code}-${index}`}><strong>{finding.code.replaceAll("_"," ")}</strong><p>{finding.message}</p></article>)}</div>:model?<p className="print-preview-clear">✓ No transcript or print findings.</p>:null}
        <p className="print-preview-note">This is a projection of the current Workspace state. Editing remains in Workspace; Preview does not persist another transcript or copy ASR evidence.</p><button type="button" className="secondary-button" onClick={onBack}>Back to Workspace</button>
      </aside>
      <div className="print-preview-content" aria-live="polite">{loading?<div className="transcript-empty">Paginating the current rendered transcript…</div>:null}{error?<div className="transcript-empty"><h3>Preview unavailable</h3><p>{error}</p><button type="button" className="primary-button" onClick={onBack}>Return to Workspace</button></div>:null}
        {!loading&&model&&mode==="continuous"?<section className="print-continuous">{model.paragraphs.map(paragraph=><article key={paragraph.id}><div><time>{clock(paragraph.start)}</time><strong>{paragraph.label}</strong><p>{paragraph.byLine?<em className="print-byline">{paragraph.byLine} </em>:null}{paragraph.text}</p></div></article>)}</section>:null}
        {!loading&&model&&mode==="pages"?<section className="print-pages">{model.pages.map(page=><article className="print-paper" key={page.id} aria-label={`Transcript body page ${page.pageNumber}`}><ol>{page.lines.map(line=><li className={line.occupied?"occupied":"blank"} key={line.position}><span>{line.position}</span><code>{line.content}</code></li>)}</ol><footer>{page.pageNumber}</footer></article>)}</section>:null}
      </div>
    </section>
  </main>
}
