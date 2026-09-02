// Corrections to the canonical record, kept beside it rather than inside it.
//
// Two existing records cannot be repaired any other way. A notice is an intake-time artifact with
// no post-creation write path, so re-extraction is not available, and the errors are real: Thomas
// carries a deposition date of 2026-08-12 against a certified transcript reading April 30, 2026;
// Zhan's represents omits Shawn Herber, whom the certified appearance page names; twelve Etminan
// fields claim NOD_EXTRACTED against intake.notice = null.
//
// The history lives in a log, not in the field envelope, for a reason that shows up on the second
// correction to the same field: an envelope either overwrites the first -- losing it -- or grows a
// list inside itself, which is a log with worse ergonomics and no append-only guarantee. Worse, a
// changedAt written into a record that is rewritten on every save has no integrity property at
// all: the write that corrects a value is the same write that could silently alter its own
// history. Append-only is enforceable; a mutable envelope is not.
//
// Same shape the transcript already uses: asr-evidence.json immutable, the reporter overlay
// beside it, the working transcript a projection. Here the canonical record is the current state
// and this log is the history. One pattern, two places.
//
// Pure: no filesystem. The caller reads and writes the file.
import crypto from "node:crypto";

export const CORRECTION_LOG_VERSION = "1.0.0";

/**
 * How a correction was made, which is the only part of "who did this" the application can know.
 *
 * IT HAS NO SIGNED-IN USER. No login, no session, no identity of any kind -- the local API binds
 * loopback and trusts everything that reaches it. So a field naming a person could only ever hold a
 * guess, and the guess this code used to make was the deposition's own court reporter.
 *
 * That is not hypothetical. A correction to Production Trial #1 was signed "Miah Bardot, Texas CSR
 * 12129" for a value she never entered, because the writer resolved the author from the record
 * rather than from anything that knew who was acting. The value was right; the signature was not. A
 * later reader relying on that name would have been relying on nothing.
 *
 * So the log records WHAT HAPPENED and THROUGH WHICH PATH, and nothing about a person. An enum
 * rather than a string, so it cannot drift back into looking like a name.
 *
 * Where a human genuinely asserts something -- an oath attestation is the case -- the assertion
 * lives in `why`, in the reporter's own words, which they typed. That is a claim somebody actually
 * made, rather than one the software made on their behalf.
 */
export const CORRECTION_ORIGINS = Object.freeze(["WORKSPACE", "OPENING"]);

/** A field envelope, as canonical-deposition-record.mjs builds them. */
const isField = value => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && "value" in value && "source" in value && "state" in value;

/**
 * Resolves a dotted path to the field envelope holding it.
 *
 * The path names the FIELD, not the value -- `deposition.remote`, not `deposition.remote.value`.
 * Numeric segments index arrays, so `counsel.1.represents` is Zhan's represents on a two-counsel
 * record. Returns null rather than creating anything: a path that does not already resolve to a
 * field is a typo, and inventing the field would write a correction nobody can find again.
 */
export function resolveField(record, path) {
  const segments = String(path ?? "").split(".").filter(Boolean);
  if (!segments.length) return null;
  let parent = record;
  for (const segment of segments.slice(0, -1)) {
    if (parent === null || typeof parent !== "object") return null;
    parent = Array.isArray(parent) ? parent[Number(segment)] : parent[segment];
  }
  const key = segments.at(-1);
  if (parent === null || typeof parent !== "object") return null;
  const field = Array.isArray(parent) ? parent[Number(key)] : parent[key];
  return isField(field) ? { parent, key: Array.isArray(parent) ? Number(key) : key, field } : null;
}

const sameValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * Deterministic id: the same correction always produces the same id, so a replayed log cannot
 * quietly acquire new identities and a duplicate append is visible rather than merely present.
 */
export function correctionId(entry) {
  // `who ?? origin` keeps every id already written reproducible. Entries in the existing logs carry
  // `who`; new ones carry `origin` in the same slot. Changing the material outright would give an
  // old entry a new id on replay, and an append-only history whose identities move is not a history.
  const material = JSON.stringify([entry.depositionId ?? null, entry.path, entry.from ?? null, entry.to ?? null, entry.who ?? entry.origin, entry.at]);
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/**
 * Validates one proposed correction against the record it will be applied to.
 *
 * `from` is required and must match what the record currently holds. A correction written against
 * a value the record no longer has was decided on a stale reading, and applying it would overwrite
 * whatever replaced it without anyone seeing.
 */
export function validateCorrection(record, input) {
  const path = String(input?.path ?? "").trim();
  const origin = String(input?.origin ?? "").trim();
  const why = String(input?.why ?? "").trim();
  const at = String(input?.at ?? "").trim();

  if (!path) return { ok:false, message:"A correction requires the path of the field it changes." };
  // A named author is refused rather than ignored. A default nobody passes is still a door, and
  // this one was open: the honorific route forwarded a caller-supplied name straight into the log.
  if (input?.who !== undefined) {
    return { ok:false, message:`A correction to ${path} may not name its author. Depo-Pro has no signed-in user and cannot establish who acted; record the execution path in origin, and what the value rests on in why.` };
  }
  if (!CORRECTION_ORIGINS.includes(origin)) {
    return { ok:false, message:`A correction to ${path} requires a supported origin (${CORRECTION_ORIGINS.join(", ")}), which is how it was made rather than by whom.` };
  }
  if (!why) return { ok:false, message:`A correction to ${path} requires why it was made. A certified record has to say what a value rests on.` };
  if (!at || Number.isNaN(Date.parse(at))) return { ok:false, message:`A correction to ${path} requires an ISO 8601 timestamp.` };

  const resolved = resolveField(record, path);
  if (!resolved) return { ok:false, message:`${path} is not a field on this canonical record. A correction cannot create one.` };
  if (!("to" in (input ?? {}))) return { ok:false, message:`A correction to ${path} requires the value it changes to.` };
  if (!sameValue(resolved.field.value, input.from)) {
    return { ok:false, message:`${path} currently holds ${JSON.stringify(resolved.field.value ?? null)}, not ${JSON.stringify(input.from ?? null)}. This correction was written against a stale reading and would overwrite whatever replaced it.` };
  }
  if (sameValue(resolved.field.value, input.to)) {
    return { ok:false, message:`${path} already holds ${JSON.stringify(input.to ?? null)}. A correction that changes nothing is history nobody can read.` };
  }

  const entry = {
    schemaVersion: CORRECTION_LOG_VERSION,
    recordType: "CANONICAL_FIELD_CORRECTION",
    depositionId: input.depositionId ?? null,
    path, from: input.from ?? null, to: input.to, origin, why, at,
  };
  return { ok:true, entry: { ...entry, id: correctionId(entry) } };
}

/**
 * Applies one entry to a record, returning a new record. Never mutates its argument.
 *
 * A corrected field becomes REPORTER_ENTERED whatever it held before. The reporter is the source
 * of the new value even when the reason cites a document -- Etminan's remote/remotePlatform come
 * from the certified transcript's page-1 preamble, but that is not the Notice, and intake.notice
 * is null. `why` carries where it came from; `source` carries who put it there. Letting a
 * correction inherit NOD_EXTRACTED would assert a notice supplied a value no notice contains.
 */
export function applyCorrection(record, entry) {
  const copy = structuredClone(record);
  const resolved = resolveField(copy, entry.path);
  if (!resolved) throw new Error(`${entry.path} is not a field on this canonical record.`);
  const present = entry.to !== null && entry.to !== undefined && entry.to !== ""
    && !(Array.isArray(entry.to) && !entry.to.length);
  resolved.parent[resolved.key] = {
    ...resolved.field,
    value: entry.to ?? null,
    source: "REPORTER_ENTERED",
    state: present ? "REPORTER_ADDED" : "MISSING",
  };
  return copy;
}

/**
 * Replays a whole log against the record as it was originally created.
 *
 * This is the property that makes the log the history rather than a side note: the current record
 * has to be reproducible from its origin plus its corrections, or the two have drifted and one of
 * them is lying.
 */
export function replayCorrections(originalRecord, entries = []) {
  return entries.reduce((record, entry) => applyCorrection(record, entry), originalRecord);
}

/** Parses the log. A malformed line is an error, never a line to skip -- a skipped correction is a lost one. */
export function parseCorrectionLog(text) {
  return String(text ?? "").split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Correction log line ${index + 1} is not valid JSON. The log is append-only and must not be repaired in place.`); }
  });
}

export function serializeCorrectionLog(entries) {
  return entries.map(entry => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : "");
}
