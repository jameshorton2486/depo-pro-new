"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import IntakeScreen, { type IntakeAttorney, type IntakeDraft } from "./IntakeScreen";
import AdminSettings from "./AdminSettings";
import InsertionPagesScreen from "./InsertionPagesScreen";
import TranscriptComparisonScreen from "./TranscriptComparisonScreen";
import WorkspaceScreen from "./WorkspaceScreen";
import TranscriptPreviewScreen from "./TranscriptPreviewScreen";
import LiveCaptureScreen from "./LiveCaptureScreen";
import OpeningProceduresScreen from "./OpeningProceduresScreen";
import WorkspaceNav, { type NavView } from "./WorkspaceNav";
import AudioToolsScreen from "./AudioToolsScreen";
import CanonicalDataSheet from "./CanonicalDataSheet";
import { normalizeCauseNumber } from "../server/cause-number.mjs";
import { formatDisplayDate } from "./date-format.mjs";
import type { DepositionCreationMode } from "./intake-types";
import { apiJson, LOCAL_API_BASE_URL as API, postJson } from "./api-client";
import { RECOVERED_WORKSPACE_RESTORED, resolveRecoveredWorkspace } from "./workspace-recovery.mjs";
import { DEPONENT_TYPES, deponentTypeOption, logisticsFields, parseNoticeDate } from "./intake-logistics.mjs";
import { reviewedMasterData, triState } from "./master-data-review.mjs";

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
  parties?: string[];
  attorneys?: IntakeAttorney[];
  audioIntakeIds: string[];
  creationMode?: DepositionCreationMode;
  workflowStatus?: "scheduled" | "recording" | "recorded" | "transcribing" | "review" | "complete";
  createdAt: string;
  updatedAt?: string;
};

type LibrarySort = "date" | "cause" | "case" | "witness";
type SortDirection = "asc" | "desc";

type CourtReporter = {
  id: string; name: string; company: string; email: string; phone: string;
  licenseNumber: string; csrExpiration: string; taxId: string; address: string;
  firmRegistrationNumber: string; firmRegistrationWaiver: string;
};

const REPORTERS_STORAGE_KEY = "depo-pro-court-reporters";
const LEGACY_DEPOSITIONS_KEY = "depo-pro-depositions";
const WORKFLOW_SESSION_KEY = "depo-pro-current-workflow-v1";

type WorkflowSession={view:WorkflowView;activeDepositionId:string|null};
const INITIAL_WORKFLOW_SESSION:WorkflowSession={view:"library",activeDepositionId:null};
// One list, because two drifted. The session writer persists every view; the reader accepted six
// of the ten and silently reset the rest to the library with no deposition open -- so reloading
// the Workspace, Compare, Read-through or Certification pages threw the reporter back to the
// start. Deriving the guard from the same constant is what stops the next view being added to one
// and not the other.
// The views that mean nothing without an open deposition. Restoring the flag without restoring
// the deposition is why widening the guard above is not on its own enough: the view flag would be
// restored, active would be null, and `if (active)` would drop to the library anyway.
const DEPOSITION_VIEWS:readonly WorkflowView[]=["transcript","workspace","opening","preview","compare","review","insertion-pages"];
// The one list. The type is derived from it rather than declared beside it, so a view added to
// the union without being added here is a type error at the assignment below -- which is the
// drift that let the writer persist ten views while the reader accepted six. "transcript" stays
// on the list although its screen is gone: a session stored before the deletion must still be
// readable, and it falls through to the Workspace.
const WORKFLOW_VIEWS=["library","intake","setup","transcript","workspace","opening","preview","live-capture","audio-tools","admin","insertion-pages","compare","review"] as const;
type WorkflowView=typeof WORKFLOW_VIEWS[number];
function readWorkflowSession():WorkflowSession{try{const value=JSON.parse(localStorage.getItem(WORKFLOW_SESSION_KEY)||"null");return value&&(WORKFLOW_VIEWS as readonly string[]).includes(value.view)?{view:value.view,activeDepositionId:typeof value.activeDepositionId==="string"?value.activeDepositionId:null}:INITIAL_WORKFLOW_SESSION}catch{return INITIAL_WORKFLOW_SESSION}}

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
async function loadReporters(){
  let {reporters}=await apiJson<{reporters:CourtReporter[]}>("/api/reporters",{cache:"no-store"});
  const legacy=localStorage.getItem(REPORTERS_STORAGE_KEY);
  if(legacy){
    const candidates=JSON.parse(legacy) as CourtReporter[];
    if(candidates.length)({reporters}=await postJson<{reporters:CourtReporter[]}>("/api/reporters/import",{reporters:candidates}));
    localStorage.removeItem(REPORTERS_STORAGE_KEY);
  }
  return reporters;
}
export default function Home() {
  const [depositions, setDepositions] = useState<Deposition[]>([]);
  const [reporters, setReporters] = useState<CourtReporter[]>([]);
  const [query, setQuery] = useState("");
  const [caseId, setCaseId] = useState("");
  const [librarySort,setLibrarySort]=useState<LibrarySort>("date");
  const [sortDirection,setSortDirection]=useState<SortDirection>("desc");
  const [showFilters,setShowFilters]=useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showIntake, setShowIntake] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAudioTools, setShowAudioTools] = useState(false);
  const [showInsertionPages, setShowInsertionPages] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showPreview,setShowPreview]=useState(false);
  const [showLiveCapture,setShowLiveCapture]=useState(false);
  const [showOpening,setShowOpening]=useState(false);
  const [liveRecording,setLiveRecording]=useState(false);
  const [audioToolFiles, setAudioToolFiles] = useState<File[]>([]);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [showReporterModal, setShowReporterModal] = useState(false);
  // The profile being corrected, or null when adding a new one. One modal does both: a reporter
  // fixing a mistyped licence number is filling in the same fields they filled in to create it, and a
  // second screen would only be a second place for the two to disagree.
  const [editingReporter, setEditingReporter] = useState<CourtReporter | null>(null);
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
      try{setReporters(await loadReporters())}catch(error){setReporters([]);setNotice(error instanceof Error?error.message:"Could not load the Court Reporter directory.")}
      setShowModal(resumeSession.view==="setup");
      setShowIntake(resumeSession.view==="intake");
      setShowAdmin(resumeSession.view==="admin");
      setShowAudioTools(resumeSession.view==="audio-tools");setShowInsertionPages(resumeSession.view==="insertion-pages");setShowCompare(resumeSession.view==="compare");setShowPreview(resumeSession.view==="preview");setShowLiveCapture(resumeSession.view==="live-capture");setShowOpening(resumeSession.view==="opening");
      try{const response=await fetch(`${API}/api/depositions`),result=await response.json(),disk=result.depositions||[],migrated=await migrateLegacyDepositions(disk),loaded=(migrated||disk).sort((a:Deposition,b:Deposition)=>b.createdAt.localeCompare(a.createdAt));if(cancelled)return;setDepositions(loaded);if(DEPOSITION_VIEWS.includes(resumeSession.view)&&resumeSession.activeDepositionId)setActive(loaded.find((item:Deposition)=>item.id===resumeSession.activeDepositionId)||null);setStoreIssues(result.issues||[])}catch(error){if(!cancelled)setNotice(error instanceof Error?error.message:"Could not load depositions from disk.")}finally{if(!cancelled)setLibraryLoaded(true)}
    }
    void restore();
    return()=>{cancelled=true};
  }, []);

  useEffect(()=>{if(!libraryLoaded)return;const view:WorkflowView=showAdmin?"admin":showInsertionPages&&active?"insertion-pages":showCompare&&active?"compare":showPreview&&active?"preview":showOpening&&active?"opening":showLiveCapture?"live-capture":showAudioTools?"audio-tools":showIntake?"intake":active?"workspace":showModal?"setup":"library";localStorage.setItem(WORKFLOW_SESSION_KEY,JSON.stringify({view,activeDepositionId:active?.id??null}))},[active,libraryLoaded,showAdmin,showAudioTools,showCompare,showInsertionPages,showIntake,showLiveCapture,showModal,showOpening,showPreview]);

  const restoreRecoveredDeposition = useCallback(async (depositionId:string) => {
    const response=await fetch(`${API}/api/depositions`),result=await response.json();
    if(!response.ok)throw new Error(result.error||"The deposition library could not be loaded during recording recovery.");
    const resolution=resolveRecoveredWorkspace(result.depositions||[],depositionId);
    if(resolution.kind!==RECOVERED_WORKSPACE_RESTORED)return false;
    setActive(resolution.deposition as Deposition);
    return true;
  },[]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = term ? depositions.filter((item) =>
      [item.caseStyle, item.witness, item.id].some((value) => value.toLowerCase().includes(term)),
    ) : [...depositions];
    const text=(item:Deposition)=>librarySort==="cause"?item.causeNumber:librarySort==="case"?item.caseStyle:librarySort==="witness"?item.witness:item.depositionDate;
    return matches.sort((a,b)=>{
      const compared=text(a).localeCompare(text(b),undefined,{numeric:true,sensitivity:"base"});
      return sortDirection==="asc"?compared:-compared;
    });
  }, [depositions, query, librarySort, sortDirection]);

  function selectLibrarySort(value:LibrarySort){
    if(value===librarySort)setSortDirection(current=>current==="asc"?"desc":"asc");
    else{setLibrarySort(value);setSortDirection(value==="date"?"desc":"asc")}
  }
  function libraryStatus(item:Deposition){
    if(item.workflowStatus==="complete")return{label:"Ready",tone:"ready"};
    if(item.workflowStatus==="scheduled")return{label:"Draft",tone:"draft"};
    return{label:"In progress",tone:"progress"};
  }

  async function createDeposition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!intakeDraft)return;
    const data = new FormData(event.currentTarget);
    const reporter = reporters.find((item) => item.id === selectedReporterId);
    const masterData=reviewedMasterData(intakeDraft.masterData,data);
    const item: Deposition = {
      id: makeId(),
      caseStyle: String(data.get("caseStyle")),
      witness: String(data.get("witness")),
      causeNumber: normalizeCauseNumber(data.get("causeNumber")),
      deponentType: String(data.get("deponentType")),
      depositionDate: String(data.get("depositionDate")),
      courtReporterId: reporter?.id ?? "",
      courtReporterName: reporter?.name ?? "",
      reporterProfile: reporter ?? undefined,
      // Values only. `extractedFields` used to be computed here as well, from a second copy of the
      // extraction, and it won -- it is spread after the master record's own list in
      // createDeposition. Two lists that could disagree about what the document said is one list too
      // many, so this one is gone and canonicalInputFromMaster is the single authority.
      canonicalSeed: {
        court:String(data.get("canonicalCourt")||""),district:String(data.get("canonicalDistrict")||""),division:String(data.get("canonicalDivision")||""),county:String(data.get("canonicalCounty")||""),
        scheduledStart:String(data.get("canonicalScheduledStart")||""),timeZone:String(data.get("canonicalTimeZone")||""),location:String(data.get("canonicalLocation")||""),remotePlatform:String(data.get("canonicalRemotePlatform")||""),
        // Absence and "no" are different answers. A checkbox could not tell them apart -- unchecked
        // is simply missing from FormData, so `=== "on"` recorded "nobody answered" as "not remote"
        // and named the Notice as the source for it. These are tri-state selects now: "" means the
        // question is still unanswered and the cell stays MISSING.
        remote:triState(data,"canonicalRemote"),videotaped:triState(data,"canonicalVideotaped"),
        interpreted:triState(data,"canonicalInterpreted"),corporateRepresentative:triState(data,"canonicalCorporateRepresentative"),
      },
      intakeNotes: String(data.get("reporterNotes") || intakeDraft?.notes || ""),
      noticeName: intakeDraft?.notice?.name ?? "",
      courtOrderName: intakeDraft?.courtOrder?.name ?? "",
      audioFiles: intakeDraft?.audioFiles.map((file) => file.name) ?? [],
      keytermCount: intakeDraft?.keyterms.length ?? 0,
      keyterms: intakeDraft?.keyterms ?? [],
      // Read by createCanonicalDepositionRecord as input.parties / input.attorneys, which is why
      // they must sit at the top level of the deposition object rather than inside canonicalSeed.
      parties: intakeDraft?.parties ?? [],
      attorneys: intakeDraft?.attorneys ?? [],
      audioIntakeIds: intakeDraft ? intakeDraft.audioFiles.map(file=>intakeDraft.audioProfiles[audioProfileKey(file)]?.uploadId).filter((value):value is string=>Boolean(value)) : [],
      creationMode: intakeDraft.creationMode,
      workflowStatus: intakeDraft.creationMode === "live" ? "scheduled" : "review",
      createdAt: new Date().toISOString(),
    };
    setCreating(true);setNotice("");
    try{const response=await fetch(`${API}/api/depositions`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({deposition:{...item,masterData,warnings:intakeDraft.warnings},artifacts:{notice:await artifact(intakeDraft.notice),courtOrder:await artifact(intakeDraft.courtOrder),supportingFiles:await Promise.all(intakeDraft.supportingFiles.map(file=>artifact(file)))}})});const saved=await response.json();if(!response.ok)throw new Error(saved.error||"Could not create deposition.");setDepositions(current=>[saved,...current]);setShowModal(false);setIntakeDraft(null);setActive(saved);setShowLiveCapture(item.creationMode==="live")}catch(error){setNotice(error instanceof Error?error.message:"Could not create deposition.")}finally{setCreating(false)}
  }


  // Saves a new profile, or corrects one that exists. Nothing could correct a stored reporter before
  // this: create refuses an id it already holds and import skips one, so a mistyped CSR licence
  // number -- which prints in the signature block of every certificate that reporter signs -- was
  // permanent. Found at the first screen of Production Trial #1.
  async function saveReporter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const correcting = editingReporter;
    const reporter: CourtReporter = {
      id: correcting?.id ?? crypto.randomUUID(), name: String(data.get("name")), company: String(data.get("company")),
      email: String(data.get("email")), phone: formatPhoneNumber(String(data.get("phone"))),
      licenseNumber: String(data.get("licenseNumber")), csrExpiration: String(data.get("csrExpiration")),
      taxId: String(data.get("taxId")), address: String(data.get("address")),
      firmRegistrationNumber: String(data.get("firmRegistrationNumber")),
      firmRegistrationWaiver: String(data.get("firmRegistrationWaiver")),
    };
    try{
      const saved=await postJson<CourtReporter>(correcting?"/api/reporters/update":"/api/reporters",reporter);
      setReporters(current=>(correcting?current.map(item=>item.id===saved.id?saved:item):[...current,saved])
        .sort((a,b)=>a.name.localeCompare(b.name)));
      setSelectedReporterId(saved.id);
      setEditingReporter(null);
      setShowReporterModal(false);
    }catch(error){setNotice(error instanceof Error?error.message:"Could not save the Court Reporter.")}
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


  const currentView:NavView = showAdmin?"admin":showIntake?"intake":showAudioTools?"audio-tools":showLiveCapture?"live-capture":active?(showOpening?"opening":showInsertionPages?"insertion-pages":showCompare?"compare":showPreview?"preview":"workspace"):"library";
  function navigate(next:NavView){
    if(next==="intake"){startNewDeposition();return}
    // One place decides which screen is showing. Every entry clears the others, so two
    // screens cannot both be open -- the thirteen independent booleans allow that otherwise.
    setShowAdmin(next==="admin"); setShowIntake(false); setShowAudioTools(next==="audio-tools");
    setShowOpening(next==="opening"); setShowInsertionPages(next==="insertion-pages"); setShowCompare(next==="compare"); setShowPreview(next==="preview"); setShowLiveCapture(next==="live-capture");
    if(next==="library") setActive(null);
  }
  const frame=(node:React.ReactNode)=>(
    <div className="app-frame">
      <WorkspaceNav current={currentView} hasDeposition={Boolean(active)} depositionLabel={active?.witness} navigationLocked={liveRecording} onNavigate={navigate} />
      <div className="app-frame-body">{node}</div>
    </div>
  );
  if (showAdmin) {
    return frame(<AdminSettings onClose={() => setShowAdmin(false)} />);
  }
  function startNewDeposition(){localStorage.removeItem(WORKFLOW_SESSION_KEY);setActive(null);setIntakeDraft(null);setAudioToolFiles([]);setShowModal(false);setShowAdmin(false);setShowAudioTools(false);setShowLiveCapture(false);setShowOpening(false);setShowReporterModal(false);setSelectedReporterId("");setQuery("");setCaseId("");setNotice("");setShowIntake(true)}
  async function openAudioTools() {
    if (intakeDraft?.audioFiles.length) setAudioToolFiles(intakeDraft.audioFiles);
    else if (depositions[0]) {
      try { setAudioToolFiles(await loadSavedAudioFiles(depositions[0])); }
      catch { setAudioToolFiles([]); }
    } else setAudioToolFiles([]);
    setShowAudioTools(true);
  }

  if (showAudioTools) {
    return frame(<AudioToolsScreen initialFiles={audioToolFiles} onFilesChange={setAudioToolFiles} onBack={() => setShowAudioTools(false)} />);
  }

  // Recording no longer waits for a deposition to exist. The reporter presses record and decides
  // where it belongs afterwards, so this sits beside Audio tools rather than inside the
  // open-deposition block. An open deposition is still passed when there is one.
  if (showLiveCapture) {
    return frame(<LiveCaptureScreen deposition={active} onRecoveredDeposition={restoreRecoveredDeposition} onRecordingChange={setLiveRecording} onDepositionUpdated={(value)=>{const updated=value as Deposition;setActive(updated);setDepositions(current=>current.map(item=>item.id===updated.id?updated:item))}} onBack={() => setShowLiveCapture(false)} />);
  }

  if (showIntake) {
    // Its button says "Back to depositions", so it goes to the depositions. Closing intake
    // without clearing the active deposition dropped the reporter into the Workspace of whatever
    // was open before -- which reads as the app refusing to leave, particularly when intake was
    // reached from the nav while a deposition was open.
    return frame(<IntakeScreen onCancel={() => { setShowIntake(false); setActive(null); }} onRecordUnattached={() => { setShowIntake(false); setActive(null); setShowLiveCapture(true); }} onContinue={(draft) => { setIntakeDraft(draft); setShowIntake(false); setShowModal(true); }} />);
  }
  if (active) {
    if (showOpening) return frame(<OpeningProceduresScreen deposition={active} onBack={()=>setShowOpening(false)} onContinue={()=>{setShowOpening(false);setShowLiveCapture(active.creationMode==="live")}} />);
    if (showInsertionPages) return frame(<InsertionPagesScreen deposition={active} onBack={() => setShowInsertionPages(false)} />);
    if (showCompare) return frame(<TranscriptComparisonScreen deposition={active} onBack={() => setShowCompare(false)} />);
    if (showPreview) return frame(<TranscriptPreviewScreen deposition={active} onBack={() => setShowPreview(false)} />);
    // The Workspace is the default for an open deposition. It was the Transcript screen, whose
    // only irreplaceable control -- the transcribe step -- now lives here, and whose speaker map
    // is keyed by job here too. A stored session naming the retired "transcript" view lands here
    // as well, because no flag matches it and this is the fallback.
    return frame(<WorkspaceScreen deposition={active} onBack={() => setActive(null)} />);
  }

  return frame(
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
        <div className="section-heading">
          <div><span className="eyebrow">YOUR WORK</span><h2>Recent depositions</h2></div>
          <div className="library-tools">
            <span className="count">{filtered.length} {filtered.length===1?"deposition":"depositions"}</span>
            <label className="sort-control"><span>Sort by</span><select value={librarySort} onChange={event=>selectLibrarySort(event.target.value as LibrarySort)} aria-label="Sort depositions"><option value="date">Deposition date</option><option value="cause">Cause number</option><option value="case">Case style</option><option value="witness">Witness</option></select></label>
            <button type="button" className="sort-direction" onClick={()=>setSortDirection(current=>current==="asc"?"desc":"asc")} aria-label={`Sort ${sortDirection==="asc"?"descending":"ascending"}`} title={`Currently ${sortDirection==="asc"?"ascending":"descending"}`}>{sortDirection==="asc"?"↑":"↓"}</button>
            <button type="button" className={`filter-toggle${showFilters?" active":""}`} aria-expanded={showFilters} onClick={()=>setShowFilters(current=>!current)}>Filters</button>
          </div>
        </div>
        {showFilters&&<div className="library-filter-panel"><span>Showing <strong>{filtered.length}</strong> of {depositions.length} {depositions.length===1?"deposition":"depositions"}{query.trim()?` matching “${query.trim()}”`:""}.</span>{query.trim()&&<button type="button" onClick={()=>setQuery("")}>Clear search</button>}</div>}
        {filtered.length ? (
          <div className="card-grid">
            {filtered.map((item) => {
              const status=libraryStatus(item);
              return <button className="deposition-card" key={item.id} onClick={() => setActive(item)} aria-label={`Open ${item.caseStyle} workspace`}>
                <div className="card-top"><span className={`library-status ${status.tone}`}>{status.label}</span><span className="workspace-pill">Workspace →</span></div>
                <h3>{item.caseStyle}</h3>
                <code>{item.id}</code>
                <div className="divider" />
                <dl><div><dt>Witness</dt><dd>{item.witness}</dd></div><div><dt>Date</dt><dd>{formatDate(item.depositionDate)}</dd></div><div><dt>Cause number</dt><dd>{item.causeNumber}</dd></div></dl>
                <div className="reporter-line"><span>Court Reporter</span><strong>{item.courtReporterName || "Not assigned"}</strong></div>
                <div className="card-footer"><span>{item.creationMode==="live"?"● Live deposition":"▤ Existing recording"}</span><span>Updated {formatDate(item.updatedAt||item.createdAt)}</span></div>
              </button>
            })}
          </div>
        ) : (
          <div className="empty-state"><div className="empty-icon">＋</div><h3>{query ? "No matching depositions" : "No depositions yet"}</h3><p>{query ? "Try a different case name, witness, or ID." : "Create your first deposition to begin organizing your case work."}</p>{query?<button className="secondary-button" onClick={()=>setQuery("")}>Clear search</button>:<button className="secondary-button" onClick={startNewDeposition}>New Deposition</button>}</div>
        )}
      </section>

      {showModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowModal(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="close-button" aria-label="Close" onClick={() => setShowModal(false)}>×</button>
            <span className="eyebrow">NEW DEPOSITION</span><h2 id="modal-title">Set up the deposition</h2><p>Review the intake details, select the Court Reporter, and create the deposition workspace.</p>
            <form onSubmit={createDeposition}>{intakeDraft && <div className="ai-review-banner"><span>AI</span><div><strong>Master deposition data ready for review</strong><small>One record will supply setup, the applicable template workflow, and {intakeDraft.keyterms.length} Deepgram terms.</small></div></div>}
              <label>Case style<input name="caseStyle" required defaultValue={intakeDraft?.caseStyle ?? ""} placeholder="e.g., Garza v. Home Depot U.S.A., Inc." /></label>
              <div className="form-row"><label>Witness name<input name="witness" required defaultValue={intakeDraft?.witness ?? ""} placeholder="Full name" /></label><label>Deponent type<select name="deponentType" defaultValue={deponentTypeOption(intakeDraft?.deponentType) ?? ""}><option value="">Not stated</option>{DEPONENT_TYPES.map(option => <option key={option} value={option}>{option}</option>)}</select></label></div>
              <label>Cause number <small>Letters are saved in uppercase</small><input name="causeNumber" required defaultValue={normalizeCauseNumber(intakeDraft?.causeNumber)} onInput={(event) => { event.currentTarget.value = event.currentTarget.value.toLocaleUpperCase("en-US"); }} placeholder="e.g., 25-CV-00598-OLG" /></label>
              <div className="form-row reporter-row"><label>Deposition date<input name="depositionDate" type="date" required defaultValue={parseNoticeDate(intakeDraft?.depositionDate) ?? logisticsFields(intakeDraft?.ufmData).depositionDate ?? ""} /></label><label>Court Reporter <small>{reporters.length ? "Required for local filing" : "Required — no court reporter is saved on this computer yet. Add one below before creating the deposition."}</small><select name="courtReporterId" required value={selectedReporterId} onChange={(event) => setSelectedReporterId(event.target.value)}><option value="">Select a court reporter</option>{reporters.map((reporter) => <option key={reporter.id} value={reporter.id}>{reporter.name}{reporter.licenseNumber ? ` — ${reporter.licenseNumber}` : ""}</option>)}</select></label></div>
              <button className="add-reporter-button" type="button" onClick={() => { setEditingReporter(null); setShowReporterModal(true); }}>＋ Add a new Court Reporter</button>
              {selectedReporterId && <button className="add-reporter-button" type="button" onClick={() => { setEditingReporter(reporters.find((item) => item.id === selectedReporterId) ?? null); setShowReporterModal(true); }}>✎ Correct this Court Reporter</button>}
              <CanonicalDataSheet seed={intakeDraft?.masterData}/>
              <label>Reporter notes<textarea name="reporterNotes" rows={3} defaultValue={intakeDraft?.notes ?? ""} placeholder="Scheduling details, appearances, spellings, or special instructions..." /></label>
              <div className="modal-actions"><button type="button" onClick={() => setShowModal(false)} disabled={creating}>Cancel</button><button className="primary-button" type="submit" disabled={creating}>{creating?"Saving to hard drive…":intakeDraft?.creationMode==="live"?"Save, Create, and Continue to Recording Setup":"Save and Create Deposition"}</button></div>
            </form>
          </section>
        </div>
      )}

      {showReporterModal && (
        <div className="modal-backdrop reporter-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowReporterModal(false)}>
          <section className="modal reporter-modal" role="dialog" aria-modal="true" aria-labelledby="reporter-modal-title">
            <button className="close-button" aria-label="Close" onClick={() => setShowReporterModal(false)}>×</button>
            <span className="eyebrow">COURT REPORTER DIRECTORY</span><h2 id="reporter-modal-title">{editingReporter ? "Correct a Court Reporter" : "Add a Court Reporter"}</h2><p>{editingReporter ? "These values print in the signature block of every certificate this reporter signs." : "Save the reporter once, then select them for future depositions."}</p>
            <form onSubmit={saveReporter}>
              <div className="form-row"><label>Full name<input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.name ?? ""} name="name" required placeholder="Court reporter's full name" /></label><label>Company<input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.company ?? ""} name="company" placeholder="Reporting firm" /></label></div>
              <div className="form-row"><label>Email address<input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.email ?? ""} name="email" type="email" placeholder="name@example.com" /></label><label>Phone number<input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.phone ?? ""} name="phone" type="tel" inputMode="tel" maxLength={14} placeholder="(469) 740-9603" onInput={(event) => { event.currentTarget.value = formatPhoneNumber(event.currentTarget.value); }} /></label></div>
              <div className="form-row"><label>License number <small>Digits only; the certificate prints &quot;Texas CSR&quot; before it.</small><input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.licenseNumber ?? ""} name="licenseNumber" placeholder="9174" /></label><label>CSR expiration<input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.csrExpiration ?? ""} name="csrExpiration" type="date" /></label></div>
              <div className="form-row"><label>Tax ID<input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.taxId ?? ""} name="taxId" placeholder="Tax identification number" /></label></div>
              {/* Both of these are required by a certified page and had no input at all. Every
                  reviewed Texas certificate prints the CSR expiration, and validateInsertionInput
                  blocks without it. The waiver is how a reporter with no firm answers the firm
                  registration requirement -- the validator has honoured it since this evening, but
                  nothing could record one, so the stored value was always "" and an empty waiver is
                  not a waiver.

                  The number below is the other answer, and until now this form could not take it:
                  the waiver's own hint said "leave empty if the firm has one" beside no field to put
                  one in. */}
              <label>Firm registration number <small>Printed in the signature block. Enter it if the deposition was reported through a registered firm.</small><input key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.firmRegistrationNumber ?? ""} name="firmRegistrationNumber" placeholder="2486" /></label>
              <label>Firm registration waiver <small>Why no firm registration number applies. Leave empty if the firm has one.</small><textarea key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.firmRegistrationWaiver ?? ""} name="firmRegistrationWaiver" rows={2} placeholder="Certifies under an individual Texas CSR; no firm registration applies." /></label>
              <label>Mailing address<textarea key={editingReporter?.id ?? "new"} defaultValue={editingReporter?.address ?? ""} name="address" rows={3} placeholder="Street, city, state, ZIP" /></label>
              <p className="sensitive-note">Tax ID information is stored only on this computer. Protect access to this device and its browser profile.</p>
              <div className="modal-actions"><button type="button" onClick={() => { setEditingReporter(null); setShowReporterModal(false); }}>Cancel</button><button className="primary-button" type="submit">Save Court Reporter</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
