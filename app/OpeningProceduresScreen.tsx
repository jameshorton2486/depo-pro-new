"use client";

import { useEffect, useState } from "react";

// The origin every other screen already uses. This file hard-coded 4317 -- the default the API
// falls back to when LOCAL_API_PORT is unset -- so on any machine that sets a port, Opening
// Procedures fetched a closed socket and rendered "Failed to fetch" while the rest of the
// application worked. Nothing else in app/ builds an origin of its own.
import { LOCAL_API_BASE_URL as API } from "./api-client";
type Envelope={value:unknown;source:string;state:string};
type Field=Envelope&{path:string;label:string;verified:boolean};
type Participant={id:string;type:string;name:Envelope;role?:Envelope;firm?:Envelope;represents?:Envelope;actualAppearance?:Envelope;remoteAppearance?:Envelope;verified:boolean};
type Script={id:string;title:string;classification:string;whenToUse:string;text:string;missing:string[];completedOnRecord:boolean;note:string;applicable:boolean};
type OpeningState={verifiedFields:Record<string,boolean>;verifiedParticipants:Record<string,boolean>;scripts:Record<string,{completedOnRecord:boolean;note:string}>;interpreterDisposition:string;witnessOathSelection:string;examiningAttorneyId:string|null};
type Envelope2=Envelope|undefined;
type Canonical={deposition?:{witnessSworn?:Envelope2};reporter?:{fullName?:Envelope2;csrNumber?:Envelope2}};
type Protection={protected:boolean;reason:string|null;unlocked:boolean;unlockedUntil:string|null;msRemaining:number;unlockCount:number};
type Projection={depositionId:string;canonical?:Canonical;state:OpeningState;fields:Field[];participants:Participant[];scripts:Script[];readiness:Record<string,boolean>;protection:Protection|null;completeCount:number;totalCount:number};

const value=(item?:Envelope)=>item?.value===null||item?.value===undefined||item?.value===""?"Missing":Array.isArray(item.value)?item.value.join(", "):String(item.value);
const minutesLeft=(ms:number)=>Math.max(1,Math.round(ms/60000));
const status=(item:Envelope,verified:boolean)=>verified?"Verified":item.state==="MISSING"?"Missing":item.source==="NOD_EXTRACTED"?"Extracted":item.state.replaceAll("_"," ").toLowerCase();

export default function OpeningProceduresScreen({deposition,onBack,onContinue}:{deposition:{id:string;caseStyle:string;witness:string};onBack:()=>void;onContinue:()=>void}){
  const [projection,setProjection]=useState<Projection|null>(null),[tab,setTab]=useState<"verify"|"appearances"|"scripts">("verify"),[error,setError]=useState(""),[busy,setBusy]=useState(false),[expandAll,setExpandAll]=useState(false),[attestSworn,setAttestSworn]=useState<""|"true"|"false">(""),[attestWhy,setAttestWhy]=useState(""),[unlockWhy,setUnlockWhy]=useState("");
  useEffect(()=>{let current=true;fetch(`${API}/api/opening?depositionId=${encodeURIComponent(deposition.id)}`).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);if(current)setProjection(body)}).catch(reason=>current&&setError(reason instanceof Error?reason.message:"Opening procedures could not be loaded."));return()=>{current=false}},[deposition.id]);
  async function save(state:OpeningState){setBusy(true);setError("");try{const response=await fetch(`${API}/api/opening`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({depositionId:deposition.id,state})}),body=await response.json();if(!response.ok)throw new Error(body.error);setProjection(body)}catch(reason){setError(reason instanceof Error?reason.message:"Opening procedures could not be saved.")}finally{setBusy(false)}}
  // Separate from save() on purpose. save() writes workflow values that carry no attribution; this
  // writes an attested fact to the canonical record through the correction log, which is the only
  // path allowed to influence a certified page. Changing the selector above must never call this.
  async function attest(sworn:boolean,why:string){setBusy(true);setError("");try{const response=await fetch(`${API}/api/opening/oath-attestation`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({depositionId:deposition.id,sworn,why})}),body=await response.json();if(!response.ok)throw new Error(body.error);setProjection(body);setAttestSworn("");setAttestWhy("")}catch(reason){setError(reason instanceof Error?reason.message:"The oath attestation could not be recorded.")}finally{setBusy(false)}}
  // Deliberately re-reads the projection instead of setting a local "unlocked" flag. The guard reads
  // the same file this reports, and a screen that decided for itself that the record was open could
  // show an open door while every write was still refused.
  async function unlock(){
    setBusy(true);setError("");
    try{
      const response=await fetch(`${API}/api/deposition/unlock-protected`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({depositionId:deposition.id,reason:unlockWhy})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      const refreshed=await fetch(`${API}/api/opening?depositionId=${encodeURIComponent(deposition.id)}`);
      const next=await refreshed.json();if(!refreshed.ok)throw new Error(next.error);
      setProjection(next);setUnlockWhy("");
    }catch(reason){setError(reason instanceof Error?reason.message:"This record could not be opened for editing.")}
    finally{setBusy(false)}
  }

  if(!projection)return <main className="opening-shell"><section className="opening-card"><button className="back-button" onClick={onBack}>← Back to Workspace</button><h1>Deposition Opening Procedures</h1><p>{error||"Loading the canonical deposition record…"}</p></section></main>;
  const state=projection.state;
  const verifyField=(path:string,checked:boolean)=>save({...state,verifiedFields:{...state.verifiedFields,[path]:checked}});
  const verifyParticipant=(id:string,checked:boolean)=>save({...state,verifiedParticipants:{...state.verifiedParticipants,[id]:checked}});
  const updateScript=(id:string,change:Partial<{completedOnRecord:boolean;note:string}>)=>save({...state,scripts:{...state.scripts,[id]:{...state.scripts[id],...change}}});
  return <main className="opening-shell">
    {projection.protection?.protected&&<section className={`opening-protection ${projection.protection.unlocked?"open":"closed"}`}>
        <div>
          <strong>{projection.protection.unlocked?`Open for editing — about ${minutesLeft(projection.protection.msRemaining)} minute${minutesLeft(projection.protection.msRemaining)===1?"":"s"} left`:"This record is protected"}</strong>
          <p>{projection.protection.reason??"Its canonical record and correction log are closed to writes."}{projection.protection.unlocked?" It will close again on its own.":" Nothing can change the canonical record — including an automated run — until you open it here."}</p>
        </div>
        {!projection.protection.unlocked&&<div className="opening-protection-unlock">
          <label>Why are you opening it?<input value={unlockWhy} disabled={busy} onChange={event=>setUnlockWhy(event.target.value)} placeholder="Entering the on-record start time"/></label>
          <button className="secondary-button" type="button" disabled={busy||!unlockWhy.trim()} onClick={()=>void unlock()}>Open for editing</button>
        </div>}
      </section>}
    <header className="opening-header"><div><span className="eyebrow">OPEN DEPOSITION</span><h1>Deposition Opening Procedures</h1><p>{deposition.caseStyle} · {deposition.witness}</p></div><div className="opening-progress"><strong>{projection.completeCount}/{projection.totalCount}</strong><span>Opening readiness</span></div></header>
    <section className="opening-card">
      <div className="opening-tabs" role="tablist" aria-label="Opening procedure sections">
        <button className={tab==="verify"?"active":""} onClick={()=>setTab("verify")}>Pre-Record Verification</button>
        <button className={tab==="appearances"?"active":""} onClick={()=>setTab("appearances")}>Appearances</button>
        <button className={tab==="scripts"?"active":""} onClick={()=>setTab("scripts")}>Scripts &amp; Oaths</button>
      </div>
      {error&&<p className="analysis-error" role="alert">{error}</p>}
      {tab==="verify"&&<section className="opening-section"><div className="opening-section-heading"><div><h2>Pre-Record Verification</h2><p>Confirm source data before going on the record. Extracted does not mean verified.</p></div></div><div className="opening-field-list">{projection.fields.map(item=><label className={`opening-field ${item.state==="MISSING"?"missing":""}`} key={item.path}><span><strong>{item.label}</strong><small>{status(item,item.verified)} · {item.source.replaceAll("_"," ").toLowerCase()}</small></span><b>{value(item)}</b><input type="checkbox" checked={item.verified} disabled={busy||item.state==="MISSING"} onChange={event=>void verifyField(item.path,event.target.checked)} aria-label={`Verify ${item.label}`}/></label>)}</div></section>}
      {tab==="appearances"&&<section className="opening-section"><div className="opening-section-heading"><div><h2>Appearances and Participant Identification</h2><p>The canonical participant roster remains authoritative; verification records what the reporter confirmed.</p></div></div>{projection.participants.length?<div className="opening-participants">{projection.participants.map(item=><article key={item.id}><header><div><span>{item.type.replaceAll("_"," ")}</span><h3>{value(item.name)}</h3></div><label><input type="checkbox" checked={item.verified} disabled={busy} onChange={event=>void verifyParticipant(item.id,event.target.checked)}/> Verified</label></header><dl><div><dt>Role</dt><dd>{value(item.role)}</dd></div><div><dt>Firm</dt><dd>{value(item.firm)}</dd></div><div><dt>Represents</dt><dd>{value(item.represents)}</dd></div><div><dt>Actual appearance</dt><dd>{value(item.actualAppearance)}</dd></div><div><dt>Participation</dt><dd>{item.remoteAppearance?.value===true?"Remote":item.remoteAppearance?.value===false?"In person":"Unresolved"}</dd></div></dl></article>)}</div>:<p className="opening-warning">No participants are recorded in the canonical record. This warns but does not block local recording.</p>}</section>}
      {tab==="scripts"&&<section className="opening-section"><div className="opening-section-heading"><div><h2>Scripts &amp; Oaths</h2><p>Controlled projections from canonical facts. Unverified legal language is clearly identified.</p></div><button className="secondary-button" onClick={()=>setExpandAll(value=>!value)}>{expandAll?"Collapse all":"Expand all for reading"}</button></div><div className="opening-controls"><label>Interpreter<select value={state.interpreterDisposition} disabled={busy} onChange={event=>void save({...state,interpreterDisposition:event.target.value})}><option value="UNRESOLVED">Unresolved</option><option value="REQUIRED">Required</option><option value="NOT_APPLICABLE">Not applicable</option></select></label><label>Witness oath selection<select value={state.witnessOathSelection} disabled={busy} onChange={event=>void save({...state,witnessOathSelection:event.target.value})}><option value="UNRESOLVED">Unresolved</option><option value="OATH">Oath</option><option value="AFFIRMATION">Affirmation</option></select></label><label>First examining attorney<select value={state.examiningAttorneyId||""} disabled={busy} onChange={event=>void save({...state,examiningAttorneyId:event.target.value||null})}><option value="">Unresolved</option>{projection.participants.filter(item=>item.type==="COUNSEL").map(item=><option key={item.id} value={item.id}>{value(item.name)}</option>)}</select></label></div>
      {(()=>{
        const sworn=projection.canonical?.deposition?.witnessSworn;
        const attested=sworn?.state==="REPORTER_ADDED"&&(sworn.value===true||sworn.value===false);
        return <div className="opening-section" style={{marginTop:"1rem"}}>
          <div className="opening-section-heading"><div>
            <h2>Oath attestation</h2>
            <p>A separate act from the selection above. The selection is your working note; this is the fact the certificate rests on, and it is written to the deposition record in your own words, with the time.</p>
          </div></div>
          {attested
            ? <p className="opening-when"><strong>{sworn?.value===true?"Attested: the witness was sworn.":"Attested: the witness was not sworn."}</strong>{" "}
                {sworn?.value===false&&"The certification page will refuse to generate. There is no approved Texas wording for a witness who affirmed, so the record and the certificate cannot both be honest until there is."}
                {" "}Recorded on the canonical record. Changing it now goes through the correction log, which keeps both values and the reason.</p>
            : <>
                <p className="opening-when">Not attested. The certificate will still generate and will state that the witness was duly sworn, resting on your own knowledge rather than on anything recorded here.</p>
                <label>What happened
                  <select value={attestSworn} disabled={busy} onChange={event=>setAttestSworn(event.target.value as ""|"true"|"false")}>
                    <option value="">Choose…</option>
                    <option value="true">The witness was sworn</option>
                    <option value="false">The witness affirmed and was not sworn</option>
                  </select>
                </label>
                <label className="opening-note">Why this is what happened
                  <textarea value={attestWhy} disabled={busy} onChange={event=>setAttestWhy(event.target.value)} placeholder="Required. What this rests on — for example, that you administered the oath yourself on the record at a stated time."/>
                </label>
                <button type="button" className="secondary-button" disabled={busy||!attestSworn||!attestWhy.trim()} onClick={()=>void attest(attestSworn==="true",attestWhy.trim())}>Record this on the deposition record</button>
              </>}
        </div>;
      })()}
      <div className="opening-scripts">{projection.scripts.filter(item=>item.applicable).map(item=><details key={item.id} open={expandAll||undefined}><summary><span><strong>{item.title}</strong><small>{item.classification.replaceAll("_"," ").toLowerCase()}</small></span><b>{item.completedOnRecord?"Completed on record":item.missing.length?"Needs information":"Ready"}</b></summary><p className="opening-when">{item.whenToUse}</p>{item.missing.length>0&&<p className="opening-warning">Missing: {item.missing.join(", ")}</p>}<blockquote>{item.text}</blockquote><div className="opening-script-actions"><button type="button" onClick={()=>void navigator.clipboard.writeText(item.text)}>Copy</button><label><input type="checkbox" checked={item.completedOnRecord} disabled={busy} onChange={event=>void updateScript(item.id,{completedOnRecord:event.target.checked})}/> Completed on record</label></div><label className="opening-note">Reporter note<textarea defaultValue={item.note} onBlur={event=>{if(event.target.value!==item.note)void updateScript(item.id,{note:event.target.value})}} placeholder="Optional operational note; not transcript testimony."/></label></details>)}</div></section>}
      <footer className="opening-footer"><button className="secondary-button" onClick={onBack}>Back to Workspace</button><div><span>{projection.completeCount===projection.totalCount?"Opening readiness complete":`${projection.totalCount-projection.completeCount} readiness item${projection.totalCount-projection.completeCount===1?"":"s"} unresolved`}</span><button className="primary-button" onClick={onContinue}>Continue to Live Deposition</button></div></footer>
    </section>
  </main>;
}
