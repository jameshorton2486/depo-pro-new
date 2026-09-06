// Live-captured audio could not be transcribed by any route.
//
// POST /api/audio/transcribe opened with readAudioAudit(root, uploadId), which throws when
// data/audio-intake/<uploadId>/audit.json is absent. Live capture never creates one: neither
// assignCaptureSession (attach after the fact) nor registerCaptureAudio (attach while a
// deposition is open) writes into the intake directory. Both attach paths therefore ended in the
// same 404 at transcribe, so the entire live path terminated at a hashed WAV.
//
// The fix is not to manufacture the missing record. runTranscriptionJob contains no reference to
// an audit at all -- it resolves the file from the deposition record and re-hashes it against the
// frozen sha256 before every job -- so the audit was never load-bearing for the work. Writing one
// would have put an intake record on the evidentiary path describing an intake that never
// happened, which is the shape this branch already refused for NOD_EXTRACTED on reporter-typed
// counsel. The handler now tolerates its absence and the media-rejection fallback, which is the
// one caller that genuinely needs an intake directory, refuses out loud instead.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readAudioAuditIfPresent } from "../server/audio-pipeline.mjs";
import { runTranscriptionJob } from "../server/transcription-jobs.mjs";

const UPLOAD_ID = "bd50c66c-1711-ad24-06cb-61f6d3fa239b";
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function throwawayRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-capture-join-"));
  return root;
}

// A deposition holding one captured channel: registered on the record with its own uploadId and
// hash, present on disk, and with no data/audio-intake directory anywhere.
function depositionWithCapturedChannel(root) {
  const directory = path.join(root, "store", "reporter_x", "cause", "witness_2026-08-28");
  fs.mkdirSync(path.join(directory, "audio", "original"), { recursive: true });
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  const wav = path.join(directory, "audio", "original", "LIVE-20260828175501-ECA52D-local-microphone.wav");
  const rendered = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", wav], { encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  const digest = sha256(wav);
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({
    schemaVersion: "1.0.0", id: "DEP-20260828-TJOIN",
    audioFiles: ["LIVE-20260828175501-ECA52D-local-microphone.wav"],
    audioIntakeIds: [UPLOAD_ID],
    audio: [{ uploadId: UPLOAD_ID, source: "original", operationId: null, sha256: digest, path: "audio/original/LIVE-20260828175501-ECA52D-local-microphone.wav", name: "LIVE-20260828175501-ECA52D-local-microphone.wav" }],
  }));
  fs.writeFileSync(path.join(directory, "intake", "intake.json"), JSON.stringify({ keyterms: ["Whitaker", "Brazos Ridge"] }));
  return { directory, digest };
}

test("audio that never passed through intake reads as absent, not as an error", () => {
  const root = throwawayRoot();
  assert.equal(readAudioAuditIfPresent(root, UPLOAD_ID), null);
  // Still refuses an identifier that is not one, so absence is not a hole for anything to pass through.
  assert.throws(() => readAudioAuditIfPresent(root, "../../etc/passwd"), /Invalid audio intake identifier/);
});

test("a captured channel transcribes with no intake record on disk", async () => {
  const root = throwawayRoot();
  const { directory, digest } = depositionWithCapturedChannel(root);
  assert.equal(fs.existsSync(path.join(root, "data", "audio-intake")), false, "the fixture must have no intake directory");

  let deliveredPath = null, deliveredSha = null;
  const result = await runTranscriptionJob(root, {
    depositionId: "DEP-20260828-TJOIN", uploadId: UPLOAD_ID, storageRoot: path.join(root, "store"),
    submit: ({ audio, audioFile }) => {
      deliveredPath = audioFile; deliveredSha = audio.sha256;
      const raw = JSON.stringify({ metadata: { request_id: "test" }, results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } });
      return Promise.resolve({ rawResponseText: raw, response: { status: 200, headers: {} }, normalized: {} });
    },
  });

  assert.equal(result.job.status, "completed");
  // The audio that reached Deepgram is the file on the deposition record, identified by the hash
  // the capture session computed -- not by anything an intake record would have supplied.
  assert.equal(deliveredSha, digest);
  assert.equal(path.resolve(deliveredPath), path.resolve(directory, "audio", "original", "LIVE-20260828175501-ECA52D-local-microphone.wav"));
});

test("transcribing a captured channel writes no intake record", async () => {
  const root = throwawayRoot();
  depositionWithCapturedChannel(root);
  await runTranscriptionJob(root, {
    depositionId: "DEP-20260828-TJOIN", uploadId: UPLOAD_ID, storageRoot: path.join(root, "store"),
    submit: () => Promise.resolve({ rawResponseText: JSON.stringify({ metadata: {}, results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } }), response: { status: 200, headers: {} }, normalized: {} }),
  });
  // The defect that would look entirely successful: a transcript produced, and an intake record
  // invented alongside it saying this audio was uploaded.
  assert.equal(fs.existsSync(path.join(root, "data", "audio-intake", UPLOAD_ID)), false,
    "captured audio must not acquire an intake record; it did not pass through intake");
});

// The route itself, read as source. runTranscriptionJob is reachable from a test; the router that
// calls it is not without binding a port, and this repo already reads local-api.mjs as text for
// that reason. The assertion is narrow on purpose: it fails when the route goes back to demanding
// an intake record, which is the whole defect.
test("the transcribe route does not require an intake record, and the fallback says why it needs one", () => {
  const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  const route = source.slice(source.indexOf('req.url === "/api/audio/transcribe"'));
  const handler = route.slice(0, route.indexOf("return json"));
  assert.match(handler, /audit\s*=\s*readAudioAuditIfPresent\(root,\s*input\.uploadId\)/);
  assert.ok(!/audit=readAudioAudit\(root,input\.uploadId\)/.test(handler),
    "the transcribe route refuses live-captured audio again");
  // The one caller that genuinely needs the intake directory must refuse rather than dereference
  // a null audit, and must say which audio and why.
  assert.match(source, /if \(!audit\)\s*throw new Error\(\s*`Deepgram could not decode/);
});
