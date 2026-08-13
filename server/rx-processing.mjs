import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectRx } from "./rx-adapter.mjs";
import { getRxProfile } from "./rx-profiles.mjs";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PYTHON = process.env.DEPO_PRO_RX_PYTHON || path.join(MODULE_DIRECTORY, "..", ".venv-pedalboard", "Scripts", "python.exe");
const DEFAULT_WORKER = path.join(MODULE_DIRECTORY, "rx-pedalboard-worker.py");
const DEFAULT_PLUGIN_ROOT = "C:\\Program Files\\Common Files\\VST3\\iZotope";

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
  const text = await runner("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,sample_rate,channels,duration_ts,time_base", "-of", "json", file], 60_000);
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
  return { durationSeconds, sampleRate, channels: Number(stream.channels), sampleFrames };
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
  profileId = "rx12-voice-denoise-factory-adaptive-v1",
  pythonExecutable = DEFAULT_PYTHON,
  workerPath = DEFAULT_WORKER,
  pluginPath,
  runWorker = runProcess,
  runDecoder = runProcess,
  validateAudio = validateReadableAudio,
  hashFile = sha256,
  recordAuditEvent,
  now = () => new Date().toISOString(),
  currentTimeMs = () => Date.now(),
  staleLockMs = 35 * 60 * 1000,
  randomId = () => crypto.randomUUID(),
} = {}) {
  if (!audit?.storage?.original?.immutable || !audit.storage.original.sha256) throw new Error("RX processing requires a hashed immutable original.");
  if (typeof recordAuditEvent !== "function") throw new RxProcessingError("RX processing requires an audit-backed event recorder.", "RX_AUDIT_RECORDER_REQUIRED");
  if (!originalPath || !fs.existsSync(originalPath)) throw new Error("Immutable original audio is unavailable.");
  if (!/^audio-intake\/[a-f0-9-]+\/[a-z0-9._ -]+$/i.test(String(audit.storage.original.key || ""))) {
    throw new Error("RX processing requires the audited original storage key.");
  }
  const expectedOriginalPath = path.resolve(root, "data", audit.storage.original.key);
  if (path.resolve(originalPath) !== expectedOriginalPath) throw new Error("RX source path does not match the audited original.");

  const rx = inspectRx({ includeExecutable:true });
  if (!rx.available || !rx.executable) throw new Error(rx.fallback || "iZotope RX 12 is unavailable.");
  const profile = getRxProfile(profileId);
  const resolvedPluginPath = pluginPath || path.join(process.env.RX_VST3_ROOT || DEFAULT_PLUGIN_ROOT, profile.pluginFile);
  for (const required of [pythonExecutable, workerPath,resolvedPluginPath]) if (!fs.existsSync(required)) throw new Error(`RX processing dependency is unavailable: ${path.basename(required)}`);
  const directory = path.dirname(path.resolve(originalPath));
  const operationId = randomId();
  const startedAt = now();
  const workRoot = path.join(path.resolve(root), "data", "rx-work");
  const lockDirectory = path.join(workRoot, "locks");
  const operationDirectory = path.join(workRoot, audit.uploadId, operationId);
  const finalPath = path.join(directory, `candidate.${profile.id}.${operationId}.wav`);
  const temporaryPath = path.join(operationDirectory, "derivative.partial.wav");
  const processingSourcePath = path.join(operationDirectory, "processing-source.wav");
  const profilePath = path.join(operationDirectory, "profile.json");
  const resultPath = path.join(operationDirectory, "result.json");
  assertWithin(finalPath, directory);
  assertWithin(temporaryPath, workRoot);
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
    fs.writeFileSync(profilePath, JSON.stringify(profile), { flag: "wx" });
    await runWorker(pythonExecutable, [workerPath, "--input", workerInputPath, "--output", temporaryPath, "--plugin", resolvedPluginPath, "--profile", profilePath, "--result", resultPath]);
    if (!fs.existsSync(temporaryPath)) throw new Error("RX worker reported success without producing output.");
    if (!fs.existsSync(resultPath)) throw new Error("RX worker reported success without a result record.");
    let worker;
    try { worker = JSON.parse(fs.readFileSync(resultPath, "utf8")); }
    catch (cause) { throw new RxProcessingError("RX worker result is invalid JSON.", "RX_PROVENANCE_INCOMPLETE", { cause }); }
    if (!worker.manufacturer || !worker.pluginVersion || worker.manufacturer !== "iZotope" || worker.plugin !== profile.expectedPlugin || String(worker.pluginVersion).split(".", 1)[0] !== "12") throw new RxProcessingError("RX worker did not report a valid plug-in identity.", "RX_PROVENANCE_INCOMPLETE");
    if (worker.profileId !== profile.id || worker.profileVersion !== profile.version) throw new RxProcessingError("RX worker profile identity does not match the requested profile.", "RX_PROVENANCE_INCOMPLETE");
    if (!Number.isInteger(worker.sourceFrames) || !Number.isInteger(worker.framesProcessed) || worker.sourceFrames <= 0 || worker.framesProcessed !== worker.sourceFrames) throw new RxProcessingError("RX worker did not prove exact frame parity.", "RX_PROVENANCE_INCOMPLETE");
    const media = await validateAudio(temporaryPath);
    assertSampleAligned(sourceMedia, media, worker.framesProcessed);
    const afterHash = await hashFile(originalPath);
    if (afterHash !== beforeHash) {
      await recordViolation(recordAuditEvent, { event: "rx-integrity-violation", code: "SOURCE_CHANGED_DURING_PROCESSING", operationId, at: now(), expectedSha256: beforeHash, observedSha256: afterHash });
    }
    const derivativeHash = await hashFile(temporaryPath);
    fs.renameSync(temporaryPath, finalPath);
    renamed = true;
    return {
      key, operationId, bytes: fs.statSync(finalPath).size, sha256: derivativeHash, sourceSha256: beforeHash, sourceImmutable: true,
      sampleAligned: true, sourceMedia, uploadedSourceMedia, processingInput: needsDecode ? { decodedToPcm: true, decoder: "ffmpeg", encoding: "pcm_s16le" } : { decodedToPcm: false }, outputEncoding: worker.outputEncoding, tool: "iZotope RX VST3 via Spotify Pedalboard", toolVersion: worker.pluginVersion,
      manufacturer: worker.manufacturer, product: profile.product, edition: profile.edition, module: profile.module,
      pluginIdentifier: profile.pluginIdentifier, host: worker.worker, hostVersion: worker.workerVersion, profileId: profile.id,
      profileVersion: profile.version, presetIdentity: profile.presetIdentity, requestedProcessingParameters: worker.requestedRawParameters, appliedProcessingParameters: worker.appliedRawParameters, effectiveProcessingParameters: worker.effectiveRawParameters, effectiveDisplayValues: worker.effectiveDisplayValues, processingParameters: worker.appliedRawParameters, createdAt: now(), media,
    };
  } catch (error) {
    if (renamed && fs.existsSync(finalPath)) fs.rmSync(finalPath, { force: true });
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
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
