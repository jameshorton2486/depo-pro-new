"use client";
import { useEffect, useRef, useState } from "react";
import type { AudioProfile } from "./IntakeScreen";

import { LOCAL_API_BASE_URL as API } from "./api-client";
type Audit = AudioProfile;
type Tool = {
  id: string;
  version: string;
  engine: string;
  displayName: string;
  plainPurpose: string;
  riskLevel: "low" | "moderate" | "high";
  asrSafe: boolean;
  chainOrder: number | null;
  recommendFor: string[];
  excludes: string[];
  caution: string | null;
  measuredRealTimeFactor: number | null;
};
type MeasurementDelta = {
  id: string;
  label: string;
  unit: string;
  before: number | null;
  after: number | null;
  status:
    | "resolved"
    | "improved"
    | "unchanged"
    | "worsened"
    | "concealed"
    | "unavailable";
  note?: string;
};
type Derivative = {
  operationId: string;
  kind: string;
  profileId: string;
  profileIds?: string[];
  sha256: string;
  sampleAligned: boolean;
  timelinePreserved: boolean;
  timelinePolicy: string;
  manufacturer?: string;
  product?: string;
  toolVersion?: string;
  module?: string;
  outputEncoding: { container: string; lossless: boolean };
  measurementDelta: MeasurementDelta[];
};
type PickerWindow = Window & {
  showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle>;
};

function outputName(name: string) {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.IXZ.flac`;
}

export default function AudioToolsScreen({
  onBack,
  initialFiles = [],
  onFilesChange,
}: {
  onBack: () => void;
  initialFiles?: File[];
  onFilesChange?: (
    files: File[],
    replacedFile?: File,
    replacedSource?: File,
    processedAudit?: AudioProfile,
  ) => void;
}) {
  const fallbackInput = useRef<HTMLInputElement>(null);
  const [availableFiles, setAvailableFiles] = useState<File[]>(initialFiles);
  const [file, setFile] = useState<File | null>(initialFiles[0] ?? null);
  const [sourceHandle, setSourceHandle] = useState<FileSystemFileHandle | null>(
    null,
  );
  const [audit, setAudit] = useState<Audit | null>(null);
  const [derivative, setDerivative] = useState<Derivative | null>(null);
  const [processedFile, setProcessedFile] = useState<File | null>(null);
  const [processedSource, setProcessedSource] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipSilence, setSkipSilence] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [message, setMessage] = useState(
    initialFiles.length
      ? `${initialFiles.length} intake audio file${initialFiles.length === 1 ? "" : "s"} loaded.`
      : "Choose one audio file to begin.",
  );
  useEffect(() => {
    void fetch(`${API}/api/audio/tools`)
      .then((response) => response.json())
      .then((items: Tool[]) => setTools(items))
      .catch(() => setMessage("Audio tool definitions could not be loaded."));
  }, []);
  const selectedTools = tools
    .filter((tool) => profileIds.includes(tool.id))
    .sort((a, b) => (a.chainOrder ?? 999) - (b.chainOrder ?? 999));
  const activeFindings = audit?.findings
    ? Object.entries(audit.findings)
        .filter(([, finding]) => finding.detected)
        .map(([id]) => id)
    : [];
  const recommended = tools.filter((tool) =>
    tool.recommendFor.some((code) => activeFindings.includes(code)),
  );
  const others = tools.filter((tool) => !recommended.includes(tool));

  function selectFile(next: File, handle: FileSystemFileHandle | null = null) {
    setAvailableFiles((current) =>
      current.some((item) => item === next) ? current : [...current, next],
    );
    setFile(next);
    setSourceHandle(handle);
    setAudit(null);
    setDerivative(null);
    setProcessedFile(null);
    setProcessedSource(null);
    setMessage("Ready to process the selected audio file.");
  }

  function selectLoadedFile(next: File) {
    setFile(next);
    setSourceHandle(null);
    setAudit(null);
    setDerivative(null);
    setProcessedFile(null);
    setProcessedSource(null);
    setMessage("Ready to process the selected intake audio file.");
  }

  async function chooseFile() {
    const picker = window as PickerWindow;
    if (!picker.showOpenFilePicker) return fallbackInput.current?.click();
    try {
      const [handle] = await picker.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Audio files",
            accept: {
              "audio/*": [
                ".wav",
                ".mp3",
                ".m4a",
                ".aac",
                ".flac",
                ".ogg",
                ".wma",
              ],
            },
          },
        ],
      });
      selectFile(await handle.getFile(), handle);
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setMessage((error as Error).message);
    }
  }

  async function processAudio() {
    if (!file) return;
    setBusy(true);
    setAudit(null);
    setDerivative(null);
    setProcessedFile(null);
    setProcessedSource(null);
    setMessage("Preserving the original locally…");
    try {
      let response = await fetch(`${API}/api/audio/analyze`, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
        },
        body: file,
      });
      let body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setAudit(body);
      setMessage(
        `Processing with ${selectedTools.map((tool) => tool.displayName).join(" → ")}…`,
      );
      response = await fetch(`${API}/api/audio/rx-process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: body.uploadId, profileIds }),
      });
      body = await response.json();
      if (!response.ok) throw new Error(`${body.code}: ${body.error}`);
      setAudit(body.audit);
      setDerivative(body.derivative);
      const audioResponse = await fetch(
        `${API}/api/audio/derivative?uploadId=${encodeURIComponent(body.audit.uploadId)}&operationId=${encodeURIComponent(body.derivative.operationId)}`,
      );
      if (!audioResponse.ok)
        throw new Error((await audioResponse.json()).error);
      const replacement = new File(
        [await audioResponse.blob()],
        outputName(file.name),
        { type: "audio/flac", lastModified: file.lastModified },
      );
      setProcessedFile(replacement);
      setProcessedSource(file);
      setMessage(
        `Processing complete. Back to deposition will replace ${file.name} with ${replacement.name}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Audio processing failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  function toggleTool(tool: Tool) {
    setProfileIds((current) => {
      if (current.includes(tool.id))
        return current.filter((id) => id !== tool.id);
      if (tool.chainOrder === null) return [tool.id];
      const next = current.filter(
        (id) => tools.find((item) => item.id === id)?.chainOrder !== null,
      );
      if (tool.excludes.some((id) => next.includes(id))) {
        setMessage(
          `${tool.displayName} cannot be combined with ${tools.find((item) => tool.excludes.includes(item.id))?.displayName}.`,
        );
        return next;
      }
      return [...next, tool.id];
    });
  }

  async function promoteForTranscription() {
    if (!audit || !derivative) return;
    const unsafe = selectedTools.filter((tool) => !tool.asrSafe);
    if (
      !window.confirm(
        `${unsafe.map((tool) => tool.displayName).join(", ")} produced a review-only result. ${unsafe
          .map((tool) => tool.caution)
          .filter(Boolean)
          .join(" ")} Promote this result for transcription anyway?`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/audio/promote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            uploadId: audit.uploadId,
            operationId: derivative.operationId,
          }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setAudit(body);
      setDerivative((current) =>
        current ? { ...current, kind: "rx-asr" } : current,
      );
      setMessage(
        "Review derivative promoted for transcription. The decision was recorded in the audit.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Promotion failed.");
    } finally {
      setBusy(false);
    }
  }
  async function detectSegments() {
    if (!audit) return;
    setBusy(true);
    setMessage("Detecting speech and silence without modifying audio…");
    try {
      const response = await fetch(`${API}/api/audio/detect-speech-segments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            uploadId: audit.uploadId,
            artifactOperationId: derivative?.operationId ?? null,
          }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setAudit(body);
      setMessage(
        "Speech map ready. Skip silence remains off until you enable it.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Speech detection failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  function handleTimeUpdate(event: React.SyntheticEvent<HTMLAudioElement>) {
    if (!skipSilence || !audit?.speechSegments) return;
    const player = event.currentTarget,
      silence = audit.speechSegments.segments.find(
        (item) =>
          item.kind === "silence" &&
          player.currentTime >= item.startSec &&
          player.currentTime < item.endSec,
      );
    if (silence) player.currentTime = silence.endSec;
  }
  function durationLabel(seconds: number) {
    const minutes = Math.round(seconds / 60),
      hours = Math.floor(minutes / 60),
      remaining = minutes % 60;
    return hours ? `${hours}h ${remaining}m` : `${minutes}m`;
  }

  function returnToDeposition() {
    if (processedFile && processedSource && onFilesChange) {
      const updated = availableFiles.map((item) =>
        item === processedSource ? processedFile : item,
      );
      onFilesChange(
        updated,
        processedFile,
        processedSource,
        audit ?? undefined,
      );
    }
    onBack();
  }

  async function saveAudio() {
    if (!file || !audit || !derivative) return;
    setBusy(true);
    setMessage("Preparing the processed audio…");
    try {
      const response = await fetch(
        `${API}/api/audio/derivative?uploadId=${encodeURIComponent(audit.uploadId)}&operationId=${encodeURIComponent(derivative.operationId)}`,
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob(),
        name = outputName(file.name),
        picker = window as PickerWindow;
      if (picker.showSaveFilePicker) {
        const options: {
          suggestedName: string;
          types: object[];
          startIn?: FileSystemFileHandle;
        } = {
          suggestedName: name,
          types: [
            {
              description: "Lossless processed FLAC audio",
              accept: { "audio/flac": [".flac"] },
            },
          ],
        };
        if (sourceHandle) options.startIn = sourceHandle;
        const handle = await picker.showSaveFilePicker(options),
          writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setMessage(`Saved ${handle.name}.`);
      } else {
        const url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
        setMessage(
          `Downloaded ${name}. Choose the source folder if your browser asks.`,
        );
      }
    } catch (error) {
      setMessage(
        (error as Error).name === "AbortError"
          ? "Save canceled. The processed audio is still ready."
          : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="audio-tools-shell">
      <header className="intake-topbar">
        <button className="back-button" onClick={returnToDeposition}>
          ← Back to deposition
        </button>
        <div className="brand">
          <span className="brand-mark">DP</span>
          <span>
            DEPO<span className="brand-accent">PRO</span>
          </span>
        </div>
        <span>Audio Tools</span>
      </header>
      <section className="audio-tools-layout">
        <div className="audio-tools-heading">
          <span className="eyebrow">AUDIO TOOLS</span>
          <h1>Process an audio file</h1>
          <p>
            Select a recording already loaded for this deposition or choose
            another file, apply an audited RX module, then save a lossless IXZ
            FLAC copy.
          </p>
        </div>
        <section className="audio-tools-card">
          {availableFiles.length > 0 && (
            <label className="audio-tool-picker">
              Loaded deposition audio
              <select
                value={
                  file ? `${file.name}:${file.lastModified}:${file.size}` : ""
                }
                onChange={(event) => {
                  const next = availableFiles.find(
                    (item) =>
                      `${item.name}:${item.lastModified}:${item.size}` ===
                      event.target.value,
                  );
                  if (next) selectLoadedFile(next);
                }}
                disabled={busy}
              >
                {availableFiles.map((item, index) => (
                  <option
                    key={`${item.name}-${item.lastModified}-${index}`}
                    value={`${item.name}:${item.lastModified}:${item.size}`}
                  >
                    {index + 1}. {item.name}
                  </option>
                ))}
              </select>
              <small>
                {availableFiles.length} file
                {availableFiles.length === 1 ? "" : "s"} carried over from the
                current deposition intake.
              </small>
            </label>
          )}
          <button
            className="secondary-button audio-tools-choose"
            onClick={chooseFile}
            disabled={busy}
          >
            {availableFiles.length
              ? "Choose a different audio file"
              : "Choose audio file"}
          </button>
          <input
            ref={fallbackInput}
            className="audio-tools-hidden-input"
            type="file"
            accept="audio/*,.wav,.flac"
            onChange={(event) =>
              event.target.files?.[0] && selectFile(event.target.files[0])
            }
          />
          {audit && (
            <section className="audio-original-summary">
              <h2>Original recording</h2>
              <strong>
                Original recording — preserved and never modified.
              </strong>
              <dl>
                <dt>File</dt>
                <dd>{audit.originalName}</dd>
                <dt>Duration</dt>
                <dd>
                  {audit.media?.durationSeconds?.toFixed(1) ?? "—"} seconds
                </dd>
                <dt>Format</dt>
                <dd>{audit.media?.codec ?? "—"}</dd>
                <dt>Sample rate</dt>
                <dd>{audit.media?.sampleRate?.toLocaleString() ?? "—"} Hz</dd>
                <dt>Channels</dt>
                <dd>{audit.media?.channels ?? "—"}</dd>
                <dt>Size</dt>
                <dd>{audit.storage.original.bytes.toLocaleString()} bytes</dd>
                <dt>SHA-256</dt>
                <dd>
                  {audit.storage.original.sha256 ? "Verified" : "Pending"}
                </dd>
              </dl>
              <p>
                Findings:{" "}
                {activeFindings.length
                  ? activeFindings.join(", ")
                  : "No validated concern detected."}
              </p>
            </section>
          )}
          <section className="audio-tool-menu">
            <h2>Recommended for this recording</h2>
            {recommended.length ? (
              <div className="audio-tool-grid">
                {recommended.map((tool) => (
                  <ToolButton
                    key={tool.id}
                    tool={tool}
                    selected={profileIds.includes(tool.id)}
                    onSelect={() => toggleTool(tool)}
                    trigger={tool.recommendFor
                      .filter((code) => activeFindings.includes(code))
                      .join(", ")}
                  />
                ))}
              </div>
            ) : (
              <p>
                No tool is automatically recommended. The original remains the
                default.
              </p>
            )}
            <h2>Other tools</h2>
            <div className="audio-tool-grid">
              {others.map((tool) => (
                <ToolButton
                  key={tool.id}
                  tool={tool}
                  selected={profileIds.includes(tool.id)}
                  onSelect={() => toggleTool(tool)}
                />
              ))}
            </div>
            {selectedTools.length > 0 && (
              <p className="audio-tool-order">
                Execution order:{" "}
                {selectedTools.map((tool) => tool.displayName).join(" → ")}.
              </p>
            )}
          </section>
          <div className="audio-tools-file">
            <strong>
              {file
                ? `${file.name} · ${file.size.toLocaleString()} bytes`
                : "No audio file selected"}
            </strong>
            <span>
              {derivative && file
                ? `Processed copy: ${outputName(file.name)} · SHA-256 verified`
                : file
                  ? "No processed copy has been created yet."
                  : "Select WAV, MP3, M4A, FLAC, OGG, AAC, or WMA."}
            </span>
          </div>
          <RenderEstimate tools={selectedTools} />
          <div className="audio-tools-actions">
            <button
              className="primary-button"
              disabled={!file || !profileIds.length || busy}
              onClick={processAudio}
            >
              {busy && !derivative
                ? "Processing…"
                : `Process with ${profileIds.length} tool${profileIds.length === 1 ? "" : "s"}`}
            </button>
            <button
              className="audio-save-button"
              disabled={!derivative || busy}
              onClick={saveAudio}
            >
              Save processed audio
            </button>
            {derivative?.kind === "rx-review" && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={promoteForTranscription}
              >
                Promote for transcription
              </button>
            )}
          </div>
          <p className="audio-tools-message" role="status">
            {message}
          </p>
          {processedFile && (
            <p className="audio-tools-replacement">
              <strong>Ready to replace intake audio:</strong>{" "}
              {processedSource?.name} → {processedFile.name}
            </p>
          )}
        </section>
        {audit && (
          <section className="audio-tools-card">
            <h2>Processing result</h2>
            {derivative && (
              <>
                <div className="skip-silence-control">
                  <label>
                    <input
                      type="checkbox"
                      checked={skipSilence}
                      disabled={!audit.speechSegments}
                      onChange={(event) => setSkipSilence(event.target.checked)}
                    />{" "}
                    Skip silence
                  </label>
                  {audit.speechSegments ? (
                    <span>
                      {durationLabel(audit.speechSegments.totalDurationSec)}{" "}
                      total ·{" "}
                      {durationLabel(audit.speechSegments.speechDurationSec)}{" "}
                      speech
                    </span>
                  ) : (
                    <>
                      <span>
                        Detect speech segments to enable playback skipping.
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={detectSegments}
                      >
                        Detect speech segments
                      </button>
                    </>
                  )}
                </div>
                <div className="audio-playback-pair">
                  <div className="audio-playback-source">
                    Original recording
                    {/* Source audio has no synchronized text track at this review stage. */}
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio
                      controls
                      onTimeUpdate={handleTimeUpdate}
                      src={`${API}/api/audio/original?uploadId=${encodeURIComponent(audit.uploadId)}`}
                    />
                  </div>
                  <div className="audio-playback-source">
                    Processed result
                    {/* Source audio has no synchronized text track at this review stage. */}
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio
                      controls
                      onTimeUpdate={handleTimeUpdate}
                      src={`${API}/api/audio/derivative?uploadId=${encodeURIComponent(audit.uploadId)}&operationId=${encodeURIComponent(derivative.operationId)}`}
                    />
                  </div>
                </div>
              </>
            )}
            <dl className="audio-tools-record">
              <dt>Upload ID</dt>
              <dd>{audit.uploadId}</dd>
              <dt>Original SHA-256</dt>
              <dd>{audit.storage.original.sha256}</dd>
              <dt>Processed SHA-256</dt>
              <dd>{derivative?.sha256 || "Pending"}</dd>
              <dt>Derivative kind</dt>
              <dd>{derivative?.kind || "Pending"}</dd>
              <dt>Source immutable</dt>
              <dd>{String(audit.storage.original.immutable)}</dd>
              <dt>Sample aligned</dt>
              <dd>
                {derivative ? String(derivative.sampleAligned) : "Pending"}
              </dd>
              <dt>Output</dt>
              <dd>
                {derivative
                  ? `${derivative.outputEncoding.container.toUpperCase()} · lossless`
                  : "Pending"}
              </dd>
              <dt>Tool chain</dt>
              <dd>
                {derivative
                  ? (derivative.module ??
                    selectedTools.map((tool) => tool.displayName).join(" → "))
                  : "Pending"}
              </dd>
              <dt>Processing identity</dt>
              <dd>
                {derivative
                  ? `${derivative.manufacturer ?? "FFmpeg"} ${derivative.product ?? ""} ${derivative.toolVersion ?? ""}`
                  : "Pending"}
              </dd>
            </dl>
            {derivative?.measurementDelta && (
              <div className="rx-delta-report">
                <h3>Before/after measurement report</h3>
                <p>
                  The original was measured before processing and the final
                  output afterward. Intermediates are not measured. Original
                  defects remain part of the evidence.
                </p>
                <ul>
                  {derivative.measurementDelta.map((item) => (
                    <li key={item.id} className={`rx-delta-${item.status}`}>
                      <strong>{item.label}</strong>
                      <span className="rx-delta-status">{item.status}</span>
                      <span>
                        {item.before === null || item.after === null
                          ? "Measurement unavailable"
                          : `${item.before.toFixed(1)} → ${item.after.toFixed(1)} ${item.unit}`}
                      </span>
                      {item.status === "concealed" &&
                        item.id === "clipping" && (
                          <small>
                            Clipping present in original — concealed by
                            processing.
                          </small>
                        )}
                      {item.note && <small>{item.note}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

// Render time, expressed per hour of audio because a deposition's length is what an operator
// actually has in mind. Dialogue Isolate and Repair Assistant run at roughly 0.19x real time,
// so a six-hour recording is about seventy minutes of processing -- worth knowing before
// starting, not after.
function renderMinutesPerHour(factor: number) {
  return factor * 60;
}
function formatRenderRate(factor: number) {
  const minutes = renderMinutesPerHour(factor);
  return minutes < 1
    ? "under a minute per hour of audio"
    : `about ${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} min per hour of audio`;
}
export function chainRenderEstimate(
  tools: { measuredRealTimeFactor: number | null }[],
) {
  const measured = tools.filter(
    (tool) => typeof tool.measuredRealTimeFactor === "number",
  );
  // Absent is "not measured", never "free". Saying so is the point: an unmeasured module in
  // the chain means the total is a floor, not an estimate.
  return {
    factor: measured.reduce(
      (total, tool) => total + (tool.measuredRealTimeFactor as number),
      0,
    ),
    measuredCount: measured.length,
    unmeasuredCount: tools.length - measured.length,
  };
}

function ToolButton({
  tool,
  selected,
  onSelect,
  trigger,
}: {
  tool: Tool;
  selected: boolean;
  onSelect: () => void;
  trigger?: string;
}) {
  return (
    <button
      type="button"
      className={`audio-tool-button ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <span>
        <strong>{tool.displayName}</strong>
        <em>{tool.riskLevel} risk</em>
      </span>
      <p>{tool.plainPurpose}</p>
      <small className="audio-tool-rate">
        {typeof tool.measuredRealTimeFactor === "number"
          ? `Renders ${formatRenderRate(tool.measuredRealTimeFactor)}`
          : "Render time not measured"}
      </small>
      {trigger && <small>Recommended for: {trigger}</small>}
      {tool.caution && <small>{tool.caution}</small>}
    </button>
  );
}

function RenderEstimate({ tools }: { tools: Tool[] }) {
  if (!tools.length) return null;
  const { factor, unmeasuredCount } = chainRenderEstimate(tools);
  const sixHourMinutes = Math.round(factor * 6 * 60);
  return (
    <p className="audio-tools-estimate">
      <strong>Estimated render time</strong>{" "}
      {factor > 0 ? (
        <>
          {formatRenderRate(factor)} — about {sixHourMinutes} min for a six-hour
          deposition.
        </>
      ) : (
        <>not measured for the selected tools.</>
      )}
      {unmeasuredCount > 0 && factor > 0 && (
        <>
          {" "}
          {unmeasuredCount} selected tool
          {unmeasuredCount === 1 ? " has" : "s have"} no measured render time,
          so the total is a minimum.
        </>
      )}
    </p>
  );
}
