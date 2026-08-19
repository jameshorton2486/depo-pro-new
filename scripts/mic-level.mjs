// Live microphone level, so a dead input is visible while you fix it rather than after.
// Run: node scripts/mic-level.mjs      Ctrl+C to stop.
import { spawn } from "node:child_process";
const { enumerateWindowsAudioSources } = await import("../server/live-capture.mjs");

const devices = enumerateWindowsAudioSources().devices;
if (!devices.length) { console.log("No audio input devices found."); process.exit(1); }
const wanted = process.argv[2];
const device = wanted ? devices.find(item => item.name.toLowerCase().includes(wanted.toLowerCase())) : devices.find(item => item.kind === "input");
if (!device) { console.log(`No device matching "${wanted}". Available:`); for (const d of devices) console.log("  " + d.name); process.exit(1); }

console.log(`Listening to: ${device.name}`);
console.log("Speak into the microphone. The bar should move.\n");
const FILTER = "astats=metadata=1:reset=25,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level";
const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "info", "-f", "dshow", "-i", `audio=${device.id}`, "-af", FILTER, "-f", "null", "-"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });

let buffer = "";
child.stderr.on("data", chunk => {
  buffer = (buffer + chunk).slice(-4000);
  const match = [...buffer.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/g)].at(-1);
  if (!match) return;
  const db = Number(match[1]);
  // -70 dB is the threshold preflight uses to decide a source received audio at all.
  const filled = Math.max(0, Math.min(40, Math.round((db + 80) / 2)));
  const verdict = db > -70 ? (db > -12 ? "LOUD" : "audio") : "SILENT -- preflight will refuse to arm";
  process.stdout.write(`\r  ${String(db.toFixed(1)).padStart(7)} dB  [${"#".repeat(filled)}${" ".repeat(40 - filled)}] ${verdict.padEnd(44)}`);
});
process.on("SIGINT", () => { child.kill(); console.log("\n"); process.exit(0); });
