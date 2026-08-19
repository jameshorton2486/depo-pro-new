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

const speakerOf = event => {
  const speakers = (event.words ?? []).map(word => word.speaker).filter(Number.isInteger);
  return speakers.length ? speakers[0] : null;
};

/**
 * Finalized events grouped into paragraphs, newest content last.
 *
 * A new paragraph begins when the voice changes, or when the gap since the previous event exceeds
 * the pause threshold. Events carry their own start times, so the gap is measured from the end of
 * the last event rather than assumed from ordering.
 */
export function groupLiveEvents(events = [], { pauseSeconds = PARAGRAPH_PAUSE_SECONDS } = {}) {
  const paragraphs = [];
  for (const event of events) {
    const speaker = speakerOf(event);
    const start = Number.isFinite(event.start) ? event.start : null;
    const end = start !== null && Number.isFinite(event.duration) ? start + event.duration : start;
    const current = paragraphs.at(-1);
    const gap = current?.end !== null && current?.end !== undefined && start !== null ? start - current.end : null;
    const sameVoice = current && current.speaker === speaker;
    const withinPause = gap === null || gap <= pauseSeconds;

    if (current && sameVoice && withinPause) {
      current.text = `${current.text} ${event.transcript}`.trim();
      current.end = end ?? current.end;
      current.eventIds.push(event.id);
      continue;
    }
    paragraphs.push({
      id: event.id,
      eventIds: [event.id],
      // Null speaker means diarization returned nothing, and the label says so by being absent
      // rather than by defaulting to a voice that was never identified.
      speaker,
      voice: speaker === null ? null : voiceLabel(speaker),
      channelId: event.channelId ?? null,
      start, end,
      text: String(event.transcript ?? "").trim(),
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
