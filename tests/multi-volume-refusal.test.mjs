// audioIndex is hardcoded to 0 in the Workspace player. That is correct for every deposition in
// the library today, but only by accident: each happens to have exactly one transcribed source.
// Nothing enforced it, so the day a second volume arrived the player would have seeked into the
// wrong recording -- right text, confident wrong audio, which is the failure a reporter is least
// able to catch by reading.
//
// True resolution is job -> sourceAudio -> index, and is not built. sourceJobIdentity alone
// cannot do it: Thomas has two recordings sharing one job, so the job identity does not
// distinguish them. This refuses instead of guessing, reusing the existing failure code.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { renderTranscript } from "../server/transcript-render.mjs";

const JOB_A = "a9901a636f724f58b9a17c1791fcbfa222732a4217482ca11a74656a431fb8e9";
const JOB_B = "5ba63c65018ca7ecb2de928b43d9f4c6b37f1fee2162c0e955364db23809142a";

const evidenceFor = job => ({
  jobIdentity:job, words:[{ id:`${job}:word:1`, word:"yes", punctuatedWord:"Yes.", start:0, end:1, confidence:0.9, deepgramSpeaker:0 }],
});
const workingFor = (jobs) => ({
  derivedFrom:jobs,
  segments:jobs.map((job, index) => ({
    id:`${job}:segment:1`, ordinal:index, sourceJobIdentity:job, deepgramSpeaker:0,
    asrWordIds:[`${job}:word:1`], text:"Yes.",
  })),
});
const render = (jobs, audio) => renderTranscript({
  working:workingFor(jobs), evidence:jobs.map(evidenceFor), sourceAudio:audio,
});
const refused = result => result.findings.filter(finding => finding.code === "MULTI_VOLUME_UNSUPPORTED");

test("Etminan's shape renders: one job, one recording", () => {
  // 1 job, 1 audio -- audioIndex 0 is unambiguous.
  const result = render([JOB_B], [{ name:"Dr_Entiminan_Audio.IXZ.wav" }]);
  assert.deepEqual(refused(result), []);
  assert.equal(result.counts.paragraphs > 0, true, "it must still render, not merely not-refuse");
});

test("Thomas's shape refuses: one job, two recordings", () => {
  // The live capture registered beside the transcribed .m4a. One job, so a per-paragraph job
  // identity cannot choose between the two files -- which is exactly why this refuses.
  const result = render([JOB_A], [{ name:"Heath_Thomas_Audio.m4a" }, { name:"LIVE-20260819114905-0F8A00-local-microphone.wav" }]);
  const [finding] = refused(result);
  assert.ok(finding, "two source recordings must refuse");
  assert.equal(finding.severity, "blocking");
  assert.equal(finding.jobs, 1);
  assert.equal(finding.audio, 2);
});

test("a transcript deriving from two jobs refuses", () => {
  // Deepgram timestamps restart per job, so a seek computed against one lands in the other.
  const [finding] = refused(render([JOB_A, JOB_B], [{ name:"volume-1.wav" }]));
  assert.ok(finding);
  assert.equal(finding.jobs, 2);
});

test("the refusal reuses the existing code rather than inventing one", () => {
  // insertion-pages/validate.mjs already blocks on MULTI_VOLUME_UNSUPPORTED. Two codes for one
  // condition means a caller can handle one and silently miss the other.
  const [finding] = refused(render([JOB_A, JOB_B], []));
  assert.equal(finding.code, "MULTI_VOLUME_UNSUPPORTED");
});

test("the Workspace player refuses to seek when the transcript is multi-volume", () => {
  // The finding is only half the guard: the screen has to act on it. Asserted on the source
  // because the seek is a DOM side effect with no return value to observe.
  const source = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const seek = source.match(/const seek = useCallback\([^;]+;/s)?.[0] ?? "";
  assert.match(seek, /multiVolume/, "seek must be gated on the multi-volume finding");
});
