import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { inspectRx } from "./rx-adapter.mjs";

const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES) || 12 * 1024 ** 3;
const SCHEMA_VERSION = "3.0.0";
const ANALYSIS_VERSION = "audio-quality-v2.0.0";
const ROUTING_VERSION = "audio-routing-v2.0.0";

async function run(command, args, { binary = false } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", code => {
      const out = Buffer.concat(stdout), error = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) reject(new Error(error.trim() || `${command} failed with exit code ${code}.`));
      else resolve(binary ? out : `${out.toString("utf8")}\n${error}`);
    });
  });
}
function metric(text, pattern) { const match = text.match(pattern); return match ? Number(match[1]) : null; }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function storageDirectory(root, uploadId) { return path.join(root, "data", "audio-intake", uploadId); }
function resolveKey(root, key) {
  const normalized = String(key || "").replaceAll("\\", "/");
  if (!/^audio-intake\/[a-f0-9-]+\/[a-z0-9._ -]+$/i.test(normalized)) throw new Error("Invalid audio storage key.");
  const resolved = path.resolve(root, "data", normalized);
  const base = path.resolve(root, "data", "audio-intake") + path.sep;
  if (!resolved.startsWith(base)) throw new Error("Audio storage key escaped its storage root.");
  return resolved;
}
function auditFile(root, uploadId) { return path.join(storageDirectory(root, uploadId), "audit.json"); }
function validateAudit(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || typeof value.uploadId !== "string" || !value.storage?.original?.key || !Array.isArray(value.history)) throw new Error("The audio audit record is invalid or unsupported.");
  return value;
}
function atomicWrite(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx");
  try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
}
function appendHistory(audit, event, details = {}) { audit.history.push({ event, at: new Date().toISOString(), ...details }); }
function publicAudit(audit) { return structuredClone(audit); }
export { publicAudit };

export function readAudioAudit(root, uploadId) {
  const target = auditFile(root, uploadId);
  if (!fs.existsSync(target)) throw new Error("Audio intake record was not found.");
  return validateAudit(JSON.parse(fs.readFileSync(target, "utf8")));
}
export function writeAudioAudit(root, audit) { validateAudit(audit); atomicWrite(auditFile(root, audit.uploadId), audit); }

export async function saveAudioForTools(req, { root, originalName, contentType }) {
  const uploadId = crypto.randomUUID();
  const safeName = path.basename(originalName || "audio.bin").replace(/[^a-zA-Z0-9._ -]/g, "_");
  const directory = storageDirectory(root, uploadId);
  fs.mkdirSync(directory, { recursive: true });
  const originalPath = path.join(directory, `original${path.extname(safeName) || ".bin"}`);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const output = fs.createWriteStream(originalPath, { flags: "wx" });
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_AUDIO_BYTES) throw new Error(`Audio file exceeds the configured ${MAX_AUDIO_BYTES} byte limit.`);
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise(resolve => output.once("drain", resolve));
    }
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    if (!bytes) throw new Error("The selected audio file is empty.");
    const sha = hash.digest("hex");
    const audit = { schemaVersion:SCHEMA_VERSION, uploadId, status:"ready", originalName:safeName, contentType:contentType||"application/octet-stream", storage:{original:{key:`audio-intake/${uploadId}/${path.basename(originalPath)}`,sha256:sha,bytes,immutable:true},derivatives:[]}, selectedSource:"original", selectedDerivativeOperationId:null, selectedAudioSha256:sha, selectionBasis:"audio-tools", rx:inspectRx(), tools:{ffmpeg:null}, transcripts:{}, comparisons:[], history:[{event:"audio-tools-original-ingested",at:new Date().toISOString(),sha256:sha,bytes}], createdAt:new Date().toISOString() };
    writeAudioAudit(root, audit);
    return publicAudit(audit);
  } catch (error) {
    output.destroy();
    fs.rmSync(directory, { recursive:true, force:true });
    throw error;
  }
}

async function ffmpegVersion() {
  const text = await run("ffmpeg", ["-version"]);
  return text.split(/\r?\n/)[0].trim();
}
async function probeAudio(file) {
  return JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,bit_rate:stream=index,codec_name,codec_type,sample_rate,channels", "-of", "json", file]));
}
async function measureAudio(file) {
  const filter = "volumedetect,astats=metadata=1:reset=0";
  const text = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", filter, "-f", "null", "-"]);
  const clippedSamples = metric(text, /histogram_0db:\s*(\d+)/i) ?? 0;
  const peakDbfs = metric(text, /Peak level dB:\s*(-?[\d.]+)/i) ?? metric(text, /max_volume:\s*(-?[\d.]+) dB/i);
  const meanVolumeDb = metric(text, /mean_volume:\s*(-?[\d.]+) dB/i);
  const dynamicRangeDb = metric(text, /Dynamic range:\s*([\d.]+)/i);
  return { meanVolumeDb, peakDbfs, dynamicRangeDb, clippedSampleCount: clippedSamples, clippingMeasured: clippedSamples !== null };
}
async function measureLowFrequencyEnergy(file) {
  const text = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", "90", "-i", file, "-af", "lowpass=f=130,highpass=f=40,volumedetect", "-f", "null", "-"]);
  return metric(text, /mean_volume:\s*(-?[\d.]+) dB/i);
}
export async function measureAudioQuality(file) {
  const measurements = await measureAudio(file);
  measurements.lowFrequencyMeanDb = await measureLowFrequencyEnergy(file);
  return measurements;
}
function classifyAudio(measurements, durationSeconds) {
  const lowLevelDetected = measurements.meanVolumeDb !== null ? measurements.meanVolumeDb < -32 : null;
  const clippingDetected = measurements.clippingMeasured && measurements.clippedSampleCount !== null ? measurements.clippedSampleCount > 8 : null;
  const lowFrequencyDetected = measurements.lowFrequencyMeanDb !== null && measurements.meanVolumeDb !== null ? measurements.lowFrequencyMeanDb - measurements.meanVolumeDb > -13 : null;
  const unevenDetected = measurements.dynamicRangeDb !== null ? measurements.dynamicRangeDb > 35 : null;
  return {
    lowLevel: { measured: measurements.meanVolumeDb !== null, detected: lowLevelDetected, confidence: lowLevelDetected === null ? null : .9, evidence: { meanVolumeDb: measurements.meanVolumeDb, thresholdDb: -32 } },
    clipping: { measured: measurements.clippingMeasured, detected: clippingDetected, confidence: clippingDetected === null ? null : .82, evidence: { clippedSampleCount: measurements.clippedSampleCount, peakDbfs: measurements.peakDbfs } },
    lowFrequencyEnergy: { measured: measurements.lowFrequencyMeanDb !== null, detected: lowFrequencyDetected, confidence: lowFrequencyDetected === null ? null : .6, evidence: { lowFrequencyMeanDb: measurements.lowFrequencyMeanDb, fullBandMeanDb: measurements.meanVolumeDb }, note: "May be HVAC rumble, handling noise, traffic, or speech; it is not labeled electrical hum." },
    unevenLevels: { measured: measurements.dynamicRangeDb !== null, detected: unevenDetected, confidence: unevenDetected === null ? null : .72, evidence: { dynamicRangeDb: measurements.dynamicRangeDb } },
    echo: { measured: false, detected: null, confidence: null, evidence: null, note: "Echo is not automatically evaluated by the current validated analyzer." },
    clean: { measured: true, detected: ![lowLevelDetected, clippingDetected, lowFrequencyDetected, unevenDetected].includes(true) && durationSeconds >= 3, confidence: durationSeconds >= 3 ? .75 : .35 },
    uncertain: { measured: true, detected: durationSeconds < 3 || [lowLevelDetected, clippingDetected].includes(null), confidence: 1 },
  };
}
function recommendProcessing(findings) {
  if (findings.uncertain.detected || findings.clipping.detected) return { route: "review", candidateProfile: null, reason: "Insufficient certainty or possible clipping; preserve original for review." };
  if (findings.lowFrequencyEnergy.detected && findings.lowLevel.detected) return { route: "candidate", candidateProfile: "low-frequency-normalize-v2", reason: "Create a conservative candidate; compare ASR results before selection." };
  if (findings.lowFrequencyEnergy.detected) return { route: "candidate", candidateProfile: "low-frequency-rolloff-v2", reason: "Create a conservative candidate; do not assume the low-frequency energy is hum." };
  if (findings.lowLevel.detected || findings.unevenLevels.detected) return { route: "candidate", candidateProfile: "gentle-normalization-v2", reason: "Create a conservative candidate; compare ASR results before selection." };
  return { route: "original", candidateProfile: null, reason: "No validated quality concern requires processing." };
}
function profileFilter(profile) {
  return { "low-frequency-normalize-v2":"highpass=f=70,loudnorm=I=-23:TP=-2:LRA=11", "low-frequency-rolloff-v2":"highpass=f=70", "gentle-normalization-v2":"loudnorm=I=-23:TP=-2:LRA=11" }[profile];
}
async function createDerivative(root, audit, originalPath, profile, measurementsBefore) {
  const filter = profileFilter(profile), directory = storageDirectory(root, audit.uploadId), name = `candidate.${profile}.wav`, target = path.join(directory, name);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", originalPath, "-af", filter, "-ar", "48000", "-c:a", "pcm_s16le", target];
  await run("ffmpeg", args);
  const after = await measureAudio(target);
  return { kind:"processing", operationId:crypto.randomUUID(), key:`audio-intake/${audit.uploadId}/${name}`, bytes:fs.statSync(target).size, sha256:sha256(target), sourceSha256:audit.storage.original.sha256, tool:"ffmpeg", toolVersion:audit.tools.ffmpeg, commandArguments:["-i", audit.storage.original.key, "-af", filter, "-ar", "48000", "-c:a", "pcm_s16le", "OUTPUT_KEY"], profileId:profile, profileVersion:"2.0.0", createdAt:new Date().toISOString(), measurementsBefore, measurementsAfter:after };
}

function processingDerivatives(audit) { return audit.storage.derivatives.filter(item => item.kind !== "deepgram-compatibility" && !String(item.kind||"").endsWith("-proxy") && item.timelinePreserved !== false && item.selectableForTranscription !== false); }
export function resolveAudioItem(audit, source = audit.selectedSource, derivativeOperationId = source === "processed" ? audit.selectedDerivativeOperationId : null) {
  if (source === "original") return audit.storage.original;
  if (source !== "processed") throw new Error("Select original or processed audio.");
  const candidates = processingDerivatives(audit);
  const item = derivativeOperationId
    ? candidates.find(candidate => candidate.operationId === derivativeOperationId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!item) throw new Error(derivativeOperationId ? "The selected processed-audio operation is unavailable." : "Choose a specific processed-audio derivative.");
  return item;
}

export async function createDeepgramCompatibilityDerivative(root, audit, source = audit.selectedSource, derivativeOperationId = audit.selectedDerivativeOperationId) {
  const sourceItem = resolveAudioItem(audit, source, derivativeOperationId);
  if (!sourceItem) throw new Error("The requested audio source is unavailable for conversion.");
  const existing = audit.storage.derivatives.find(item => item.kind === "deepgram-compatibility" && item.sourceSha256 === sourceItem.sha256);
  if (existing) {
    appendHistory(audit, "deepgram-compatibility-derivative-reused", { source, key: existing.key, sha256: existing.sha256 });
    writeAudioAudit(root, audit);
    return { path: resolveKey(root, existing.key), derivative: existing };
  }
  const sourcePath = resolveKey(root, sourceItem.key);
  const name = `deepgram-compatibility.${source}.${sourceItem.sha256.slice(0, 12)}.wav`;
  const target = path.join(storageDirectory(root, audit.uploadId), name);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", sourcePath, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", target];
  await run("ffmpeg", args);
  const probe = await probeAudio(target), stream = probe.streams?.find(item => item.codec_type === "audio");
  if (!stream) throw new Error("The compatibility conversion did not produce readable audio.");
  const derivative = {
    kind: "deepgram-compatibility", key: `audio-intake/${audit.uploadId}/${name}`,
    bytes: fs.statSync(target).size, sha256: sha256(target), sourceSha256: sourceItem.sha256,
    tool: "ffmpeg", toolVersion: audit.tools.ffmpeg, profileId: "deepgram-pcm-wav-v1", profileVersion: "1.0.0",
    commandArguments: ["-i", sourceItem.key, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "OUTPUT_KEY"],
    media: { codec: stream.codec_name || "pcm_s16le", sampleRate: Number(stream.sample_rate || 0), channels: Number(stream.channels || 0) },
    createdAt: new Date().toISOString(), purpose: "Deepgram media-decoding fallback only",
  };
  audit.storage.derivatives.push(derivative);
  appendHistory(audit, "deepgram-compatibility-derivative-created", { source, key: derivative.key, sha256: derivative.sha256, sourceSha256: derivative.sourceSha256, profileId: derivative.profileId });
  writeAudioAudit(root, audit);
  return { path: target, derivative };
}
export async function saveAndAnalyzeAudio(req, { root, originalName, contentType }) {
  const uploadId = crypto.randomUUID(), safeName = path.basename(originalName || "audio.bin").replace(/[^a-zA-Z0-9._ -]/g, "_"), directory = storageDirectory(root, uploadId);
  fs.mkdirSync(directory, { recursive: true });
  const originalPath = path.join(directory, `original${path.extname(safeName) || ".bin"}`), hash = crypto.createHash("sha256");
  let bytes = 0;
  const audit = { schemaVersion:SCHEMA_VERSION, analysisVersion:ANALYSIS_VERSION, routingPolicyVersion:ROUTING_VERSION, uploadId, status:"ingesting", originalName:safeName, contentType:contentType||"application/octet-stream", storage:{ original:{ key:`audio-intake/${uploadId}/${path.basename(originalPath)}`, sha256:null, bytes:0, immutable:true }, derivatives:[] }, media:null, measurements:null, findings:null, recommendation:null, selectedSource:"original", selectedDerivativeOperationId:null, selectedAudioSha256:null, selectionBasis:"safety-default", rx:inspectRx(), tools:{ffmpeg:null}, transcripts:{}, comparisons:[], history:[], createdAt:new Date().toISOString() };
  const declaredLength = Number(req.headers?.["content-length"] || 0);
  if (declaredLength > MAX_AUDIO_BYTES) throw new Error(`Audio file exceeds the configured ${MAX_AUDIO_BYTES} byte limit.`);
  const output = fs.createWriteStream(originalPath, { flags:"wx" });
  try {
    for await (const chunk of req) { bytes += chunk.length; if(bytes>MAX_AUDIO_BYTES) throw new Error(`Audio file exceeds the configured ${MAX_AUDIO_BYTES} byte limit.`); hash.update(chunk); if(!output.write(chunk)) await new Promise(resolve=>output.once("drain",resolve)); }
    await new Promise((resolve,reject)=>output.end(error=>error?reject(error):resolve()));
    audit.storage.original.sha256=hash.digest("hex"); audit.storage.original.bytes=bytes; audit.selectedAudioSha256=audit.storage.original.sha256; audit.status="ingested"; appendHistory(audit,"original-ingested",{sha256:audit.storage.original.sha256,bytes}); writeAudioAudit(root,audit);
  } catch(error) { output.destroy(); fs.rmSync(directory,{recursive:true,force:true}); throw error; }
  try {
    audit.tools.ffmpeg=await ffmpegVersion(); const probe=await probeAudio(originalPath), stream=probe.streams?.find(item=>item.codec_type==="audio"); if(!stream) throw new Error("The selected file does not contain a readable audio stream.");
    audit.media={durationSeconds:Number(probe.format?.duration||0),codec:stream.codec_name||"unknown",sampleRate:Number(stream.sample_rate||0),channels:Number(stream.channels||0)};
    const measurements=await measureAudioQuality(originalPath); audit.measurements=measurements;
    audit.findings=classifyAudio(measurements,audit.media.durationSeconds); audit.recommendation=recommendProcessing(audit.findings); appendHistory(audit,"technical-analysis-completed",{analysisVersion:ANALYSIS_VERSION});
    if(audit.recommendation.candidateProfile){const derivative=await createDerivative(root,audit,originalPath,audit.recommendation.candidateProfile,measurements);audit.storage.derivatives.push(derivative);appendHistory(audit,"candidate-derivative-created",{key:derivative.key,sha256:derivative.sha256,profileId:derivative.profileId});}
    audit.status="ready"; appendHistory(audit,"routing-recommendation-created",{routingPolicyVersion:ROUTING_VERSION,route:audit.recommendation.route}); writeAudioAudit(root,audit); return publicAudit(audit);
  } catch(error) { audit.status="analysis-failed"; audit.analysisError=error instanceof Error?error.message:"Audio analysis failed."; appendHistory(audit,"analysis-failed",{error:audit.analysisError}); writeAudioAudit(root,audit); return publicAudit(audit); }
}
export function selectAudioSource(root,uploadId,source,reason="user-override",derivativeOperationId=null) { const audit=readAudioAudit(root,uploadId); const item=resolveAudioItem(audit,source,derivativeOperationId); audit.selectedSource=source; audit.selectedDerivativeOperationId=source==="processed"?item.operationId:null; audit.selectedAudioSha256=item.sha256; audit.selectionBasis=reason;appendHistory(audit,"source-selected",{source,reason,derivativeOperationId:audit.selectedDerivativeOperationId,audioSha256:item.sha256});writeAudioAudit(root,audit);return publicAudit(audit); }
export function resolveAudioPath(root,audit,source=audit.selectedSource,derivativeOperationId=source==="processed"?audit.selectedDerivativeOperationId:null){return resolveKey(root,resolveAudioItem(audit,source,derivativeOperationId).key);}
export function recordTranscription(root,audit,source,transcript,derivativeOperationId=source==="processed"?audit.selectedDerivativeOperationId:null){const item=resolveAudioItem(audit,source,derivativeOperationId); audit.transcripts[source]={...transcript,audioSha256:item.sha256,derivativeOperationId:source==="processed"?item.operationId:null};appendHistory(audit,"deepgram-transcription-completed",{source,requestId:transcript.requestId,audioSha256:item.sha256,derivativeOperationId:source==="processed"?item.operationId:null});writeAudioAudit(root,audit);return publicAudit(audit);}
export function recordComparison(root,audit,comparison){audit.comparisons.push(comparison);appendHistory(audit,"transcript-quality-compared",{source:comparison.source,wer:comparison.wer,criticalLegalErrorRate:comparison.criticalLegalErrorRate});writeAudioAudit(root,audit);return publicAudit(audit);}
