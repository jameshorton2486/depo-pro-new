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
// A correlation peak must stand at least this many standard deviations above the rest of the
// search range before its lag is treated as a measurement rather than an argmax over noise.
const MINIMUM_PROMINENCE = 6;
// Correlation window each side of a marker. Widening this to 4096 was tried on the
// hypothesis that more material would sharpen the peak. It did not: on real De-hum output
// every offset stayed exactly 0 while prominence FELL from 4.7-8.65 to 4.19-5.28, and on
// tonal synthetic signals it broke a known 512-frame shift into 6233. Kept at 1024 because
// the evidence did not support changing it.
const ALIGNMENT_WINDOW_FRAMES = 1024;

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

// Cross-correlates a window of source audio against the derivative to find the lag that best
// matches. Correlating a WINDOW rather than picking the loudest sample is what makes this
// work for modules that modify the landmark itself: De-click's entire purpose is removing
// isolated impulses, so peak-picking a de-clicked derivative locks onto unrelated content
// and reports a large fictitious offset. The surrounding room tone, hum and speech-band
// material survive, so the window still correlates even when the marker does not.
function bestLag(sourceSamples, derivativeSamples, centre, { window = 1024, search = ALIGNMENT_SEARCH_FRAMES } = {}) {
  const from = Math.max(0, centre - window), to = Math.min(sourceSamples.length, centre + window);
  let bestScore = -Infinity, best = 0; const scores = [];
  for (let lag = -search; lag <= search; lag += 1) {
    let dot = 0;
    for (let index = from; index < to; index += 1) {
      const shifted = index + lag;
      if (shifted < 0 || shifted >= derivativeSamples.length) continue;
      dot += sourceSamples[index] * derivativeSamples[shifted];
    }
    // A plain matched filter, deliberately not energy-normalised. Dividing by the window's
    // energy is the textbook move for detecting whether a template is present, and it is
    // wrong here: at the correct lag both windows contain the same loud transient, so the
    // energy term is largest exactly where the answer is right and normalising suppresses
    // it. Measured directly -- normalised scoring returned 3418 and -7841 on signals shifted
    // by a known 512 frames, while the plain dot product returned 512 in both.
    scores.push(dot);
    if (dot > bestScore) { bestScore = dot; best = lag; }
  }
  // How far the winning lag stands above the rest, in standard deviations.
  //
  // An argmax always returns something. When a module has altered the audio enough that no
  // lag matches well, the correlation surface is flat and the winner is essentially noise --
  // which is how De-click produced 0 at 5s, +7932 at 15s and -6469 at 50s on the same file,
  // three answers that cannot all describe one time shift. Reporting the number without this
  // is how a measurement turns into a confident fiction.
  const mean = scores.reduce((total, value) => total + value, 0) / scores.length;
  const variance = scores.reduce((total, value) => total + (value - mean) ** 2, 0) / scores.length;
  const deviation = Math.sqrt(variance);
  return { lag:best, prominence: deviation > 0 ? (bestScore - mean) / deviation : 0 };
}

function bestLagRange(sourceSamples, derivativeSamples, from, to, lagFrom, lagTo) {
  let bestScore = -Infinity, best = lagFrom;
  for (let lag = lagFrom; lag <= lagTo; lag += 1) {
    let dot = 0;
    for (let index = from; index < to; index += 1) {
      const shifted = index + lag;
      if (shifted < 0 || shifted >= derivativeSamples.length) continue;
      dot += sourceSamples[index] * derivativeSamples[shifted];
    }
    if (dot > bestScore) { bestScore = dot; best = lag; }
  }
  return best;
}

// Mean-removed amplitude envelope. The mean matters: an envelope is all-positive, so
// without removing it every lag scores highly and the correlation peak is flat.
function envelope(samples, factor) {
  const length = Math.floor(samples.length / factor);
  const out = new Float64Array(length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (let step = 0; step < factor; step += 1) sum += Math.abs(samples[index * factor + step]);
    out[index] = sum / factor;
    total += out[index];
  }
  const mean = length ? total / length : 0;
  for (let index = 0; index < length; index += 1) out[index] -= mean;
  return out;
}

/**
 * Marker-free bulk alignment: correlates the whole file, coarsely on a decimated envelope
 * and then refined at full rate.
 *
 * This exists because measuring a module with landmarks it is designed to destroy is
 * circular. De-click removes isolated impulses, so per-marker alignment on its output says
 * as much about the fixture as the plug-in. A whole-file correlation answers the question
 * that actually matters -- is the audio bulk-shifted in time -- without depending on any
 * single landmark surviving.
 */
export function measureGlobalAlignment(sourceSamples, derivativeSamples, { maxLag = ALIGNMENT_SEARCH_FRAMES, decimation = 64 } = {}) {
  const coarseSource = envelope(sourceSamples, decimation), coarseDerivative = envelope(derivativeSamples, decimation);
  const coarseLimit = Math.ceil(maxLag / decimation);
  const coarse = bestLagRange(coarseSource, coarseDerivative, 0, coarseSource.length, -coarseLimit, coarseLimit) * decimation;
  const centre = Math.floor(sourceSamples.length / 2);
  const half = Math.min(1 << 17, Math.floor(sourceSamples.length / 4));
  const refined = half > 0
    ? bestLagRange(sourceSamples, derivativeSamples, centre - half, centre + half, coarse - decimation * 2, coarse + decimation * 2)
    : coarse;
  return { coarseOffsetFrames:coarse, offsetFrames:refined, aligned:refined === 0, decimation, maxLag };
}

/**
 * Alignment sampled at chosen positions rather than at markers, to separate a step from
 * progressive drift.
 *
 * RECORDED WITH A CAVEAT: on stationary content this is not informative, and the control
 * proves it. Voice De-noise is aligned by both other methods -- whole-file correlation 0,
 * marker offsets 0 to 15 frames at uniform 8.5+ prominence, markers 84-93% retained -- yet
 * this sweep returned -8018, -8019, -8019, 6380, 0, 6382 on the same render. Away from a
 * landmark there is only room tone and quasi-periodic hum, which correlates ambiguously at
 * many lags. Read it as corroboration when it agrees, never as evidence when it does not.
 */
/**
 * Whole-file alignment, measured at two search widths and only trusted when they agree.
 *
 * This is the alignment test to gate on, and the stability check is the point of it.
 *
 * A cross-correlation argmax always returns a number. For a module that merely filters --
 * De-hum, Voice De-noise -- input and output really are related by a time shift, and every
 * estimator agrees: De-hum returns 0 at both +/-8192 and +/-48000, on two different fixtures,
 * coarse and refined. For a module that reshapes the waveform -- De-click removing
 * transients, De-reverb removing tails -- there is no true lag to find, and the estimate
 * moves with whatever range you searched: De-click gave -90 at +/-8192 and +31931 at
 * +/-48000; De-reverb gave 6506 and 9727.
 *
 * Disagreement between search widths is therefore the signal that the question has no
 * answer for this module, and it must be reported as indeterminate rather than as a shift.
 * Neither number is a latency.
 */
export function measureStableGlobalAlignment(sourceSamples, derivativeSamples, { searches = [ALIGNMENT_SEARCH_FRAMES, 48_000], decimation = 64 } = {}) {
  const measurements = searches.map(maxLag => measureGlobalAlignment(sourceSamples, derivativeSamples, { maxLag, decimation }));
  const distinct = [...new Set(measurements.map(item => item.offsetFrames))];
  const stable = distinct.length === 1;
  return {
    measurements, stable,
    offsetFrames: stable ? distinct[0] : null,
    aligned: stable && distinct[0] === 0,
    indeterminate: !stable,
    note: stable ? null : `Whole-file correlation returned different offsets at different search widths (${measurements.map(item => `${item.offsetFrames} at +/-${item.maxLag}`).join(", ")}). The relationship between input and output is not a time shift, so no offset is being measured.`,
  };
}

/**
 * Does the landmark survive the module?
 *
 * Validating a marker style against the fixture is necessary and not sufficient. Burst
 * markers self-correlate at 8.48-8.52 prominence in the source, but a 3.3 kHz burst is
 * exactly the kind of thing De-reverb might smear or a de-noiser might attenuate as
 * non-speech. If the marker is gone from the output, a marker-based alignment measurement is
 * measuring nothing regardless of how clean it looked going in.
 *
 * Retention is the derivative's local peak over the source's, per marker. It is recorded
 * rather than thresholded, because what counts as "survived" depends on the module -- but a
 * marker measurement taken where retention is near zero should not be believed.
 *
 * Measured, and it closes the causal chain behind every alignment failure seen so far.
 * Retention predicts prominence predicts whether the offset means anything:
 *
 *   De-click       retention 1, 1, 1, 0.138, 0.132   prominence 8.48, 8.50, 8.46, 4.02, 3.71
 *   De-reverb      retention 1, 1, 1, 0.111, 0.110   prominence 8.48, 8.50, 8.46, 3.69, 3.04
 *   Voice De-noise retention 0.93, 0.85, 0.84, 0.84, 0.84   prominence 8.50 - 8.56 throughout
 *
 * The markers that survive give offset 0 at high prominence. The markers reduced to ~12% give
 * noise. And retention is exactly 1.0 for the three markers inside the first ten-second chunk
 * and ~0.12 for the two after it -- under reset=first_block the plug-in starts each render
 * fresh, so early content passes through lightly processed while later content does not.
 *
 * That makes chunk non-invariance and marker-based alignment failure one phenomenon with two
 * symptoms, not two findings: the same cross-chunk state that changes the output with block
 * size is what destroys the landmarks later in the file. Burst markers did NOT rescue these
 * two modules -- the instrument is unimproved for them past the first chunk, which is why
 * whole-file correlation is what alignment gates on.
 */
export function measureMarkerSurvival(sourceSamples, derivativeSamples, { window = 2048 } = {}) {
  return findTransients(sourceSamples).map(frame => {
    const from = Math.max(0, frame - window), to = Math.min(sourceSamples.length, frame + window);
    let sourcePeak = 0, derivativePeak = 0;
    for (let index = from; index < to; index += 1) {
      const source = Math.abs(sourceSamples[index]);
      if (source > sourcePeak) sourcePeak = source;
      if (index < derivativeSamples.length) {
        const derivative = Math.abs(derivativeSamples[index]);
        if (derivative > derivativePeak) derivativePeak = derivative;
      }
    }
    return { sourceFrame:frame, sourcePeak, derivativePeak, retention: sourcePeak ? Number((derivativePeak / sourcePeak).toFixed(3)) : null };
  });
}

export function measureAlignmentAtPositions(sourceSamples, derivativeSamples, positionsSeconds, { sampleRate = 48_000, window = 4096, search = ALIGNMENT_SEARCH_FRAMES } = {}) {
  return positionsSeconds
    .map(seconds => ({ seconds, centre:Math.round(seconds * sampleRate) }))
    .filter(item => item.centre < sourceSamples.length)
    .map(item => { const { lag, prominence } = bestLag(sourceSamples, derivativeSamples, item.centre, { window, search }); return { atSeconds:item.seconds, offsetFrames:lag, prominence:Number(prominence.toFixed(2)), distinctive:prominence >= MINIMUM_PROMINENCE }; });
}

// For each marker in the source, reports the signed frame offset at which the surrounding
// audio best matches in the derivative. The offset is the diagnosis: a constant non-zero
// value across every marker is fixed plug-in latency, which can be compensated
// deterministically; a varying one cannot. A boolean would throw that distinction away.
export function measureAlignment(sourceSamples, derivativeSamples, { search = ALIGNMENT_SEARCH_FRAMES } = {}) {
  const markers = findTransients(sourceSamples);
  const offsets = markers.map(frame => {
    const { lag, prominence } = bestLag(sourceSamples, derivativeSamples, frame, { search, window:ALIGNMENT_WINDOW_FRAMES });
    return { sourceFrame:frame, derivativeFrame:frame + lag, offsetFrames:lag, prominence:Number(prominence.toFixed(2)), distinctive:prominence >= MINIMUM_PROMINENCE };
  });
  const values = offsets.map(item => item.offsetFrames);
  const distinct = [...new Set(values)];
  return {
    markers: markers.length,
    offsets,
    maxAbsoluteOffsetFrames: values.length ? Math.max(...values.map(Math.abs)) : null,
    constantOffset: distinct.length === 1 ? distinct[0] : null,
    // Three states, not two.
    //
    // `indeterminate` is disagreement between markers. One time shift is one number, so five
    // markers reporting different lags is not a measurement of anything -- it means the
    // correlation could not resolve a lag, which must not be recorded as a shift in either
    // direction. De-click produced [0, 0, 0, -6469, -6468]; the two outliers also carried
    // the lowest prominence of any measurement taken.
    //
    // Gating on `prominence` directly was tried and abandoned: it is reported because it
    // ranked those outliers correctly, but it is not calibrated well enough to threshold on.
    // Widening the correlation window from 1024 to 4096 frames LOWERED it (De-hum 4.7-8.65
    // became 4.19-5.28) while every De-hum offset stayed exactly 0. Agreement across five
    // independent markers is the robust signal; peak sharpness is a diagnostic.
    indeterminate: values.length > 0 && distinct.length > 1,
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
  const derivativePath = path.join(root, "data", ...derivative.key.split("/"));
  // Determinism and chunk invariance must compare AUDIO, not the container.
  //
  // createRxDerivative writes provenance into FLAC metadata, including DEPO_PRO_OPERATION_ID
  // and DEPO_PRO_UPLOAD_ID, both fresh per render. Comparing derivative.sha256 therefore
  // compares two unique UUIDs and can never match -- it reports every profile as
  // non-deterministic regardless of what the plug-in actually did. Hashing the decoded PCM
  // stream measures the rendered signal, which is the thing the claim is about.
  const audioSha256 = crypto.createHash("sha256").update(await run("ffmpeg", ["-v","error","-nostdin","-i",derivativePath,"-map","0:a:0","-f","s16le","-acodec","pcm_s16le","-"])).digest("hex");
  return { root, derivative, elapsedMs, derivativePath, audioSha256 };
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
  record.results.determinism = { firstAudioSha256:first.audioSha256, secondAudioSha256:second.audioSha256, firstContainerSha256:first.derivative.sha256, secondContainerSha256:second.derivative.sha256, separateProcesses:true, comparedOn:"decoded PCM; container hashes differ by design because provenance metadata is unique per render", passed:first.audioSha256 === second.audioSha256 };

  // Test 3 -- chunk invariance. If output differs, chunk size is part of profile identity
  // and the qualified value becomes mandatory rather than incidental.
  const alternate = await renderOnce(fixturePath, ids, { chunkSeconds:alternateChunkSeconds, workRoot, now });
  record.results.chunkInvariance = { chunkSeconds:DEFAULT_CHUNK_SECONDS, alternateChunkSeconds, audioSha256:first.audioSha256, alternateAudioSha256:alternate.audioSha256, comparedOn:"decoded PCM", passed:first.audioSha256 === alternate.audioSha256 };

  // Test 2 -- time alignment. The one the frame-parity check cannot substitute for: equal
  // length says nothing about equal position.
  const sourceSamples = await decodeMonoPcm(fixturePath);
  const derivativeSamples = await decodeMonoPcm(first.derivativePath);
  const alignment = measureAlignment(sourceSamples, derivativeSamples);
  // Whole-file correlation decides; per-marker measurement corroborates. The markers use
  // 2048 samples against up to 96001 candidate lags, which is underdetermined -- the global
  // measurement uses every sample in the file.
  const global = measureStableGlobalAlignment(sourceSamples, derivativeSamples);
  // Two independent methods, recorded together. Whole-file correlation decides because it
  // does not depend on a landmark surviving the module; the per-marker and per-position
  // measurements corroborate it. Agreement between methods is a far stronger record than one
  // method with better markers, and disagreement is itself worth having on file.
  //
  // The position sweep exists to separate a step from drift. Every failing module so far
  // reads 0 inside the first ten-second chunk and loses the lock later, which tracks exactly
  // with chunk-one-versus-the-rest under reset=first_block -- plausibly one phenomenon with
  // two symptoms rather than two findings.
  const positions = measureAlignmentAtPositions(sourceSamples, derivativeSamples, [5, 15, 25, 50, 150, 290]);
  const markerSurvival = measureMarkerSurvival(sourceSamples, derivativeSamples);
  record.results.alignment = { ...alignment, markerAligned:alignment.aligned, markerSurvival, positions, global, passed:global.aligned };
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
