"use client";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import AudioReviewCard from "./AudioReviewCard";
import AudioToolsScreen from "./AudioToolsScreen";
import TermReviewTable from "./TermReviewTable";
import { KEYTERM_PRODUCT_CAP } from "@/server/keyterm-limits.mjs";
import { LOCAL_API_BASE_URL as API } from "./api-client";
import type { ClaudeIntakeAnalysis, DepositionCreationMode, IntakeAttorney } from "./intake-types";
export type AudioDerivative = {
  kind?: string;
  operationId?: string;
  key: string;
  sha256: string;
  bytes: number;
  [key: string]: unknown;
};
export type AudioProfile = {
  uploadId: string;
  schemaVersion: string;
  status: string;
  originalName: string;
  media: {
    durationSeconds: number;
    codec: string;
    sampleRate: number;
    channels: number;
  } | null;
  measurements: Record<string, number | null> | null;
  findings: Record<
    string,
    {
      measured: boolean;
      detected: boolean | null;
      confidence: number | null;
      evidence?: unknown;
      note?: string;
    }
  > | null;
  recommendation: {
    route: string;
    candidateProfile: string | null;
    candidateProfileIds?: string[];
    reason: string;
  } | null;
  selectedSource: "original" | "processed";
  selectedDerivativeOperationId?: string | null;
  selectedAudioSha256?: string | null;
  selectionBasis: string;
  storage: {
    original: {
      key: string;
      sha256: string;
      bytes: number;
      immutable: boolean;
    };
    derivatives: AudioDerivative[];
  };
  rx: Record<string, unknown>;
  history: Record<string, unknown>[];
  speechSegments?: {
    artifactOperationId: string | null;
    detectedAt: string;
    parameters: {
      noiseThresholdDb: number;
      minSilenceSec: number;
      paddingMs: number;
    };
    totalDurationSec: number;
    speechDurationSec: number;
    segments: {
      startSec: number;
      endSec: number;
      kind: "speech" | "silence";
    }[];
  };
  automaticSelection?: {
    status: string;
    method: string;
    winner: string;
    measuredWer: boolean;
    reason: string;
    metrics?: unknown;
  };
};
export type { IntakeAttorney } from "./intake-types";
// `parties` and `attorneys` are carried through explicitly. The extraction returns them and the
// canonical builder reads them from the top level, but the draft used to list its fields one by
// one and silently omitted both -- so counsel[] and parties[] arrived empty on every deposition
// however good the extraction was.
export type IntakeDraft = {
  creationMode: DepositionCreationMode;
  caseStyle: string;
  witness: string;
  causeNumber: string;
  depositionDate: string;
  deponentType: string;
  notes: string;
  notice: File | null;
  courtOrder: File | null;
  supportingFiles: File[];
  audioFiles: File[];
  audioProfiles: Record<string, AudioProfile>;
  keyterms: string[];
  parties: string[];
  attorneys: IntakeAttorney[];
  deepgramArtifact: Record<string, unknown>;
  ufmData: Record<string, unknown>;
  warnings: string[];
  confidence: string;
};
type Props = { creationMode: DepositionCreationMode; onCancel: () => void; onContinue: (draft: IntakeDraft) => void };
function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function looksLikeProcessedDerivative(name: string) {
  return (
    /\.ixz\./i.test(name) ||
    /^candidate\..+\.[a-f0-9-]{36}\.(?:wav|flac)$/i.test(name)
  );
}
function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
export default function IntakeScreen({ creationMode, onCancel, onContinue }: Props) {
  const [notice, setNotice] = useState<File | null>(null),
    [courtOrder, setCourtOrder] = useState<File | null>(null),
    [supportingFiles, setSupportingFiles] = useState<File[]>([]),
    [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<ClaudeIntakeAnalysis | null>(null),
    [analyzing, setAnalyzing] = useState(false),
    [analysisElapsed, setAnalysisElapsed] = useState(0),
    [error, setError] = useState(""),
    [reviewFile, setReviewFile] = useState<"keyterms" | "ufm" | null>(null),
    [audioProfiles, setAudioProfiles] = useState<Record<string, AudioProfile>>(
      {},
    ),
    [profiling, setProfiling] = useState<Record<string, boolean>>({}),
    [showAudioTools, setShowAudioTools] = useState(false);
  const audioAnalysisPending = Object.values(profiling).some(Boolean);
  useEffect(() => {
    if (!analyzing) return;
    const startedAt = Date.now(),
      timer = window.setInterval(
        () => setAnalysisElapsed(Math.floor((Date.now() - startedAt) / 1000)),
        1000,
      );
    return () => window.clearInterval(timer);
  }, [analyzing]);
  async function analyze() {
    if (!notice) return;
    const audioSnapshot = [...audioFiles];
    setAnalysisElapsed(0);
    setAnalyzing(true);
    setError("");
    try {
      if (!["application/pdf", "text/plain"].includes(notice.type))
        throw new Error(
          "For Claude extraction, upload the Notice as a PDF or plain-text file.",
        );
      const response = await fetch(`${API}/api/claude/extract-notice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: {
            name: notice.name,
            type: notice.type,
            base64: await toBase64(notice),
          },
          supportingFiles: await Promise.all(
            supportingFiles.map(async (file) => ({
              name: file.name,
              type: file.type,
              base64: await toBase64(file),
            })),
          ),
        }),
      });
      const body = (await response.json()) as ClaudeIntakeAnalysis;
      if (!response.ok)
        throw new Error(
          String(
            (body as { error?: string }).error || "Claude analysis failed.",
          ),
        );
      body.keyterms = [
        ...new Set(
          (body.keyterms || []).map((term) => term.trim()).filter(Boolean),
        ),
      ].slice(0, 100);
      setAnalysis(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claude analysis failed.");
    } finally {
      setAudioFiles((current) => (current.length ? current : audioSnapshot));
      setAnalyzing(false);
    }
  }
  function audioKey(file: File) {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }
  async function profileAudio(file: File) {
    const key = audioKey(file);
    setProfiling((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch(`${API}/api/audio/analyze`, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Audio analysis failed.");
      setAudioProfiles((current) => ({ ...current, [key]: result }));
    } catch (e) {
      setError(
        e instanceof Error
          ? `Audio analysis: ${e.message}`
          : "Audio analysis failed.",
      );
    } finally {
      setProfiling((current) => ({ ...current, [key]: false }));
    }
  }
  function addAudio(e: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.currentTarget.files ?? []).filter(
      (file) =>
        !looksLikeProcessedDerivative(file.name) ||
        window.confirm(
          `${file.name} looks like a Depo-Pro processed derivative. Depo-Pro should ingest the original recording as received. Continue anyway?`,
        ),
    );
    e.currentTarget.value = "";
    if (!selectedFiles.length) return;
    setAudioFiles((c) => [...c, ...selectedFiles]);
    selectedFiles.forEach((file) => void profileAudio(file));
  }
  function move(index: number, direction: -1 | 1) {
    setAudioFiles((c) => {
      const target = index + direction;
      if (target < 0 || target >= c.length) return c;
      const n = [...c];
      [n[index], n[target]] = [n[target], n[index]];
      return n;
    });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!analysis) {
      setError("Analyze the Notice with Claude before continuing.");
      return;
    }
    if (audioAnalysisPending) {
      setError(
        "Wait for every audio recording to finish analysis before continuing.",
      );
      return;
    }
    onContinue({
      creationMode,
      caseStyle: analysis.caseStyle || "",
      witness: analysis.witness || "",
      causeNumber: analysis.causeNumber || analysis.ufmData?.cause_number || "",
      depositionDate: analysis.depositionDate || "",
      deponentType: analysis.deponentType || "Fact witness",
      notes: "",
      notice,
      courtOrder,
      supportingFiles,
      audioFiles,
      audioProfiles,
      keyterms: analysis.keyterms || [],
      parties: analysis.parties || [],
      attorneys: analysis.attorneys || [],
      deepgramArtifact: analysis.deepgramArtifact || {
        terms: [],
        term_count: 0,
        estimated_tokens: 0,
      },
      ufmData: analysis.ufmData || {},
      warnings: analysis.warnings || [],
      confidence: analysis.confidence || "low",
    });
  }
  if (showAudioTools)
    return (
      <AudioToolsScreen
        initialFiles={audioFiles}
        onFilesChange={(
          files,
          replacedFile,
          replacedSource,
          processedAudit,
        ) => {
          setAudioFiles(files);
          if (replacedSource)
            setAudioProfiles((current) => {
              const next = { ...current };
              delete next[audioKey(replacedSource)];
              if (replacedFile && processedAudit)
                next[audioKey(replacedFile)] = processedAudit;
              return next;
            });
        }}
        onBack={() => setShowAudioTools(false)}
      />
    );
  return (
    <main className="intake-shell">
      <header className="intake-topbar">
        <button type="button" className="back-button" onClick={onCancel}>
          ← Back to depositions
        </button>
        <div>
          <span className="step-dot active" />
          <span className="step-line" />
          <span className="step-dot" />
        </div>
        <span className="intake-header-actions">
          <button
            type="button"
            className="audio-tools-nav"
            onClick={() => setShowAudioTools(true)}
          >
            ♫ Audio Tools{audioFiles.length ? ` (${audioFiles.length})` : ""}
          </button>
          <span>Step 1 of 2</span>
        </span>
      </header>
      <form className="intake-layout" onSubmit={submit}>
        <section className="intake-heading">
          <span className="eyebrow">CASE INTAKE</span>
          <h1>Prepare a new deposition</h1>
          <p>
            Add the source documents and audio recordings. Claude will analyze
            the Notice, and you will verify every extracted field on the
            Deposition Setup screen.
          </p>
        </section>
        <section className="intake-panel">
          <div className="panel-title">
            <span className="panel-number">1</span>
            <div>
              <h2>Source documents</h2>
              <p>
                Upload the Notice of Deposition and an optional court order.
              </p>
            </div>
          </div>
          <div className="upload-grid">
            <label className={`upload-card ${notice ? "has-file" : ""}`}>
              <input
                type="file"
                accept=".pdf,.txt"
                onChange={(e) => {
                  setNotice(e.target.files?.[0] ?? null);
                  setAnalysis(null);
                  setError("");
                }}
                required
              />
              <span className="upload-icon">▤</span>
              <strong>{notice ? notice.name : "Notice of Deposition"}</strong>
              <small>
                {notice
                  ? `${fileSize(notice.size)} · Click to replace`
                  : "PDF or text file · Required"}
              </small>
            </label>
            <label className={`upload-card ${courtOrder ? "has-file" : ""}`}>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) => {
                  setCourtOrder(e.target.files?.[0] ?? null);
                  setAnalysis(null);
                }}
              />
              <span className="upload-icon">§</span>
              <strong>{courtOrder ? courtOrder.name : "Court Order"}</strong>
              <small>
                {courtOrder
                  ? `${fileSize(courtOrder.size)} · Click to replace`
                  : "Add when not included in the notice · Optional"}
              </small>
            </label>
          </div>
          <div className="supporting-documents">
            <div className="supporting-header">
              <div>
                <strong>Supporting Documents</strong>
                <p>
                  Add pleadings, witness lists, exhibits, correspondence, or
                  other spelling references.
                </p>
              </div>
              <label className="supporting-add">
                <input
                  type="file"
                  accept=".pdf,.txt"
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(
                      event.currentTarget.files ?? [],
                    );
                    event.currentTarget.value = "";
                    setSupportingFiles((current) => [
                      ...current,
                      ...selectedFiles,
                    ]);
                    setAnalysis(null);
                  }}
                />
                ＋ Add documents
              </label>
            </div>
            {supportingFiles.length > 0 ? (
              <ul className="supporting-list">
                {supportingFiles.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <span className="supporting-file-icon">▤</span>
                    <span>
                      <strong>{file.name}</strong>
                      <small>{fileSize(file.size)}</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => {
                        setSupportingFiles((files) =>
                          files.filter((_, fileIndex) => fileIndex !== index),
                        );
                        setAnalysis(null);
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="supporting-empty">
                No supporting documents added.
              </div>
            )}
          </div>
          <div className="ai-analysis">
            <div>
              <span className="ai-mark">AI</span>
              <div>
                <strong>Claude document analysis</strong>
                <p>
                  {analysis
                    ? `Extraction ready · ${analysis.confidence} confidence · ${analysis.keyterms?.length || 0} Deepgram keyterms`
                    : "Analyze the Notice and supporting documents for setup fields, verified spellings, Deepgram keyterms, and future UFM data."}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!notice || analyzing}
              onClick={analyze}
            >
              {analyzing
                ? `Analyzing documents… ${analysisElapsed}s`
                : analysis
                  ? "Analyze again"
                  : "Analyze documents with Claude"}
            </button>
          </div>
          {error && (
            <p className="analysis-error" role="alert">
              {error}
            </p>
          )}
          {analysis && analysis.warnings.length > 0 && (
            <div className="analysis-warning">
              <strong>Review required</strong>
              <ul>
                {analysis.warnings.map((w: string) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis && (
            <div className="generated-files">
              <div>
                <strong>Generated transcription files</strong>
                <p>Review the files Claude created before continuing.</p>
              </div>
              <button type="button" onClick={() => setReviewFile("keyterms")}>
                <span>ABC</span> Review and correct terms{" "}
                <small>
                  {analysis.keyterms.length}/{KEYTERM_PRODUCT_CAP}
                </small>
              </button>
              <button type="button" onClick={() => setReviewFile("ufm")}>
                <span>{"{}"}</span> Review UFM Data{" "}
                <small>
                  {analysis.ufmData?.entry_count || 0} terms ·{" "}
                  {analysis.ufmData?.anomalies?.length || 0} flags
                </small>
              </button>
            </div>
          )}
        </section>
        {creationMode === "existing_recording" ? <section className="intake-panel audio-panel">
          <div className="panel-title">
            <span className="panel-number">2</span>
            <div>
              <h2>Deposition audio</h2>
              <p>
                Add one or more recordings, then place them in transcription
                order.
              </p>
            </div>
          </div>
          <label className="audio-add">
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.m4a,.mp4,.aac,.wma"
              multiple
              onChange={addAudio}
            />
            <span>＋ Add audio files</span>
            <small>MP3, WAV, FLAC, M4A, MP4, AAC, or WMA</small>
          </label>
          {audioFiles.length ? (
            <ol className="audio-list">
              {audioFiles.map((f, i) => (
                <li key={`${f.name}-${f.lastModified}-${i}`}>
                  <span className="audio-order">{i + 1}</span>
                  <span className="audio-file">
                    <strong>{f.name}</strong>
                    <small>{fileSize(f.size)}</small>
                    {profiling[audioKey(f)] ? (
                      <span className="audio-profile pending">
                        Analyzing and preserving original audio…
                      </span>
                    ) : audioProfiles[audioKey(f)] ? (
                      <AudioReviewCard
                        profile={audioProfiles[audioKey(f)]}
                        keyterms={analysis?.keyterms || []}
                        onProfile={(profile) =>
                          setAudioProfiles((current) => ({
                            ...current,
                            [audioKey(f)]: profile,
                          }))
                        }
                      />
                    ) : null}
                  </span>
                  <span className="audio-actions">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === audioFiles.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="remove-audio"
                      onClick={() =>
                        setAudioFiles((a) => a.filter((_, x) => x !== i))
                      }
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="no-audio">
              No audio files added yet. Audio can also be added later.
            </div>
          )}
        </section> : <section className="intake-panel live-intake-plan" aria-labelledby="live-recording-plan-title">
          <div className="panel-title"><span className="panel-number">2</span><div>
            <h2 id="live-recording-plan-title">Live recording plan</h2>
            <p>The deposition will be created now. Select and test both audio channels when you are ready to record.</p>
          </div></div>
          <div className="live-plan-grid">
            <div><strong>Local microphone</strong><span>Required reporter-room channel</span></div>
            <div><strong>Virtual meeting audio</strong><span>Separate remote-participant channel</span></div>
            <div><strong>Deepgram live text</strong><span>Preserved as a provisional transcript</span></div>
            <div><strong>Working transcript</strong><span>Created explicitly from the preserved audio after recording</span></div>
          </div>
        </section>}
        <footer className="intake-footer">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!analysis || audioAnalysisPending}
          >
            {audioAnalysisPending
              ? "Analyzing audio…"
              : "Continue to Deposition Setup →"}
          </button>
        </footer>
      </form>
      {reviewFile && analysis && (
        <div
          className="modal-backdrop generated-review-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setReviewFile(null)
          }
        >
          <section
            className="modal generated-review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generated-review-title"
          >
            <button
              className="close-button"
              type="button"
              aria-label="Close"
              onClick={() => setReviewFile(null)}
            >
              ×
            </button>
            <span className="eyebrow">CLAUDE GENERATED FILE</span>
            <h2 id="generated-review-title">
              {reviewFile === "keyterms"
                ? "Review and correct terms"
                : "UFM Template Data"}
            </h2>
            {reviewFile === "keyterms" ? (
              <TermReviewTable
                intake={analysis}
                onCancel={() => setReviewFile(null)}
                onSave={(next) => {
                  setAnalysis(next);
                  setReviewFile(null);
                }}
              />
            ) : (
              <>
                <p>
                  This structured data will be available when UFM template
                  population is added.
                </p>
                <pre className="json-review">
                  {JSON.stringify(analysis.ufmData, null, 2)}
                </pre>
                <div className="modal-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setReviewFile(null)}
                  >
                    Done Reviewing
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
