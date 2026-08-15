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
