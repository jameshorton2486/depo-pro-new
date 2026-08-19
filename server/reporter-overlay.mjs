// The reporter's edits, kept beside the projection instead of inside it.
//
// working.json is f(asr-evidence, storedParameters). Two functions regenerate it wholesale from
// the raw Deepgram bytes, so anything written into it is erased on the next rebuild with no
// warning -- which is why no write path existed. The overlay is an ordered operation list
// anchored to asrWordId values, and the render is projection + overlay. A rebuild re-applies it
// rather than erasing it, because word ids are `jobIdentity:word:N`, deterministic from the raw
// response.
//
// This is not what ADR-0017 governs. That ADR is about mutating the canonical transcript; an
// overlay is not that. ADR-0018 holds too, because working.json stays a pure projection.
//
// Pure: no filesystem, no fetch. The caller reads and writes the file.

export const OVERLAY_SCHEMA_VERSION = "1.0.0";
export const OPERATIONS = Object.freeze(["split", "label", "replace", "delete", "insert", "flag", "unflag"]);
export const emptyOverlay = depositionId => ({ schemaVersion:OVERLAY_SCHEMA_VERSION, recordType:"REPORTER_OVERLAY", depositionId:depositionId ?? null, operations:[] });

const text = value => String(value ?? "");
const trimmed = value => text(value).trim();

/**
 * Validates one operation. Returns `{ ok:true, operation }` or `{ ok:false, message }`.
 * Rejects rather than normalises: an operation Depo-Pro had to guess at is one whose effect on
 * a certified record nobody can reconstruct later.
 */
export function validateOperation(input) {
  const op = trimmed(input?.op);
  if (!OPERATIONS.includes(op)) return { ok:false, message:`Unsupported overlay operation: ${op || "(none)"}` };
  // Both split and label resolve by word when no segmentId is given.
  //
  // A rendered paragraph can span several segments, so the caller cannot tell which one holds a
  // given word without carrying segment boundaries into the UI. It got that wrong the first time
  // it was written -- `segmentIds.at(-1)` is the last segment, not the one containing the anchor
  // -- and the split silently orphaned along with the label that followed it. Resolving
  // server-side from the word removes the whole class of error, and after a split the segment
  // holding the anchor IS the new tail, so labelling by the same word needs no second lookup.
  if (op === "split") {
    if (!trimmed(input.beforeWordId)) return { ok:false, message:"split requires beforeWordId." };
    return { ok:true, operation:{ op, segmentId:trimmed(input.segmentId) || null, beforeWordId:trimmed(input.beforeWordId) } };
  }
  if (op === "label") {
    if (!trimmed(input.segmentId) && !trimmed(input.wordId)) return { ok:false, message:"label requires segmentId or wordId." };
    return { ok:true, operation:{ op, segmentId:trimmed(input.segmentId) || null, wordId:trimmed(input.wordId) || null, speakerIdentity:trimmed(input.speakerIdentity) || null, transcriptRole:trimmed(input.transcriptRole) || null } };
  }
  if (op === "replace") {
    if (!trimmed(input.wordId)) return { ok:false, message:"replace requires wordId." };
    // An empty replacement is a deletion wearing a disguise. Keeping them distinct means the
    // record can show whether a word was corrected or struck.
    if (!trimmed(input.text)) return { ok:false, message:"replace requires text; use delete to strike a word." };
    return { ok:true, operation:{ op, wordId:trimmed(input.wordId), text:text(input.text) } };
  }
  if (op === "delete") {
    if (!trimmed(input.wordId)) return { ok:false, message:"delete requires wordId." };
    return { ok:true, operation:{ op, wordId:trimmed(input.wordId) } };
  }
  // A flag marks a passage as needing another listen. It is the only mark there is, deliberately:
  // a mark whose meaning is chosen per mark asks the scopist to make a decision at the moment the
  // tool exists to make fast. Everything else a passage might need is already an operation --
  // replace corrects, delete strikes, label reattributes -- so a second mark type would only ever
  // duplicate one of those, less precisely.
  //
  // It is an overlay operation and not a separate sidecar because it has the overlay's exact
  // durability requirements: anchored to asrWordId values, surviving a rebuild, ordered, and
  // undoable by the same pop. It is NOT an edit, and applyOverlay keeps it out of the text: a
  // flagged word reads exactly as it did before it was flagged.
  if (op === "flag") {
    if (!trimmed(input.fromWordId)) return { ok:false, message:"flag requires fromWordId." };
    // A single word is a range of one, so there is one shape to apply and one to reason about.
    return { ok:true, operation:{ op, fromWordId:trimmed(input.fromWordId), toWordId:trimmed(input.toWordId) || trimmed(input.fromWordId) } };
  }
  // Clearing is not optional extra scope. A flag list that only grows is a flag list the scopist
  // stops trusting, and then stops using -- the mark has to come off when the passage is resolved.
  if (op === "unflag") {
    if (!trimmed(input.fromWordId)) return { ok:false, message:"unflag requires fromWordId." };
    return { ok:true, operation:{ op, fromWordId:trimmed(input.fromWordId) } };
  }
  if (!trimmed(input.afterWordId)) return { ok:false, message:"insert requires afterWordId." };
  if (!trimmed(input.text)) return { ok:false, message:"insert requires text." };
  return { ok:true, operation:{ op, afterWordId:trimmed(input.afterWordId), text:text(input.text) } };
}

export function validateOverlay(value, depositionId) {
  if (!value) return emptyOverlay(depositionId);
  if (value.schemaVersion !== OVERLAY_SCHEMA_VERSION || !Array.isArray(value.operations)) throw new Error("The reporter overlay record is invalid or unsupported.");
  return { ...emptyOverlay(depositionId), ...value, operations:value.operations.map(item => { const result = validateOperation(item); if (!result.ok) throw new Error(result.message); return result.operation; }) };
}

const segmentHolding = (segments, wordId) => segments.findIndex(segment => (segment.asrWordIds || []).includes(wordId));

function splitSegments(segments, segmentId, beforeWordId) {
  const index = segmentId ? segments.findIndex(segment => segment.id === segmentId) : segmentHolding(segments, beforeWordId);
  if (index < 0) return { ok:false, reason:segmentId ? "SEGMENT_NOT_FOUND" : "WORD_NOT_FOUND" };
  const segment = segments[index];
  const at = (segment.asrWordIds || []).indexOf(beforeWordId);
  if (at < 0) return { ok:false, reason:"WORD_NOT_IN_SEGMENT" };
  // Splitting before the first word would produce an empty head. That is not a split, it is a
  // no-op that silently multiplies segment ids, so it is reported instead.
  if (at === 0) return { ok:false, reason:"SPLIT_AT_SEGMENT_START" };
  const head = { ...segment, asrWordIds:segment.asrWordIds.slice(0, at) };
  // Named for the word it begins at, not by a counter. Every tail was `#2`, so splitting one
  // segment twice produced two segments sharing an id, with no orphan raised -- and a later
  // `label` addressed by segment id then resolved to whichever came first, silently moving a
  // speaker attribution to the wrong half. The anchor word is unique within the segment and
  // deterministic, so replaying the same overlay rebuilds the same ids.
  const tail = { ...segment, id:`${segment.id}#${beforeWordId}`, asrWordIds:segment.asrWordIds.slice(at), start:null, end:null };
  return { ok:true, segments:[...segments.slice(0, index), head, tail, ...segments.slice(index + 1)] };
}

/**
 * Applies the overlay to the projection's segments.
 *
 * Returns new segments plus a word-level override map. Nothing here mutates its input, and
 * nothing here touches asr-evidence.json or working.json -- the caller holds those.
 *
 * An operation whose anchor no longer exists becomes an orphan, reported with its reason. A
 * silently dropped correction is worse than a visible one: the reporter believes the record
 * says something it does not.
 */
export function applyOverlay(segments = [], overlay = emptyOverlay(), { knownWordIds = null } = {}) {
  let current = segments.map(segment => ({ ...segment, asrWordIds:[...(segment.asrWordIds || [])] }));
  const orphaned = [];
  const replaced = new Map(), deleted = new Set(), inserted = new Map();
  // Keyed by the word the flag starts at, so flagging the same passage twice moves the mark
  // rather than stacking two, and an unflag has one thing to address.
  const flags = new Map();
  const anchorExists = id => (knownWordIds ? knownWordIds.has(id) : current.some(segment => segment.asrWordIds.includes(id)));

  overlay.operations.forEach((operation, index) => {
    const orphan = reason => orphaned.push({ index, operation, reason });
    if (operation.op === "split") {
      const result = splitSegments(current, operation.segmentId, operation.beforeWordId);
      if (!result.ok) return orphan(result.reason);
      current = result.segments;
      return;
    }
    if (operation.op === "label") {
      const at = operation.segmentId ? current.findIndex(segment => segment.id === operation.segmentId) : segmentHolding(current, operation.wordId);
      if (at < 0) return orphan(operation.segmentId ? "SEGMENT_NOT_FOUND" : "WORD_NOT_FOUND");
      const target = current[at];
      target.speakerIdentity = operation.speakerIdentity;
      target.transcriptRole = operation.transcriptRole;
      return;
    }
    if (operation.op === "replace") {
      if (!anchorExists(operation.wordId)) return orphan("WORD_NOT_FOUND");
      replaced.set(operation.wordId, operation.text);
      return;
    }
    if (operation.op === "delete") {
      if (!anchorExists(operation.wordId)) return orphan("WORD_NOT_FOUND");
      deleted.add(operation.wordId);
      return;
    }
    // Flags resolve against segment order rather than anchorExists, because a range needs
    // positions and knownWordIds is a membership test. A word present in the evidence but held by
    // no segment cannot bound a passage in the reading.
    if (operation.op === "flag") {
      const order = current.flatMap(segment => segment.asrWordIds);
      const from = order.indexOf(operation.fromWordId), to = order.indexOf(operation.toWordId);
      if (from < 0 || to < 0) return orphan("WORD_NOT_FOUND");
      flags.set(operation.fromWordId, { fromWordId:operation.fromWordId, toWordId:operation.toWordId });
      return;
    }
    if (operation.op === "unflag") {
      // Reported rather than ignored. A clear that silently did nothing leaves the scopist
      // believing a passage is resolved while it is still marked.
      if (!flags.delete(operation.fromWordId)) return orphan("FLAG_NOT_FOUND");
      return;
    }
    if (!anchorExists(operation.afterWordId)) return orphan("WORD_NOT_FOUND");
    const list = inserted.get(operation.afterWordId) ?? [];
    // The id is positional, so the same overlay against the same projection produces the same
    // ids every time -- I4. It carries no evidence anchor, which is the point: reporter-authored
    // text must stay distinguishable from anything the microphone produced.
    list.push({ id:`overlay:${operation.afterWordId}:${list.length + 1}`, text:operation.text, authored:true });
    inserted.set(operation.afterWordId, list);
  });

  // Expanded to every word the passage covers, each carrying the flag it belongs to so a click
  // anywhere in a marked passage can clear the whole of it. Splits never reorder words, so the
  // final order resolves a range the same way the order at flag time did.
  const order = current.flatMap(segment => segment.asrWordIds);
  const flagged = new Map();
  for (const flag of flags.values()) {
    const from = order.indexOf(flag.fromWordId), to = order.indexOf(flag.toWordId);
    if (from < 0 || to < 0) continue;
    for (let at = Math.min(from, to); at <= Math.max(from, to); at += 1) flagged.set(order[at], flag.fromWordId);
  }
  // `flagged` is deliberately not folded into replaced/deleted/inserted. A flag changes nothing a
  // reader reads, and a caller that only asks for the text gets the text.
  return { segments:current, replaced, deleted, inserted, flagged, orphaned };
}

/** Removes the last operation. Undo is a pop, deliberately: no editing, no history browsing. */
export function undoLast(overlay) {
  const operations = [...(overlay?.operations || [])];
  const removed = operations.pop() ?? null;
  return { overlay:{ ...emptyOverlay(overlay?.depositionId), ...overlay, operations }, removed };
}

export function appendOperations(overlay, inputs) {
  const operations = [...(overlay?.operations || [])];
  for (const input of Array.isArray(inputs) ? inputs : [inputs]) {
    const result = validateOperation(input);
    if (!result.ok) throw new Error(result.message);
    operations.push(result.operation);
  }
  return { ...emptyOverlay(overlay?.depositionId), ...overlay, operations };
}
