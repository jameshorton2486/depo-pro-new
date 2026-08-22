/**
 * Drives a live capture session from an audio file instead of microphones.
 *
 * This exists because the live path cannot otherwise be exercised at more than two channels on a
 * machine with two inputs, and because a room does not produce the same audio twice. A fixture
 * does: same channels, same dialogue, same timings, every run.
 *
 * It produces a synthetic session. That session is marked as such in its own manifest, and both
 * paths that attach audio to a deposition refuse it. Nothing it writes can become evidence.
 *
 *   $env:DEPO_PRO_ALLOW_FILE_CAPTURE=1
 *   node scripts/drive-fixture-capture.mjs "C:\\path\\fixture.wav" --seconds 30
 *
 * --seconds defaults to the full duration of the file. Capture is paced in real time, so a
 * ten-minute fixture occupies ten minutes -- that is the point of it, not an inefficiency.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  FILE_CAPTURE_FLAG,
  createCaptureSession,
  getCaptureSession,
  startCaptureSession,
  stopCaptureSession,
} from "../server/live-capture.mjs";
import { getDeepgramLive, startDeepgramLive, stopDeepgramLive } from "../server/deepgram-live.mjs";

// Read the same DPAPI-protected store the local API reads, so the key is never typed on a command
// line, never placed in the environment, and never printed. Only its presence is ever reported.
function deepgramKey(secretsPath) {
  if (!fs.existsSync(secretsPath)) throw new Error(`No secrets store at ${secretsPath}. Point --secrets at the tree that has one.`);
  const script = 'Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($d)';
  const out = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input: fs.readFileSync(secretsPath, "utf8"), encoding: "utf8", windowsHide: true });
  if (out.status !== 0) throw new Error("The secrets store could not be decrypted by this user.");
  const key = JSON.parse(out.stdout.trim()).deepgramApiKey;
  if (!key) throw new Error("No Deepgram API key is configured in that store.");
  return key;
}

const ROLES = ["EXAMINING_COUNSEL", "WITNESS", "DEFENDING_COUNSEL", "PARTICIPANT_MICROPHONE"];
const argv = process.argv.slice(2);
const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at === -1 ? fallback : argv[at + 1]; };
const flagValues = new Set(["--seconds", "--label"].filter((flag) => argv.includes(flag)).map((flag) => argv[argv.indexOf(flag) + 1]));
const fixture = argv.find((value) => !value.startsWith("--") && !flagValues.has(value));

if (!fixture) { console.error("Usage: node scripts/drive-fixture-capture.mjs <audio-file> [--seconds N] [--label \"...\"]"); process.exit(2); }
if (process.env[FILE_CAPTURE_FLAG] !== "1") { console.error(`Refused: set ${FILE_CAPTURE_FLAG}=1 to drive capture from a file.`); process.exit(2); }

const resolved = path.resolve(fixture);
if (!fs.existsSync(resolved)) { console.error(`Not found: ${resolved}`); process.exit(2); }

// The channel count decides how many sources there are, so it is read from the file rather than
// assumed -- a four-channel run against a stereo fixture would otherwise produce two silent
// channels and look like a capture fault.
const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate:format=duration", "-of", "json", resolved], { encoding: "utf8", windowsHide: true });
if (probe.status !== 0) { console.error(`ffprobe could not read ${resolved}`); process.exit(1); }
const probed = JSON.parse(probe.stdout);
const channels = Number(probed.streams?.[0]?.channels ?? 0);
const duration = Number(probed.format?.duration ?? 0);
if (!channels) { console.error("The file reports no audio channels."); process.exit(1); }

const seconds = Math.min(Number(option("seconds", duration)) || duration, duration);
const label = option("label", `Fixture ${path.basename(resolved)}`);

const sources = Array.from({ length: channels }, (_, index) => ({
  id: `ch${index + 1}`,
  role: ROLES[index] ?? "PARTICIPANT_MICROPHONE",
  kind: "file",
  filePath: resolved,
  channelIndex: index,
}));

console.log(`fixture   : ${resolved}`);
console.log(`channels  : ${channels} (${duration.toFixed(1)}s of audio)`);
console.log(`capturing : ${seconds.toFixed(1)}s, paced in real time`);

const session = createCaptureSession(null, { label, sources });
console.log(`session   : ${session.sessionId}  synthetic=${session.synthetic}\n`);

startCaptureSession(null, { sessionId: session.sessionId });

// The live aid starts after the recording, and its failure never stops the run: the local
// recording is the authoritative artifact and does not depend on Deepgram working.
const wantLive = argv.includes("--deepgram");
let live = false;
if (wantLive) {
  try {
    await startDeepgramLive(null, { sessionId: session.sessionId, apiKey: deepgramKey(path.resolve(option("secrets", "data/secrets.dat"))) });
    live = true;
    console.log(`deepgram  : opening ${channels} streams\n`);
  } catch (error) {
    console.log(`deepgram  : not started -- ${error.message}\n`);
  }
}

const started = Date.now();
const seen = new Set();
const meters = setInterval(() => {
  const current = getCaptureSession(null, { sessionId: session.sessionId });
  const elapsed = ((Date.now() - started) / 1000).toFixed(0).padStart(3);
  const levels = current.sources.map((source) => {
    const rms = source.health.rmsDb;
    return `${source.id}:${rms === null ? "  --  " : `${rms.toFixed(1).padStart(6)}`}`;
  }).join("  ");
  console.log(`  ${elapsed}s  ${levels}`);
  if (!live) return;
  for (const event of getDeepgramLive(null, { sessionId: session.sessionId }).finalizedEvents ?? []) {
    if (seen.has(event.id) || !event.transcript?.trim()) continue;
    seen.add(event.id);
    console.log(`        ${String(event.channelId).padEnd(4)} ${event.transcript.trim().slice(0, 96)}`);
  }
}, 5000);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
clearInterval(meters);

if (live) { try { await stopDeepgramLive(null, { sessionId: session.sessionId }); } catch { /* the recording matters; this does not */ } }
const stopped = await stopCaptureSession(null, { sessionId: session.sessionId });
const wall = (Date.now() - started) / 1000;

console.log(`\nstate     : ${stopped.state}`);
console.log(`wall clock: ${wall.toFixed(1)}s for ${seconds.toFixed(1)}s of audio`);
for (const source of stopped.sources) {
  console.log(`  ${source.id.padEnd(4)} ${String(source.role).padEnd(20)} ${String(source.state).padEnd(10)} ${String(source.artifact?.bytes ?? "-").padStart(10)} bytes  rms ${source.health.rmsDb === null ? "unmeasured" : `${source.health.rmsDb.toFixed(1)} dB`}  sha256 ${source.artifact?.sha256?.slice(0, 16) ?? "-"}…`);
}
const provenance = stopped.sources[0]?.sourceFile;
if (provenance) {
  console.log(`\nsource file: ${provenance.filePath}`);
  console.log(`             ${provenance.bytes} bytes, sha256 ${provenance.sha256}`);
}
if (live) {
  const record = getDeepgramLive(null, { sessionId: session.sessionId });
  const events = record.finalizedEvents ?? [];
  console.log(`\ndeepgram  : ${record.state}, ${events.length} finalized events, ${record.errors?.length ?? 0} errors`);
  for (const source of stopped.sources) {
    const mine = events.filter((event) => event.channelId === source.id);
    const words = mine.reduce((total, event) => total + (event.transcript?.trim().split(/\s+/).filter(Boolean).length ?? 0), 0);
    console.log(`  ${source.id.padEnd(4)} ${String(mine.length).padStart(4)} events  ${String(words).padStart(5)} words`);
  }
  for (const error of (record.errors ?? []).slice(0, 5)) console.log(`  error: ${error.channelId ?? "-"} ${error.kind ?? ""} ${error.message ?? ""}`);
}
console.log(`\nThis session is synthetic. It cannot be attached to a deposition.`);
