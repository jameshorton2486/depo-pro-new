"use client";

type Cell={value?:unknown;status?:string;sourceType?:string|null;sourceDocument?:string|null;citation?:string|null;confidence?:string|null};
type RecordValue=Record<string,unknown>;
const object=(value:unknown):RecordValue=>value&&typeof value==="object"&&!Array.isArray(value)?value as RecordValue:{};
const cell=(value:unknown):Cell=>object(value) as Cell;
const text=(value:unknown)=>typeof value==="string"?value:"";
const display=(value:unknown)=>Array.isArray(value)?value.join(", "):typeof value==="boolean"?(value?"Yes":"No"):text(value)||"—";
function Source({value}:{value:Cell}){return <><span className={`field-state ${(value.status||"missing").toLowerCase()}`}>{value.status||"MISSING"}</span><small>{[value.sourceType,value.sourceDocument,value.citation,value.confidence].filter(Boolean).join(" · ")||"No provenance recorded"}</small></>}
function Row({label,value,children}:{label:string;value:Cell;children?:React.ReactNode}){return <tr><th scope="row">{label}</th><td>{children??display(value.value)}</td><td><Source value={value}/></td></tr>}
// Three answers, because there are three. A checkbox can only say yes or not-yes, and not-yes was
// being recorded as "no" -- so a question nobody had answered came out as a stated fact.
function TriState({name,value}:{name:string;value:Cell}){return <select name={name} defaultValue={value.value===true?"true":value.value===false?"false":""}><option value="">Not stated</option><option value="true">Yes</option><option value="false">No</option></select>}

export default function CanonicalDataSheet({seed}:{seed?:RecordValue}){
  const master=object(seed),caseData=object(master.case),deposition=object(master.deposition),parties=Array.isArray(master.parties)?master.parties.map(object):[],counsel=Array.isArray(master.counsel)?master.counsel.map(object):[];
  return <section className="canonical-data-sheet">
    <header><div><span className="eyebrow">MASTER DEPOSITION DATA RECORD</span><h3>Reporter Data Sheet</h3></div><span className="data-sheet-phase">One record · three projections</span></header>
    <p>Review the document extraction here. This record supplies deposition setup, Texas UFM templates, and the Deepgram terminology projection.</p>
    <details open><summary>Case and court</summary><table className="master-data-table"><thead><tr><th>Field</th><th>Value</th><th>Evidence</th></tr></thead><tbody>
      <Row label="Case style" value={cell(caseData.caseStyle)}/><Row label="Cause number" value={cell(caseData.causeNumber)}/>
      <Row label="Court" value={cell(caseData.court)}><input name="canonicalCourt" defaultValue={text(cell(caseData.court).value)}/></Row>
      <Row label="District" value={cell(caseData.district)}><input name="canonicalDistrict" defaultValue={text(cell(caseData.district).value)}/></Row>
      <Row label="Division" value={cell(caseData.division)}><input name="canonicalDivision" defaultValue={text(cell(caseData.division).value)}/></Row>
      <Row label="County" value={cell(caseData.county)}><input name="canonicalCounty" defaultValue={text(cell(caseData.county).value)}/></Row>
      <Row label="Judicial district" value={cell(caseData.judicialDistrict)}/>
    </tbody></table></details>
    <details open><summary>Proceeding</summary><table className="master-data-table"><thead><tr><th>Field</th><th>Value</th><th>Evidence</th></tr></thead><tbody>
      <Row label="Witness" value={cell(deposition.witness)}/><Row label="Type of proceeding" value={cell(deposition.proceedingType)}/><Row label="Scheduled date" value={cell(deposition.scheduledDate)}/>
      <Row label="Scheduled time" value={cell(deposition.scheduledStart)}><input name="canonicalScheduledStart" type="time" defaultValue={text(cell(deposition.scheduledStart).value)}/></Row>
      <Row label="Time zone" value={cell(deposition.timeZone)}><input name="canonicalTimeZone" defaultValue={text(cell(deposition.timeZone).value)}/></Row>
      <Row label="Location" value={cell(deposition.location)}><input name="canonicalLocation" defaultValue={typeof cell(deposition.location).value==="string"?text(cell(deposition.location).value):""}/></Row>
      <Row label="Remote platform" value={cell(deposition.remotePlatform)}><input name="canonicalRemotePlatform" defaultValue={text(cell(deposition.remotePlatform).value)}/></Row>
      <Row label="Remote" value={cell(deposition.remote)}><TriState name="canonicalRemote" value={cell(deposition.remote)}/></Row>
      <Row label="Videotaped" value={cell(deposition.videotaped)}><TriState name="canonicalVideotaped" value={cell(deposition.videotaped)}/></Row>
      <Row label="Interpreted" value={cell(deposition.interpreted)}><TriState name="canonicalInterpreted" value={cell(deposition.interpreted)}/></Row>
      <Row label="Corporate representative" value={cell(deposition.corporateRepresentative)}><TriState name="canonicalCorporateRepresentative" value={cell(deposition.corporateRepresentative)}/></Row>
    </tbody></table></details>
    <details open><summary>Parties ({parties.length})</summary>{parties.length?<table className="master-data-table"><thead><tr><th>Name</th><th>Role</th><th>Evidence</th></tr></thead><tbody>{parties.map((party,index)=><tr key={String(party.id??index)}><th>{display(cell(party.name).value)}</th><td>{display(cell(party.role).value)}</td><td><Source value={cell(party.name)}/></td></tr>)}</tbody></table>:<p>No party records were extracted.</p>}</details>
    <details open><summary>Known counsel ({counsel.length})</summary>{counsel.length?<table className="master-data-table"><thead><tr><th>Name</th><th>Represents</th><th>Evidence</th></tr></thead><tbody>{counsel.map((attorney,index)=><tr key={String(attorney.id??index)}><th>{display(cell(attorney.fullName).value)}</th><td>{display(cell(attorney.represents).value)}</td><td><Source value={cell(attorney.fullName)}/></td></tr>)}</tbody></table>:<p>No counsel records were extracted.</p>}</details>
    <details><summary>Later-stage UFM fields</summary><p>Actual appearances, recording method, witness oath, examinations, exhibits, signature/errata, pagination, and certification remain unresolved until their authoritative stage.</p></details>
  </section>
}
