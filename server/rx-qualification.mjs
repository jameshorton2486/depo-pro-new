// Profile qualification protocol.
//
// A profile in the catalog carries `asrSafe`, and an `asrSafe: true` profile is selectable
// by an operator today. That flag is currently a prior, not a measurement. This module turns
// it into one: no RX module should stay in the ASR class without a qualification record
// showing it is deterministic, time-aligned, and chunk-invariant against a known fixture.
//
// The output is a record, not an assertion. A profile that FAILS must be recorded as failing
// rather than left absent, because absence reads the same as "not yet run" -- and a profile
// with no record still ships with whatever asrSafe value it was given by hand.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { inspectRx } from "./rx-adapter.mjs";
import { AUDIO_TOOL_PROFILES } from "./rx-profiles.mjs";
import { createRxDerivative, DEFAULT_CHUNK_SECONDS } from "./rx-processing.mjs";

export const QUALIFICATION_VERSION = "rx-qualification-v1";
export const ALTERNATE_CHUNK_SECONDS = 30;
// A transient must clear this fraction of the fixture's peak to count as a marker, and two
// markers closer than this many frames are treated as one.
const TRANSIENT_THRESHOLD = 0.5;
const TRANSIENT_SEPARATION_FRAMES = 2048;
// How far either side of a source transient to look for its counterpart. Wide enough to
// catch a plug-in's reported latency, narrow enough not to lock onto a neighbouring marker.
const ALIGNMENT_SEARCH_FRAMES = 8192;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide:true, stdio:["ignore","pipe","pipe"] });
    const out = [], err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString("utf8").trim() || `${command} exited ${code}`)));
  });
}

export async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// Decodes to mono signed 16-bit PCM. Channel-summed on purpose: a transient marker is a
// timing landmark, and mixing to one channel makes its position unambiguous.
export async function decodeMonoPcm(file, { runDecoder = run } = {}) {
  const raw = await runDecoder("ffmpeg", ["-v","error","-nostdin","-i",file,"-map","0:a:0","-vn","-ac","1","-f","s16le","-acodec","pcm_s16le","-"]);
  return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
}

// Returns frame indices of impulse markers, strongest-first suppression so each marker is
// reported once rather than once per sample above threshold.
export function findTransients(samples, { threshold = TRANSIENT_THRESHOLD, separation = TRANSIENT_SEPARATION_FRAMES } = {}) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) { const value = Math.abs(samples[index]); if (value > peak) peak = value; }
  if (!peak) return [];
  const floor = peak * threshold, found = [];
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) < floor) continue;
    let best = index, bestValue = Math.abs(samples[index]);
    const limit = Math.min(samples.length, index + separation);
    for (let scan = index + 1; scan < limit; scan += 1) { const value = Math.abs(samples[scan]); if (value > bestValue) { bestValue = value; best = scan; } }
    found.push(best);
    index = best + separation;
  }
  return found;
}

// For each marker in the source, finds the strongest sample within the search window in the
// derivative and reports the signed frame offset. The offset is the diagnosis: a constant
// non-zero value across every marker is fixed plug-in latency, which can be compensated
// deterministically; a varying one cannot. A boolean would throw that distinction away.
export function measureAlignment(sourceSamples, derivativeSamples, { search = ALIGNMENT_SEARCH_FRAMES } = {}) {
  const markers = findTransients(sourceSamples);
  const offsets = markers.map(frame => {
    const start = Math.max(0, frame - search), end = Math.min(derivativeSamples.length, frame + search + 1);
    let best = start, bestValue = -1;
    for (let index = start; index < end; index += 1) { const value = Math.abs(derivativeSamples[index]); if (value > bestValue) { bestValue = value; best = index; } }
    return { sourceFrame:frame, derivativeFrame:best, offsetFrames:best - frame };
  });
  const values = offsets.map(item => item.offsetFrames);
  const distinct = [...new Set(values)];
  return {
    markers: markers.length,
    offsets,
    maxAbsoluteOffsetFrames: values.length ? Math.max(...values.map(Math.abs)) : null,
    constantOffset: distinct.length === 1 ? distinct[0] : null,
    aligned: values.length > 0 && values.every(value => value === 0),
  };
}

async function renderOnce(fixturePath, profileIds, { chunkSeconds = DEFAULT_CHUNK_SECONDS, workRoot, now = () => Date.now() } = {}) {
  const root = fs.mkdtempSync(path.join(workRoot, "run-"));
  const uploadId = crypto.randomUUID(), directory = path.join(root, "data", "audio-intake", uploadId);
  const originalPath = path.join(directory, `original${path.extname(fixturePath) || ".wav"}`);
  fs.mkdirSync(directory, { recursive:true });
  fs.copyFileSync(fixturePath, originalPath);
  const sourceSha256 = await sha256File(originalPath);
  const audit = { uploadId, storage:{ original:{ key:`audio-intake/${uploadId}/${path.basename(originalPath)}`, immutable:true, sha256:sourceSha256 }, derivatives:[] } };
  const startedMs = now();
  const derivative = await createRxDerivative(root, audit, { originalPath, profileIds, chunkSeconds, recordAuditEvent:async()=>{} });
  const elapsedMs = now() - startedMs;
  return { root, derivative, elapsedMs, derivativePath:path.join(root, "data", ...derivative.key.split("/")) };
}

function pluginBinaries(profileIds, { pluginRoot = process.env.RX_VST3_ROOT || "C:\\Program Files\\Common Files\\VST3\\iZotope" } = {}) {
  return profileIds.map(id => AUDIO_TOOL_PROFILES[id]).filter(profile => profile?.engine === "rx").map(profile => path.join(pluginRoot, profile.pluginFile));
}

/**
 * Runs the full protocol for one profile or chain and returns a qualification record.
 * Never throws for a qualification failure -- a failing profile is a recorded outcome. It
 * throws only when the run could not be performed at all (missing fixture, missing plug-in).
 */
export async function qualifyProfile({ fixturePath, profileIds, workRoot = fs.mkdtempSync(path.join(process.env.TEMP || "/tmp", "depo-rx-qual-")), alternateChunkSeconds = ALTERNATE_CHUNK_SECONDS, now = () => Date.now(), at = () => new Date().toISOString() }) {
  if (!fixturePath || !fs.existsSync(fixturePath)) throw new Error("Qualification requires an existing audio fixture.");
  const ids = [...profileIds];
  const fixtureSha256 = await sha256File(fixturePath);
  const binaries = pluginBinaries(ids);
  const pluginHashes = {};
  for (const binary of binaries) pluginHashes[path.basename(binary)] = fs.existsSync(binary) ? await sha256File(binary) : null;

  const record = {
    qualificationVersion: QUALIFICATION_VERSION, profileIds: ids, at: at(),
    fixture: { path:fixturePath, sha256:fixtureSha256 },
    rx: inspectRx(), pluginBinarySha256: pluginHashes,
    results: {}, passed: false, failures: [],
  };

  const first = await renderOnce(fixturePath, ids, { chunkSeconds:DEFAULT_CHUNK_SECONDS, workRoot, now });
  const sourceMedia = first.derivative.sourceMedia;
  const durationSeconds = sourceMedia.sampleFrames / sourceMedia.sampleRate;
  record.worker = { host:first.derivative.host, hostVersion:first.derivative.hostVersion, numpyVersion:first.derivative.numpyVersion, chunkSeconds:first.derivative.renderChunkSeconds };
  record.modules = first.derivative.modules?.map(item => ({ profileId:item.profileId, plugin:item.plugin, manufacturer:item.manufacturer, pluginVersion:item.pluginVersion })) ?? [];

  // Test 4 -- frame parity, over a fixture long enough to run the loop many times. The
  // worker enforces this per block; what matters here is accumulation across many blocks.
  record.results.frameParity = {
    sourceFrames: sourceMedia.sampleFrames, derivativeFrames: first.derivative.media.sampleFrames,
    chunksRun: Math.ceil(durationSeconds / (first.derivative.renderChunkSeconds || DEFAULT_CHUNK_SECONDS)),
    passed: first.derivative.media.sampleFrames === sourceMedia.sampleFrames,
  };

  // Real-time factor. Free to capture, and the input to any honest duration estimate: at
  // 0.5x a six-hour deposition is a twelve-hour render on the reporter's own machine.
  record.results.realTimeFactor = { elapsedMs:first.elapsedMs, audioSeconds:durationSeconds, factor:durationSeconds ? (first.elapsedMs / 1000) / durationSeconds : null };

  // Test 1 -- determinism, across SEPARATE worker invocations. Two passes inside one process
  // would only show that identical in-memory state yields identical output, which is close
  // to tautological. The failure worth catching is per-process variation: seeded RNG, thread
  // pool sizing, model load order. createRxDerivative spawns a fresh interpreter per call.
  const second = await renderOnce(fixturePath, ids, { chunkSeconds:DEFAULT_CHUNK_SECONDS, workRoot, now });
  record.results.determinism = { firstSha256:first.derivative.sha256, secondSha256:second.derivative.sha256, separateProcesses:true, passed:first.derivative.sha256 === second.derivative.sha256 };

  // Test 3 -- chunk invariance. If output differs, chunk size is part of profile identity
  // and the qualified value becomes mandatory rather than incidental.
  const alternate = await renderOnce(fixturePath, ids, { chunkSeconds:alternateChunkSeconds, workRoot, now });
  record.results.chunkInvariance = { chunkSeconds:DEFAULT_CHUNK_SECONDS, alternateChunkSeconds, sha256:first.derivative.sha256, alternateSha256:alternate.derivative.sha256, passed:first.derivative.sha256 === alternate.derivative.sha256 };

  // Test 2 -- time alignment. The one the frame-parity check cannot substitute for: equal
  // length says nothing about equal position.
  const sourceSamples = await decodeMonoPcm(fixturePath);
  const derivativeSamples = await decodeMonoPcm(first.derivativePath);
  const alignment = measureAlignment(sourceSamples, derivativeSamples);
  record.results.alignment = { ...alignment, passed:alignment.aligned };
  if (!alignment.markers) record.results.alignment.note = "No transient markers found in the fixture; alignment was not measured.";

  for (const [name, result] of Object.entries(record.results)) if (result.passed === false) record.failures.push(name);
  // Real-time factor is a measurement, not a gate.
  record.failures = record.failures.filter(name => name !== "realTimeFactor");
  record.passed = record.failures.length === 0 && Boolean(alignment.markers);
  record.asrClassEligible = record.passed;

  for (const item of [first, second, alternate]) fs.rmSync(item.root, { recursive:true, force:true });
  return record;
}

export function writeQualificationRecord(directory, record) {
  fs.mkdirSync(directory, { recursive:true });
  const file = path.join(directory, `${record.profileIds.join("+")}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}

export const _testing = { run, renderOnce, pluginBinaries };
