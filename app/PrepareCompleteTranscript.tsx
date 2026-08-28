"use client";
import { useCallback, useEffect, useState } from "react";

import { LOCAL_API_BASE_URL as API } from "./api-client";
import { DISPOSITIONS, JURISDICTIONS } from "./complete-transcript-options.mjs";

// The reporter-facing way into the complete transcript.
//
// The engine and its authority already existed: getCompleteTranscriptModel refuses without
// intake/complete-transcript-assembly.json, and writeAssembly has been able to create that file
// since 0e5ae4d. Until this panel the only writer was the fixture generator, so a complete
// transcript existed for fixture-created depositions and for nothing a reporter could make.
//
// What this panel does NOT do, deliberately:
//
//   - It does not decide readiness. The server returns `blocking` findings and `ready`, and this
//     displays them. A screen that judged for itself would be a second authority on the question,
//     and the two would disagree the first time one of them changed.
//   - It does not construct pages, page numbers or index entries. It collects administrative
//     authority only; the shared paginator remains the single document authority.
//   - It does not retype the jurisdiction or disposition lists. They come from the same frozen
//     module the validator reads, which is why that module has no imports of its own.
//   - It never sends a typed examiner name. `operator.examiningCounselId` is a canonical counsel
//     id, so the choice is made from the roster the record already holds.
type Finding = { code:string; message:string; field?:string|null };
type Readiness = { ready:boolean; revision:number; exists:boolean; blocking:Finding[]; assembly:{ operator?:Operator }|null };
type Operator = { jurisdiction?:string; signatureDisposition?:string; signatureDispositionBasis?:string; examiningCounselId?:string };
type Counsel = { id:string; name:string; firm:string };

const JURISDICTION_LABELS:Record<string,string> = { "texas-state":"Texas state", federal:"Federal" };
const DISPOSITION_LABELS:Record<string,string> = { requested:"Signature requested", waived:"Signature waived" };

export default function PrepareCompleteTranscript({ depositionId, preparedBy }:{ depositionId:string; preparedBy:string }) {
  const [readiness, setReadiness] = useState<Readiness|null>(null);
  const [counsel, setCounsel] = useState<Counsel[]>([]);
  const [operator, setOperator] = useState<Operator>({});
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [conflict, setConflict] = useState("");
  const [notice, setNotice] = useState("");

  // Reading and applying are separate so the mount effect can drop a result that arrived after the
  // panel went away, following the pattern the Workspace already uses for its own loads.
  const read = useCallback(async () => {
    const [assemblyResponse, counselResponse] = await Promise.all([
      fetch(`${API}/api/transcript/assembly?depositionId=${encodeURIComponent(depositionId)}`),
      fetch(`${API}/api/deposition/counsel?depositionId=${encodeURIComponent(depositionId)}`),
    ]);
    return { current:(await assemblyResponse.json()) as Readiness, roster:await counselResponse.json() };
  }, [depositionId]);

  // Existing preparation is loaded, not assumed absent: a reporter returning to this panel is
  // amending what they recorded before, and starting them from blank would quietly discard it.
  const apply = useCallback((current:Readiness, roster:{ counsel?:Counsel[] }) => {
    setReadiness(current);
    setCounsel(roster.counsel ?? []);
    setOperator(current.assembly?.operator ?? {});
    setFindings(current.blocking ?? []);
    setConflict("");
  }, []);

  const load = useCallback(async () => { const { current, roster } = await read(); apply(current, roster); }, [read, apply]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { current, roster } = await read();
      if (!cancelled) apply(current, roster);
    })();
    return () => { cancelled = true; };
  }, [read, apply]);

  const set = (key:keyof Operator, value:string) => setOperator(current => ({ ...current, [key]:value }));

  async function save() {
    if (!readiness) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/transcript/assembly`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          depositionId,
          // What the reporter last read. The server refuses a mismatch rather than merging, and
          // this is the value that makes that possible.
          expectedRevision: readiness.revision,
          // Never defaulted here. A timestamp the screen invented is indistinguishable on the page
          // from one a reporter's action produced, so this is stamped at the moment they save.
          actor:{ preparedBy, preparedAt:new Date().toISOString() },
          assembly:{ schemaVersion:"1.1.0", operator },
        }),
      });
      const body = await response.json();
      if (response.status === 409) {
        // A different instruction from "fix these fields": reload, do not retry.
        setConflict(body.error ?? "This preparation was changed elsewhere. Reload before saving.");
        setFindings([]);
        return;
      }
      if (!response.ok) {
        setFindings(body.findings ?? [{ code:body.code ?? "ASSEMBLY_REFUSED", message:body.error ?? "The preparation was refused." }]);
        return;
      }
      setReadiness({ ...body, assembly:body.assembly ?? null });
      setFindings(body.blocking ?? []);
      setNotice(`Saved as revision ${body.revision}.`);
    } finally {
      setBusy(false);
    }
  }

  if (!readiness) return <section className="prepare-complete" aria-label="Prepare Complete Transcript"><p>Loading the preparation…</p></section>;

  return (
    <section className="prepare-complete" aria-label="Prepare Complete Transcript">
      <header>
        <h3>Prepare Complete Transcript</h3>
        <p>
          Record the administrative authority the complete transcript is assembled from. The pages,
          numbering and index come from the shared document model, not from anything entered here.
        </p>
      </header>

      <div className="form-row">
        <label>Jurisdiction
          <select value={operator.jurisdiction ?? ""} onChange={event => set("jurisdiction", event.target.value)}>
            <option value="">Select the jurisdiction</option>
            {(JURISDICTIONS as readonly string[]).map(option =>
              <option key={option} value={option}>{JURISDICTION_LABELS[option] ?? option}</option>)}
          </select>
        </label>
        <label>Signature disposition
          <select value={operator.signatureDisposition ?? ""} onChange={event => set("signatureDisposition", event.target.value)}>
            <option value="">Select the disposition</option>
            {(DISPOSITIONS as readonly string[]).map(option =>
              <option key={option} value={option}>{DISPOSITION_LABELS[option] ?? option}</option>)}
          </select>
        </label>
      </div>

      {/* Printed on the certificate, so it is the reporter's words rather than a code this screen
          expands. */}
      <label>How the signature disposition was established
        <input value={operator.signatureDispositionBasis ?? ""} onChange={event => set("signatureDispositionBasis", event.target.value)}
          placeholder="Stated on the record" />
      </label>

      <label>Examining attorney
        <select value={operator.examiningCounselId ?? ""} onChange={event => set("examiningCounselId", event.target.value)}>
          <option value="">Select the examining attorney</option>
          {counsel.map(item => <option key={item.id} value={item.id}>{item.firm ? `${item.name} — ${item.firm}` : item.name}</option>)}
        </select>
      </label>
      {!counsel.length && <p className="prepare-complete-empty">No counsel are recorded on this deposition, so there is no one to name as the examining attorney.</p>}

      {conflict && <p className="prepare-complete-conflict" role="alert">{conflict}</p>}

      {/* The server's findings, in the server's words. This does not translate a code: a display
          that expanded an enum would claim to know more than it was told. */}
      {findings.length > 0 && (
        <ul className="prepare-complete-findings" aria-label="What this preparation still needs">
          {findings.map(finding => <li key={finding.code + (finding.field ?? "")}>{finding.message}</li>)}
        </ul>
      )}

      <div className="prepare-complete-actions">
        <span className={readiness.ready ? "prepare-complete-ready" : "prepare-complete-blocked"} role="status">
          {readiness.ready ? "Complete transcript ready" : "Complete transcript blocked — action required"}
          {readiness.exists ? ` · revision ${readiness.revision}` : ""}
        </span>
        {notice && <span className="prepare-complete-notice" role="status">{notice}</span>}
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={busy}>Reload</button>
        <button type="button" className="primary-button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save preparation"}
        </button>
      </div>
    </section>
  );
}
