// Generates a disposable qualification fixture.
//
// This exists because most of the qualification protocol needs SIGNAL, not speech.
// Determinism, time alignment, chunk invariance, frame parity and real-time factor are all
// measurable against synthesized audio with impulse markers at exactly known sample offsets
// -- more precisely than against a real recording, where a marker's true position has to be
// estimated rather than known.
//
// What this fixture cannot do: the ASR delta test (qualification Test 5) compares Deepgram
// output against a human-verified reference. That needs real speech and a real transcript.
// A profile qualified against this fixture is qualified for determinism, alignment, chunk
// invariance and frame parity -- NOT for asrSafe. Those remain separate claims.
//
// Output is deterministic: a seeded generator, no Math.random, no timestamps. Regenerating
// from this script produces a byte-identical file, so the fixture hash recorded in a
// qualification record identifies exactly this content.

import fs from "node:fs";
import path from "node:path";

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 310;          // 31 ten-second chunks, so the loop runs 30+ times
const TOTAL_FRAMES = SAMPLE_RATE * DURATION_SECONDS;

// Impulse markers at exact sample offsets. 479_040 is 9.98s -- deliberately inside the last
// 20ms before the first chunk boundary at 10.0s, so a plug-in that mishandles a chunk seam
// disturbs a marker rather than only silence.
export const MARKER_FRAMES = Object.freeze([
  0,
  SAMPLE_RATE * 1,                     // 1s
  Math.round(SAMPLE_RATE * 9.98),      // 9.98s -- straddles the 10s chunk seam
  SAMPLE_RATE * 30,                    // 30s
  SAMPLE_RATE * 300,                   // 300s
]);

// Deterministic PRNG. Math.random would make the fixture unreproducible, which would defeat
// recording its hash in a qualification record.
function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

// 20ms at 3.3 kHz: long enough to localise, short enough to be a landmark, and well clear
// of the hum harmonics and speech-band fundamentals so it stays distinctive.
const BURST_SECONDS = 0.020;
const BURST_FREQUENCY_HZ = 3300;

export function buildFixtureSamples(markerStyle = "impulse") {
  const samples = new Float64Array(TOTAL_FRAMES);
  const noise = seededNoise(0x5eed1234);

  for (let frame = 0; frame < TOTAL_FRAMES; frame += 1) {
    const t = frame / SAMPLE_RATE;
    let value = 0;

    // 60 Hz mains hum with harmonics -- what De-hum is meant to remove. Conference-room
    // power, fluorescent ballasts, HVAC.
    value += 0.030 * Math.sin(2 * Math.PI * 60 * t);
    value += 0.014 * Math.sin(2 * Math.PI * 120 * t);
    value += 0.008 * Math.sin(2 * Math.PI * 180 * t);
    value += 0.004 * Math.sin(2 * Math.PI * 240 * t);

    // Room tone: broadband noise, and deliberately not faint.
    //
    // Alignment is measured by cross-correlating a window, and correlation against purely
    // tonal material is ambiguous -- a periodic signal matches itself at many lags. With
    // room tone at 0.010 against speech-band tones at 0.11, De-click's output correlated to
    // a spurious -6468 frames at two markers while three others read exactly 0. Broadband
    // content is what makes the correlation peak sharp, and it is also what real room tone
    // actually sounds like.
    value += 0.045 * noise();

    // Speech-band content. Not speech -- an amplitude-modulated tone cluster in the vocal
    // range, so the modules have real broadband material to work on instead of silence.
    // Two overlapping "voices" at different rates stand in for crosstalk.
    const voiceA = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t);
    const voiceB = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.3 * t + 1.1);
    value += 0.11 * voiceA * (Math.sin(2 * Math.PI * 210 * t) + 0.6 * Math.sin(2 * Math.PI * 700 * t) + 0.3 * Math.sin(2 * Math.PI * 2400 * t)) / 1.9;
    if (t > 120 && t < 180) value += 0.07 * voiceB * (Math.sin(2 * Math.PI * 165 * t) + 0.5 * Math.sin(2 * Math.PI * 950 * t)) / 1.5;

    // Table noise: short broadband bursts every 7 seconds, the pen-tap and paper-shuffle
    // class of defect De-click targets. Kept away from the impulse markers.
    const intoBurst = frame % (SAMPLE_RATE * 7);
    if (intoBurst < 240) value += 0.18 * noise() * (1 - intoBurst / 240);

    samples[frame] = value;
  }

  // Markers last, written over whatever is beneath them so each is unambiguously the local
  // peak.
  //
  // Two styles, because the choice is not cosmetic. A one-sample full-scale impulse IS a
  // click, so De-click removes it by design -- measuring a de-clicker with impulse markers
  // destroys the landmarks and the correlation then reports noise. A short tone burst is
  // localised in time but is not an impulse, so it survives de-clicking and still gives the
  // correlator something distinctive to lock onto.
  if (markerStyle === "burst") {
    const length = Math.round(SAMPLE_RATE * BURST_SECONDS);
    for (const frame of MARKER_FRAMES) {
      for (let offset = 0; offset < length && frame + offset < TOTAL_FRAMES; offset += 1) {
        // Raised-cosine envelope, so the burst has no step discontinuity at either edge --
        // a hard edge would itself read as a click.
        const envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * offset / length);
        samples[frame + offset] = 0.9 * envelope * Math.sin(2 * Math.PI * BURST_FREQUENCY_HZ * offset / SAMPLE_RATE);
      }
    }
  } else {
    for (const frame of MARKER_FRAMES) samples[frame] = 0.98;
  }

  return samples;
}

function writeWav(file, samples, bitDepth) {
  const bytesPerSample = bitDepth / 8;
  const dataBytes = samples.length * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                       // PCM
  header.writeUInt16LE(1, 22);                       // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);

  const data = Buffer.alloc(dataBytes);
  const peak = (1 << (bitDepth - 1)) - 1;
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    const value = Math.round(clamped * peak);
    if (bitDepth === 24) {
      const unsigned = value < 0 ? value + 0x1000000 : value;
      data.writeUIntLE(unsigned, index * 3, 3);
    } else {
      data.writeInt16LE(value, index * 2);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
  return file;
}

const outputDirectory = process.argv[2] ?? path.join(process.env.TEMP ?? "/tmp", "depo-rx-fixture");
const markerStyle = process.argv[3] === "burst" ? "burst" : "impulse";
const samples = buildFixtureSamples(markerStyle);
// 24-bit is the primary: it exercises the M-6 native-WAV path, where the source depth
// exceeds the canonical 16-bit derivative and precisionReduced must fire.
const wide = writeWav(path.join(outputDirectory, "qualification-fixture-24bit.wav"), samples, 24);
const narrow = writeWav(path.join(outputDirectory, "qualification-fixture-16bit.wav"), samples, 16);
console.log(JSON.stringify({
  sampleRate:SAMPLE_RATE, durationSeconds:DURATION_SECONDS, frames:TOTAL_FRAMES,
  chunksAtTenSeconds:Math.ceil(DURATION_SECONDS / 10), markerStyle, markerFrames:MARKER_FRAMES,
  files:{ "24bit":wide, "16bit":narrow },
}, null, 2));
