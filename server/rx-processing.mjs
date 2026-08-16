import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectRx } from "./rx-adapter.mjs";
import { resolveAudioToolChain } from "./rx-profiles.mjs";
import { measureAudioQuality } from "./audio-pipeline.mjs";
import { compareRxMeasurements } from "./rx-delta.mjs";
import { CANONICAL_ASR_PCM_BITS, DERIVATIVE_KINDS } from "./audio-kinds.mjs";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PYTHON = process.env.DEPO_PRO_RX_PYTHON || path.join(MODULE_DIRECTORY, "..", ".venv-pedalboard", "Scripts", "python.exe");
const DEFAULT_WORKER = path.join(MODULE_DIRECTORY, "rx-pedalboard-worker.py");
const DEFAULT_PLUGIN_ROOT = "C:\\Program Files\\Common Files\\VST3\\iZotope";
// Must match DEFAULT_CHUNK_SECONDS in rx-pedalboard-worker.py. Recorded per render, because
// a plug-in whose output varies with chunk size is not reproducible from the profile alone.
export const DEFAULT_CHUNK_SECONDS = 10;

export class RxProcessingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "RxProcessingError";
    this.code = code;
    Object.assign(this, details);
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function runProcess(command, args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    let outputBytes = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", chunk => { outputBytes += chunk.length; if (outputBytes <= 1024 * 1024) stdout.push(chunk); });
    child.stderr.on("data", chunk => { outputBytes += chunk.length; if (outputBytes <= 1024 * 1024) stderr.push(chunk); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (timedOut) reject(new RxProcessingError("RX processing exceeded the 30-minute limit.", "RX_TIMEOUT"));
      else if (code !== 0) reject(new Error(errorText || `${path.basename(command)} failed with exit code ${code}.`));
      else resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}

async function validateReadableAudio(file, runner = runProcess) {
  const text = await runner("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,sample_rate,channels,duration_ts,time_base,bits_per_raw_sample,bits_per_sample", "-of", "json", file], 60_000);
  const probe = JSON.parse(text);
  const stream = probe.streams?.find(item => item.codec_type === "audio");
  const durationSeconds = Number(probe.format?.duration || 0);
  if (!stream || durationSeconds <= 0) throw new Error("Audio is not readable.");
  const sampleRate = Number(stream.sample_rate);
  const durationTicks = Number(stream.duration_ts);
  const [timeNumerator, timeDenominator] = String(stream.time_base || "").split("/").map(Number);
  const sampleFrames = Number.isFinite(durationTicks) && timeNumerator > 0 && timeDenominator > 0
    ? Math.round(durationTicks * timeNumerator * sampleRate / timeDenominator)
    : Math.round(durationSeconds * sampleRate);
  // M-6: a lossy source has no meaningful PCM bit depth and reports 0 here, which is
  // recorded as null rather than as a depth of zero.
  const declaredBits = Number(stream.bits_per_raw_sample || stream.bits_per_sample || 0);
  const bitDepth = Number.isFinite(declaredBits) && declaredBits > 0 ? declaredBits : null;
  return { durationSeconds, sampleRate, channels: Number(stream.channels), sampleFrames, bitDepth };
}

/**
 * M-5. When the upload needs decoding, every alignment assertion downstream compares against
 * the decoded intermediate, so the chain proves RX did not change the length of the decoded
 * file -- not that the decoded file matches what was uploaded. Encoder delay and padding in
 * AAC and MP3 routinely shift frame counts through a decode, and most deposition recorders
 * write compressed formats, so this is the common path rather than an edge case.
 *
 * A frame delta is expected and is recorded rather than rejected. A changed sample rate or
 * channel count is not: those break the timeline claim materially, so they fail closed.
 */
export function compareDecodeGeometry(uploaded, decoded) {
  if (uploaded.sampleRate !== decoded.sampleRate) throw new RxProcessingError("Decoding changed the audio sample rate, so the derivative timeline cannot be tied to the upload.", "RX_DECODE_GEOMETRY_VIOLATION", { uploadedSampleRate:uploaded.sampleRate, decodedSampleRate:decoded.sampleRate });
  if (uploaded.channels !== decoded.channels) throw new RxProcessingError("Decoding changed the audio channel count, so the derivative timeline cannot be tied to the upload.", "RX_DECODE_GEOMETRY_VIOLATION", { uploadedChannels:uploaded.channels, decodedChannels:decoded.channels });
  const decodeFrameDelta = decoded.sampleFrames - uploaded.sampleFrames;
  return {
    decodeFrameDelta,
    decodeDurationDeltaSeconds: decoded.durationSeconds - uploaded.durationSeconds,
    uploadedTimelinePreserved: decodeFrameDelta === 0,
    reason: decodeFrameDelta === 0 ? null : "Encoder delay or padding in the compressed upload changed the frame count through decoding. The derivative is frame-aligned with the decoded intermediate; this delta records its offset from the upload.",
  };
}

function assertSampleAligned(source, derivative, workerFrames) {
  for (const [label, media] of [["source", source], ["derivative", derivative]]) {
    if (!Number.isInteger(media?.sampleFrames) || media.sampleFrames <= 0 || !Number.isInteger(media?.sampleRate) || media.sampleRate <= 0 || !Number.isInteger(media?.channels) || media.channels <= 0 || !Number.isFinite(media?.durationSeconds) || media.durationSeconds <= 0) {
      throw new RxProcessingError(`RX ${label} media geometry is missing or invalid.`, "RX_ALIGNMENT_VIOLATION");
    }
  }
  if (!Number.isInteger(workerFrames) || workerFrames <= 0) throw new RxProcessingError("RX worker frame count is missing or invalid.", "RX_PROVENANCE_INCOMPLETE");
  if (source.sampleRate !== derivative.sampleRate) throw new RxProcessingError("RX derivative sample rate differs from the original.", "RX_ALIGNMENT_VIOLATION");
  if (source.channels !== derivative.channels) throw new RxProcessingError("RX derivative channel count differs from the original.", "RX_ALIGNMENT_VIOLATION");
  const frameDelta = Math.abs(source.sampleFrames - derivative.sampleFrames);
  const durationDelta = Math.abs(source.durationSeconds - derivative.durationSeconds);
  if (frameDelta > 1 || durationDelta > (1 / source.sampleRate)) {
    throw new RxProcessingError("RX derivative duration is not sample-aligned with the original.", "RX_ALIGNMENT_VIOLATION", { frameDelta, durationDelta });
  }
  if (Math.abs(source.sampleFrames - workerFrames) > 1) {
    throw new RxProcessingError("RX worker frame count differs from the original.", "RX_ALIGNMENT_VIOLATION");
  }
}

function assertWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("RX derivative path escaped or replaced its protected storage directory.");
}

function acquireLock(lockPath, operationId, timestamp, currentTimeMs, staleAfterMs) {
  let stale = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(descriptor, JSON.stringify({ operationId, startedAt: timestamp }));
      fs.fsyncSync(descriptor);
      return { descriptor, lockPath, stale };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing;
      try { existing = JSON.parse(fs.readFileSync(lockPath, "utf8")); }
      catch { throw new RxProcessingError("RX lock exists but cannot be validated; investigate before recovery.", "RX_LOCK_INVALID"); }
      const startedMs = Date.parse(existing.startedAt);
      if (!Number.isFinite(startedMs) || currentTimeMs - startedMs <= staleAfterMs) throw new RxProcessingError("RX processing is already active for this original.", "RX_OPERATION_CONFLICT");
      const stalePath = `${lockPath}.stale.${operationId}`;
      try { fs.renameSync(lockPath, stalePath); }
      catch (renameError) { if (renameError?.code === "ENOENT" || renameError?.code === "EEXIST") continue; throw renameError; }
      stale = { event: "rx-stale-lock-recovered", code: "RX_STALE_LOCK_RECOVERED", previousOperationId: existing.operationId, previousStartedAt: existing.startedAt, recoveredByOperationId: operationId, at: timestamp, stalePath };
    }
  }
  throw new RxProcessingError("RX lock contention could not be resolved.", "RX_OPERATION_CONFLICT");
}

async function recordViolation(recordAuditEvent, incident) {
  try { await recordAuditEvent(incident); }
  catch (cause) { throw new RxProcessingError("The integrity violation could not be durably recorded.", "RX_INTEGRITY_RECORD_FAILED", { incident, cause }); }
  throw new RxProcessingError("Immutable original integrity verification failed.", "RX_INTEGRITY_VIOLATION", { incident });
}

export async function createRxDerivative(root, audit, {
  originalPath,
  profileId = "rx12-voice-denoise-factory-adaptive-v1", profileIds,
  pythonExecutable = DEFAULT_PYTHON,
  workerPath = DEFAULT_WORKER,
  pluginPath,
  // Null means "take it from the profile". An explicit value overrides the pin, which is
  // what the qualification runner needs in order to measure chunk invariance at all.
  chunkSeconds = null,
  runWorker = runProcess,
  runDecoder = runProcess,
  runEncoder = runProcess,
  validateAudio = validateReadableAudio,
  measureQuality = measureAudioQuality,
  hashFile = sha256,
  recordAuditEvent,
  now = () => new Date().toISOString(),
  currentTimeMs = () => Date.now(),
  staleLockMs = 35 * 60 * 1000,
  randomId = () => crypto.randomUUID(),
  inspectRxStatus = inspectRx,
} = {}) {
  if (!audit?.storage?.original?.immutable || !audit.storage.original.sha256) throw new Error("RX processing requires a hashed immutable original.");
  if (typeof recordAuditEvent !== "function") throw new RxProcessingError("RX processing requires an audit-backed event recorder.", "RX_AUDIT_RECORDER_REQUIRED");
  if (!originalPath || !fs.existsSync(originalPath)) throw new Error("Immutable original audio is unavailable.");
  if (!/^audio-intake\/[a-f0-9-]+\/[a-z0-9._ -]+$/i.test(String(audit.storage.original.key || ""))) {
    throw new Error("RX processing requires the audited original storage key.");
  }
  const expectedOriginalPath = path.resolve(root, "data", audit.storage.original.key);
  if (path.resolve(originalPath) !== expectedOriginalPath) throw new Error("RX source path does not match the audited original.");

  const rx = inspectRxStatus({ includeExecutable:true });
  const profiles=resolveAudioToolChain(profileIds||[profileId]),rxProfiles=profiles.filter(item=>item.engine==="rx"),resolvedPluginPaths=rxProfiles.map((profile,index)=>index===0&&pluginPath?pluginPath:path.join(process.env.RX_VST3_ROOT || DEFAULT_PLUGIN_ROOT,profile.pluginFile));
  // RX availability gates RX modules, not the renderer. A chain containing no RX-engine
  // profile -- the high-pass filter is the only one today -- still renders through this same
  // Pedalboard host, and requiring the RX editor for it would be the reason a second
  // ffmpeg renderer existed in the first place.
  if (rxProfiles.length && (!rx.available || !rx.executable)) throw new Error(rx.fallback || "iZotope RX 12 is unavailable.");
  // A profile whose output depends on the render chunk size pins it, making it part of that
  // profile's identity rather than an implementation detail. Two pinned profiles in one
  // chain that disagree cannot both be honoured, so that fails closed rather than silently
  // rendering under one of them.
  const pinnedChunkSeconds = [...new Set(profiles.map(item => item.renderChunkSeconds).filter(Number.isFinite))];
  if (pinnedChunkSeconds.length > 1) throw new RxProcessingError("Chained profiles pin different render chunk sizes.", "RX_CHUNK_SIZE_CONFLICT", { pinnedChunkSeconds });
  const effectiveChunkSeconds = chunkSeconds ?? pinnedChunkSeconds[0] ?? DEFAULT_CHUNK_SECONDS;
  // Measured processing latency, compensated deterministically below.
  //
  // Frame parity cannot see this: the derivative is the same length as the source with its
  // content late inside it. Dialogue Isolate is 4096 frames, Repair Assistant 8159, both
  // constant across every search width tested -- which is what makes them compensable at all.
  //
  // A chain's total latency is NOT the sum of its parts as far as this code is concerned,
  // because that sum has never been measured. Two latency-declaring profiles in one chain
  // fails closed rather than compensating by an assumed figure.
  const latencyProfiles = profiles.filter(item => Number.isFinite(item.measuredLatencyFrames) && item.measuredLatencyFrames > 0);
  if (latencyProfiles.length > 1) throw new RxProcessingError("Chained profiles each declare processing latency, and the chain's combined latency has not been measured.", "RX_CHAIN_LATENCY_UNMEASURED", { profileIds:latencyProfiles.map(item => item.id) });
  const latencyFrames = latencyProfiles[0]?.measuredLatencyFrames ?? 0;
  for (const required of [pythonExecutable,workerPath,...resolvedPluginPaths]) if (!fs.existsSync(required)) throw new Error(`RX processing dependency is unavailable: ${path.basename(required)}`);
  const chainId=profiles.map(item=>item.id).join("+");
  const directory = path.dirname(path.resolve(originalPath));
  const operationId = randomId();
  const startedAt = now();
  const workRoot = path.join(path.resolve(root), "data", "rx-work");
  const lockDirectory = path.join(workRoot, "locks");
  const operationDirectory = path.join(workRoot, audit.uploadId, operationId);
  const finalPath = path.join(directory, `candidate.chain.${operationId}.flac`);
  const temporaryPath = path.join(operationDirectory, "derivative.partial.wav");
  const encodedPath = path.join(operationDirectory, "derivative.partial.flac");
  const processingSourcePath = path.join(operationDirectory, "processing-source.wav");
  const compensatedPath = path.join(operationDirectory, "derivative.compensated.wav");
  const profilePath = path.join(operationDirectory, "profile.json");
  const resultPath = path.join(operationDirectory, "result.json");
  assertWithin(finalPath, directory);
  assertWithin(temporaryPath, workRoot);
  assertWithin(encodedPath, workRoot);
  const key = path.relative(path.join(path.resolve(root), "data"), finalPath).replaceAll("\\", "/");
  if (!/^audio-intake\/[a-f0-9-]+\//i.test(key)) throw new RxProcessingError("RX derivative is outside audited audio storage.", "RX_STORAGE_PATH_INVALID");
  fs.mkdirSync(lockDirectory, { recursive: true });
  const lock = acquireLock(path.join(lockDirectory, `${audit.uploadId}.lock`), operationId, startedAt, currentTimeMs(), staleLockMs);
  let renamed = false;
  let staleRecorded = false;

  try {
    fs.mkdirSync(operationDirectory, { recursive: true });
    if (lock.stale) {
      await recordAuditEvent({ ...lock.stale, stalePath: undefined });
      staleRecorded = true;
    }
    if (fs.existsSync(finalPath) || fs.existsSync(temporaryPath)) throw new Error("RX derivative target already exists.");
    const beforeHash = await hashFile(originalPath);
    if (beforeHash !== audit.storage.original.sha256) {
      await recordViolation(recordAuditEvent, { event: "rx-integrity-violation", code: "SOURCE_HASH_MISMATCH_BEFORE_PROCESSING", operationId, at: now(), expectedSha256: audit.storage.original.sha256, observedSha256: beforeHash });
    }
    const uploadedSourceMedia = await validateAudio(originalPath);
    const needsDecode = ![".wav", ".wave"].includes(path.extname(originalPath).toLowerCase());
    let workerInputPath = originalPath;
    if (needsDecode) {
      await runDecoder("ffmpeg", ["-v", "error", "-nostdin", "-i", originalPath, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", processingSourcePath]);
      if (!fs.existsSync(processingSourcePath)) throw new Error("Audio decode reported success without producing PCM audio.");
      workerInputPath = processingSourcePath;
    }
    const sourceMedia = needsDecode ? await validateAudio(processingSourcePath) : uploadedSourceMedia;
    // M-5: assert the decoded intermediate against the upload it came from, and record the
    // offset. Without this the record claims a preserved timeline having only compared the
    // derivative to the intermediate.
    const decodeGeometry = needsDecode ? compareDecodeGeometry(uploadedSourceMedia, sourceMedia) : { decodeFrameDelta:0, decodeDurationDeltaSeconds:0, uploadedTimelinePreserved:true, reason:null };
    if (decodeGeometry.decodeFrameDelta !== 0) await recordAuditEvent({ event:"rx-decode-frame-delta", code:"DECODE_FRAME_DELTA", operationId, at:now(), decodeFrameDelta:decodeGeometry.decodeFrameDelta, uploadedSampleFrames:uploadedSourceMedia.sampleFrames, decodedSampleFrames:sourceMedia.sampleFrames, reason:decodeGeometry.reason });
    // M-6: the canonical derivative is 16-bit. A 24-bit source loses eight bits of depth, so
    // the record states the source depth and that precision was reduced rather than leaving
    // it to be inferred from a code comment.
    const sourceBitDepth = uploadedSourceMedia.bitDepth ?? null;
    const precisionReduced = Number.isFinite(sourceBitDepth) && sourceBitDepth > CANONICAL_ASR_PCM_BITS;
    fs.writeFileSync(profilePath, JSON.stringify(profiles), { flag: "wx" });
    await runWorker(pythonExecutable, [workerPath, "--input", workerInputPath, "--output", temporaryPath,...resolvedPluginPaths.flatMap(value=>["--plugin",value]), "--profile", profilePath, "--result", resultPath, "--chunk-seconds", String(effectiveChunkSeconds)]);
    if (!fs.existsSync(temporaryPath)) throw new Error("RX worker reported success without producing output.");
    // Shift the rendered audio back by the profile's measured latency: drop the leading
    // `latencyFrames` samples the plug-in produced before the signal arrived, and pad the
    // tail so the total frame count is unchanged and the derivative stays frame-aligned.
    // whole_len pins the output length exactly rather than letting apad guess.
    let latencyCompensation = null;
    if (latencyFrames > 0) {
      await runEncoder("ffmpeg", ["-v","error","-nostdin","-i",temporaryPath,"-map","0:a:0","-vn","-af",`atrim=start_sample=${latencyFrames},asetpts=N/SR/TB,apad=whole_len=${sourceMedia.sampleFrames}`,"-c:a","pcm_s16le",compensatedPath], 30 * 60 * 1000);
      if (!fs.existsSync(compensatedPath)) throw new RxProcessingError("Latency compensation reported success without producing audio.", "RX_LATENCY_COMPENSATION_FAILED", { latencyFrames });
      fs.rmSync(temporaryPath, { force:true });
      fs.renameSync(compensatedPath, temporaryPath);
      latencyCompensation = { frames:latencyFrames, seconds:latencyFrames / sourceMedia.sampleRate, method:"trim-head-pad-tail", profileId:latencyProfiles[0].id, note:"The plug-in delays its output by a constant measured offset. The derivative is shifted back by that offset and the tail padded to preserve the frame count, so timestamps derived from it match the original timeline." };
      await recordAuditEvent({ event:"rx-latency-compensated", code:"LATENCY_COMPENSATED", operationId, at:now(), ...latencyCompensation });
    }
    if (!fs.existsSync(resultPath)) throw new Error("RX worker reported success without a result record.");
    let worker;
    try { worker = JSON.parse(fs.readFileSync(resultPath, "utf8")); }
    catch (cause) { throw new RxProcessingError("RX worker result is invalid JSON.", "RX_PROVENANCE_INCOMPLETE", { cause }); }
    const modules=worker.modules||[worker];if(modules.length!==profiles.length||modules.some((item,index)=>item.profileId!==profiles[index].id||item.profileVersion!==profiles[index].version))throw new RxProcessingError("RX worker chain identity does not match the requested profiles.","RX_PROVENANCE_INCOMPLETE");
    for(let index=0;index<profiles.length;index++){const requested=profiles[index],actual=modules[index];if(requested.engine==="rx"&&(actual.manufacturer!=="iZotope"||actual.plugin!==requested.expectedPlugin||String(actual.pluginVersion).split(".",1)[0]!=="12"))throw new RxProcessingError("RX worker did not report a valid plug-in identity.","RX_PROVENANCE_INCOMPLETE")}
    if (!Number.isInteger(worker.sourceFrames) || !Number.isInteger(worker.framesProcessed) || worker.sourceFrames <= 0 || worker.framesProcessed !== worker.sourceFrames) throw new RxProcessingError("RX worker did not prove exact frame parity.", "RX_PROVENANCE_INCOMPLETE");
    const workerMedia = await validateAudio(temporaryPath);
    assertSampleAligned(sourceMedia, workerMedia, worker.framesProcessed);
    const measurementsBefore = await measureQuality(originalPath);
    const provenanceTags={DEPO_PRO_UPLOAD_ID:audit.uploadId,DEPO_PRO_OPERATION_ID:operationId,DEPO_PRO_SOURCE_SHA256:beforeHash,DEPO_PRO_PROFILE_ID:chainId,DEPO_PRO_PROFILE_VERSION:profiles.map(item=>item.version).join("+"),DEPO_PRO_TIMELINE_POLICY:"frame-aligned-no-cuts"};
    const metadataArguments=Object.entries(provenanceTags).flatMap(([name,value])=>["-metadata",`${name}=${value}`]);
    await runEncoder("ffmpeg", ["-v", "error", "-nostdin", "-i", temporaryPath, "-map", "0:a:0", "-vn", "-c:a", "flac", "-sample_fmt", "s16", ...metadataArguments, encodedPath], 30 * 60 * 1000);
    if (!fs.existsSync(encodedPath)) throw new Error("Lossless FLAC encoding reported success without producing output.");
    const media = await validateAudio(encodedPath);
    assertSampleAligned(sourceMedia, media, worker.framesProcessed);
    const measurementsAfter = await measureQuality(encodedPath);
    const measurementDelta = compareRxMeasurements(measurementsBefore, measurementsAfter);
    const afterHash = await hashFile(originalPath);
    if (afterHash !== beforeHash) {
      await recordViolation(recordAuditEvent, { event: "rx-integrity-violation", code: "SOURCE_CHANGED_DURING_PROCESSING", operationId, at: now(), expectedSha256: beforeHash, observedSha256: afterHash });
    }
    const derivativeHash = await hashFile(encodedPath);
    fs.renameSync(encodedPath, finalPath);
    renamed = true;
    return {
      key, operationId, bytes: fs.statSync(finalPath).size, sha256: derivativeHash, sourceSha256: beforeHash, sourceImmutable: true,
      kind:profiles.every(item=>item.asrSafe)?DERIVATIVE_KINDS.RX_ASR:DERIVATIVE_KINDS.RX_REVIEW, sourcePcmPrecision:needsDecode?"decoded to signed 16-bit PCM":"source WAV decoded by Pedalboard", processingPrecision:"32-bit floating point", outputPcmPrecision:`signed ${CANONICAL_ASR_PCM_BITS}-bit PCM`, sourceBitDepth,precisionReduced,precisionReductionNote:precisionReduced?`The source is ${sourceBitDepth}-bit; the canonical derivative is ${CANONICAL_ASR_PCM_BITS}-bit, so sample depth was reduced.`:null,decodeFrameDelta:decodeGeometry.decodeFrameDelta,decodeDurationDeltaSeconds:decodeGeometry.decodeDurationDeltaSeconds,uploadedTimelinePreserved:decodeGeometry.uploadedTimelinePreserved,uploadedTimelineNote:decodeGeometry.reason,sampleAligned:true,measuredLatencyFrames:latencyFrames||null,latencyCompensation,timelinePreserved:latencyFrames===0||Boolean(latencyCompensation),timelinePolicy:latencyCompensation?"frame-aligned-latency-compensated":"frame-aligned-no-cuts",selectableForTranscription:profiles.every(item=>item.asrSafe),provenanceTags,sourceMedia,uploadedSourceMedia,processingInput:needsDecode?{decodedToPcm:true,decoder:"ffmpeg",encoding:"pcm_s16le"}:{decodedToPcm:false},processingRenderEncoding:worker.outputEncoding,outputEncoding:{container:"flac",sampleFormat:"s16",bitDepth:16,lossless:true},measurementsBefore,measurementsAfter,measurementDelta,tool:"iZotope RX chain via Spotify Pedalboard",toolVersion:worker.workerVersion,
      manufacturer:"iZotope / Spotify",product:"RX 12 audio tool chain",edition:"Standard",module:profiles.map(item=>item.displayName).join(" → "),profileIds:profiles.map(item=>item.id),profileVersions:profiles.map(item=>item.version),modules,host:worker.worker,hostVersion:worker.workerVersion,numpyVersion:worker.numpyVersion??null,renderChunkSeconds:worker.chunkSeconds??null,renderChunkFrames:worker.chunkFrames??null,profileId:profiles.length===1?profiles[0].id:chainId,profileVersion:profiles.length===1?profiles[0].version:"chain-v1",createdAt:now(),media,
    };
  } catch (error) {
    if (renamed && fs.existsSync(finalPath)) fs.rmSync(finalPath, { force: true });
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    if (fs.existsSync(encodedPath)) fs.rmSync(encodedPath, { force: true });
    if (error instanceof RxProcessingError) throw error;
    throw new RxProcessingError(error instanceof Error ? error.message : "RX processing failed.", "RX_PROCESSING_FAILED", { cause: error });
  } finally {
    if (fs.existsSync(profilePath)) fs.rmSync(profilePath, { force: true });
    if (fs.existsSync(resultPath)) fs.rmSync(resultPath, { force: true });
    if (fs.existsSync(operationDirectory)) fs.rmSync(operationDirectory, { recursive: true, force: true });
    fs.closeSync(lock.descriptor);
    if (fs.existsSync(lock.lockPath)) fs.rmSync(lock.lockPath, { force: true });
    if (lock.stale?.stalePath && fs.existsSync(lock.stale.stalePath)) {
      if (staleRecorded) fs.rmSync(lock.stale.stalePath, { force: true });
      else if (!fs.existsSync(lock.lockPath)) fs.renameSync(lock.stale.stalePath, lock.lockPath);
    }
  }
}

export const _testing = { sha256, validateReadableAudio, assertSampleAligned, assertWithin, runProcess, acquireLock };
