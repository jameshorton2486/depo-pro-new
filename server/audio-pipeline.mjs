import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { inspectRx } from "./rx-adapter.mjs";
import { ASR_ELIGIBLE_KINDS, CANONICAL_ASR_PCM_BITS, DERIVATIVE_KINDS } from "./audio-kinds.mjs";
import { chooseMeasuredAsrSource } from "./asr-selection.mjs";

const DEFAULT_MAX_AUDIO_BYTES = 12 * 1024 ** 3;
const configuredMaxAudioBytes = Number(process.env.MAX_AUDIO_BYTES ?? DEFAULT_MAX_AUDIO_BYTES);
if (!Number.isSafeInteger(configuredMaxAudioBytes) || configuredMaxAudioBytes < 1) throw new Error("MAX_AUDIO_BYTES must be a positive integer.");
const MAX_AUDIO_BYTES = configuredMaxAudioBytes;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUploadId(value) { if (!UPLOAD_ID.test(String(value || ""))) throw new Error("Invalid audio intake identifier."); return String(value); }
const SCHEMA_VERSION = "3.0.0";
const ANALYSIS_VERSION = "audio-quality-v2.0.0";
const ROUTING_VERSION = "audio-routing-v2.0.0";
const auditLocks=new Map();
export async function withAuditLock(uploadId,fn){const previous=auditLocks.get(uploadId)??Promise.resolve();const next=previous.then(fn,fn);auditLocks.set(uploadId,next.catch(()=>{}));try{return await next}finally{if(auditLocks.get(uploadId)===next)auditLocks.delete(uploadId)}}

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
async function sha256(file) { const hash=crypto.createHash("sha256"); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
function storageDirectory(root, uploadId) { return path.join(root, "data", "audio-intake", assertUploadId(uploadId)); }
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
function atomicBuffer(file, value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const descriptor=fs.openSync(file,"wx");
  try { fs.writeFileSync(descriptor,value); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
function appendHistory(audit, event, details = {}) { audit.history.push({ event, at: new Date().toISOString(), ...details }); }
function publicAudit(audit) { return structuredClone(audit); }
export { publicAudit };

export function readAudioAudit(root, uploadId) {
  assertUploadId(uploadId);
  const target = auditFile(root, uploadId);
  if (!fs.existsSync(target)) throw new Error("Audio intake record was not found.");
  return validateAudit(JSON.parse(fs.readFileSync(target, "utf8")));
}
export function writeAudioAudit(root, audit) { validateAudit(audit); assertUploadId(audit.uploadId); atomicWrite(auditFile(root, audit.uploadId), audit); }
export async function mutateAudioAudit(root,uploadId,mutator){assertUploadId(uploadId);return withAuditLock(uploadId,async()=>{const audit=readAudioAudit(root,uploadId),result=await mutator(audit);writeAudioAudit(root,audit);return result??publicAudit(audit)})}

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
    const declaredLength=Number(req.headers?.["content-length"]||0);
    if (declaredLength > MAX_AUDIO_BYTES) throw new Error(`Audio file exceeds the configured ${MAX_AUDIO_BYTES} byte limit.`);
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_AUDIO_BYTES) throw new Error(`Audio file exceeds the configured ${MAX_AUDIO_BYTES} byte limit.`);
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise(resolve => output.once("drain", resolve));
    }
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    if (!bytes) throw new Error("The selected audio file is empty.");
    const sha = hash.digest("hex");
    const audit = { schemaVersion:SCHEMA_VERSION, intakeMode:"tools", analysisVersion:null, routingPolicyVersion:null, uploadId, status:"ready", originalName:safeName, contentType:contentType||"application/octet-stream", media:null, measurements:null, findings:null, recommendation:null, storage:{original:{key:`audio-intake/${uploadId}/${path.basename(originalPath)}`,sha256:sha,bytes,immutable:true},derivatives:[]}, selectedSource:"original", selectedDerivativeOperationId:null, selectedAudioSha256:sha, selectionBasis:"audio-tools", rx:inspectRx(), tools:{ffmpeg:null}, transcripts:{}, comparisons:[], history:[{event:"audio-tools-original-ingested",at:new Date().toISOString(),sha256:sha,bytes}], createdAt:new Date().toISOString() };
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
  return parseAudioMeasurements(text);
}
export function parseAudioMeasurements(text) {
  const clippedSamples = metric(text, /histogram_0db:\s*(\d+)/i);
  const peakDbfs = metric(text, /Peak level dB:\s*(-?[\d.]+)/i) ?? metric(text, /max_volume:\s*(-?[\d.]+) dB/i);
  const meanVolumeDb = metric(text, /mean_volume:\s*(-?[\d.]+) dB/i);
  const dynamicRangeDb = metric(text, /Dynamic range:\s*([\d.]+)/i);
  return { meanVolumeDb, peakDbfs, dynamicRangeDb, clippedSampleCount: clippedSamples, clippingMeasured: clippedSamples !== null };
}
async function measureLowFrequencyEnergy(file) {
  const text = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", "90", "-i", file, "-af", "lowpass=f=130,highpass=f=40,volumedetect", "-f", "null", "-"]);
  return metric(text, /mean_volume:\s*(-?[\d.]+) dB/i);
}
async function measureBandEnergy(file, filter) {
  const text = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", "90", "-i", file, "-af", `${filter},volumedetect`, "-f", "null", "-"]);
  return metric(text, /mean_volume:\s*(-?[\d.]+) dB/i);
}
async function measureHumHarmonics(file) {
  const fundamentals=await Promise.all([50,60].map(async lineFrequencyHz=>({lineFrequencyHz,level:await measureBandEnergy(file,`bandpass=f=${lineFrequencyHz}:width_type=h:width=4`)})));
  const selected=fundamentals.reduce((stronger,candidate)=>candidate.level !== null && (stronger.level === null || candidate.level>stronger.level) ? candidate : stronger);
  const levels=await Promise.all([1,2,3,4,5].map(harmonic=>measureBandEnergy(file,`bandpass=f=${selected.lineFrequencyHz*harmonic}:width_type=h:width=4`)));
  const available=levels.filter(Number.isFinite);
  return {lineFrequencyHz:selected.lineFrequencyHz,meanDb:available.length ? available.reduce((sum,value)=>sum+value,0)/available.length : null};
}
async function measureImpulseCount(file) {
  const pcm = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-t", "90", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], { binary:true });
  let previous=0, count=0, cooldown=0;
  for(let offset=0;offset+4<=pcm.length;offset+=4){const sample=pcm.readFloatLE(offset),jump=Math.abs(sample-previous);if(cooldown>0)cooldown-=1;else if(jump>=0.35){count+=1;cooldown=80}previous=sample}
  return count;
}
export async function measureAudioQuality(file) {
  const measurements = await measureAudio(file);
  const [lowFrequencyMeanDb,hum,fricativeBandMeanDb,impulseCount]=await Promise.all([
    measureLowFrequencyEnergy(file), measureHumHarmonics(file), measureBandEnergy(file,"highpass=f=4000,lowpass=f=7900"), measureImpulseCount(file),
  ]);
  Object.assign(measurements,{lowFrequencyMeanDb,humLineFrequencyHz:hum.lineFrequencyHz,humHarmonicMeanDb:hum.meanDb,fricativeBandMeanDb,impulseCount});
  return measurements;
}
function classifyAudio(measurements, durationSeconds) {
  const lowLevelDetected = measurements.meanVolumeDb !== null ? measurements.meanVolumeDb < -32 : null;
  const clippingDetected = measurements.clippingMeasured && measurements.clippedSampleCount !== null ? measurements.clippedSampleCount > 8 : null;
  const lowFrequencyDetected = measurements.lowFrequencyMeanDb !== null && measurements.meanVolumeDb !== null ? measurements.lowFrequencyMeanDb - measurements.meanVolumeDb > -13 : null;
  const unevenDetected = measurements.dynamicRangeDb !== null ? measurements.dynamicRangeDb > 35 : null;
  const humRelativeDb=measurements.humHarmonicMeanDb !== null&&measurements.meanVolumeDb !== null?measurements.humHarmonicMeanDb-measurements.meanVolumeDb:null;
  const lineHumDetected=humRelativeDb!==null?humRelativeDb>-24:null,impulsesDetected=measurements.impulseCount!==null?measurements.impulseCount>8:null;
  return {
    lowLevel: { measured: measurements.meanVolumeDb !== null, detected: lowLevelDetected, confidence: lowLevelDetected === null ? null : .9, evidence: { meanVolumeDb: measurements.meanVolumeDb, thresholdDb: -32 } },
    clipping: { measured: measurements.clippingMeasured, detected: clippingDetected, confidence: clippingDetected === null ? null : .82, evidence: { clippedSampleCount: measurements.clippedSampleCount, peakDbfs: measurements.peakDbfs } },
    lowFrequencyEnergy: { measured: measurements.lowFrequencyMeanDb !== null, detected: lowFrequencyDetected, confidence: lowFrequencyDetected === null ? null : .6, evidence: { lowFrequencyMeanDb: measurements.lowFrequencyMeanDb, fullBandMeanDb: measurements.meanVolumeDb }, note: "May be HVAC rumble, handling noise, traffic, or speech; it is not labeled electrical hum." },
    unevenLevels: { measured: measurements.dynamicRangeDb !== null, detected: unevenDetected, confidence: unevenDetected === null ? null : .72, evidence: { dynamicRangeDb: measurements.dynamicRangeDb } },
    lineHum: { measured:humRelativeDb!==null,detected:lineHumDetected,confidence:lineHumDetected===null?null:.7,evidence:{lineFrequencyHz:measurements.humLineFrequencyHz,harmonicEnergyRelativeDb:humRelativeDb} },
    impulses: { measured:measurements.impulseCount!==null,detected:impulsesDetected,confidence:impulsesDetected===null?null:.7,evidence:{impulseCount:measurements.impulseCount} },
    echo: { measured: false, detected: null, confidence: null, evidence: null, note: "Echo is not automatically evaluated by the current validated analyzer." },
    clean: { measured: true, detected: ![lowLevelDetected, clippingDetected, lowFrequencyDetected, unevenDetected,lineHumDetected,impulsesDetected].includes(true) && durationSeconds >= 3, confidence: durationSeconds >= 3 ? .75 : .35 },
    uncertain: { measured: true, detected: durationSeconds < 3 || [lowLevelDetected, clippingDetected].includes(null), confidence: 1 },
  };
}
function recommendProcessing(findings) {
  if (findings.uncertain.detected || findings.clipping.detected) return { route: "review", candidateProfile: null, reason: "Insufficient certainty or possible clipping; preserve original for review." };
  if (findings.lowFrequencyEnergy.detected) return { route: "candidate", candidateProfile: "low-frequency-rolloff-v2", reason: "Create a conservative candidate; do not assume the low-frequency energy is hum." };
  if (findings.lowLevel.detected || findings.unevenLevels.detected) return { route: "review", candidateProfile: null, reason: "Level concerns require listening review; automatic gain is not applied to transcription evidence." };
  return { route: "original", candidateProfile: null, reason: "No validated quality concern requires processing." };
}
function profileFilter(profile) {
  return { "low-frequency-rolloff-v2":"highpass=f=70" }[profile];
}
async function createDerivative(root, audit, originalPath, profile, measurementsBefore) {
  const filter = profileFilter(profile), directory = storageDirectory(root, audit.uploadId), name = `candidate.${profile}.wav`, target = path.join(directory, name);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", originalPath, "-af", filter, "-c:a", "pcm_s16le", target];
  await run("ffmpeg", args);
  const after = await measureAudio(target);
  return { kind:DERIVATIVE_KINDS.FFMPEG_CANDIDATE, operationId:crypto.randomUUID(), key:`audio-intake/${audit.uploadId}/${name}`, bytes:fs.statSync(target).size, sha256:await sha256(target), sourceSha256:audit.storage.original.sha256, tool:"ffmpeg", toolVersion:audit.tools.ffmpeg, commandArguments:["-i", audit.storage.original.key, "-af", filter, "-c:a", "pcm_s16le", "OUTPUT_KEY"], profileId:profile, profileVersion:"2.0.0", sourcePcmPrecision:"decoded source; lossy inputs have no source PCM bit depth",processingPrecision:"ffmpeg internal",outputPcmPrecision:`signed ${CANONICAL_ASR_PCM_BITS}-bit PCM`,timelinePreserved:true,selectableForTranscription:true,createdAt:new Date().toISOString(), measurementsBefore, measurementsAfter:after };
}

function processingDerivatives(audit) { return audit.storage.derivatives.filter(item => ASR_ELIGIBLE_KINDS.has(item.kind) && item.timelinePreserved !== false && item.selectableForTranscription !== false); }
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
  const existing = audit.storage.derivatives.find(item => item.kind === DERIVATIVE_KINDS.DEEPGRAM_COMPATIBILITY && item.sourceSha256 === sourceItem.sha256);
  if (existing) {
    await mutateAudioAudit(root,audit.uploadId,current=>appendHistory(current,"deepgram-compatibility-derivative-reused",{source,key:existing.key,sha256:existing.sha256}));
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
    kind: DERIVATIVE_KINDS.DEEPGRAM_COMPATIBILITY, key: `audio-intake/${audit.uploadId}/${name}`,
    bytes: fs.statSync(target).size, sha256: await sha256(target), sourceSha256: sourceItem.sha256,
    tool: "ffmpeg", toolVersion: audit.tools.ffmpeg, profileId: "deepgram-pcm-wav-v1", profileVersion: "1.0.0",
    commandArguments: ["-i", sourceItem.key, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "OUTPUT_KEY"],
    media: { codec: stream.codec_name || "pcm_s16le", sampleRate: Number(stream.sample_rate || 0), channels: Number(stream.channels || 0) },
    sourcePcmPrecision:"selected source precision",processingPrecision:"ffmpeg internal",outputPcmPrecision:`signed ${CANONICAL_ASR_PCM_BITS}-bit PCM`,timelinePreserved:true,selectableForTranscription:true,createdAt: new Date().toISOString(), purpose: "Deepgram media-decoding fallback only",
  };
  await mutateAudioAudit(root,audit.uploadId,current=>{current.storage.derivatives.push(derivative);appendHistory(current,"deepgram-compatibility-derivative-created",{source,key:derivative.key,sha256:derivative.sha256,sourceSha256:derivative.sourceSha256,profileId:derivative.profileId})});
  return { path: target, derivative };
}
export async function saveAndAnalyzeAudio(req, { root, originalName, contentType }) {
  const uploadId = crypto.randomUUID(), safeName = path.basename(originalName || "audio.bin").replace(/[^a-zA-Z0-9._ -]/g, "_"), directory = storageDirectory(root, uploadId);
  fs.mkdirSync(directory, { recursive: true });
  const originalPath = path.join(directory, `original${path.extname(safeName) || ".bin"}`), hash = crypto.createHash("sha256");
  let bytes = 0;
  const audit = { schemaVersion:SCHEMA_VERSION, intakeMode:"analysis", analysisVersion:ANALYSIS_VERSION, routingPolicyVersion:ROUTING_VERSION, uploadId, status:"ingesting", originalName:safeName, contentType:contentType||"application/octet-stream", storage:{ original:{ key:`audio-intake/${uploadId}/${path.basename(originalPath)}`, sha256:null, bytes:0, immutable:true }, derivatives:[] }, media:null, measurements:null, findings:null, recommendation:null, selectedSource:"original", selectedDerivativeOperationId:null, selectedAudioSha256:null, selectionBasis:"safety-default", rx:inspectRx(), tools:{ffmpeg:null}, transcripts:{}, comparisons:[], history:[], createdAt:new Date().toISOString() };
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
export async function selectAudioSource(root,uploadId,source,reason="user-override",derivativeOperationId=null) {return mutateAudioAudit(root,uploadId,audit=>{const item=resolveAudioItem(audit,source,derivativeOperationId);audit.selectedSource=source;audit.selectedDerivativeOperationId=source==="processed"?item.operationId:null;audit.selectedAudioSha256=item.sha256;audit.selectionBasis=reason;appendHistory(audit,"source-selected",{source,reason,derivativeOperationId:audit.selectedDerivativeOperationId,audioSha256:item.sha256})})}
export function resolveAudioPath(root,audit,source=audit.selectedSource,derivativeOperationId=source==="processed"?audit.selectedDerivativeOperationId:null){return resolveKey(root,resolveAudioItem(audit,source,derivativeOperationId).key);}
function transcriptFile(root,uploadId,operationId){assertUploadId(uploadId);assertUploadId(operationId);return path.join(storageDirectory(root,uploadId),"transcripts",`${operationId}.json`)}
export async function recordTranscription(root,audit,source,transcript,derivativeOperationId=source==="processed"?audit.selectedDerivativeOperationId:null){
  const item=resolveAudioItem(audit,source,derivativeOperationId),serialized=Buffer.from(JSON.stringify(transcript)),transcriptSha256=crypto.createHash("sha256").update(serialized).digest("hex");
  const file=transcriptFile(root,audit.uploadId,transcript.operationId);atomicBuffer(file,serialized);
  const relativePath=`audio-intake/${audit.uploadId}/transcripts/${transcript.operationId}.json`;
  try{return await mutateAudioAudit(root,audit.uploadId,current=>{const currentItem=resolveAudioItem(current,source,derivativeOperationId);if(currentItem.sha256!==item.sha256)throw new Error("The selected audio changed before the transcript could be recorded.");current.transcripts[source]={operationId:transcript.operationId,requestId:transcript.requestId,model:transcript.model,provider:transcript.provider,createdAt:transcript.createdAt,audioSha256:item.sha256,derivativeOperationId:source==="processed"?item.operationId:null,transcriptSha256,path:relativePath,wordCount:Array.isArray(transcript.words)?transcript.words.length:0,confidence:transcript.confidence,keytermCount:transcript.keytermCount,diarization:transcript.diarization,audioDelivery:transcript.audioDelivery};appendHistory(current,"deepgram-transcription-completed",{source,operationId:transcript.operationId,requestId:transcript.requestId,audioSha256:item.sha256,transcriptSha256,path:relativePath,derivativeOperationId:source==="processed"?item.operationId:null})})}catch(error){fs.rmSync(file,{force:true});throw error}
}
export async function readStoredTranscript(root,audit,source=audit.selectedSource){
  const metadata=audit.transcripts?.[source];if(!metadata)return null;
  if(!metadata.path)return metadata;
  const expected=`audio-intake/${assertUploadId(audit.uploadId)}/transcripts/${assertUploadId(metadata.operationId)}.json`;if(metadata.path!==expected)throw new Error("Stored transcript path is invalid.");
  const value=await fs.promises.readFile(transcriptFile(root,audit.uploadId,metadata.operationId));const digest=crypto.createHash("sha256").update(value).digest("hex");if(digest!==metadata.transcriptSha256)throw new Error("Stored transcript integrity verification failed.");return JSON.parse(value.toString("utf8"));
}
// Records an observation. It must not change which audio is eligible for transcription --
// selection is an explicit act, performed by selectAsrSource below.
export async function recordComparison(root,audit,comparison){return mutateAudioAudit(root,audit.uploadId,current=>{
  if(!["original","processed"].includes(comparison.source))throw new Error("Transcript comparison source must be original or processed audio.");
  current.comparisons.push(comparison);
  appendHistory(current,"transcript-quality-compared",{source:comparison.source,wer:comparison.wer,criticalLegalErrorRate:comparison.criticalLegalErrorRate,referenceSha256:comparison.referenceSha256});
})}

// Pairs the most recent original and processed comparisons scored against the same human
// reference, and lets the measured result decide the ASR source.
//
// Invariant: selection never proceeds without a concrete reference hash to pair on.
// schemaVersion 1 comparison records predate `referenceSha256` and carry none, so they are
// unpairable and cannot drive a selection. This matters because `undefined === undefined`
// is true -- if an absent hash were ever compared against another absent hash, every v1
// record would "match" every other, and chooseMeasuredAsrSource could not catch it: its own
// mismatch check would be comparing the same two undefined values.
//
// Three lines hold the invariant together, and it is deliberately over-determined: the
// `find(item => item.referenceSha256)` below only ever selects a record that has one, the
// trailing `|| null` keeps an absent hash from staying `undefined`, and `if(!hash) return`
// refuses to pair without it. Removing any single one leaves the others sufficient today --
// removing the wrong two does not. The behavior is pinned by tests in
// tests/measured-asr-selection.test.mjs; change this block only with those in front of you.
export async function selectAsrSource(root,uploadId,{referenceSha256=null}={}){
  let outcome={status:"insufficient-comparisons",selection:null};
  const audit=await mutateAudioAudit(root,uploadId,current=>{
    const hash=referenceSha256||[...current.comparisons].reverse().find(item=>item.referenceSha256)?.referenceSha256||null;
    if(!hash)return;
    const matching=current.comparisons.filter(item=>item.referenceSha256&&item.referenceSha256===hash);
    const original=[...matching].reverse().find(item=>item.source==="original"),processed=[...matching].reverse().find(item=>item.source==="processed");
    if(!original||!processed)return;
    const selection=chooseMeasuredAsrSource(original,processed),processedOperationId=processed.derivativeOperationId||current.transcripts?.processed?.derivativeOperationId||null;
    const selected=selection.winner==="processed"?resolveAudioItem(current,"processed",processedOperationId):current.storage.original;
    current.automaticSelection=selection;
    current.selectedSource=selection.winner;
    current.selectedDerivativeOperationId=selection.winner==="processed"?selected.operationId:null;
    current.selectedAudioSha256=selected.sha256;
    current.selectionBasis="measured-human-reference";
    appendHistory(current,"asr-source-selected-from-human-reference",{source:selection.winner,method:selection.method,referenceSha256:hash,derivativeOperationId:current.selectedDerivativeOperationId,audioSha256:selected.sha256});
    outcome={status:"selected",selection};
  });
  return {...outcome,audit};
}
