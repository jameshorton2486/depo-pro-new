import crypto from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function transcriptContentProjection(transcript) {
  const assignments = [...(transcript?.speakerMap?.assignments ?? [])]
    .map(({ sourceJobIdentity, deepgramSpeaker, speakerIdentity, transcriptRole }) => ({
      sourceJobIdentity,
      deepgramSpeaker,
      speakerIdentity,
      transcriptRole,
    }))
    .sort((left, right) => JSON.stringify(canonicalize(left)).localeCompare(JSON.stringify(canonicalize(right))));
  return canonicalize({
    schemaVersion: transcript?.schemaVersion ?? null,
    recordType: transcript?.recordType ?? null,
    derivedFrom: transcript?.derivedFrom ?? [],
    speakerMap: transcript?.speakerMap ? { status: transcript.speakerMap.status ?? null, assignments } : null,
    segments: transcript?.segments ?? [],
  });
}

export function computeTranscriptContentHash(transcript) {
  const bytes = Buffer.from(JSON.stringify(transcriptContentProjection(transcript)));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function withTranscriptContentHash(transcript) {
  const next = { ...transcript };
  next.transcript_hash = computeTranscriptContentHash(next);
  return next;
}

/**
 * The identity of what the Workspace actually shows: the stored transcript plus the reporter's
 * edits.
 *
 * transcript_hash covers working.json -- its segments and speaker map -- and nothing else. The
 * reporter overlay lives beside working.json and is applied at render, so two transcripts
 * differing only by a deletion carry the same transcript_hash. That is correct for what it
 * names, and wrong for anything that needs to know whether the reading changed: a correction
 * pass invalidating against transcript_hash alone would treat an edited transcript as unedited
 * and keep proposals anchored to text the reporter has since struck.
 *
 * This does not replace or rewrite transcript_hash. Nothing on disk changes; this is a derived
 * value for callers that need to identify a rendering rather than a projection.
 */
export function computeRenderedContentHash(transcript, overlay) {
  const operations = (overlay?.operations ?? []).map(operation => canonicalize(operation));
  const bytes = Buffer.from(JSON.stringify({ transcript:transcriptContentProjection(transcript), operations }));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
