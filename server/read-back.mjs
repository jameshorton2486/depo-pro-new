// Finding a moment in the recording and playing it back.
//
// This is the whole purpose of the live text. The reporter does not read the ASR aloud -- they use
// it to locate a moment and then play the audio, because the audio is the record and the text is
// an index into it. So the index only has to be good enough to recognise a passage by. A misheard
// word the reporter can still place has done its entire job.
//
// WITHIN ONE CHANNEL, ENFORCED.
//
// A read-back is one person saying one thing, so searching within a channel is not a limitation --
// it is what the task is. It is enforced rather than intended because the alternative fails
// silently: a hit found in one channel, used to seek in another, lands at a position no one
// measured, and the reporter plays back the wrong moment believing it is the right one. The
// channel a hit came from travels with the hit, and seeking with a different channel is refused.
//
// WHAT THE TIMES MEAN, AND WHAT IS NOT KNOWN.
//
// Deepgram's times are relative to the stream it received, which begins when the reporter connects
// -- not when recording began. The gap between those two is derived here from the wall clocks both
// already record, and it is the large part of the offset: seconds or minutes.
//
// What is NOT derivable is the fine residual: each capture is an independent ffmpeg process, and
// the interval between starting a process and its first sample is not observable from outside it.
// Measured on one device with identical invocations, that residual varied between 28 and 83
// milliseconds run to run, so no constant corrects it.
//
// Read-back survives this because of how a read-back is actually performed: the reporter plays
// from several seconds BEFORE the moment, because the context is what settles the word. A lead-in
// measured in seconds swamps a residual measured in tens of milliseconds. The residual is named in
// what this returns rather than hidden, because the one thing that must not happen is a downstream
// reader treating an approximate position as an exact one.
import fs from "node:fs";
import path from "node:path";

/** Seconds of context before the hit. Read-back is performed from before the moment, not at it. */
export const READ_BACK_LEAD_IN_SECONDS = 5;

export const CROSS_CHANNEL_SEEK = "CROSS_CHANNEL_SEEK";
export const CHANNEL_REQUIRED = "CHANNEL_REQUIRED";
export const CHANNEL_NOT_RECORDED = "CHANNEL_NOT_RECORDED";

const fail = (code, message, detail = {}) => { const error = new Error(message); error.code = code; Object.assign(error, detail); throw error; };

const RESIDUAL = Object.freeze({
  measured: false,
  reason: "Each capture is an independent process, and the interval between starting one and its first sample is not observable from outside it.",
  observedVariationMs: [28, 83],
  observedOn: "one DirectShow device, identical invocations, four runs",
});

/**
 * Seconds to add to a Deepgram stream time to reach a position in this channel's recording.
 *
 * Derived from wall clocks, so it carries their precision and no more. Returns null rather than a
 * number when either clock is missing: a read-back that cannot be positioned should say so, not
 * position itself at zero.
 */
export function recordingOffsetSeconds(capture, live, channelId) {
  const origin = capture?.clock?.originWallClock;
  const connected = (live?.connectionHistory ?? []).find(entry => entry.type === "CONNECTED" && entry.channelId === channelId);
  if (!origin || !connected?.at) return null;
  const offset = (Date.parse(connected.at) - Date.parse(origin)) / 1000;
  return Number.isFinite(offset) ? offset : null;
}

/**
 * Hits for a query, within one channel.
 *
 * channelId is required and has no default. A default would make cross-channel search the easy
 * path and the enforcement below a formality.
 */
export function searchLiveIndex(live, { channelId, query, limit = 50 } = {}) {
  if (!channelId) fail(CHANNEL_REQUIRED, "A read-back search is performed within one channel; no channel was given.");
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return [];

  const hits = [];
  for (const event of live?.finalizedEvents ?? []) {
    if (event.channelId !== channelId) continue;
    const transcript = String(event.transcript ?? "");
    if (!transcript.toLowerCase().includes(needle)) continue;
    // The word carrying the match gives a tighter position than the event does; the event start is
    // the fallback when the words did not come through.
    const word = (event.words ?? []).find(item => String(item.punctuatedWord ?? item.word ?? "").toLowerCase().includes(needle));
    const streamSeconds = Number.isFinite(word?.start) ? word.start : Number.isFinite(event.start) ? event.start : null;
    if (streamSeconds === null) continue;
    hits.push({ channelId: event.channelId, channelRole: event.channelRole ?? null, eventId: event.id, streamSeconds, text: transcript, matched: word?.punctuatedWord ?? word?.word ?? null });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Where to play from, for a hit found in this channel.
 *
 * Refuses a hit from any other channel. That refusal is the point of the module: the offset between
 * two channels is unmeasured, so a position derived in one and applied to another is wrong by an
 * unknown amount while looking entirely reasonable.
 */
export function resolveReadBackTarget({ capture, live, hit, channelId, leadInSeconds = READ_BACK_LEAD_IN_SECONDS } = {}) {
  if (!channelId) fail(CHANNEL_REQUIRED, "A read-back target is resolved within one channel; no channel was given.");
  if (!hit) fail(CHANNEL_REQUIRED, "A read-back target requires a hit.");
  if (hit.channelId !== channelId) {
    fail(CROSS_CHANNEL_SEEK,
      `This hit came from channel ${hit.channelId} and cannot position playback in channel ${channelId}. The offset between channels was never measured, so a position taken from one does not locate the same moment in another.`,
      { hitChannelId: hit.channelId, requestedChannelId: channelId });
  }

  const source = (capture?.sources ?? []).find(item => item.id === channelId);
  if (!source?.artifact?.finalized || !source.artifact.relativePath) {
    fail(CHANNEL_NOT_RECORDED, `Channel ${channelId} has no finalized recording to play back.`, { channelId });
  }

  const offset = recordingOffsetSeconds(capture, live, channelId);
  const recordingSeconds = offset === null ? null : hit.streamSeconds + offset;
  const playFromSeconds = recordingSeconds === null ? null : Math.max(0, recordingSeconds - leadInSeconds);

  return {
    channelId,
    channelRole: source.role ?? null,
    audioPath: source.artifact.relativePath,
    audioSha256: source.artifact.sha256 ?? null,
    streamSeconds: hit.streamSeconds,
    // Named for what it is. A caller reading "approximate" and a stated residual cannot mistake
    // this for a measured position the way a bare number invites.
    recordingSeconds,
    playFromSeconds,
    leadInSeconds,
    precision: recordingSeconds === null ? "unavailable" : "approximate",
    residual: RESIDUAL,
    positionable: recordingSeconds !== null,
  };
}

/** The absolute file for a resolved target, kept inside the deposition folder. */
export function readBackAudioFile(depositionDirectory, target) {
  const file = path.resolve(depositionDirectory, ...String(target.audioPath).split("/"));
  const relative = path.relative(path.resolve(depositionDirectory), file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail(CHANNEL_NOT_RECORDED, "Read-back audio path escaped the deposition folder.");
  return file;
}

/**
 * Search and position in one call, against the stored session records.
 *
 * Each hit is resolved with the channel it was found in, so a cross-channel target cannot be
 * constructed here at all. The guard in resolveReadBackTarget still stands for callers that build
 * a target themselves -- this route simply never gives them the chance to get it wrong.
 */
export async function readBackSearch(root, { depositionId, sessionId, channelId, query, leadInSeconds, storageRoot } = {}) {
  const { getCaptureSession } = await import("./live-capture.mjs");
  const { getDeepgramLive } = await import("./deepgram-live.mjs");
  const capture = getCaptureSession(root, { depositionId, sessionId, storageRoot });
  let live = null;
  try { live = getDeepgramLive(root, { depositionId, sessionId, storageRoot }); }
  catch { live = null; }
  if (!live) return { channelId: channelId ?? null, hits: [], indexed: false, message: "No live index was recorded for this session, so there is nothing to search. The recording is unaffected." };

  const hits = searchLiveIndex(live, { channelId, query });
  return {
    channelId,
    indexed: true,
    hits: hits.map(hit => {
      const target = resolveReadBackTarget({ capture, live, hit, channelId, leadInSeconds: leadInSeconds ?? READ_BACK_LEAD_IN_SECONDS });
      return { ...hit, playFromSeconds: target.playFromSeconds, recordingSeconds: target.recordingSeconds, precision: target.precision, positionable: target.positionable };
    }),
  };
}

/** The absolute WAV for one channel of a session, for playback. */
export async function readBackChannelFile(root, { depositionId, sessionId, channelId, storageRoot } = {}) {
  const { getCaptureSession } = await import("./live-capture.mjs");
  const { depositionDirectory } = await import("./deposition-store.mjs");
  const capture = getCaptureSession(root, { depositionId, sessionId, storageRoot });
  const source = (capture.sources ?? []).find(item => item.id === channelId);
  if (!source?.artifact?.finalized) fail(CHANNEL_NOT_RECORDED, `Channel ${channelId} has no finalized recording.`, { channelId });
  const file = readBackAudioFile(depositionDirectory(root, depositionId, { storageRoot }), { audioPath: source.artifact.relativePath });
  // The manifest says the channel was finalized; the disk is what decides whether it is still
  // there. Trusting the manifest alone hands the caller a path to a file that may not exist, and
  // the reporter meets that as a broken player rather than as a stated problem.
  if (!fs.existsSync(file)) fail(CHANNEL_NOT_RECORDED, `Channel ${channelId} was finalized but its recording is missing from disk.`, { channelId, file });
  return file;
}
