import assert from "node:assert/strict";
import test from "node:test";
import { ASR_ELIGIBLE_KINDS, DERIVATIVE_KINDS } from "../server/audio-kinds.mjs";
import { PROXY_PROFILE, correlate, proxyRenderArgs } from "../server/playback-proxy.mjs";

// Speech-like: filtered noise under a slowly varying envelope. Aperiodic, so its
// autocorrelation has one sharp peak.
//
// The first version of this fixture was a sum of sines, and it failed -- correctly. A strongly
// periodic signal genuinely is ambiguous under correlation, because the peak recurs at every
// period and no lag dominates. That is a real property worth its own test below, but it is not
// what speech looks like, so using it as the ordinary fixture tested the pathological case and
// nothing else.
function signal(length, seed = 1) {
  const out = new Float32Array(length);
  let state = seed >>> 0 || 1, previous = 0;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const white = state / 0x7fffffff - 0.5;
    // 0.93 is chosen, not arbitrary: it reproduces the correlation length measured on the real
    // pair. Against the actual Opus proxy the peak was 554 at lag 0, 533 at lag 1 and 377 at
    // lag 5 -- ratios of 1.04 without a guard band and 1.47 with one. This fixture gives 1.073
    // and 1.475. A smoother or sharper signal would not exercise the guard band at all.
    previous = previous * 0.93 + white * 0.07; // one-pole low-pass, matched to real speech
    out[index] = previous * (0.55 + 0.45 * Math.sin(index / 1700)); // syllable-rate envelope
  }
  return out;
}
function periodic(length) {
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) out[index] = Math.sin(index / 9) * 0.6 + Math.sin(index / 23) * 0.4;
  return out;
}
const shifted = (source, lag) => {
  const out = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) { const from = index - lag; out[index] = from >= 0 && from < source.length ? source[from] : 0; }
  return out;
};

test("a proxy can never be transcribed",()=>{
  // The whole safety argument for a lossy proxy. If PLAYBACK_PROXY ever became ASR-eligible,
  // a 64 kbps Opus render could reach Deepgram and become the evidentiary transcript.
  assert.equal(ASR_ELIGIBLE_KINDS.has(DERIVATIVE_KINDS.PLAYBACK_PROXY),false);
  assert.equal(DERIVATIVE_KINDS.PLAYBACK_PROXY,"playback-proxy");
});

test("the render command preserves the source channel count",()=>{
  // Asserted on the command, not the profile. A mutation that hardcoded `-ac 1` in the ffmpeg
  // arguments survived a test that only inspected the profile -- the downmix was in the command
  // while the profile still read correctly.
  //
  // A mono downmix is smaller and destroys the separation between a Zoom feed and a
  // videographer feed, which is what resolves overlapping speech -- the one thing a reporter
  // needs the audio for.
  for (const channels of [1, 2, 4]) {
    const args = proxyRenderArgs({ sourceFile:"in.wav", targetFile:"out.ogg", channels });
    const at = args.indexOf("-ac");
    assert.ok(at > 0,"the command must set the channel count explicitly");
    assert.equal(args[at + 1], String(channels), `${channels}-channel source must render ${channels} channels`);
  }
  assert.equal(PROXY_PROFILE.codec,"libopus");
  assert.equal(PROXY_PROFILE.container,"ogg");
});

test("a proxy is refused when the source channel count is unknown",()=>{
  // Guessing here is how a downmix happens quietly.
  for (const channels of [0, null, undefined, 1.5, "2"]) {
    assert.throws(()=>proxyRenderArgs({ sourceFile:"in.wav", targetFile:"out.ogg", channels }));
  }
});

test("an aligned pair measures zero shift",()=>{
  const reference = signal(24000);
  const result = correlate(reference, Float32Array.from(reference));
  assert.equal(result.shiftSamples,0);
  assert.equal(result.shiftMs,0);
});

test("a known offset is recovered exactly, in both directions",()=>{
  // Opus pre-skip is the case this exists for: a shift that plays cleanly and makes every
  // paragraph seek land slightly wrong -- the same failure shape as a reversed suffix range.
  const reference = signal(24000);
  for (const lag of [1, 7, -7, 104, -104, 312]) {
    const result = correlate(reference, shifted(reference, lag));
    assert.equal(result.shiftSamples, lag, `a ${lag}-sample offset must be recovered`);
  }
});

test("the runner-up is measured outside a guard band around the peak",()=>{
  // Without a guard band this reported PEAK_NOT_DISTINCT on a proxy that was perfectly aligned:
  // it compared the peak against lag +/-1, which is adjacent to any real peak and therefore
  // always close to it -- 554 against 533, a ratio of 1.04. The curve was a clean symmetric
  // peak at lag 0 throughout. Outside the band the real ratio was 1.47 to 1.70.
  const reference = signal(24000);
  const identical = correlate(reference, Float32Array.from(reference));
  assert.equal(identical.indeterminate,undefined,"an identical pair must not read as indeterminate");
  assert.ok(identical.confidence > 1.15,`confidence ${identical.confidence} must clear the threshold`);
  const narrow = correlate(reference, Float32Array.from(reference), 400, { guardBand:0 });
  assert.equal(narrow.indeterminate,true,"with no guard band the adjacent lag suppresses the peak");
  assert.equal(narrow.reason,"PEAK_NOT_DISTINCT");
});

test("a strongly periodic signal is reported as indeterminate, which is correct",()=>{
  // Its peak recurs at every period, so no lag dominates and no offset can be claimed. Real
  // speech is aperiodic enough that this does not arise, but a tone burst would, and asserting
  // a shift there would be a fabricated number.
  const tone = periodic(24000);
  const result = correlate(tone, shifted(tone, 17));
  assert.equal(result.indeterminate,true);
  assert.equal(result.reason,"PEAK_NOT_DISTINCT");
});

test("uncorrelated audio is reported as indeterminate, never as zero",()=>{
  // Indeterminate is a finding. Returning 0 would assert alignment that was never established.
  const result = correlate(signal(24000, 1), signal(24000, 99));
  assert.equal(result.indeterminate,true);
  assert.equal(typeof result.shiftSamples,"undefined");
});

test("a window too short to search is refused rather than guessed",()=>{
  const result = correlate(signal(500), signal(500));
  assert.equal(result.indeterminate,true);
  assert.equal(result.reason,"WINDOW_TOO_SHORT");
});

test("silence yields no peak rather than a confident zero",()=>{
  const result = correlate(new Float32Array(24000), new Float32Array(24000));
  assert.equal(result.indeterminate,true);
  assert.equal(result.reason,"NO_CORRELATION_PEAK");
});
