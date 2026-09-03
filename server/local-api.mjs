import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { allowedApiOrigins, localApiPort } from "./api-origins.mjs";
import { extractionTool } from "./extraction-schema.mjs";
import {
  saveAndAnalyzeAudio,
  saveAudioForTools,
  readAudioAudit,
  readAudioAuditIfPresent,
  publicAudit,
  selectAudioSource,
  resolveAudioPath,
  createDeepgramCompatibilityDerivative,
  readStoredTranscript,
  recordComparison,
  selectAsrSource,
  mutateAudioAudit,
  writeAudioAudit,
} from "./audio-pipeline.mjs";
import {
  DeepgramRequestError,
  transcribeWithDeepgram,
  isDeepgramMediaError,
} from "./deepgram-service.mjs";
import {
  STALE_REPORTER_TRANSACTION,
  appendReporterOperations,
  getSpeakerCandidates,
  getTranscriptionJob,
  getWorkingTranscript,
  listTranscriptionJobs,
  readAsrEvidence,
  readReporterOverlay,
  reconcileDepositionSpeakers,
  redoReporterOperation,
  runTranscriptionJob,
  undoReporterOperation,
} from "./transcription-jobs.mjs";
import { renderTranscript } from "./transcript-render.mjs";
import { getTranscriptPrintModel } from "./transcript-print-model.mjs";
import { createTranscriptDocxArtifact } from "./final-document-docx.mjs";
import { createTranscriptPdfArtifact } from "./final-document-pdf.mjs";
import { getCompleteTranscriptModel } from "./complete-transcript-model.mjs";
import {
  assignCaptureSession,
  captureRecordingParts,
  continueCaptureSession,
  createCaptureSession,
  enumerateWindowsAudioSources,
  finalizeOrphanedSession,
  getCaptureSession,
  listCaptureSessions,
  recoverableCaptureSessions,
  registerCaptureAudio,
  renameCaptureSession,
  startCaptureSession,
  stopCaptureSession,
} from "./live-capture.mjs";
import {
  armPreflight,
  assertArmed,
  confirmPlayback,
  createPreflight,
  getPreflightArtifact,
  runTestCapture,
} from "./live-preflight.mjs";
import {
  getDeepgramLive,
  recordLiveAnnotation,
  startDeepgramLive,
  stopDeepgramLive,
} from "./deepgram-live.mjs";
import { readBackChannelFile, readBackSearch } from "./read-back.mjs";
import {
  listCorrectionPasses,
  readCorrectionPass,
  runEntityPass,
} from "./entity-pass.mjs";
import { suggestSpeakerAttributions } from "./speaker-attribution-pass.mjs";
import { runSpeakerRangePass } from "./speaker-range-pass.mjs";
import {
  RANGE_ACCEPTANCE_REFUSED,
  acceptRangeProposal,
} from "./range-proposal-acceptance.mjs";
import { STALE_CORRECTION_PROPOSAL } from "./review-state-hash.mjs";
import { appendFieldCorrection } from "./deposition-store.mjs";
import {
  KEYTERM_PRODUCT_CAP,
  KEYTERM_TOKEN_BUDGET,
  estimateKeytermTokens,
} from "./keyterm-limits.mjs";
import { mediaContentType, mediaResponse } from "./media-range.mjs";
import {
  needsPlaybackProxy,
  probeMediaForPlayback,
  renderPlaybackProxy,
} from "./playback-proxy.mjs";

// Every media route answers through here so seeking behaves the same on all three. The size is
// taken from the file on disk rather than from the recorded `bytes`: a range must be resolved
// against what will actually be streamed, and if the two ever disagree the recorded figure is
// the one that is wrong. Integrity of the file itself is established by SHA-256 elsewhere.
function sendMedia(req, res, file, base) {
  const size = fs.statSync(file).size;
  const { status, headers, start, end, partial, unsatisfiable } = mediaResponse(
    { rangeHeader: req.headers?.range, size, base },
  );
  res.writeHead(status, headers);
  if (unsatisfiable) return res.end();
  return fs.createReadStream(file, partial ? { start, end } : {}).pipe(res);
}
import { compareTranscripts } from "./transcript-quality.mjs";
import { inspectRx } from "./rx-adapter.mjs";
import { createRxDerivative, RxProcessingError } from "./rx-processing.mjs";
import { publicAudioTools, resolveAudioToolChain } from "./rx-profiles.mjs";
import { DERIVATIVE_KINDS } from "./audio-kinds.mjs";
import { detectSpeechSegments } from "./speech-segments.mjs";
import { systemPreflight } from "./preflight.mjs";
import { fetchExternal } from "./external-fetch.mjs";
import {
  createDeposition,
  depositionDirectory,
  playbackProxyPaths,
  readDepositionAttorneyTime,
  readDepositionCertificateWorkflow,
  readDepositionCertification,
  readDepositionCounsel,
  readDepositionIntake,
  readDepositionParties,
  readDepositionRecord,
  readDepositionVideographers,
  readPlaybackProxy,
  resolveDepositionAudio,
  scanDepositions,
  writeDepositionAttorneyTime,
  writeDepositionCertificateWorkflow,
  writeDepositionCertification,
  writeDepositionCounsel,
  writeDepositionParties,
  writeDepositionProceeding,
  writeDepositionVideographers,
  writeParticipantHonorific,
  writePlaybackProxyRecord,
} from "./deposition-store.mjs";
import { buildTermGroups } from "./term-groups.mjs";
import { fileURLToPath } from "node:url";
import { depositionStorageRoot as configuredDepositionStorageRoot } from "./storage-config.mjs";
import {
  createInsertionWordArtifact,
  prepareInsertionRenderingArtifact,
} from "./insertion-pages/word-service.mjs";
import { insertionTemplateCatalog } from "./insertion-pages/templates.mjs";
import {
  createReporter,
  importReporters,
  listReporters,
  updateReporter,
} from "./reporter-store.mjs";
import { inspectStorage } from "./storage-inventory.mjs";
import {
  EDITABLE_PATHS,
  confirmOpeningField,
  confirmOpeningFields,
  confirmOpeningParticipant,
  getOpeningProjection,
  recordClosingAttestation,
  recordInterpreterAttestation,
  recordOathAttestation,
  recordStipulationResponse,
  saveOpeningState,
} from "./opening-procedures.mjs";
import {
  attestWitnessSworn,
  readCorrectionAuthority,
  setOpeningParticipantAttendance,
} from "./deposition-store.mjs";
import { COMPLETE_RECORD_TYPE } from "../app/document-status.mjs";
import {
  AssemblyConflictError,
  AssemblyRefusedError,
  assemblyReadiness,
  writeAssembly,
} from "./complete-transcript-assembly.mjs";
import { recordReviewElection, recordReviewNotification, recordReviewCompletion, recordReviewCorrection, recordReviewOverride } from "./canonical-review-election.mjs";
import {
  masterDataFromExtraction,
  projectDeepgramKeyterms,
  projectTexasFreelanceUfm,
} from "./master-deposition-data.mjs";

// What a rendered document actually is, decided from the model that was actually rendered.
// COMPLETE_RECORD_TYPE is imported rather than restated so the browser's idea of "complete" and
// this one cannot drift apart. document-status.mjs is pure -- no DOM, no fs -- which is what
// makes it safe to read from both sides.
const documentKindOf = (model) =>
  model?.recordType === COMPLETE_RECORD_TYPE
    ? "complete-transcript"
    : "testimony-only";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnvironment = path.join(root, ".env.local");
if (fs.existsSync(localEnvironment)) process.loadEnvFile(localEnvironment);
const depositionStorageRoot = configuredDepositionStorageRoot();
const terminologyPrompt = fs.readFileSync(
  path.join(root, "prompts", "extraction", "case_terms", "v2.md"),
  "utf8",
);
const secretFile = path.join(root, "data", "secrets.dat");
const port = localApiPort();
const allowedOrigins = allowedApiOrigins();

function dpapi(mode, value) {
  const script =
    mode === "encrypt"
      ? "Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($e)"
      : "Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($d)";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: value, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw new Error("Windows secret protection failed.");
  return result.stdout.trim();
}

function loadSecrets() {
  if (!fs.existsSync(secretFile)) return null;
  return JSON.parse(dpapi("decrypt", fs.readFileSync(secretFile, "utf8")));
}
function saveSecrets(value) {
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, dpapi("encrypt", JSON.stringify(value)), {
    encoding: "utf8",
    mode: 0o600,
  });
}
function hashCode(code, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(code, salt, 32).toString("hex") };
}
function validCode(code, config) {
  if (!config?.adminHash || !code) return false;
  const actual = crypto.scryptSync(code, config.adminSalt, 32);
  const expected = Buffer.from(config.adminHash, "hex");
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}
function json(res, status, body, origin) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin,
    vary: "Origin",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req, max = 25 * 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("Request is too large.");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}
function contentBlock(file) {
  if (file.type === "application/pdf")
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: file.base64,
      },
    };
  if (file.type === "text/plain")
    return {
      type: "document",
      source: {
        type: "text",
        media_type: "text/plain",
        data: Buffer.from(file.base64, "base64").toString("utf8"),
      },
    };
  throw new Error(
    "Claude extraction currently accepts PDF or plain-text notices. Convert Word files to PDF first.",
  );
}

// `audit` is null for live-captured audio, which never passed through intake. Nothing on the
// success path needs it: runTranscriptionJob resolves the file from the deposition record and
// re-hashes it against the frozen sha256 before every job, so the identity check is unaffected.
// Only the media-rejection fallback needs an audit, because the derivative it builds is written
// into the intake directory -- and it refuses out loud rather than inventing one.
async function transcribeAudioWithCompatibility({
  apiKey,
  audit,
  uploadId,
  source,
  derivativeOperationId,
  expectedAudioSha256,
  audioFile,
  request,
  keyterms,
  operationId,
}) {
  const requestedPath = audioFile;
  try {
    const result = await transcribeWithDeepgram({
      apiKey,
      filePath: requestedPath,
      request,
      keyterms,
      uploadId,
      operationId,
    });
    result.normalized.audioDelivery = {
      requestedSource: source,
      deliveredSource: "deposition-workspace",
      converted: false,
      reason: "Deepgram accepted the frozen deposition audio directly.",
    };
    result.delivery = {
      source: "deposition-workspace",
      sha256: expectedAudioSha256,
      bytes: fs.statSync(requestedPath).size,
      converted: false,
    };
    return result;
  } catch (error) {
    if (!isDeepgramMediaError(error)) throw error;
    if (!audit)
      throw new Error(
        `Deepgram could not decode ${path.basename(audioFile)}, and Depo-Pro builds its compatibility copy inside the audio intake record this audio does not have. It was captured locally rather than uploaded. The recording itself is unaffected and still verifies against its recorded SHA-256.`,
      );
    const fallback = await createDeepgramCompatibilityDerivative(
      root,
      audit,
      source,
      derivativeOperationId,
    );
    if (fallback.derivative.sourceSha256 !== expectedAudioSha256)
      throw new Error(
        "The compatibility derivative was not created from the frozen deposition audio.",
      );
    const result = await transcribeWithDeepgram({
      apiKey,
      filePath: fallback.path,
      request,
      keyterms,
      uploadId,
      operationId,
    });
    result.normalized.audioDelivery = {
      requestedSource: source,
      deliveredSource: "compatibility-wav",
      converted: true,
      reason:
        "Deepgram could not decode the selected file, so Depo-Pro automatically retried with a lossless PCM WAV derivative.",
      derivativeKey: fallback.derivative.key,
      derivativeSha256: fallback.derivative.sha256,
      sourceSha256: fallback.derivative.sourceSha256,
    };
    result.delivery = {
      source: "compatibility-wav",
      sha256: fallback.derivative.sha256,
      sourceSha256: fallback.derivative.sourceSha256,
      bytes: fallback.derivative.bytes,
      converted: true,
      derivativeKey: fallback.derivative.key,
    };
    result.transportAttempts = [
      {
        status: error.status,
        code: error.code,
        rawResponseBytes: error.rawResponseBytes || null,
        headers: error.responseHeaders || {},
        outcome: "media_rejected",
      },
    ];
    return result;
  }
}
/**
 * The deposition's keyterms for the live socket, or none.
 *
 * The cap is not applied here. buildDeepgramLiveUrl holds it, so it cannot be bypassed by a
 * caller that forgets -- which is what this line was.
 *
 * Read leniently on purpose. authoritativeKeyterms throws for a transcription job, correctly --
 * that set is part of job identity and a wrong one is an evidentiary problem. Here the list only
 * improves recognition in an index, so a deposition without intake, or an unassigned capture with
 * no deposition at all, connects without names rather than not connecting.
 */
function liveKeyterms(depositionId) {
  if (!depositionId) return [];
  try {
    const intake = readDepositionIntake(root, depositionId, {
      storageRoot: depositionStorageRoot,
    });
    const source =
      intake?.masterData?.recordType === "MASTER_DEPOSITION_DATA_RECORD"
        ? projectDeepgramKeyterms(intake.masterData).wire
        : Array.isArray(intake?.deepgramArtifact?.wire)
          ? intake.deepgramArtifact.wire
          : intake?.keyterms;
    return (Array.isArray(source) ? source : [])
      .map((term) => String(term).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  // The gate is correct and stays. It is also non-obvious for media, so: ANY <audio> or <video>
  // element pointed at this server MUST carry crossOrigin="anonymous". Without it the browser
  // issues a no-cors request, which sends no Origin header, and this line 403s it -- surfacing
  // as MEDIA_ERR_SRC_NOT_SUPPORTED, indistinguishable from an unsupported codec. That cost an
  // investigation once (see the correction in media-range.mjs) and will bite the next media
  // element someone adds.
  const origin = req.headers.origin || "";
  if (!allowedOrigins.has(origin))
    return json(res, 403, { error: "Origin not allowed." }, "null");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST",
      "access-control-allow-headers":
        "content-type,x-admin-code,x-file-name,range",
      "access-control-expose-headers":
        "content-range,accept-ranges,content-length",
    });
    return res.end();
  }
  try {
    if (req.url === "/api/audio/analyze" && req.method === "POST") {
      const originalName = decodeURIComponent(
        String(req.headers["x-file-name"] || "audio.bin"),
      );
      // One renderer for every derivative. The recommended candidate goes through the same
      // audited path as an operator-selected chain, so a profile id means one thing.
      const createCandidate = ({
        root: candidateRoot,
        audit,
        originalPath,
        profileIds,
      }) =>
        createRxDerivative(candidateRoot, audit, {
          originalPath,
          profileIds,
          recordAuditEvent: async (event) => {
            audit.history.push(event);
            writeAudioAudit(candidateRoot, audit);
          },
        });
      const profile = await saveAndAnalyzeAudio(req, {
        root,
        originalName,
        contentType: req.headers["content-type"],
        createCandidate,
      });
      return json(res, 200, profile, origin);
    }
    if (req.url === "/api/rx/status" && req.method === "GET")
      return json(res, 200, inspectRx(), origin);
    if (req.url === "/api/audio/tools" && req.method === "GET")
      return json(res, 200, publicAudioTools(), origin);
    if (req.url === "/api/system/preflight" && req.method === "GET")
      return json(res, 200, systemPreflight({ config: loadSecrets() }), origin);
    if (req.url === "/api/live-capture/devices" && req.method === "GET")
      return json(res, 200, enumerateWindowsAudioSources(), origin);
    if (req.url === "/api/live-capture/preflight" && req.method === "POST") {
      const input = await body(req, 128 * 1024);
      return json(
        res,
        201,
        createPreflight(root, { ...input, storageRoot: depositionStorageRoot }),
        origin,
      );
    }
    if (
      req.url === "/api/live-capture/preflight/test" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        await runTestCapture(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/live-capture/preflight/confirm" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        confirmPlayback(root, { ...input, storageRoot: depositionStorageRoot }),
        origin,
      );
    }
    if (
      req.url === "/api/live-capture/preflight/arm" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        armPreflight(root, { ...input, storageRoot: depositionStorageRoot }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/live-capture/preflight/audio?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost"),
        file = getPreflightArtifact(root, {
          depositionId: url.searchParams.get("depositionId"),
          preflightId: url.searchParams.get("preflightId"),
          sourceId: url.searchParams.get("sourceId"),
          storageRoot: depositionStorageRoot,
        });
      return sendMedia(req, res, file, {
        "content-type": "audio/wav",
        "access-control-allow-origin": origin,
        vary: "Origin",
        "cache-control": "no-store",
      });
    }
    if (req.url === "/api/live-capture/session" && req.method === "POST") {
      const input = await body(req, 256 * 1024);
      return json(
        res,
        201,
        createCaptureSession(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // Continuing configures the next part; it does not start it. Starting stays one route with one
    // meaning, and the preflight check on it applies to a continuation exactly as to a first part --
    // the device signature is computed over the same sources, so the same armed preflight covers it.
    if (req.url === "/api/live-capture/continue" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        201,
        continueCaptureSession(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/live-capture/parts?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost");
      return json(
        res,
        200,
        captureRecordingParts(root, {
          depositionId: url.searchParams.get("depositionId") || null,
          sessionId: url.searchParams.get("sessionId"),
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/live-capture/start" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      if (input.preflightId) {
        const session = getCaptureSession(root, {
          depositionId: input.depositionId,
          sessionId: input.sessionId,
          storageRoot: depositionStorageRoot,
        });
        assertArmed(root, {
          depositionId: input.depositionId,
          preflightId: input.preflightId,
          sources: session.sources,
          storageRoot: depositionStorageRoot,
        });
      }
      return json(
        res,
        200,
        startCaptureSession(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/live-capture/deepgram/start" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024),
        config = loadSecrets();
      return json(
        res,
        200,
        startDeepgramLive(root, {
          ...input,
          apiKey: config?.deepgramApiKey,
          keyterms: liveKeyterms(input.depositionId),
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/live-capture/deepgram/stop" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      return json(res, 200, await stopDeepgramLive(root, input), origin);
    }
    if (req.url === "/api/live-capture/annotation" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        201,
        recordLiveAnnotation(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/live-capture/deepgram?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost");
      return json(
        res,
        200,
        getDeepgramLive(root, {
          depositionId: url.searchParams.get("depositionId"),
          sessionId: url.searchParams.get("sessionId"),
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/live-capture/stop" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        await stopCaptureSession(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/live-capture/recover" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        await finalizeOrphanedSession(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/correction/entity-pass" && req.method === "POST") {
      const input = await body(req, 16 * 1024),
        config = loadSecrets();
      if (!config?.anthropicApiKey)
        return json(
          res,
          503,
          {
            error:
              "Add the Anthropic API key in Administrator Settings before running a correction pass.",
          },
          origin,
        );
      return json(
        res,
        201,
        await runEntityPass(root, {
          depositionId: input.depositionId,
          limitChunks: input.limitChunks ?? null,
          additionalInstructions: input.additionalInstructions ?? "",
          apiKey: config.anthropicApiKey,
          model: config.claudeModel,
          passStartedAt: new Date().toISOString(),
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/transcript/speaker-suggestions" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024),
        config = loadSecrets();
      if (!config?.anthropicApiKey)
        return json(
          res,
          503,
          {
            error:
              "Add the Anthropic API key in Administrator Settings before suggesting speakers.",
          },
          origin,
        );
      return json(
        res,
        200,
        await suggestSpeakerAttributions(root, {
          depositionId: input.depositionId,
          additionalInstructions: input.additionalInstructions ?? "",
          apiKey: config.anthropicApiKey,
          model: config.claudeModel,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // RANGE, beside GLOBAL rather than instead of it. /api/transcript/speaker-suggestions proposes
    // a whole diarization cluster; this proposes a stretch of words. Five of Trial #1's eight
    // clusters were one person throughout, so both questions are worth asking.
    if (
      req.url === "/api/correction/speaker-range-pass" &&
      req.method === "POST"
    ) {
      const input = await body(req, 16 * 1024),
        config = loadSecrets();
      if (!config?.anthropicApiKey)
        return json(
          res,
          503,
          {
            error:
              "Add the Anthropic API key in Administrator Settings before running a correction pass.",
          },
          origin,
        );
      return json(
        res,
        201,
        await runSpeakerRangePass(root, {
          depositionId: input.depositionId,
          limitChunks: input.limitChunks ?? null,
          additionalInstructions: input.additionalInstructions ?? "",
          apiKey: config.anthropicApiKey,
          model: config.claudeModel,
          passStartedAt: new Date().toISOString(),
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // The client sends WHICH proposal the reporter accepted, and nothing else. It does not send
    // operations and is not trusted to have worked out what they would be -- the plan is made here,
    // against the projection the proposal was analyzed against, and applied as one transaction.
    if (
      req.url === "/api/transcript/range-proposal/accept" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      const result = acceptRangeProposal(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        proposal: input.proposal,
        expectedReviewStateHash: input.expectedReviewStateHash ?? null,
        getWorkingTranscript,
        readReporterOverlay,
        getSpeakerCandidates,
        appendReporterOperations,
      });
      return json(res, 200, result, origin);
    }
    if (
      req.url?.startsWith("/api/correction/passes?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost");
      return json(
        res,
        200,
        {
          passes: listCorrectionPasses(root, {
            depositionId: url.searchParams.get("depositionId"),
            storageRoot: depositionStorageRoot,
          }),
        },
        origin,
      );
    }
    if (req.url?.startsWith("/api/correction/pass?") && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      return json(
        res,
        200,
        readCorrectionPass(root, {
          depositionId: url.searchParams.get("depositionId"),
          passId: url.searchParams.get("passId"),
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/live-capture/read-back" && req.method === "POST") {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        await readBackSearch(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/live-capture/channel-audio?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost"),
        file = await readBackChannelFile(root, {
          depositionId: url.searchParams.get("depositionId"),
          sessionId: url.searchParams.get("sessionId"),
          channelId: url.searchParams.get("channelId"),
          storageRoot: depositionStorageRoot,
        });
      return sendMedia(req, res, file, {
        "content-type": "audio/wav",
        "access-control-allow-origin": origin,
        vary: "Origin",
        "cache-control": "no-store",
      });
    }
    if (req.url === "/api/live-capture/recoverable" && req.method === "GET")
      return json(
        res,
        200,
        recoverableCaptureSessions(root, {
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    if (req.url === "/api/live-capture/sessions" && req.method === "GET")
      return json(res, 200, { sessions: listCaptureSessions() }, origin);
    if (req.url === "/api/live-capture/rename" && req.method === "POST") {
      const input = await body(req, 8 * 1024);
      return json(
        res,
        200,
        renameCaptureSession(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/live-capture/assign" && req.method === "POST") {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        await assignCaptureSession(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/live-capture/add-to-deposition" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        registerCaptureAudio(root, {
          ...input,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/live-capture/session?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost");
      return json(
        res,
        200,
        getCaptureSession(root, {
          depositionId: url.searchParams.get("depositionId"),
          sessionId: url.searchParams.get("sessionId"),
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/depositions" && req.method === "GET")
      return json(
        res,
        200,
        scanDepositions(root, { storageRoot: depositionStorageRoot }),
        origin,
      );
    if (req.url === "/api/reporters" && req.method === "GET")
      return json(
        res,
        200,
        { reporters: listReporters(depositionStorageRoot) },
        origin,
      );
    if (req.url === "/api/reporters" && req.method === "POST")
      return json(
        res,
        201,
        createReporter(depositionStorageRoot, await body(req, 64 * 1024)),
        origin,
      );
    // Correcting a saved profile. Its own verb because create refuses an existing id and import
    // skips one, so nothing could change a stored value -- and a mistyped CSR number, expiration,
    // address or firm registration prints in the signature block of every certificate that reporter
    // signs. Found at the first screen of Production Trial #1.
    if (req.url === "/api/reporters/update" && req.method === "POST")
      return json(
        res,
        200,
        updateReporter(depositionStorageRoot, await body(req, 64 * 1024)),
        origin,
      );
    if (req.url === "/api/reporters/import" && req.method === "POST") {
      const input = await body(req, 256 * 1024);
      return json(
        res,
        200,
        { reporters: importReporters(depositionStorageRoot, input.reporters) },
        origin,
      );
    }
    if (req.url === "/api/storage/inventory" && req.method === "GET")
      return json(
        res,
        200,
        inspectStorage(root, { storageRoot: depositionStorageRoot }),
        origin,
      );
    if (req.url === "/api/depositions" && req.method === "POST") {
      const input = await body(req, 100 * 1024 * 1024);
      return json(
        res,
        201,
        createDeposition(root, input, { storageRoot: depositionStorageRoot }),
        origin,
      );
    }
    if (req.url === "/api/insertion-pages/docx" && req.method === "POST") {
      const input = await body(req, 10 * 1024 * 1024);
      return json(
        res,
        201,
        await createInsertionWordArtifact(root, input.depositionId, input, {
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/insertion-pages/catalog" && req.method === "GET") {
      return json(
        res,
        200,
        { variants: await insertionTemplateCatalog() },
        origin,
      );
    }
    if (
      req.url === "/api/insertion-pages/rendering-spec" &&
      req.method === "POST"
    ) {
      const input = await body(req, 10 * 1024 * 1024);
      const prepared = await prepareInsertionRenderingArtifact(
        root,
        input.depositionId,
        input,
        { storageRoot: depositionStorageRoot },
      );
      return json(
        res,
        201,
        {
          variant: prepared.variant,
          findings: prepared.findings,
          renderingSpec: prepared.renderingSpec,
          workspaceDocument: prepared.workspaceDocument,
        },
        origin,
      );
    }
    // Playback proxy. GET serves it or reports that none exists; POST renders one.
    //
    // Split because rendering an 83-minute source takes about half a minute, which is too long
    // to hold a media request open -- the player asks, and if the answer is "none yet" the
    // Workspace offers to build it rather than showing a control that silently fails.
    if (
      req.url?.startsWith("/api/depositions/playback?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost"),
        id = url.searchParams.get("id"),
        index = url.searchParams.get("index") ?? 0;
      const store = { storageRoot: depositionStorageRoot };
      if (url.searchParams.get("meta") === "1") {
        const source = resolveDepositionAudio(root, id, index, store);
        const media = await probeMediaForPlayback(source.file);
        return json(
          res,
          200,
          {
            proxy: readPlaybackProxy(root, id, index, store),
            sourceMedia: media,
            needsProxy: needsPlaybackProxy(media),
          },
          origin,
        );
      }
      const proxy = readPlaybackProxy(root, id, index, store);
      if (!proxy)
        return json(
          res,
          404,
          { error: "No playback proxy has been rendered for this recording." },
          origin,
        );
      return sendMedia(req, res, proxy.file, {
        "content-type": "audio/ogg",
        "access-control-allow-origin": origin,
        vary: "Origin",
        "cache-control": "no-store",
      });
    }
    if (req.url === "/api/depositions/playback" && req.method === "POST") {
      const input = await body(req, 64 * 1024),
        store = { storageRoot: depositionStorageRoot },
        index = Number(input.index ?? 0);
      const source = resolveDepositionAudio(
        root,
        input.depositionId,
        index,
        store,
      );
      const paths = playbackProxyPaths(root, input.depositionId, index, store);
      const started = Date.now();
      console.log("[external:playback proxy] render started", {
        depositionId: input.depositionId,
        index,
      });
      const record = await renderPlaybackProxy({
        sourceFile: source.file,
        targetFile: paths.file,
        sourceSha256: source.item.sha256,
      });
      console.log("[external:playback proxy] render finished", {
        depositionId: input.depositionId,
        index,
        elapsedMs: Date.now() - started,
        aligned: record.alignment?.aligned,
      });
      return json(
        res,
        201,
        {
          proxy: writePlaybackProxyRecord(
            root,
            input.depositionId,
            index,
            { ...record, file: undefined },
            store,
          ),
        },
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/depositions/audio?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost"),
        resolved = resolveDepositionAudio(
          root,
          url.searchParams.get("id"),
          url.searchParams.get("index"),
          { storageRoot: depositionStorageRoot },
        );
      return sendMedia(req, res, resolved.file, {
        "content-type": mediaContentType(resolved.file),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(resolved.item.name)}`,
        "access-control-allow-origin": origin,
        vary: "Origin",
        "cache-control": "no-store",
      });
    }
    if (req.url === "/api/audio/select" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        await selectAudioSource(
          root,
          input.uploadId,
          input.source,
          "user-override",
          input.derivativeOperationId,
        ),
        origin,
      );
    }
    if (req.url === "/api/audio/tools/upload" && req.method === "POST") {
      const originalName = decodeURIComponent(
        String(req.headers["x-file-name"] || "audio.bin"),
      );
      return json(
        res,
        201,
        await saveAudioForTools(req, {
          root,
          originalName,
          contentType: req.headers["content-type"],
        }),
        origin,
      );
    }
    if (req.url === "/api/audio/rx-process" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const audit = readAudioAudit(root, input.uploadId);
      const originalPath = resolveAudioPath(root, audit, "original"),
        profiles = resolveAudioToolChain(input.profileIds || [input.profileId]);
      const profileIds = profiles.map((item) => item.id),
        operationId = crypto.randomUUID(),
        correlator = { uploadId: audit.uploadId, operationId },
        startedAt = Date.now();
      console.log("[external:RX audio processing] request started", {
        ...correlator,
        profileIds,
      });
      try {
        const recordAuditEvent = async (event) =>
          mutateAudioAudit(root, audit.uploadId, (current) =>
            current.history.push(event),
          );
        const derivative = await createRxDerivative(root, audit, {
          originalPath,
          profileIds,
          recordAuditEvent,
          randomId: () => operationId,
        });
        const updated = await mutateAudioAudit(
          root,
          audit.uploadId,
          (current) => {
            current.storage.derivatives.push(derivative);
            current.history.push({
              event: "audio-tool-derivative-created",
              at: new Date().toISOString(),
              operationId: derivative.operationId,
              key: derivative.key,
              kind: derivative.kind,
              sha256: derivative.sha256,
              sourceSha256: derivative.sourceSha256,
              profileIds,
            });
          },
        );
        console.log("[external:RX audio processing] response received", {
          ...correlator,
          status: 200,
          elapsedMs: Date.now() - startedAt,
          profileIds,
        });
        return json(res, 200, { derivative, audit: updated }, origin);
      } catch (error) {
        console.error("[external:RX audio processing] request failed", {
          ...correlator,
          elapsedMs: Date.now() - startedAt,
          profileIds,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    if (req.url === "/api/audio/promote" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const updated = await mutateAudioAudit(
        root,
        input.uploadId,
        (current) => {
          const derivative = current.storage.derivatives.find(
            (item) => item.operationId === input.operationId,
          );
          if (!derivative || derivative.kind !== DERIVATIVE_KINDS.RX_REVIEW)
            throw new Error("Review derivative was not found.");
          const profiles = resolveAudioToolChain(
              derivative.profileIds || [derivative.profileId],
            ),
            unsafe = profiles.filter((item) => !item.asrSafe);
          if (!unsafe.length)
            throw new Error(
              "Only a review-marked tool result can be promoted.",
            );
          derivative.kind = DERIVATIVE_KINDS.RX_ASR;
          derivative.selectableForTranscription = true;
          current.history.push({
            event: "rx-review-derivative-promoted",
            at: new Date().toISOString(),
            operationId: derivative.operationId,
            profileIds: profiles.map((item) => item.id),
            riskLevels: unsafe.map((item) => item.riskLevel),
            cautions: unsafe.map((item) => item.caution),
          });
        },
      );
      return json(res, 200, updated, origin);
    }
    if (
      req.url === "/api/audio/detect-speech-segments" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024),
        audit = readAudioAudit(root, input.uploadId),
        operationId = input.artifactOperationId || null;
      const artifact = operationId
        ? audit.storage.derivatives.find(
            (item) => item.operationId === operationId,
          )
        : audit.storage.original;
      if (!artifact) throw new Error("Audio artifact was not found.");
      if (
        operationId &&
        (artifact.kind === DERIVATIVE_KINDS.PLAYBACK_PROXY ||
          artifact.timelinePreserved === false ||
          artifact.sampleAligned === false)
      )
        throw new Error(
          "Speech segments require an original or frame-aligned derivative.",
        );
      const source = operationId ? "processed" : "original",
        file = resolveAudioPath(root, audit, source, operationId),
        detected = await detectSpeechSegments(file);
      const speechSegments = {
        artifactOperationId: operationId,
        detectedAt: new Date().toISOString(),
        ...detected,
      };
      const updated = await mutateAudioAudit(
        root,
        audit.uploadId,
        (current) => {
          current.speechSegments = speechSegments;
          current.history.push({
            event: "speech-segments-detected",
            at: speechSegments.detectedAt,
            artifactOperationId: operationId,
            parameters: speechSegments.parameters,
            totalDurationSec: speechSegments.totalDurationSec,
            speechDurationSec: speechSegments.speechDurationSec,
          });
        },
      );
      return json(res, 200, updated, origin);
    }
    if (req.url?.startsWith("/api/audio/original?") && req.method === "GET") {
      const uploadId = new URL(req.url, "http://localhost").searchParams.get(
          "uploadId",
        ),
        audit = readAudioAudit(root, uploadId),
        file = resolveAudioPath(root, audit, "original");
      return sendMedia(req, res, file, {
        "content-type": audit.contentType || "application/octet-stream",
        "access-control-allow-origin": origin,
        vary: "Origin",
        "cache-control": "no-store",
      });
    }
    if (req.url?.startsWith("/api/audio/derivative?") && req.method === "GET") {
      const url = new URL(req.url, "http://localhost"),
        audit = readAudioAudit(root, url.searchParams.get("uploadId"));
      const operationId = url.searchParams.get("operationId"),
        derivative = audit.storage.derivatives.find(
          (item) => item.operationId === operationId,
        );
      if (!derivative) throw new Error("Processed audio was not found.");
      const file = path.resolve(root, "data", derivative.key),
        directory =
          path.resolve(root, "data", "audio-intake", audit.uploadId) + path.sep;
      if (!file.startsWith(directory))
        throw new Error("Processed audio path is invalid.");
      return sendMedia(req, res, file, {
        "content-type": mediaContentType(file, "audio/wav"),
        "access-control-allow-origin": origin,
        vary: "Origin",
        "cache-control": "no-store",
      });
    }
    if (req.url === "/api/audio/transcribe" && req.method === "POST") {
      const input = await body(req, 64 * 1024),
        config = loadSecrets(),
        audit = readAudioAuditIfPresent(root, input.uploadId);
      const result = await runTranscriptionJob(root, {
        depositionId: input.depositionId,
        uploadId: input.uploadId,
        keytermOverrideReason: input.keytermOverrideReason || "",
        storageRoot: depositionStorageRoot,
        submit: ({ audio, audioFile, request, keyterms, operationId }) =>
          transcribeAudioWithCompatibility({
            apiKey: config?.deepgramApiKey,
            audit,
            uploadId: input.uploadId,
            source: audio.source,
            derivativeOperationId: audio.operationId,
            expectedAudioSha256: audio.sha256,
            audioFile,
            request,
            keyterms,
            operationId,
          }),
      });
      return json(
        res,
        200,
        {
          cached: result.cached,
          job: result.job,
          evidence: result.evidence,
          workingTranscript: result.workingTranscript,
          transcript: result.normalized || null,
        },
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/transcription/jobs?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost"),
        depositionId = url.searchParams.get("depositionId"),
        jobId = url.searchParams.get("jobId");
      return json(
        res,
        200,
        jobId
          ? getTranscriptionJob(root, {
              depositionId,
              jobId,
              storageRoot: depositionStorageRoot,
            })
          : {
              jobs: listTranscriptionJobs(root, {
                depositionId,
                storageRoot: depositionStorageRoot,
              }),
            },
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/transcript/working?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        getWorkingTranscript(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url?.startsWith("/api/opening?") && req.method === "GET") {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/opening" && req.method === "POST") {
      const input = await body(req, 256 * 1024);
      saveOpeningState(root, {
        depositionId: input.depositionId,
        state: input.state,
        storageRoot: depositionStorageRoot,
      });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // The oath attestation is a separate endpoint from the state save above, and deliberately so.
    // Saving the Opening screen writes workflow values that carry no attribution; this writes an
    // attested fact to the canonical record through the correction log. Routing it through the
    // state save would make a dropdown change indistinguishable from an attestation, which is the
    // failure ADR-0021 exists to prevent. See docs/opening-procedures/.
    //
    // `who` is read from the canonical record rather than accepted from the client. A client-
    // supplied attestor is a forgeable one, and this value ends up in a certified record's history.
    if (req.url === "/api/opening/oath-attestation" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const projection = getOpeningProjection(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
      });
      if (!String(projection.canonical?.reporter?.fullName?.value ?? "").trim())
        return json(
          res,
          400,
          {
            error:
              "This deposition has no deposition officer on its canonical record, so an oath attestation cannot be recorded.",
          },
          origin,
        );
      const who = readCorrectionAuthority(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
      });
      const structured =
        input.attestation && typeof input.attestation === "object"
          ? input.attestation
          : null;
      if (structured) {
        const recorded = recordOathAttestation(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
          input: structured,
          actor: who,
        });
        // `witnessSworn` is the legacy certificate gate meaning "placed under an oath or
        // affirmation", not a religious-form selector. The exact form lives in the immutable
        // structured opening attestation. An affirmation therefore satisfies this gate too.
        attestWitnessSworn(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
          sworn: recorded.selection === "OATH",
          who,
          why: `${recorded.selection}: ${recorded.justification}`,
        });
      } else
        attestWitnessSworn(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
          sworn: input.sworn,
          who,
          why: input.why,
        });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/opening/interpreter-attestation" && req.method === "POST") {
      const input = await body(req, 64 * 1024), who = readCorrectionAuthority(root, { depositionId: input.depositionId, storageRoot: depositionStorageRoot });
      recordInterpreterAttestation(root, { depositionId: input.depositionId, storageRoot: depositionStorageRoot, input: input.attestation, actor: who });
      return json(res, 200, getOpeningProjection(root, { depositionId: input.depositionId, storageRoot: depositionStorageRoot }), origin);
    }
    if (req.url === "/api/opening/closing-attestation" && req.method === "POST") {
      const input = await body(req, 64 * 1024), who = readCorrectionAuthority(root, { depositionId: input.depositionId, storageRoot: depositionStorageRoot });
      recordClosingAttestation(root, { depositionId: input.depositionId, storageRoot: depositionStorageRoot, input: input.attestation, actor: who });
      return json(res, 200, getOpeningProjection(root, { depositionId: input.depositionId, storageRoot: depositionStorageRoot }), origin);
    }
    if (req.url === "/api/opening/rule-30e-election" && req.method === "POST") {
      const input=await body(req,64*1024), who=readCorrectionAuthority(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot});
      const election=recordReviewElection(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot,input:input.election,actor:who});
      return json(res,200,{election},origin);
    }
    if (req.url === "/api/opening/rule-30e-notification" && req.method === "POST") {
      const input=await body(req,64*1024), who=readCorrectionAuthority(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot});
      const notification=recordReviewNotification(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot,input:input.notification,actor:who});
      return json(res,200,{notification},origin);
    }
    if (req.url === "/api/opening/rule-30e-completion" && req.method === "POST") {
      const input=await body(req,64*1024), who=readCorrectionAuthority(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot});
      const completion=recordReviewCompletion(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot,input:input.completion,actor:who});
      return json(res,200,{completion},origin);
    }
    if (req.url === "/api/opening/rule-30e-correction" && req.method === "POST") {
      const input=await body(req,128*1024), who=readCorrectionAuthority(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot});
      const correction=recordReviewCorrection(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot,input:input.correction,actor:who});
      return json(res,200,{correction},origin);
    }
    if (req.url === "/api/opening/rule-30e-override" && req.method === "POST") {
      const input=await body(req,128*1024), who=readCorrectionAuthority(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot});
      const override=recordReviewOverride(root,{depositionId:input.depositionId,storageRoot:depositionStorageRoot,input:input.override,actor:who});
      return json(res,200,{override},origin);
    }
    if (
      req.url === "/api/opening/stipulation-response" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024),
        who = readCorrectionAuthority(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        });
      recordStipulationResponse(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        participantId: input.participantId,
        status: input.status,
        modifiedText: input.modifiedText,
        topic: input.topic,
        evidenceAnchor: input.evidenceAnchor,
        actor: who,
      });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // One correction to one displayed fact. The write channel and `from` are established on the
    // server: a caller-supplied actor is forgeable, and a caller-supplied previous value would let
    // a stale screen overwrite whatever replaced it. What the operator
    // supplies is the new value and the reason, which are the two things only they can know.
    // Confirming records WHICH value the reporter agreed with, read here rather than sent, so a
    // screen that has drifted cannot record agreement with something nobody is looking at.
    if (req.url === "/api/opening/confirm-field" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      confirmOpeningField(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        path: input.path,
        confirmed: input.confirmed === true,
      });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/opening/confirm-fields" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      confirmOpeningFields(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        paths: input.paths,
        confirmed: input.confirmed === true,
      });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/opening/confirm-participant" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      confirmOpeningParticipant(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        participantId: input.participantId,
        confirmed: input.confirmed === true,
      });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/opening/participant-attendance" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024);
      setOpeningParticipantAttendance(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        participantId: input.participantId,
        attendance: input.attendance,
        why: input.why,
      });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/opening/field-correction" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      appendFieldCorrection(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        allowed: EDITABLE_PATHS,
        path: input.path,
        to: input.to,
        why: input.why,
      });
      return json(
        res,
        200,
        getOpeningProjection(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/transcript/rendered?") &&
      req.method === "GET"
    ) {
      // What the Workspace reads: the projection joined to its evidence, carrying transcript
      // labels and addressable word spans. GET only -- nothing here writes, and the render is
      // recomputed on every read rather than stored, so it cannot drift from working.json.
      const url = new URL(req.url, "http://localhost"),
        depositionId = url.searchParams.get("depositionId");
      const store = { storageRoot: depositionStorageRoot };
      return json(
        res,
        200,
        renderTranscript({
          working: getWorkingTranscript(root, { depositionId, ...store }),
          evidence: readAsrEvidence(root, { depositionId, ...store }),
          speakerCandidates: getSpeakerCandidates(root, {
            depositionId,
            ...store,
          }).candidates,
          examinerIdentity: url.searchParams.get("examinerIdentity") || null,
          overlay: readReporterOverlay(root, { depositionId, ...store }),
          sourceAudio:
            readDepositionRecord(root, depositionId, store)?.audio ?? [],
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/transcript/print-model?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost"),
        depositionId = url.searchParams.get("depositionId");
      return json(
        res,
        200,
        getTranscriptPrintModel(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
          examinerIdentity: url.searchParams.get("examinerIdentity") || null,
        }),
        origin,
      );
    }
    // One resource, GET and POST, rather than a field-per-endpoint surface. The readiness
    // projection is computed server-side and returned with it: the browser displays readiness,
    // it does not decide it.
    if (
      req.url?.startsWith("/api/transcript/assembly?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        assemblyReadiness(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/transcript/assembly" && req.method === "POST") {
      const input = await body(req, 256 * 1024);
      try {
        const written = writeAssembly(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
          assembly: input.assembly,
          expectedRevision: input.expectedRevision,
          actor: input.actor,
        });
        return json(
          res,
          200,
          {
            ...written,
            ...assemblyReadiness(root, {
              depositionId: input.depositionId,
              storageRoot: depositionStorageRoot,
            }),
          },
          origin,
        );
      } catch (error) {
        // Both registers, from the server. 409 for a conflict because the caller's next move is
        // to reload and retry -- a different instruction from "fix these fields".
        if (error instanceof AssemblyConflictError)
          return json(
            res,
            409,
            {
              error: error.message,
              code: error.code,
              expectedRevision: error.expected,
              actualRevision: error.actual,
            },
            origin,
          );
        if (error instanceof AssemblyRefusedError)
          return json(
            res,
            400,
            {
              error: error.message,
              code: error.code,
              findings: error.findings,
            },
            origin,
          );
        throw error;
      }
    }
    if (
      req.url?.startsWith("/api/transcript/complete-document-model?") &&
      req.method === "GET"
    ) {
      const url = new URL(req.url, "http://localhost"),
        depositionId = url.searchParams.get("depositionId");
      return json(
        res,
        200,
        await getCompleteTranscriptModel(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
          examinerIdentity: url.searchParams.get("examinerIdentity") || null,
        }),
        origin,
      );
    }
    // documentKind is reported by whichever endpoint actually ran, read off the model that was
    // actually rendered. The Workspace used to name its output from its own cached record type,
    // which can be stale by the time the answer arrives -- the silent-fallback defect one layer
    // up. What the reporter is told a document is now comes from the side that made it.
    if (
      req.url === "/api/transcript/complete-document-docx" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024),
        model = await getCompleteTranscriptModel(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
          examinerIdentity: input.examinerIdentity || null,
        });
      return json(
        res,
        200,
        {
          ...createTranscriptDocxArtifact(root, {
            depositionId: input.depositionId,
            printModel: model,
            storageRoot: depositionStorageRoot,
          }),
          documentKind: documentKindOf(model),
        },
        origin,
      );
    }
    if (
      req.url === "/api/transcript/complete-document-pdf" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024),
        model = await getCompleteTranscriptModel(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
          examinerIdentity: input.examinerIdentity || null,
        });
      const artifact = createTranscriptPdfArtifact(root, {
        depositionId: input.depositionId,
        printModel: model,
        storageRoot: depositionStorageRoot,
      });
      return json(
        res,
        200,
        {
          ...artifact,
          documentKind: documentKindOf(model),
          downloadUrl: `/api/transcript/complete-document-pdf?depositionId=${encodeURIComponent(input.depositionId)}`,
        },
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/transcript/complete-document-pdf?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      const file = path.join(
        depositionDirectory(root, depositionId, {
          storageRoot: depositionStorageRoot,
        }),
        "transcript",
        "complete-transcript.pdf",
      );
      if (!fs.existsSync(file))
        throw new Error(
          "Generate the complete transcript PDF before downloading it.",
        );
      return sendMedia(req, res, file, {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=complete-transcript.pdf",
        "access-control-allow-origin": origin,
        vary: "Origin",
        "cache-control": "no-store",
      });
    }
    if (
      req.url === "/api/transcript/final-document-docx" &&
      req.method === "POST"
    ) {
      const input = await body(req, 64 * 1024),
        printModel = getTranscriptPrintModel(root, {
          depositionId: input.depositionId,
          storageRoot: depositionStorageRoot,
          examinerIdentity: input.examinerIdentity || null,
        });
      return json(
        res,
        200,
        {
          ...createTranscriptDocxArtifact(root, {
            depositionId: input.depositionId,
            printModel,
            storageRoot: depositionStorageRoot,
          }),
          documentKind: documentKindOf(printModel),
        },
        origin,
      );
    }
    // The only two write paths for reporter edits. Deliberately not an editable operation list:
    // append and undo are enough to work, and every additional verb is another way for the
    // record of what a reporter did to stop matching what they did.
    if (req.url === "/api/transcript/overlay" && req.method === "POST") {
      const input = await body(req, 1024 * 1024);
      const overlay = appendReporterOperations(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        operations: input.operations ?? input.operation,
        expectedReviewStateHash: input.expectedReviewStateHash ?? null,
      });
      return json(res, 200, { overlay }, origin);
    }
    if (req.url === "/api/transcript/overlay/undo" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const { overlay, removed } = undoReporterOperation(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        expectedReviewStateHash: input.expectedReviewStateHash ?? null,
      });
      return json(res, 200, { overlay, removed }, origin);
    }
    if (req.url === "/api/transcript/overlay/redo" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const { overlay, restored } = redoReporterOperation(root, {
        depositionId: input.depositionId,
        storageRoot: depositionStorageRoot,
        expectedReviewStateHash: input.expectedReviewStateHash ?? null,
      });
      return json(res, 200, { overlay, restored }, origin);
    }
    // Counsel only. The one write the canonical record has outside intake, and it stays narrow
    // on purpose: without it the Label panel offers no attorneys on any deposition whose Notice
    // extraction missed them, and the alternative is editing the record by hand.
    // The certificate facts only a reporter can supply. They go to the canonical record rather
    // than into the render request, so they arrive carrying REPORTER_ENTERED provenance instead of
    // as bare values on an operator payload nothing validates.
    // The court and the deposition method, which nothing could set after intake. The route is
    // deliberately as narrow as the certification one beside it: a closed field list, refused by
    // name, so it cannot become a general canonical-record patch endpoint by accident.
    if (req.url === "/api/deposition/proceeding" && req.method === "POST") {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        writeDepositionProceeding(root, {
          depositionId: input.depositionId,
          proceeding: input.proceeding,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // The screen must be able to see what it is about to overwrite.
    if (
      req.url?.startsWith("/api/deposition/certification?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        readDepositionCertification(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/deposition/certification" && req.method === "POST") {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        writeDepositionCertification(root, {
          depositionId: input.depositionId,
          certification: input.certification,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/deposition/certificate-workflow?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        readDepositionCertificateWorkflow(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url === "/api/deposition/certificate-workflow" &&
      req.method === "POST"
    ) {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        writeDepositionCertificateWorkflow(root, {
          depositionId: input.depositionId,
          workflow: input.workflow,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // The time each party used, which the certificate states by name and nothing could record.
    // Same shape as the certification pair above and for the same reason: the screen has to be
    // able to see the list before it replaces it.
    if (
      req.url?.startsWith("/api/deposition/attorney-time?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        readDepositionAttorneyTime(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/deposition/attorney-time" && req.method === "POST") {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        writeDepositionAttorneyTime(root, {
          depositionId: input.depositionId,
          attorneyTime: input.attorneyTime,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/deposition/videographers?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        readDepositionVideographers(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/deposition/videographers" && req.method === "POST") {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        writeDepositionVideographers(root, {
          depositionId: input.depositionId,
          videographers: input.videographers,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    // GET beside the POST: the screen that chooses an examining attorney needs the same canonical
    // ids the assembly stores, and there was no way to ask for them.
    // The caption's parties. Same pair, same reason as counsel below: a deposition whose Notice
    // extraction produced no parties had a certified caption with nothing under PLAINTIFF or
    // DEFENDANT, and no screen anywhere that could put a name there. Manual intake collects them
    // when a deposition is created; nothing could record them afterwards.
    if (
      req.url?.startsWith("/api/deposition/parties?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        readDepositionParties(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/deposition/parties" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      return json(
        res,
        200,
        writeDepositionParties(root, {
          depositionId: input.depositionId,
          parties: input.parties,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/deposition/counsel?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        readDepositionCounsel(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/deposition/counsel" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const written = writeDepositionCounsel(root, {
        depositionId: input.depositionId,
        counsel: input.counsel,
        storageRoot: depositionStorageRoot,
      });
      // The candidate list is returned with it so the caller never has to guess whether the
      // roster it is about to label against reflects what was just saved.
      return json(
        res,
        200,
        {
          ...written,
          candidates: getSpeakerCandidates(root, {
            depositionId: input.depositionId,
            storageRoot: depositionStorageRoot,
          }).candidates,
        },
        origin,
      );
    }
    if (req.url === "/api/deposition/honorific" && req.method === "POST") {
      const input = await body(req, 16 * 1024);
      return json(
        res,
        200,
        writeParticipantHonorific(root, {
          depositionId: input.depositionId,
          participantId: input.participantId,
          honorific: input.honorific ?? null,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (
      req.url?.startsWith("/api/transcript/speaker-candidates?") &&
      req.method === "GET"
    ) {
      const depositionId = new URL(
        req.url,
        "http://localhost",
      ).searchParams.get("depositionId");
      return json(
        res,
        200,
        getSpeakerCandidates(root, {
          depositionId,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/transcript/speaker-map" && req.method === "POST") {
      const input = await body(req, 256 * 1024);
      return json(
        res,
        200,
        reconcileDepositionSpeakers(root, {
          depositionId: input.depositionId,
          assignments: input.assignments,
          storageRoot: depositionStorageRoot,
        }),
        origin,
      );
    }
    if (req.url === "/api/transcript/compare" && req.method === "POST") {
      const input = await body(req, 10 * 1024 * 1024);
      const audit = readAudioAudit(root, input.uploadId);
      const source = input.source || audit.selectedSource;
      const stored = input.hypothesis
        ? null
        : await readStoredTranscript(root, audit, source);
      const hypothesis = input.hypothesis || stored?.transcript || "";
      // Term groups are resolved here from the named set plus this deposition's own UFM
      // registry and intake keyterms. Any groups in the request body are ignored on purpose:
      // a client able to narrow them is a client able to weaken the selection gate.
      let resolved = null,
        termGroupError = null;
      try {
        const intake = input.depositionId
          ? readDepositionIntake(root, input.depositionId, {
              storageRoot: depositionStorageRoot,
            })
          : null;
        const masterTerms = intake?.masterData?.terminology || [];
        resolved = buildTermGroups(input.termGroupSetId, {
          ufmEntries: masterTerms.map((term) => ({
            canonical: term.canonical,
            category: term.category,
          })),
          keyterms: intake?.masterData
            ? projectDeepgramKeyterms(intake.masterData).wire
            : intake?.keyterms || [],
        });
      } catch (error) {
        termGroupError = error instanceof Error ? error.message : String(error);
      }
      const comparison = {
        source,
        derivativeOperationId:
          source === "processed"
            ? input.derivativeOperationId ||
              audit.transcripts?.processed?.derivativeOperationId ||
              null
            : null,
        termGroupSetId: resolved?.termGroupSetId ?? null,
        termGroupSetVersion: resolved?.termGroupSetVersion ?? null,
        termGroupError,
        ...compareTranscripts(
          input.reference,
          hypothesis,
          input.criticalTerms || [],
          resolved?.groups || {},
        ),
      };
      await recordComparison(root, audit, comparison);
      return json(res, 200, comparison, origin);
    }
    if (req.url === "/api/audio/select-asr-source" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const result = await selectAsrSource(root, input.uploadId, {
        referenceSha256: input.referenceSha256 || null,
      });
      return json(
        res,
        200,
        {
          status: result.status,
          selection: result.selection,
          audit: publicAudit(result.audit),
        },
        origin,
      );
    }
    if (req.url?.startsWith("/api/audio/audit?") && req.method === "GET") {
      const uploadId = new URL(req.url, "http://localhost").searchParams.get(
          "uploadId",
        ),
        audit = readAudioAudit(root, uploadId),
        result = publicAudit(audit),
        source = audit.selectedSource,
        transcript = await readStoredTranscript(root, audit, source);
      if (transcript)
        result.transcripts[source] = {
          ...transcript,
          ...audit.transcripts[source],
        };
      return json(res, 200, result, origin);
    }
    if (req.url?.startsWith("/api/audio/transcript?") && req.method === "GET") {
      const url = new URL(req.url, "http://localhost"),
        audit = readAudioAudit(root, url.searchParams.get("uploadId")),
        source = url.searchParams.get("source") || audit.selectedSource;
      const transcript = await readStoredTranscript(root, audit, source);
      return transcript
        ? json(res, 200, transcript, origin)
        : json(res, 404, { error: "Transcript was not found." }, origin);
    }
    if (req.url === "/api/admin/status" && req.method === "GET") {
      const config = loadSecrets();
      return json(
        res,
        200,
        {
          initialized: !!config?.adminHash,
          anthropicConfigured: !!config?.anthropicApiKey,
          deepgramConfigured: !!config?.deepgramApiKey,
        },
        origin,
      );
    }
    if (req.url === "/api/admin/secrets" && req.method === "POST") {
      const input = await body(req, 64 * 1024);
      const current = loadSecrets();
      if (current && !validCode(input.adminCode, current))
        return json(
          res,
          401,
          { error: "The administrator access code is incorrect." },
          origin,
        );
      if (!current && (!input.adminCode || input.adminCode.length < 8))
        return json(
          res,
          400,
          {
            error:
              "Create an administrator access code with at least 8 characters.",
          },
          origin,
        );
      const derived = current
        ? { salt: current.adminSalt, hash: current.adminHash }
        : hashCode(input.adminCode);
      saveSecrets({
        adminSalt: derived.salt,
        adminHash: derived.hash,
        anthropicApiKey:
          input.anthropicApiKey || current?.anthropicApiKey || "",
        deepgramApiKey: input.deepgramApiKey || current?.deepgramApiKey || "",
        claudeModel:
          input.claudeModel || current?.claudeModel || "claude-opus-5",
      });
      return json(res, 200, { ok: true }, origin);
    }
    if (req.url === "/api/claude/extract-notice" && req.method === "POST") {
      const config = loadSecrets();
      if (!config?.anthropicApiKey)
        return json(
          res,
          503,
          {
            error: "Add the Anthropic API key in Administrator Settings first.",
          },
          origin,
        );
      const input = await body(req);
      const document = contentBlock(input.file);
      const supportingDocuments = (input.supportingFiles || [])
        .slice(0, 10)
        .map((file, index) => [
          {
            type: "text",
            text: `Supporting document ${index + 1}: ${file.name}. Use this only to confirm spellings, proper names, firms, locations, and specialized terminology. Do not override conflicting deposition facts from the Notice.`,
          },
          contentBlock(file),
        ])
        .flat();
      const tool = extractionTool;
      // Effort controls are optional and model-specific. The configured model is administrator
      // selectable, so attaching one unconditionally makes an otherwise valid model reject the
      // entire extraction request. Use the model's supported default unless compatibility has
      // been established for that exact model and API version.
      const response = await fetchExternal(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: config.claudeModel,
            max_tokens: 8192,
            system:
              terminologyPrompt +
              "\n\nCompatibility requirement: In the same extraction, populate the setup object for the Depo-Pro setup screen. The Notice controls setup facts when sources conflict.",
            tools: [tool],
            tool_choice: { type: "tool", name: "extract_deposition_intake" },
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "The first document is the authoritative Notice of Deposition. Supporting documents follow.",
                  },
                  document,
                  ...supportingDocuments,
                ],
              },
            ],
          }),
        },
        {
          label: "Claude document analysis",
          attempts: 2,
          timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS) || 5 * 60 * 1000,
        },
      );
      const result = await response.json();
      if (!response.ok)
        return json(
          res,
          response.status,
          { error: result?.error?.message || "Claude request failed." },
          origin,
        );
      const toolUse = result.content?.find(
        (item) =>
          item.type === "tool_use" && item.name === "extract_deposition_intake",
      );
      if (!toolUse)
        throw new Error("Claude did not return structured intake data.");
      const data = toolUse.input;
      if (!data || typeof data !== "object")
        throw new Error("Claude returned an invalid structured intake object.");
      data.setup ??= {};
      data.deepgram_keyterms ??= { terms: [] };
      data.ufm_registry ??= { entries: [] };
      data.extraction_report ??= { low_confidence_spellings: [] };
      data.setup.warnings = Array.isArray(data.setup.warnings)
        ? data.setup.warnings
        : [];
      data.deepgram_keyterms.terms = Array.isArray(data.deepgram_keyterms.terms)
        ? data.deepgram_keyterms.terms
        : [];
      data.ufm_registry.entries = Array.isArray(data.ufm_registry.entries)
        ? data.ufm_registry.entries
        : [];
      data.extraction_report.low_confidence_spellings = Array.isArray(
        data.extraction_report.low_confidence_spellings,
      )
        ? data.extraction_report.low_confidence_spellings
        : [];
      const seen = new Set();
      data.deepgram_keyterms.terms = (data.deepgram_keyterms.terms || [])
        .filter((item) => {
          const term = String(item.term || "").trim();
          const key = term.toLowerCase();
          if (!term || seen.has(key)) return false;
          seen.add(key);
          item.term = term;
          return true;
        })
        .slice(0, KEYTERM_PRODUCT_CAP);
      const wire = data.deepgram_keyterms.terms.map((item) => item.term);
      const estimatedTokens = estimateKeytermTokens(wire);
      data.deepgram_keyterms.wire = wire;
      data.deepgram_keyterms.term_count = wire.length;
      data.deepgram_keyterms.estimated_tokens = estimatedTokens;
      data.deepgram_keyterms.budget = {
        token_ceiling: 500,
        working_target: KEYTERM_TOKEN_BUDGET,
        quality_target_range: [20, KEYTERM_PRODUCT_CAP],
        product_cap: KEYTERM_PRODUCT_CAP,
      };
      data.ufm_registry.entry_count = (data.ufm_registry.entries || []).length;
      // One extraction authority. Deepgram and UFM are projections of this record, not sibling
      // files that can disagree with the deposition setup or with each other.
      const masterData = masterDataFromExtraction(data, {
        sourceDocument: input.file?.name ?? null,
      });
      const deepgramArtifact = projectDeepgramKeyterms(masterData);
      const ufmProjection = projectTexasFreelanceUfm(masterData);
      // ufmData remains response-only during the UI migration. New intake persistence stores
      // masterData and derives this projection when needed; it is not a second authority.
      const ufmData = {
        ...ufmProjection.fields,
        caption: data.caption,
        logistics: data.logistics,
        anomalies: data.anomalies,
        extraction_report: data.extraction_report,
      };
      const anomalyWarnings = (data.anomalies || []).map(
        (item) =>
          `Review flag: ${item.detail || item.type || "Document anomaly"}${item.action ? ` — ${item.action}` : ""}`,
      );
      return json(
        res,
        200,
        {
          ...data.setup,
          keyterms: deepgramArtifact.wire,
          masterData,
          deepgramArtifact,
          ufmData,
          warnings: [
            ...(data.setup.warnings || []),
            ...(data.extraction_report.low_confidence_spellings || []).map(
              (term) => `Low-confidence spelling: ${term}`,
            ),
            ...anomalyWarnings,
          ],
          confidence: data.setup.confidence,
        },
        origin,
      );
    }
    if (req.url === "/api/admin/test-keys" && req.method === "POST") {
      const config = loadSecrets();
      const results = {
        anthropic: { ok: false, message: "Not configured" },
        deepgram: { ok: false, message: "Not configured" },
      };
      if (config?.anthropicApiKey) {
        try {
          const response = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": config.anthropicApiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: config.claudeModel,
                max_tokens: 8,
                messages: [{ role: "user", content: "Reply OK" }],
              }),
            },
          );
          const payload = await response.json();
          results.anthropic = response.ok
            ? {
                ok: true,
                message: `Authenticated successfully with ${config.claudeModel}.`,
              }
            : {
                ok: false,
                message:
                  payload?.error?.message ||
                  `Anthropic returned HTTP ${response.status}.`,
              };
        } catch (error) {
          results.anthropic = {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "Anthropic connection failed.",
          };
        }
      }
      if (config?.deepgramApiKey) {
        try {
          const response = await fetch(
            "https://api.deepgram.com/v1/auth/token",
            { headers: { Authorization: `Token ${config.deepgramApiKey}` } },
          );
          const payload = await response.json();
          results.deepgram = response.ok
            ? { ok: true, message: "Authenticated successfully." }
            : {
                ok: false,
                message:
                  payload?.err_msg ||
                  payload?.message ||
                  `Deepgram returned HTTP ${response.status}.`,
              };
        } catch (error) {
          results.deepgram = {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "Deepgram connection failed.",
          };
        }
      }
      return json(res, 200, results, origin);
    }
    return json(res, 404, { error: "Not found." }, origin);
  } catch (error) {
    if (error?.code === "WORKING_TRANSCRIPT_NOT_CREATED")
      return json(res, 404, { error: error.message, code: error.code }, origin);
    // A refused stale mutation is a conflict, not a server fault. Falling through to the
    // generic handler below reported it as a 500 -- which tells the reporter the application
    // broke, when in fact it protected their transcript.
    if (error?.code === STALE_REPORTER_TRANSACTION)
      return json(
        res,
        409,
        {
          error: error.message,
          code: error.code,
          expected: error.expected,
          carried: error.carried,
        },
        origin,
      );
    if (error?.code === STALE_CORRECTION_PROPOSAL)
      return json(
        res,
        409,
        {
          error: error.message,
          code: error.code,
          reason: error.reason ?? null,
          expected: error.expected ?? null,
          carried: error.carried ?? null,
        },
        origin,
      );
    // A proposal the server will not apply is a refusal with a cause, not a fault. Reported as 422
    // so the reporter is told WHY rather than being shown a generic failure.
    if (error?.code === RANGE_ACCEPTANCE_REFUSED)
      return json(
        res,
        422,
        {
          error: error.message,
          code: error.code,
          reason: error.reason ?? null,
        },
        origin,
      );
    const message =
        error instanceof Error
          ? error.message
          : "Unexpected local service error.",
      status =
        error instanceof DeepgramRequestError
          ? 502
          : /already processing|integrity verification failed/i.test(message)
            ? 409
            : /not found/i.test(message)
              ? 404
              : /required|requires|exceeds|invalid|missing|does not|failed SHA-256|not part of/i.test(
                    message,
                  )
                ? 400
                : 500,
      code =
        error instanceof RxProcessingError
          ? error.code
          : error instanceof DeepgramRequestError
            ? error.code || "DEEPGRAM_ERROR"
            : status === 409
              ? "TRANSCRIPTION_CONFLICT"
              : status === 400
                ? "TRANSCRIPTION_VALIDATION"
                : "LOCAL_API_ERROR";
    return json(res, status, { error: message, code }, origin);
  }
});
// Binding a port is a side effect of RUNNING this file, not of reading a value out of it.
//
// Until this guard existed, `import`ing this module started a listener. That is why every test
// that needed to know something about these routes read the file as TEXT with readFileSync and
// asserted on source strings -- eight of them do, and one says so in a comment. Source pinning is
// a poor instrument: it proves a literal is present, not that the route behaves. Checkpoint 2
// adds the assembly write path here, and the write path for document-assembly authority is the
// last thing that should be checked by grepping for its own name.
//
// `export`s above are now safe to import. The server starts only when this file is the process
// entry point, which is how scripts/dev.mjs spawns it.
export { server };
const isEntryPoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint)
  server.listen(port, "127.0.0.1", () =>
    console.log(`Depo Pro local API ready at http://127.0.0.1:${port}`),
  );
