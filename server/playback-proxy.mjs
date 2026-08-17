// A browser-playable copy of audio the browser cannot decode.
//
// The Etminan recording is pcm_s24le -- 24-bit PCM, 48 kHz stereo, 1.37 GB. Chrome decodes 8-
// and 16-bit PCM WAV and refuses 24-bit: MEDIA_ERR_SRC_NOT_SUPPORTED, duration 0. Labelling the
// content type correctly was necessary and did not make it playable.
//
// This is a PLAYBACK_PROXY, a kind that already existed in audio-kinds.mjs and is deliberately
// absent from ASR_ELIGIBLE_KINDS, so it can never be transcribed. That exclusion is what makes
// a lossy proxy safe: the 24-bit original stays immutable and remains the evidence, and the
// proxy exists only so a reporter can hear what they are reading.
//
// Channel count is preserved. A mono downmix would be smaller and would destroy the separation
// between a Zoom feed and a videographer feed -- which is precisely what resolves overlapping
// speech, the one thing the audio is needed for.
//
// Opus carries encoder pre-skip. Ogg signals it and decoders are expected to honour it, but
// "expected to" is not measured, and a 6 ms shift plays perfectly while making every paragraph
// seek land slightly wrong. measureProxyAlignment exists so the delta is a number in the record
// rather than an assumption.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const PROXY_PROFILE = Object.freeze({
  id:"playback-opus-v1", version:"1.0.0", codec:"libopus", container:"ogg",
  bitrateKbps:64, application:"audio", purpose:"Browser playback only; never eligible for transcription.",
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide:true, stdio:["ignore","pipe","pipe"] });
    const out = [], err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.once("error", reject);
    child.once("close", code => {
      const stderr = Buffer.concat(err).toString("utf8");
      if (code !== 0) reject(new Error(stderr.trim().split(/\r?\n/).slice(-3).join(" ") || `${command} exited ${code}`));
      else resolve(`${Buffer.concat(out).toString("utf8")}\n${stderr}`);
    });
  });
}

async function probe(file) {
  const text = await run("ffprobe", ["-v","error","-show_entries","format=duration:stream=codec_name,sample_rate,channels","-of","json",file]);
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const stream = json.streams?.find(item => item.codec_name) ?? {};
  return { durationSeconds:Number(json.format?.duration ?? 0), codec:stream.codec_name ?? null, sampleRate:Number(stream.sample_rate ?? 0), channels:Number(stream.channels ?? 0) };
}

/** Decodes a window to mono 16 kHz float samples, for correlation. */
async function pcm(file, startSeconds, durationSeconds) {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner","-loglevel","error","-ss",String(startSeconds),"-t",String(durationSeconds),"-i",file,"-map","0:a:0","-ac","1","-ar","16000","-f","f32le","pipe:1"], { windowsHide:true, stdio:["ignore","pipe","pipe"] });
    const out = [], err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString("utf8").trim() || `ffmpeg exited ${code}`)));
  });
  const samples = new Float32Array(raw.length >> 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = raw.readFloatLE(index * 4);
  return samples;
}

/**
 * Measures the proxy's time offset against its source, in samples at 16 kHz.
 *
 * Plain cross-correlation, not energy-normalised -- the same choice the RX qualification made,
 * after a normalised matched filter returned 3418 on a known 512-frame shift while a plain dot
 * product returned 512.
 *
 * Returns `{ shiftSamples, shiftMs, confidence }`, or `{ indeterminate:true, reason }` when no
 * peak stands out. An indeterminate result is a finding, not a zero.
 */
export function correlate(reference, candidate, maxLagSamples = 400, { guardBand = 4 } = {}) {
  const length = Math.min(reference.length, candidate.length);
  if (length < maxLagSamples * 4) return { indeterminate:true, reason:"WINDOW_TOO_SHORT" };
  const curve = [];
  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag += 1) {
    let sum = 0;
    for (let index = maxLagSamples; index < length - maxLagSamples; index += 8) sum += reference[index] * candidate[index + lag];
    curve.push({ lag, magnitude:Math.abs(sum) });
  }
  const best = curve.reduce((strongest, item) => item.magnitude > strongest.magnitude ? item : strongest);
  if (best.magnitude <= 0) return { indeterminate:true, reason:"NO_CORRELATION_PEAK" };
  // The runner-up must sit outside a guard band around the peak.
  //
  // Without one, this reported PEAK_NOT_DISTINCT on a proxy that is perfectly aligned: the
  // comparison was against lag +/-1, which is adjacent to any genuine peak and therefore always
  // close to it (554 against 533, a ratio of 1.04). The curve was a clean symmetric peak at
  // lag 0 the whole time. Measured outside the band the ratio is 1.47 to 1.70.
  const rival = curve.filter(item => Math.abs(item.lag - best.lag) > guardBand).reduce((strongest, item) => item.magnitude > strongest.magnitude ? item : strongest, { magnitude:0, lag:null });
  const confidence = rival.magnitude > 0 ? best.magnitude / rival.magnitude : Infinity;
  if (confidence < 1.15) return { indeterminate:true, reason:"PEAK_NOT_DISTINCT", confidence:Number(confidence.toFixed(3)) };
  return { shiftSamples:best.lag, shiftMs:Number(((best.lag / 16000) * 1000).toFixed(3)), confidence:Number.isFinite(confidence) ? Number(confidence.toFixed(3)) : null };
}

export async function measureProxyAlignment(sourceFile, proxyFile, { windows = [30, 300, 1200] } = {}) {
  const measurements = [];
  for (const start of windows) {
    try {
      const [reference, candidate] = await Promise.all([pcm(sourceFile, start, 8), pcm(proxyFile, start, 8)]);
      measurements.push({ atSeconds:start, ...correlate(reference, candidate) });
    } catch (error) { measurements.push({ atSeconds:start, indeterminate:true, reason:"WINDOW_UNREADABLE", detail:error instanceof Error ? error.message : String(error) }); }
  }
  const resolved = measurements.filter(item => !item.indeterminate);
  if (!resolved.length) return { aligned:false, indeterminate:true, measurements, message:"Proxy alignment could not be measured in any window." };
  const shifts = [...new Set(resolved.map(item => item.shiftSamples))];
  const consistent = shifts.length === 1;
  return {
    aligned:consistent && shifts[0] === 0,
    indeterminate:false, consistent,
    shiftSamples:consistent ? shifts[0] : null,
    shiftMs:consistent ? resolved[0].shiftMs : null,
    measurements,
    message:consistent
      ? (shifts[0] === 0 ? "Proxy is sample-aligned with the source." : `Proxy is offset by ${shifts[0]} samples (${resolved[0].shiftMs} ms) at 16 kHz. Seeks will land by that much. Not compensated.`)
      : `Offset differs between windows (${shifts.join(", ")} samples), so no single figure describes it.`,
  };
}

/**
 * The ffmpeg invocation, separated so the channel-preservation property is testable without
 * rendering. A test that only inspected the profile passed a mutation that hardcoded `-ac 1`
 * here -- the downmix would have been in the command while the profile still looked correct.
 */
export function proxyRenderArgs({ sourceFile, targetFile, channels, profile = PROXY_PROFILE }) {
  if (!Number.isInteger(channels) || channels < 1) throw new Error("The source channel count must be known before rendering a proxy.");
  return ["-y","-hide_banner","-loglevel","error","-i",sourceFile,"-map","0:a:0","-vn",
    "-c:a",profile.codec,"-b:a",`${profile.bitrateKbps}k`,"-application",profile.application,
    // Carried from the source rather than left to ffmpeg's default.
    "-ac",String(channels),"-ar","48000",targetFile];
}

/** Renders the proxy. Returns the derivative record; the caller stores it. */
export async function renderPlaybackProxy({ sourceFile, targetFile, sourceSha256, profile = PROXY_PROFILE }) {
  const source = await probe(sourceFile);
  if (!source.channels) throw new Error("The source has no readable audio stream.");
  fs.mkdirSync(path.dirname(targetFile), { recursive:true });
  const args = proxyRenderArgs({ sourceFile, targetFile, channels:source.channels, profile });
  await run("ffmpeg", args);
  const proxy = await probe(targetFile);
  const alignment = await measureProxyAlignment(sourceFile, targetFile);
  return {
    kind:"playback-proxy", key:null, file:targetFile, bytes:fs.statSync(targetFile).size,
    sourceSha256, tool:"ffmpeg", profileId:profile.id, profileVersion:profile.version,
    commandArguments:args.map(item => item === sourceFile ? "SOURCE" : item === targetFile ? "TARGET" : item),
    media:{ codec:proxy.codec, sampleRate:proxy.sampleRate, channels:proxy.channels, durationSeconds:proxy.durationSeconds },
    sourceMedia:source,
    channelsPreserved:proxy.channels === source.channels,
    // A proxy is lossy and its timeline is only as trustworthy as the measurement below says.
    timelinePreserved:alignment.aligned === true,
    selectableForTranscription:false,
    alignment,
    purpose:profile.purpose,
    createdAt:new Date().toISOString(),
  };
}
