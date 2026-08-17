"use client";

import { useEffect, useMemo, useState } from "react";
import { groupTranscriptSegments } from "./transcript-paragraphs.mjs";

const API = "http://127.0.0.1:4317";

type Segment = { id: string; sourceJobIdentity: string; sourceUploadId: string; asrWordIds: string[]; deepgramSpeaker: number | null; speakerIdentity: string | null; transcriptRole: string | null; start: number | null; end: number | null; text: string };
type Paragraph = Segment & { segmentIds: string[] };
type Working = { speakerMap: { status: string; assignments: unknown[] }; segments: Segment[]; updatedAt: string; transcript_hash?: string; derivedFrom?: string[] };
type Deposition = { id: string; caseStyle: string; witness: string };

function clock(seconds: number | null) {
  if (typeof seconds !== "number") return "—";
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

const roleLabel = (role: string | null) => (role ? role.replaceAll("_", " ").toLowerCase() : "unassigned");

export default function ReporterReviewScreen({ deposition, onBack }: { deposition: Deposition; onBack: () => void }) {
  const [working, setWorking] = useState<Working | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${API}/api/transcript/working?depositionId=${encodeURIComponent(deposition.id)}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "The working transcript could not be read."); return body as Working; })
      .then((body) => { if (live) { setWorking(body); setLoading(false); } })
      .catch((cause: Error) => { if (live) { setError(cause.message); setLoading(false); } });
    return () => { live = false; };
  }, [deposition.id]);

  const paragraphs = useMemo(() => (working ? (groupTranscriptSegments(working.segments) as Paragraph[]) : []), [working]);
  const unassigned = paragraphs.filter((paragraph) => !paragraph.speakerIdentity).length;

  return (
    <main className="review-screen">
      <div className="review-heading">
        <span className="eyebrow">REPORTER REVIEW</span>
        <h1>Read-through</h1>
        <p>{deposition.caseStyle} · {deposition.witness}</p>
        <button type="button" className="secondary-button" onClick={onBack}>Back to deposition</button>
      </div>

      <div className="review-banner">
        <strong>Nothing here can be changed yet.</strong> This is the reading surface only. The transcript is derived from immutable ASR evidence, and no path exists to write reporter edits back — adding one before the correction architecture is ratified would let a rebuild from raw evidence erase them without warning.
      </div>

      {loading && <p className="review-status">Loading the working transcript…</p>}
      {error && <p className="review-status review-error">{error}</p>}

      {working && (
        <>
          <section className="review-meta">
            <div><span>Paragraphs</span><strong>{paragraphs.length}</strong></div>
            <div><span>Segments</span><strong>{working.segments.length}</strong></div>
            <div><span>Speakers unassigned</span><strong className={unassigned ? "review-flag" : ""}>{unassigned}</strong></div>
            <div><span>Speaker map</span><strong>{working.speakerMap?.status ?? "unknown"}</strong></div>
            <div><span>Source jobs</span><strong>{working.derivedFrom?.length ?? 0}</strong></div>
            <div><span>Content hash</span><strong className="review-hash">{working.transcript_hash?.slice(0, 12) ?? "—"}</strong></div>
          </section>

          <section className="review-body">
            {paragraphs.map((paragraph) => (
              <article
                key={paragraph.segmentIds.join(":")}
                className={`review-paragraph ${focused === paragraph.segmentIds[0] ? "focused" : ""}`}
              >
                <header>
                  <span className="review-speaker">{paragraph.speakerIdentity ?? "Unassigned speaker"}</span>
                  <span className="review-role">{roleLabel(paragraph.transcriptRole)}</span>
                  <span className="review-time">{clock(paragraph.start)}</span>
                  <button
                    type="button"
                    className="review-source-toggle"
                    aria-expanded={focused === paragraph.segmentIds[0]} aria-controls={`source-${paragraph.segmentIds[0]}`}
                    onClick={() => setFocused(focused === paragraph.segmentIds[0] ? null : paragraph.segmentIds[0])}
                  >{focused === paragraph.segmentIds[0] ? "Hide source" : "Source"}</button>
                </header>
                <p>{paragraph.text}</p>
                {focused === paragraph.segmentIds[0] && (
                  <footer className="review-provenance" id={`source-${paragraph.segmentIds[0]}`}>
                    <span>{paragraph.segmentIds.length} segment{paragraph.segmentIds.length === 1 ? "" : "s"}</span>
                    <span>{paragraph.asrWordIds.length} ASR words</span>
                    <span>Deepgram speaker {paragraph.deepgramSpeaker ?? "—"}</span>
                    <span>{clock(paragraph.start)} – {clock(paragraph.end)}</span>
                    <span className="review-hash">job {paragraph.sourceJobIdentity.slice(0, 12)}</span>
                  </footer>
                )}
              </article>
            ))}
            {!paragraphs.length && <p className="review-status">This deposition has no transcribed segments yet.</p>}
          </section>

          <p className="review-note">Selecting a paragraph shows what it was derived from. Every paragraph traces to specific ASR words in a specific job, which is what makes a correction expressible as an input rather than an edit.</p>
        </>
      )}
    </main>
  );
}
