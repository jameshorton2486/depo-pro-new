"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import IntakeScreen, { type IntakeDraft } from "./IntakeScreen";
import AdminSettings from "./AdminSettings";
import TranscriptCreationScreen from "./TranscriptCreationScreen";
import InsertionPagesScreen from "./InsertionPagesScreen";
import TranscriptComparisonScreen from "./TranscriptComparisonScreen";
import AudioToolsScreen from "./AudioToolsScreen";
import CanonicalDataSheet from "./CanonicalDataSheet";
import { formatDisplayDate } from "./date-format.mjs";

type Deposition = {
  id: string;
  caseStyle: string;
  witness: string;
  causeNumber: string;
  deponentType: string;
  depositionDate: string;
  courtReporterId: string;
  courtReporterName: string;
  reporterProfile?: CourtReporter;
  canonicalSeed?: Record<string,unknown>;
  intakeNotes: string;
  noticeName: string;
  courtOrderName: string;
  audioFiles: string[];
  keytermCount: number;
  keyterms: string[];
  audioIntakeIds: string[];
  createdAt: string;
};

type CourtReporter = {
  id: string; name: string; company: string; email: string; phone: string;
  licenseNumber: string; taxId: string; address: string;
};

const REPORTERS_STORAGE_KEY = "depo-pro-court-reporters";
const LEGACY_DEPOSITIONS_KEY = "depo-pro-depositions";
const WORKFLOW_SESSION_KEY = "depo-pro-current-workflow-v1";
const API = "http://127.0.0.1:4317";
type WorkflowView="library"|"intake"|"setup"|"transcript"|"audio-tools"|"admin"|"insertion-pages"|"compare";
type WorkflowSession={view:WorkflowView;activeDepositionId:string|null};
const INITIAL_WORKFLOW_SESSION:WorkflowSession={view:"library",activeDepositionId:null};
function readWorkflowSession():WorkflowSession{try{const value=JSON.parse(localStorage.getItem(WORKFLOW_SESSION_KEY)||"null");return value&&["library","intake","setup","transcript","audio-tools","admin"].includes(value.view)?{view:value.view,activeDepositionId:typeof value.activeDepositionId==="string"?value.activeDepositionId:null}:INITIAL_WORKFLOW_SESSION}catch{return INITIAL_WORKFLOW_SESSION}}

function makeId() {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `DEP-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function formatDate(value: string) {
  return formatDisplayDate(value);
}

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function toBase64(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
function audioProfileKey(file:File){return `${file.name}-${file.size}-${file.lastModified}`}
async function artifact(file:File|null){return file?{name:file.name,type:file.type,base64:await toBase64(file)}:null}
async function loadSavedAudioFiles(deposition:Deposition){return Promise.all(deposition.audioFiles.map(async(name,index)=>{const response=await fetch(`${API}/api/depositions/audio?id=${encodeURIComponent(deposition.id)}&index=${index}`);if(!response.ok)throw new Error((await response.json()).error);return new File([await response.blob()],name,{lastModified:Date.now()})}))}
function legacyFiles(depositionId:string){return new Promise<Array<{category:string;order:number;name:string;type:string;blob:Blob}>>((resolve,reject)=>{const request=indexedDB.open("depo-pro-local-files",1);request.onerror=()=>reject(request.error);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("files"))db.createObjectStore("files",{keyPath:"id"})};request.onsuccess=()=>{const db=request.result,transaction=db.transaction("files","readonly"),all=transaction.objectStore("files").getAll();all.onerror=()=>reject(all.error);all.onsuccess=()=>resolve(all.result.filter(item=>item.depositionId===depositionId));transaction.oncomplete=()=>db.close()}})}
async function migrateLegacyDepositions(existing:Deposition[]){const raw=localStorage.getItem(LEGACY_DEPOSITIONS_KEY);if(!raw)return null;const legacy:Deposition[]=JSON.parse(raw),known=new Set(existing.map(item=>item.id)),migrated=[...existing];for(const deposition of legacy){if(known.has(deposition.id))continue;const records=await legacyFiles(deposition.id),notice=records.find(item=>item.category==="notice"),courtOrder=records.find(item=>item.category==="court-order"),supporting=records.filter(item=>item.category==="supporting-document").sort((a,b)=>a.order-b.order);const convert=async(item:typeof notice)=>item?{name:item.name,type:item.type,base64:await toBase64(new File([item.blob],item.name,{type:item.type}))}:null;const response=await fetch(`${API}/api/depositions`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({deposition,artifacts:{notice:await convert(notice),courtOrder:await convert(courtOrder),supportingFiles:await Promise.all(supporting.map(convert))}})}),saved=await response.json();if(!response.ok)throw new Error(`Legacy migration stopped at ${deposition.id}: ${saved.error||"unknown error"}`);migrated.push(saved);known.add(saved.id)}localStorage.removeItem(LEGACY_DEPOSITIONS_KEY);indexedDB.deleteDatabase("depo-pro-local-files");return migrated}
export default function Home() {
  const [depositions, setDepositions] = useState<Deposition[]>([]);
  const [reporters, setReporters] = useState<CourtReporter[]>([]);
  const [query, setQuery] = useState("");
  const [caseId, setCaseId] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showIntake, setShowIntake] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAudioTools, setShowAudioTools] = useState(false);
  const [showInsertionPages, setShowInsertionPages] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [audioToolFiles, setAudioToolFiles] = useState<File[]>([]);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [showReporterModal, setShowReporterModal] = useState(false);
  const [selectedReporterId, setSelectedReporterId] = useState("");
  const [active, setActive] = useState<Deposition | null>(null);
  const [notice, setNotice] = useState("");
  const [storeIssues,setStoreIssues]=useState<Array<{folder:string;code:string;message:string}>>([]);
  const [creating,setCreating]=useState(false);
  const [libraryLoaded,setLibraryLoaded]=useState(false);

  useEffect(() => {
    // The server and the client's first render must both be the library. Read
    // browser-only persistence after hydration, then restore the saved view.
    let cancelled=false;
    async function restore(){
      await Promise.resolve();
      if(cancelled)return;
      const resumeSession=readWorkflowSession();
      try{const saved=localStorage.getItem(REPORTERS_STORAGE_KEY);setReporters(saved?JSON.parse(saved):[])}catch{setReporters([])}
      setShowModal(resumeSession.view==="setup");
      setShowIntake(resumeSession.view==="intake");
      setShowAdmin(resumeSession.view==="admin");
      setShowAudioTools(resumeSession.view==="audio-tools");setShowInsertionPages(resumeSession.view==="insertion-pages");setShowCompare(resumeSession.view==="compare");
      try{const response=await fetch(`${API}/api/depositions`),result=await response.json(),disk=result.depositions||[],migrated=await migrateLegacyDepositions(disk),loaded=(migrated||disk).sort((a:Deposition,b:Deposition)=>b.createdAt.localeCompare(a.createdAt));if(cancelled)return;setDepositions(loaded);if(resumeSession.view==="transcript"&&resumeSession.activeDepositionId)setActive(loaded.find((item:Deposition)=>item.id===resumeSession.activeDepositionId)||null);setStoreIssues(result.issues||[])}catch(error){if(!cancelled)setNotice(error instanceof Error?error.message:"Could not load depositions from disk.")}finally{if(!cancelled)setLibraryLoaded(true)}
    }
    void restore();
    return()=>{cancelled=true};
  }, []);

  useEffect(()=>{if(!libraryLoaded)return;const view:WorkflowView=showAdmin?"admin":showInsertionPages&&active?"insertion-pages":showCompare&&active?"compare":showAudioTools?"audio-tools":showIntake?"intake":active?"transcript":showModal?"setup":"library";localStorage.setItem(WORKFLOW_SESSION_KEY,JSON.stringify({view,activeDepositionId:active?.id??null}))},[active,libraryLoaded,showAdmin,showAudioTools,showCompare,showInsertionPages,showIntake,showModal]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return depositions;
    return depositions.filter((item) =>
      [item.caseStyle, item.witness, item.id].some((value) => value.toLowerCase().includes(term)),
    );
  }, [depositions, query]);

  async function createDeposition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reporter = reporters.find((item) => item.id === selectedReporterId);
    const item: Deposition = {
      id: makeId(),
      caseStyle: String(data.get("caseStyle")),
      witness: String(data.get("witness")),
      causeNumber: String(data.get("causeNumber")),
      deponentType: String(data.get("deponentType")),
      depositionDate: String(data.get("depositionDate")),
      courtReporterId: reporter?.id ?? "",
      courtReporterName: reporter?.name ?? "",
      reporterProfile: reporter ?? undefined,
      canonicalSeed: {
        ...(intakeDraft?.ufmData||{}),
        court:String(data.get("canonicalCourt")||""),district:String(data.get("canonicalDistrict")||""),division:String(data.get("canonicalDivision")||""),county:String(data.get("canonicalCounty")||""),
        scheduledStart:String(data.get("canonicalScheduledStart")||""),timeZone:String(data.get("canonicalTimeZone")||""),location:String(data.get("canonicalLocation")||""),remotePlatform:String(data.get("canonicalRemotePlatform")||""),
        remote:data.get("canonicalRemote")==="on",videotaped:data.get("canonicalVideotaped")==="on",interpreted:data.get("canonicalInterpreted")==="on",corporateRepresentative:data.get("canonicalCorporateRepresentative")==="on",
      },
      intakeNotes: String(data.get("reporterNotes") || intakeDraft?.notes || ""),
      noticeName: intakeDraft?.notice?.name ?? "",
      courtOrderName: intakeDraft?.courtOrder?.name ?? "",
      audioFiles: intakeDraft?.audioFiles.map((file) => file.name) ?? [],
      keytermCount: intakeDraft?.keyterms.length ?? 0,
      keyterms: intakeDraft?.keyterms ?? [],
      audioIntakeIds: intakeDraft ? intakeDraft.audioFiles.map(file=>intakeDraft.audioProfiles[audioProfileKey(file)]?.uploadId).filter((value):value is string=>Boolean(value)) : [],
      createdAt: new Date().toISOString(),
    };
    if(!intakeDraft)return;setCreating(true);setNotice("");
    try{const response=await fetch(`${API}/api/depositions`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({deposition:{...item,deepgramArtifact:intakeDraft.deepgramArtifact,ufmData:{...intakeDraft.ufmData,cause_number:item.causeNumber},warnings:intakeDraft.warnings},artifacts:{notice:await artifact(intakeDraft.notice),courtOrder:await artifact(intakeDraft.courtOrder),supportingFiles:await Promise.all(intakeDraft.supportingFiles.map(file=>artifact(file)))}})});const saved=await response.json();if(!response.ok)throw new Error(saved.error||"Could not create deposition.");setDepositions(current=>[saved,...current]);setShowModal(false);setIntakeDraft(null);setActive(saved)}catch(error){setNotice(error instanceof Error?error.message:"Could not create deposition.")}finally{setCreating(false)}
  }


  function createReporter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reporter: CourtReporter = {
      id: crypto.randomUUID(), name: String(data.get("name")), company: String(data.get("company")),
      email: String(data.get("email")), phone: formatPhoneNumber(String(data.get("phone"))),
      licenseNumber: String(data.get("licenseNumber")), taxId: String(data.get("taxId")), address: String(data.get("address")),
    };
    const updated = [...reporters, reporter].sort((a, b) => a.name.localeCompare(b.name));
    setReporters(updated);
    localStorage.setItem(REPORTERS_STORAGE_KEY, JSON.stringify(updated));
    setSelectedReporterId(reporter.id);
    setShowReporterModal(false);
  }
  function openById(event: FormEvent) {
    event.preventDefault();
    const found = depositions.find((item) => item.id.toLowerCase() === caseId.trim().toLowerCase());
    if (found) {
      setActive(found);
      setNotice("");
    } else {
      setNotice("No deposition was found with that ID.");
    }
  }


  if (showAdmin) {
    return <AdminSettings onClose={() => setShowAdmin(false)} />;
  }
  function startNewDeposition(){localStorage.removeItem(WORKFLOW_SESSION_KEY);setActive(null);setIntakeDraft(null);setAudioToolFiles([]);setShowModal(false);setShowAdmin(false);setShowAudioTools(false);setShowReporterModal(false);setSelectedReporterId("");setQuery("");setCaseId("");setNotice("");setShowIntake(true)}
  async function openAudioTools() {
    if (intakeDraft?.audioFiles.length) setAudioToolFiles(intakeDraft.audioFiles);
    else if (depositions[0]) {
      try { setAudioToolFiles(await loadSavedAudioFiles(depositions[0])); }
      catch { setAudioToolFiles([]); }
    } else setAudioToolFiles([]);
    setShowAudioTools(true);
  }
  if (showAudioTools) {
    return <AudioToolsScreen initialFiles={audioToolFiles} onFilesChange={setAudioToolFiles} onBack={() => setShowAudioTools(false)} />;
  }

  if (showIntake) {
    return <IntakeScreen onCancel={() => setShowIntake(false)} onContinue={(draft) => { setIntakeDraft(draft); setShowIntake(false); setShowModal(true); }} />;
  }
  if (active) {
    if (showInsertionPages) return <InsertionPagesScreen deposition={active} onBack={() => setShowInsertionPages(false)} />;
    if (showCompare) return <TranscriptComparisonScreen deposition={active} onBack={() => setShowCompare(false)} />;
    return <TranscriptCreationScreen deposition={active} onBack={() => setActive(null)} onInsertionPages={() => setShowInsertionPages(true)} onCompare={() => setShowCompare(true)} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button type="button" className="brand" aria-label="Depo Pro home"><span className="brand-mark">DP</span><span>DEPO<span className="brand-accent">PRO</span></span></button>
        <div className="topbar-actions"><button type="button" className="audio-tools-nav" onClick={openAudioTools}>♫ Audio Tools</button><div className="local-status"><span className="status-dot" /> Saved locally on this PC</div><button className="settings-button" onClick={() => setShowAdmin(true)} aria-label="Administrator Settings">⚙</button></div>
      </header>

      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">DEPOSITION LIBRARY</span>
          <h1>Open a saved deposition<br />or start a new one.</h1>
          <p>Create, find, and continue your deposition work from one place. Your records stay on this computer.</p>
        </div>
        <button type="button" className="primary-button" onClick={startNewDeposition}><span>＋</span> New Deposition</button>
        <div className="search-row">
          <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by case style, witness, or deposition ID" /></label>
          <form className="id-search" onSubmit={openById}>
            <input value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="Open by deposition ID" aria-label="Deposition ID" />
            <button type="submit">Open</button>
          </form>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
        {storeIssues.length>0&&<div className="store-issues" role="alert"><strong>Deposition folders need attention</strong><ul>{storeIssues.map(issue=><li key={`${issue.folder}-${issue.code}`}><code>{issue.folder}</code>: {issue.message}</li>)}</ul></div>}
      </section>

      <section className="library-section">
        <div className="section-heading"><div><span className="eyebrow">YOUR WORK</span><h2>Recent depositions</h2></div><span className="count">{filtered.length} {filtered.length === 1 ? "deposition" : "depositions"}</span></div>
        {filtered.length ? (
          <div className="card-grid">
            {filtered.map((item) => (
              <button className="deposition-card" key={item.id} onClick={() => setActive(item)}>
                <div className="card-top"><span className="case-label">CASE</span><span className="workspace-pill">Workspace →</span></div>
                <h3>{item.caseStyle}</h3>
                <code>{item.id}</code>
                <div className="divider" />
                <dl><div><dt>Witness</dt><dd>{item.witness}</dd></div><div><dt>Date</dt><dd>{formatDate(item.depositionDate)}</dd></div></dl>
                <div className="reporter-line"><span>Court Reporter</span><strong>{item.courtReporterName || "Not assigned"}</strong></div>
                <div className="card-footer"><span>▤ Transcript</span><span>Updated {formatDate(item.createdAt)}</span></div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state"><div className="empty-icon">＋</div><h3>{query ? "No matching depositions" : "No depositions yet"}</h3><p>{query ? "Try a different case name, witness, or ID." : "Create your first deposition to begin organizing your case work."}</p>{!query && <button className="secondary-button" onClick={startNewDeposition}>Create a deposition</button>}</div>
        )}
      </section>

      {showModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowModal(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="close-button" aria-label="Close" onClick={() => setShowModal(false)}>×</button>
            <span className="eyebrow">NEW DEPOSITION</span><h2 id="modal-title">Set up the deposition</h2><p>Review the intake details, select the Court Reporter, and create the deposition workspace.</p>
            <form onSubmit={createDeposition}>{intakeDraft && <div className="ai-review-banner"><span>AI</span><div><strong>Claude extraction ready for review</strong><small>{intakeDraft.keyterms.length} Deepgram keyterms and UFM data will be saved with this deposition.</small></div></div>}
              <label>Case style<input name="caseStyle" required defaultValue={intakeDraft?.caseStyle ?? ""} placeholder="e.g., Garza v. Home Depot U.S.A., Inc." /></label>
              <div className="form-row"><label>Witness name<input name="witness" required defaultValue={intakeDraft?.witness ?? ""} placeholder="Full name" /></label><label>Deponent type<select name="deponentType" defaultValue={intakeDraft?.deponentType || "Fact witness"}><option>Fact witness</option><option>Expert witness</option><option>Corporate representative</option><option>Party</option><option>Other</option></select></label></div>
              <label>Cause number <small>Confirm the extracted value or enter it manually</small><input name="causeNumber" required defaultValue={intakeDraft?.causeNumber ?? ""} placeholder="e.g., 25-CV-00598-OLG" /></label>
              <div className="form-row reporter-row"><label>Deposition date<input name="depositionDate" type="date" required defaultValue={intakeDraft?.depositionDate || new Date().toISOString().slice(0, 10)} /></label><label>Court Reporter <small>Required for local filing</small><select name="courtReporterId" required value={selectedReporterId} onChange={(event) => setSelectedReporterId(event.target.value)}><option value="">Select a court reporter</option>{reporters.map((reporter) => <option key={reporter.id} value={reporter.id}>{reporter.name}{reporter.licenseNumber ? ` — ${reporter.licenseNumber}` : ""}</option>)}</select></label></div>
              <button className="add-reporter-button" type="button" onClick={() => setShowReporterModal(true)}>＋ Add a new Court Reporter</button>
              <CanonicalDataSheet seed={intakeDraft?.ufmData}/>
              <label>Reporter notes<textarea name="reporterNotes" rows={3} defaultValue={intakeDraft?.notes ?? ""} placeholder="Scheduling details, appearances, spellings, or special instructions..." /></label>
              <div className="modal-actions"><button type="button" onClick={() => setShowModal(false)} disabled={creating}>Cancel</button><button className="primary-button" type="submit" disabled={creating}>{creating?"Saving to hard drive…":"Create Deposition"}</button></div>
            </form>
          </section>
        </div>
      )}

      {showReporterModal && (
        <div className="modal-backdrop reporter-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowReporterModal(false)}>
          <section className="modal reporter-modal" role="dialog" aria-modal="true" aria-labelledby="reporter-modal-title">
            <button className="close-button" aria-label="Close" onClick={() => setShowReporterModal(false)}>×</button>
            <span className="eyebrow">COURT REPORTER DIRECTORY</span><h2 id="reporter-modal-title">Add a Court Reporter</h2><p>Save the reporter once, then select them for future depositions.</p>
            <form onSubmit={createReporter}>
              <div className="form-row"><label>Full name<input name="name" required placeholder="Court reporter's full name" /></label><label>Company<input name="company" placeholder="Reporting firm" /></label></div>
              <div className="form-row"><label>Email address<input name="email" type="email" placeholder="name@example.com" /></label><label>Phone number<input name="phone" type="tel" inputMode="tel" maxLength={14} placeholder="(469) 740-9603" onInput={(event) => { event.currentTarget.value = formatPhoneNumber(event.currentTarget.value); }} /></label></div>
              <div className="form-row"><label>License number<input name="licenseNumber" placeholder="CSR or license number" /></label><label>Tax ID<input name="taxId" placeholder="Tax identification number" /></label></div>
              <label>Mailing address<textarea name="address" rows={3} placeholder="Street, city, state, ZIP" /></label>
              <p className="sensitive-note">Tax ID information is stored only on this computer. Protect access to this device and its browser profile.</p>
              <div className="modal-actions"><button type="button" onClick={() => setShowReporterModal(false)}>Cancel</button><button className="primary-button" type="submit">Save Court Reporter</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
