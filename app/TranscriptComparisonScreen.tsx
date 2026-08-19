"use client";

import { useState } from "react";

import { LOCAL_API_BASE_URL as API } from "./api-client";
const TERM_GROUP_SET = "deposition-core-v1";

type GroupMetric = { expected: number; matched: number; missed: number; errorRate: number | null; missedTerms: string[] };
type Comparison = {
  source: string; termGroupSetId: string | null; termGroupSetVersion: string | null; termGroupError: string | null;
  referenceWords: number; hypothesisWords: number; substitutions: number; deletions: number; insertions: number;
  wer: number | null; criticalLegalErrorRate: number | null; criticalTermsMissed: string[];
  depositionMetrics: Record<string, GroupMetric>; referenceSha256?: string;
};
type Selection = { winner: string; reason: string; measuredWer: boolean; metrics?: { delta?: { werGain: number; deletionIncrease: number }; categoryRegressions?: string[] } };
type SelectResult = { status: string; selection: Selection | null; blocker?: string };
type Deposition = { id: string; caseStyle: string; witness: string; audioIntakeIds?: string[] };

const percent = (value: number | null | undefined) => (typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—");

export default function TranscriptComparisonScreen({ deposition, onBack }: { deposition: Deposition; onBack: () => void }) {
  const uploads = deposition.audioIntakeIds ?? [];
  const [uploadId, setUploadId] = useState(uploads[0] ?? "");
  const [reference, setReference] = useState("");
  const [results, setResults] = useState<Record<string, Comparison>>({});
  const [selection, setSelection] = useState<SelectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Paste the reporter-verified transcript, then measure each candidate against it.");

  const original = results.original;
  const processed = results.processed;
  const ready = Boolean(uploadId && reference.trim());

  async function compare(source: "original" | "processed") {
    setBusy(true); setSelection(null); setMessage(`Measuring the ${source} recording against the reference…`);
    try {
      const response = await fetch(`${API}/api/transcript/compare`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId, depositionId: deposition.id, termGroupSetId: TERM_GROUP_SET, source, reference }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Comparison failed with status ${response.status}.`);
      setResults((current) => ({ ...current, [source]: body as Comparison }));
      setMessage(body.termGroupError ? `Measured, but the term group set did not resolve: ${body.termGroupError}` : `Measured the ${source} recording. Word error rate ${percent(body.wer)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The comparison failed.");
    } finally { setBusy(false); }
  }

  async function selectSource() {
    setBusy(true); setMessage("Applying the measured result…");
    try {
      const response = await fetch(`${API}/api/audio/select-asr-source`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId, referenceSha256: original?.referenceSha256 ?? null }),
      });
      const body = (await response.json()) as SelectResult;
      if (!response.ok) throw new Error((body as unknown as { error?: string }).error || "Selection failed.");
      setSelection(body);
      setMessage(body.status === "selected" ? `Selected the ${body.selection?.winner} recording.` : `No selection was made: ${body.blocker ?? body.status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The selection failed.");
    } finally { setBusy(false); }
  }

  function metricRows(comparison: Comparison) {
    return Object.entries(comparison.depositionMetrics ?? {}).filter(([, metric]) => metric.expected > 0);
  }

  return (
    <main className="compare-screen">
      <div className="compare-heading">
        <span className="eyebrow">MEASURED SELECTION</span>
        <h1>Compare against a verified transcript</h1>
        <p>{deposition.caseStyle} · {deposition.witness}</p>
        <button type="button" className="secondary-button" onClick={onBack}>Back to deposition</button>
      </div>

      <section className="compare-card">
        <h2>Reference</h2>
        <p className="compare-help">Only a transcript a reporter has verified can decide which recording is better. Comparing machine output against machine output measures nothing.</p>

        <label className="compare-field">
          <span>Audio intake</span>
          {uploads.length
            ? <select value={uploadId} onChange={(event) => { setUploadId(event.target.value); setResults({}); setSelection(null); }}>{uploads.map((id) => <option key={id} value={id}>{id}</option>)}</select>
            : <input type="text" value={uploadId} onChange={(event) => setUploadId(event.target.value)} placeholder="Audio intake identifier" />}
        </label>

        <label className="compare-field">
          <span>Reporter-verified transcript</span>
          <textarea value={reference} onChange={(event) => { setReference(event.target.value); setResults({}); setSelection(null); }} rows={8} placeholder="Paste the verified text for the excerpt being measured." />
          <small>{reference.trim() ? `${reference.trim().split(/\s+/).length.toLocaleString()} words` : "Paste an aligned reference excerpt. The server enforces a per-side word limit and reports it if the comparison exceeds it."}</small>
        </label>

        <div className="compare-actions">
          <button type="button" className="primary-button" disabled={!ready || busy} onClick={() => compare("original")}>Measure original</button>
          <button type="button" className="primary-button" disabled={!ready || busy} onClick={() => compare("processed")}>Measure processed</button>
          <button type="button" className="audio-save-button" disabled={!original || !processed || busy} onClick={selectSource}>Apply measured selection</button>
        </div>
        <p className="compare-message">{message}</p>
      </section>

      {(original || processed) && (
        <section className="compare-card">
          <h2>Measurements</h2>
          <div className="scroll-x">
            <table className="compare-table">
              <thead><tr><th>Measure</th><th>Original</th><th>Processed</th></tr></thead>
              <tbody>
                <tr><td>Word error rate</td><td>{percent(original?.wer)}</td><td>{percent(processed?.wer)}</td></tr>
                <tr><td>Deletions</td><td>{original?.deletions ?? "—"}</td><td>{processed?.deletions ?? "—"}</td></tr>
                <tr><td>Substitutions</td><td>{original?.substitutions ?? "—"}</td><td>{processed?.substitutions ?? "—"}</td></tr>
                <tr><td>Insertions</td><td>{original?.insertions ?? "—"}</td><td>{processed?.insertions ?? "—"}</td></tr>
                <tr><td>Critical terms missed</td><td>{original?.criticalTermsMissed?.length ?? "—"}</td><td>{processed?.criticalTermsMissed?.length ?? "—"}</td></tr>
              </tbody>
            </table>
          </div>

          {original && (
            <>
              <h3>Deposition-critical categories</h3>
              <div className="scroll-x">
                <table className="compare-table">
                  <thead><tr><th>Category</th><th>Expected</th><th>Missed, original</th><th>Missed, processed</th></tr></thead>
                  <tbody>
                    {metricRows(original).map(([name, metric]) => {
                      const after = processed?.depositionMetrics?.[name];
                      const regressed = after ? after.missed > metric.missed : false;
                      return <tr key={name} className={regressed ? "compare-regressed" : ""}><td>{name}</td><td>{metric.expected}</td><td>{metric.missed}</td><td>{after ? after.missed : "—"}{regressed ? " — regressed" : ""}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <p className="compare-help">A processed recording is refused if it regresses any category, even when its overall word error rate is better. A lost negation changes what the witness said.</p>
            </>
          )}
        </section>
      )}

      {selection && (
        <section className={`compare-card ${selection.status === "selected" ? "" : "compare-blocked"}`}>
          <h2>{selection.status === "selected" ? "Selected" : "No selection made"}</h2>
          {selection.selection
            ? <>
                <p><strong>{selection.selection.winner}</strong> — {selection.selection.reason}</p>
                {selection.selection.metrics?.delta && <p className="compare-help">Word error rate gain {percent(selection.selection.metrics.delta.werGain)}, deletion change {selection.selection.metrics.delta.deletionIncrease}.</p>}
                {selection.selection.metrics?.categoryRegressions?.length ? <p className="compare-help">Regressed categories: {selection.selection.metrics.categoryRegressions.join(", ")}.</p> : null}
              </>
            : <p>{selection.blocker ?? selection.status}</p>}
        </section>
      )}
    </main>
  );
}
