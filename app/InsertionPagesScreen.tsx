"use client";

import { useState } from "react";

const API = "http://127.0.0.1:4317";

type Finding = { code: string; target: string; severity: "blocking" | "warning"; message: string };
type RenderingSpec = { sha256?: string; pages?: unknown[] };
type Preview = { variant: string; findings: Finding[]; renderingSpec: RenderingSpec; workspaceDocument?: unknown };
type Artifact = { outputPath: string; bytes: number; mode: string; variant: string; findings: Finding[]; pageSetSha256: string; renderingSpecSha256: string; renderingSpecPath: string };
type Deposition = { id: string; caseStyle: string; witness: string; depositionDate: string; courtReporterName: string };

const JURISDICTIONS = [
  { value: "texas-state", label: "Texas state court" },
  { value: "federal", label: "Federal court" },
] as const;

const DISPOSITIONS = [
  { value: "requested", label: "Signature requested", hint: "The witness reserved the right to read and sign." },
  { value: "waived", label: "Signature waived", hint: "Reading and signing was waived on the record." },
] as const;

export default function InsertionPagesScreen({ deposition, onBack }: { deposition: Deposition; onBack: () => void }) {
  const [jurisdiction, setJurisdiction] = useState<string>("texas-state");
  const [signatureDisposition, setSignatureDisposition] = useState<string>("");
  const [basis, setBasis] = useState("");
  const [mode, setMode] = useState<"standalone" | "full">("standalone");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose the jurisdiction and signature disposition to preview the certification pages.");

  const findings = artifact?.findings ?? preview?.findings ?? [];
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const ready = Boolean(jurisdiction && signatureDisposition);

  function request() {
    return { depositionId: deposition.id, mode, operator: { jurisdiction, signatureDisposition, signatureDispositionBasis: basis.trim() || null } };
  }

  async function post(path: string) {
    const response = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request()) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Request failed with status ${response.status}.`);
    return body;
  }

  async function runPreview() {
    setBusy(true); setArtifact(null); setMessage("Assembling the certification pages…");
    try {
      const body = (await post("/api/insertion-pages/rendering-spec")) as Preview;
      setPreview(body);
      const stops = (body.findings ?? []).filter((finding) => finding.severity === "blocking");
      setMessage(stops.length ? `${stops.length} blocking issue${stops.length === 1 ? "" : "s"} must be resolved before a document can be produced.` : `Ready to generate. Variant ${body.variant}.`);
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "The certification pages could not be assembled.");
    } finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true); setMessage("Rendering the Word document…");
    try {
      const body = (await post("/api/insertion-pages/docx")) as Artifact;
      setArtifact(body);
      setMessage(`Word document written to ${body.outputPath}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Word document could not be rendered.");
    } finally { setBusy(false); }
  }

  return (
    <main className="insertion-screen">
      <div className="insertion-heading">
        <span className="eyebrow">CERTIFICATION PAGES</span>
        <h1>Insertion pages</h1>
        <p>{deposition.caseStyle} · {deposition.witness} · {deposition.depositionDate}</p>
        <button type="button" className="secondary-button" onClick={onBack}>Back to deposition</button>
      </div>

      <section className="insertion-card">
        <h2>Certification variant</h2>
        <p className="insertion-help">The variant is chosen by jurisdiction and signature disposition only. Reporter credentials, location, and prior matters never participate in that selection.</p>

        <fieldset className="insertion-field">
          <legend>Jurisdiction</legend>
          {JURISDICTIONS.map((item) => (
            <label key={item.value} className="insertion-option">
              <input type="radio" name="jurisdiction" value={item.value} checked={jurisdiction === item.value} onChange={() => { setJurisdiction(item.value); setPreview(null); setArtifact(null); }} />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="insertion-field">
          <legend>Signature disposition</legend>
          {DISPOSITIONS.map((item) => (
            <label key={item.value} className="insertion-option">
              <input type="radio" name="disposition" value={item.value} checked={signatureDisposition === item.value} onChange={() => { setSignatureDisposition(item.value); setPreview(null); setArtifact(null); }} />
              <span>{item.label}<small>{item.hint}</small></span>
            </label>
          ))}
        </fieldset>

        <label className="insertion-field">
          <span>How the disposition was established</span>
          <input type="text" value={basis} onChange={(event) => setBasis(event.target.value)} placeholder="Stated on the record" />
          <small>Recorded on the certificate as the basis for the disposition above.</small>
        </label>

        <fieldset className="insertion-field">
          <legend>Document</legend>
          <label className="insertion-option">
            <input type="radio" name="mode" value="standalone" checked={mode === "standalone"} onChange={() => { setMode("standalone"); setArtifact(null); }} />
            <span>Certification pages only<small>Produces the insertion pages as their own document.</small></span>
          </label>
          <label className="insertion-option">
            <input type="radio" name="mode" value="full" checked={mode === "full"} onChange={() => { setMode("full"); setArtifact(null); }} />
            <span>Transcript with certification pages<small>Requires the canonical transcript rendering specification, which final pagination has not yet produced.</small></span>
          </label>
        </fieldset>

        <div className="insertion-actions">
          <button type="button" className="primary-button" disabled={!ready || busy} onClick={runPreview}>{busy && !artifact ? "Working…" : "Preview certification pages"}</button>
          <button type="button" className="audio-save-button" disabled={!preview || blocking.length > 0 || busy} onClick={generate}>Generate Word document</button>
        </div>
        <p className="insertion-message">{message}</p>
      </section>

      {preview && (
        <section className="insertion-card">
          <h2>Assembled</h2>
          <dl className="insertion-facts">
            <div><dt>Variant</dt><dd>{preview.variant}</dd></div>
            <div><dt>Pages</dt><dd>{preview.renderingSpec?.pages?.length ?? 0}</dd></div>
            <div><dt>Rendering spec</dt><dd className="insertion-hash">{preview.renderingSpec?.sha256 ?? "—"}</dd></div>
          </dl>
        </section>
      )}

      {blocking.length > 0 && (
        <section className="insertion-card insertion-blocking">
          <h2>Blocking — no document will be produced</h2>
          <ul>{blocking.map((finding) => <li key={`${finding.code}:${finding.target}`}><strong>{finding.code}</strong> <span>{finding.message}</span></li>)}</ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="insertion-card insertion-warning">
          <h2>Review before certifying</h2>
          <ul>{warnings.map((finding) => <li key={`${finding.code}:${finding.target}`}><strong>{finding.code}</strong> <span>{finding.message}</span></li>)}</ul>
        </section>
      )}

      {artifact && (
        <section className="insertion-card">
          <h2>Document produced</h2>
          <dl className="insertion-facts">
            <div><dt>File</dt><dd>{artifact.outputPath}</dd></div>
            <div><dt>Size</dt><dd>{artifact.bytes.toLocaleString()} bytes</dd></div>
            <div><dt>Variant</dt><dd>{artifact.variant}</dd></div>
            <div><dt>Page set</dt><dd className="insertion-hash">{artifact.pageSetSha256}</dd></div>
            <div><dt>Rendering spec</dt><dd className="insertion-hash">{artifact.renderingSpecSha256}</dd></div>
          </dl>
          <p className="insertion-help">Both hashes identify exactly this document. Regenerating from the same canonical record and the same variant reproduces them.</p>
        </section>
      )}
    </main>
  );
}
