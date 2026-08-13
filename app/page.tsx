"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import IntakeScreen, { type IntakeDraft } from "./IntakeScreen";
import AdminSettings from "./AdminSettings";
import TranscriptCreationScreen from "./TranscriptCreationScreen";
import AudioToolsScreen from "./AudioToolsScreen";

type Deposition = {
  id: string;
  caseStyle: string;
  witness: string;
  deponentType: string;
  depositionDate: string;
  courtReporterId: string;
  courtReporterName: string;
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

const STORAGE_KEY = "depo-pro-depositions";
const REPORTERS_STORAGE_KEY = "depo-pro-court-reporters";

function makeId() {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `DEP-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function saveIntakeFiles(depositionId: string, draft: IntakeDraft) {
  const request = indexedDB.open("depo-pro-local-files", 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
  };
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction("files", "readwrite");
    const store = transaction.objectStore("files");
    if (draft.notice) store.put({ id: `${depositionId}:notice`, depositionId, category: "notice", order: 0, name: draft.notice.name, type: draft.notice.type, blob: draft.notice });
    if (draft.courtOrder) store.put({ id: `${depositionId}:court-order`, depositionId, category: "court-order", order: 0, name: draft.courtOrder.name, type: draft.courtOrder.type, blob: draft.courtOrder });
    draft.supportingFiles.forEach((file, index) => store.put({ id: `${depositionId}:supporting:${index}`, depositionId, category: "supporting-document", order: index, name: file.name, type: file.type, blob: file }));
    draft.audioFiles.forEach((file, index) => store.put({ id: `${depositionId}:audio:${index}`, depositionId, category: "audio", order: index, name: file.name, type: file.type, blob: file }));
    store.put({ id: `${depositionId}:deepgram-keyterms`, depositionId, category: "generated", order: 0, name: "deepgram-keyterms.json", type: "application/json", blob: new Blob([JSON.stringify(draft.deepgramArtifact, null, 2)], { type: "application/json" }) });
    store.put({ id: `${depositionId}:ufm-data`, depositionId, category: "generated", order: 1, name: "ufm-data.json", type: "application/json", blob: new Blob([JSON.stringify(draft.ufmData, null, 2)], { type: "application/json" }) });
    store.put({ id: `${depositionId}:audio-processing-audit`, depositionId, category: "generated", order: 2, name: "audio-processing-audit.json", type: "application/json", blob: new Blob([JSON.stringify({ schemaVersion: 1, profiles: draft.audioProfiles }, null, 2)], { type: "application/json" }) });
    transaction.oncomplete = () => db.close();
  };
}
function loadSavedAudioFiles(depositionId: string) {
  return new Promise<File[]>((resolve, reject) => {
    const request = indexedDB.open("depo-pro-local-files", 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { const db=request.result; if(!db.objectStoreNames.contains("files")) db.createObjectStore("files",{keyPath:"id"}); };
    request.onsuccess = () => {
      const db=request.result, transaction=db.transaction("files","readonly"), all=transaction.objectStore("files").getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{ const records=all.result.filter(item=>item.depositionId===depositionId&&item.category==="audio").sort((a,b)=>a.order-b.order); resolve(records.map(item=>new File([item.blob],item.name,{type:item.type,lastModified:item.blob?.lastModified||Date.now()}))); };
      transaction.oncomplete=()=>db.close();
    };
  });
}
export default function Home() {
  const [depositions, setDepositions] = useState<Deposition[]>([]);
  const [reporters, setReporters] = useState<CourtReporter[]>([]);
  const [query, setQuery] = useState("");
  const [caseId, setCaseId] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showIntake, setShowIntake] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAudioTools, setShowAudioTools] = useState(false);
  const [audioToolFiles, setAudioToolFiles] = useState<File[]>([]);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [showReporterModal, setShowReporterModal] = useState(false);
  const [selectedReporterId, setSelectedReporterId] = useState("");
  const [active, setActive] = useState<Deposition | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setDepositions(JSON.parse(saved));
    const savedReporters = localStorage.getItem(REPORTERS_STORAGE_KEY);
    if (savedReporters) setReporters(JSON.parse(savedReporters));
  }, []);

  function persist(items: Deposition[]) {
    setDepositions(items);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return depositions;
    return depositions.filter((item) =>
      [item.caseStyle, item.witness, item.id].some((value) => value.toLowerCase().includes(term)),
    );
  }, [depositions, query]);

  function createDeposition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reporter = reporters.find((item) => item.id === selectedReporterId);
    const item: Deposition = {
      id: makeId(),
      caseStyle: String(data.get("caseStyle")),
      witness: String(data.get("witness")),
      deponentType: String(data.get("deponentType")),
      depositionDate: String(data.get("depositionDate")),
      courtReporterId: reporter?.id ?? "",
      courtReporterName: reporter?.name ?? "",
      intakeNotes: String(data.get("reporterNotes") || intakeDraft?.notes || ""),
      noticeName: intakeDraft?.notice?.name ?? "",
      courtOrderName: intakeDraft?.courtOrder?.name ?? "",
      audioFiles: intakeDraft?.audioFiles.map((file) => file.name) ?? [],
      keytermCount: intakeDraft?.keyterms.length ?? 0,
      keyterms: intakeDraft?.keyterms ?? [],
      audioIntakeIds: intakeDraft ? Object.values(intakeDraft.audioProfiles).map(profile => profile.uploadId) : [],
      createdAt: new Date().toISOString(),
    };
    persist([item, ...depositions]);
    if (intakeDraft) saveIntakeFiles(item.id, intakeDraft);
    setShowModal(false);
    setIntakeDraft(null);
    setActive(item);
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
  async function openAudioTools() {
    if (intakeDraft?.audioFiles.length) setAudioToolFiles(intakeDraft.audioFiles);
    else if (depositions[0]) {
      try { setAudioToolFiles(await loadSavedAudioFiles(depositions[0].id)); }
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
    return <TranscriptCreationScreen deposition={active} onBack={() => setActive(null)} />;
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
        <button type="button" className="primary-button" onClick={() => setShowIntake(true)}><span>＋</span> New Deposition</button>
        <div className="search-row">
          <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by case style, witness, or deposition ID" /></label>
          <form className="id-search" onSubmit={openById}>
            <input value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="Open by deposition ID" aria-label="Deposition ID" />
            <button type="submit">Open</button>
          </form>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
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
          <div className="empty-state"><div className="empty-icon">＋</div><h3>{query ? "No matching depositions" : "No depositions yet"}</h3><p>{query ? "Try a different case name, witness, or ID." : "Create your first deposition to begin organizing your case work."}</p>{!query && <button className="secondary-button" onClick={() => setShowIntake(true)}>Create a deposition</button>}</div>
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
              <div className="form-row reporter-row"><label>Deposition date<input name="depositionDate" type="date" required defaultValue={intakeDraft?.depositionDate || new Date().toISOString().slice(0, 10)} /></label><label>Court Reporter <small>Optional</small><select name="courtReporterId" value={selectedReporterId} onChange={(event) => setSelectedReporterId(event.target.value)}><option value="">Not assigned</option>{reporters.map((reporter) => <option key={reporter.id} value={reporter.id}>{reporter.name}{reporter.licenseNumber ? ` — ${reporter.licenseNumber}` : ""}</option>)}</select></label></div>
              <button className="add-reporter-button" type="button" onClick={() => setShowReporterModal(true)}>＋ Add a new Court Reporter</button>
              <label>Reporter notes<textarea name="reporterNotes" rows={3} defaultValue={intakeDraft?.notes ?? ""} placeholder="Scheduling details, appearances, spellings, or special instructions..." /></label>
              <div className="modal-actions"><button type="button" onClick={() => setShowModal(false)}>Cancel</button><button className="primary-button" type="submit">Create Deposition</button></div>
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
