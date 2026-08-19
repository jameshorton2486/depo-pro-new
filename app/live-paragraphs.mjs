// Grouping live events into something a reporter can scan under time pressure.
//
// The live text is an index for finding a moment in the audio. It is never certified, never
// canonical, and never evidence for the correction pipeline. Everything here serves one purpose:
// making a passage findable quickly. A wall of unbroken text is hard to scan; breaks at a turn
// change and at a long pause make it scannable, and that is the whole job.
//
// VOICE LABELS ARE NOT SPEAKER ATTRIBUTIONS, and the naming enforces it.
//
// Live diarization has no lookahead and renumbers speakers as the stream evolves, so it is less
// accurate than the batch pass. More importantly, speaker 0 in a live stream is NOT speaker 0 in
// the batch transcription of the same audio -- they are separate diarizations of separate streams.
// So a live number is rendered as "Voice A", never as a participant name and never mapped to the
// roster. The visual break tells the reporter where a turn changed, which is what helps them find
// the moment. Anything that looked like a name would eventually be read as an attribution.
//
// Nothing here is written to working.json, the speaker map, or a correction pass. The batch
// transcription of the registered audio does that work, with better diarization and a real roster.
// Two sources of speaker truth for one deposition is the collision that keying the speaker map on
// (sourceJobIdentity, deepgramSpeaker) exists to prevent.

/** A pause long enough that the reporter's eye wants a break, even from the same voice. */
export const PARAGRAPH_PAUSE_SECONDS = 2;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Neutral by construction. There is no code path from a live speaker number to a person's name,
 * because this function is the only thing that renders one and it cannot produce a name.
 */
export function voiceLabel(speaker) {
  if (!Number.isInteger(speaker) || speaker < 0) return "Voice";
  return `Voice ${LETTERS[speaker % LETTERS.length]}${speaker >= LETTERS.length ? String(Math.floor(speaker / LETTERS.length) + 1) : ""}`;
}

/**
 * Every run of consecutive words spoken by one voice.
 *
 * Deepgram diarizes per WORD, and an utterance regularly holds more than one speaker -- someone
 * finishes a sentence while the next person begins. Reading the speaker off the first word and
 * applying it to the whole utterance threw that away: a room with three voices rendered as one
 * unbroken block attributed to Voice A, which is precisely what the paragraph breaks exist to
 * prevent. The turn boundary lives inside the utterance, so that is where it has to be found.
 */
function speakerRuns(events = []) {
  const runs = [];
  for (const event of events) {
    const words = (event.words ?? []).filter(word => String(word.punctuatedWord ?? word.word ?? "").trim());
    // No word detail: the event is the smallest unit available, and its voice is unknown rather
    // than assumed from a neighbour.
    if (!words.length) {
      const text = String(event.transcript ?? "").trim();
      if (text) runs.push({ id: event.id, channelId: event.channelId ?? null, speaker: null, text,
        start: Number.isFinite(event.start) ? event.start : null,
        end: Number.isFinite(event.start) && Number.isFinite(event.duration) ? event.start + event.duration : (Number.isFinite(event.start) ? event.start : null) });
      continue;
    }
    let current = null;
    words.forEach((word, index) => {
      const speaker = Number.isInteger(word.speaker) ? word.speaker : null;
      const text = String(word.punctuatedWord ?? word.word ?? "").trim();
      if (current && current.speaker === speaker) {
        current.text = `${current.text} ${text}`;
        if (Number.isFinite(word.end)) current.end = word.end;
        return;
      }
      if (current) runs.push(current);
      current = { id: `${event.id}:${index}`, channelId: event.channelId ?? null, speaker, text,
        start: Number.isFinite(word.start) ? word.start : (Number.isFinite(event.start) ? event.start : null),
        end: Number.isFinite(word.end) ? word.end : null };
    });
    if (current) {
      const eventEnd = Number.isFinite(event.start) && Number.isFinite(event.duration) ? event.start + event.duration : null;
      if (!Number.isFinite(current.end) && eventEnd !== null) current.end = eventEnd;
      runs.push(current);
    }
  }
  return runs;
}

/**
 * Finalized events grouped into paragraphs, newest content last.
 *
 * A new paragraph begins when the voice changes, or when the gap since the previous event exceeds
 * the pause threshold. Events carry their own start times, so the gap is measured from the end of
 * the last event rather than assumed from ordering.
 */
export function groupLiveEvents(events = [], { pauseSeconds = PARAGRAPH_PAUSE_SECONDS } = {}) {
  const paragraphs = [];
  for (const run of speakerRuns(events)) {
    const current = paragraphs.at(-1);
    const gap = Number.isFinite(current?.end) && Number.isFinite(run.start) ? run.start - current.end : null;
    const sameVoice = current && current.speaker === run.speaker;
    const withinPause = gap === null || gap <= pauseSeconds;

    if (current && sameVoice && withinPause) {
      current.text = `${current.text} ${run.text}`.trim();
      current.end = run.end ?? current.end;
      current.runIds.push(run.id);
      continue;
    }
    paragraphs.push({
      id: run.id,
      runIds: [run.id],
      // Null speaker means diarization returned nothing, and the label says so by being absent
      // rather than by defaulting to a voice that was never identified.
      speaker: run.speaker,
      voice: run.speaker === null ? null : voiceLabel(run.speaker),
      channelId: run.channelId,
      start: run.start, end: run.end,
      text: run.text.trim(),
    });
  }
  return paragraphs.filter(paragraph => paragraph.text);
}

/** mm:ss for a stream time, so a reporter can relate a paragraph to the recording clock. */
export function streamClock(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
