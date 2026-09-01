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

export const OVERLAY_SCHEMA_VERSION = "2.0.0";
export const LEGACY_OVERLAY_SCHEMA_VERSION = "1.0.0";
export const OPERATIONS = Object.freeze(["split", "join", "label", "replace", "delete", "insert", "flag", "unflag", "review", "examination", "colloquy", "uncolloquy"]);
// The examinations a Texas deposition actually contains, in the order they can occur. Closed on
// purpose: an examination type is a thing the record can be asked to prove, not a free-text note,
// and a heading nobody recognises is worse than a refusal.
export const EXAMINATION_TYPES = Object.freeze(["DIRECT", "CROSS", "REDIRECT", "RECROSS"]);
export const emptyOverlay = depositionId => ({ schemaVersion:OVERLAY_SCHEMA_VERSION, recordType:"REPORTER_OVERLAY", depositionId:depositionId ?? null, operations:[], transactionSizes:[], redoTransactions:[] });

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
  if (op === "join") {
    if (!trimmed(input.leadingWordId) || !trimmed(input.trailingWordId)) return { ok:false, message:"join requires leadingWordId and trailingWordId." };
    return { ok:true, operation:{ op, leadingWordId:trimmed(input.leadingWordId), trailingWordId:trimmed(input.trailingWordId), leadingFirstWordId:trimmed(input.leadingFirstWordId)||trimmed(input.leadingWordId), trailingLastWordId:trimmed(input.trailingLastWordId)||trimmed(input.trailingWordId) } };
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
  // An utterance by the active examiner that is not a question.
  //
  // §247. `labelParagraphs` emits Q. for anything the active examiner says, so "I will rephrase."
  // and "Let me back up." print as testimony. Whether an utterance is a question is a THIRD fact,
  // separate from who spoke and from who is examining, and nothing in this repository recorded it.
  //
  // Stated by the reporter, never inferred. Measured on a real deposition, 456 of 1,972 sentences
  // end in a question mark against 484 examiner turns, and "Counsel, can we take a short break?"
  // carries one while being colloquy -- a punctuation rule would be wrong in both directions at
  // once. Deepgram carries no question, type or intent field anywhere.
  //
  // The reporter had no way to say it either: measured against every value `label` can set, all five
  // roles still emit Q., because the identity test precedes the role test. The one lever that worked
  // was changing who spoke, which puts another person's name on a line they did not say.
  //
  // Paired with `uncolloquy` rather than relying on undo. Undo pops the last transaction; a reporter
  // who finds a bad mark an hour later cannot reach it that way. `flag`/`unflag` set the precedent
  // and the naming follows it -- `uncolloquy` is not a word, and consistency with the nine
  // operations already here is worth more than a prettier name nobody else in the file uses.
  if (op === "colloquy") {
    if (!trimmed(input.wordId)) return { ok:false, message:"colloquy requires wordId." };
    return { ok:true, operation:{ op, wordId:trimmed(input.wordId) } };
  }
  // Removes the reporter's determination. It does NOT assert that the utterance is a question: the
  // paragraph returns to whatever the examination model derives for it, which is the only honest
  // meaning of clearing a mark.
  if (op === "uncolloquy") {
    if (!trimmed(input.wordId)) return { ok:false, message:"uncolloquy requires wordId." };
    return { ok:true, operation:{ op, wordId:trimmed(input.wordId) } };
  }
  // Where one examination stops and the next begins.
  //
  // `labelParagraphs` holds a single examiner for the whole transcript, so defending counsel's
  // cross renders as colloquy and the answers to it render as THE WITNESS rather than A. The
  // missing thing is not a label -- it is that the transcript has no notion of an examination
  // having a beginning. This operation supplies one; nothing consumes it yet.
  //
  // A boundary carries no end. The next boundary terminates the previous one and the last runs to
  // the end of testimony, so an examination cannot be left with an end that contradicts where the
  // following one starts.
  //
  // `examinerPersonId` is a canonical participant id, never a typed name. A name entered twice is
  // two examiners as far as the index is concerned, and the index is printed.
  if (op === "examination") {
    if (!trimmed(input.atWordId)) return { ok:false, message:"examination requires atWordId." };
    if (!trimmed(input.examinerPersonId)) return { ok:false, message:"examination requires examinerPersonId; a boundary that names nobody cannot say whose examination begins." };
    const type = trimmed(input.type).toUpperCase();
    if (!EXAMINATION_TYPES.includes(type)) return { ok:false, message:`examination type must be one of ${EXAMINATION_TYPES.join(", ")}.` };
    return { ok:true, operation:{ op, atWordId:trimmed(input.atWordId), examinerPersonId:trimmed(input.examinerPersonId), type } };
  }
  if (op === "review") {
    if (!trimmed(input.wordId)) return { ok:false, message:"review requires wordId." };
    const disposition=trimmed(input.disposition).toUpperCase();
    if (!['APPROVED','CORRECTED'].includes(disposition)) return { ok:false, message:"review disposition must be APPROVED or CORRECTED." };
    return { ok:true, operation:{ op, wordId:trimmed(input.wordId), disposition, at:trimmed(input.at)||null, actor:trimmed(input.actor)||null } };
  }
  if (!trimmed(input.afterWordId) && !trimmed(input.beforeWordId)) return { ok:false, message:"insert requires afterWordId or beforeWordId." };
  if (trimmed(input.afterWordId) && trimmed(input.beforeWordId)) return { ok:false, message:"insert accepts one anchor, not both." };
  if (!trimmed(input.text)) return { ok:false, message:"insert requires text." };
  return { ok:true, operation:{ op, afterWordId:trimmed(input.afterWordId) || null, beforeWordId:trimmed(input.beforeWordId) || null, text:text(input.text) } };
}

export function validateOverlay(value, depositionId) {
  if (!value) return emptyOverlay(depositionId);
  if (![OVERLAY_SCHEMA_VERSION, LEGACY_OVERLAY_SCHEMA_VERSION].includes(value.schemaVersion) || !Array.isArray(value.operations)) throw new Error("The reporter overlay record is invalid or unsupported.");
  const operations=value.operations.map(item => { const result = validateOperation(item); if (!result.ok) throw new Error(result.message); return result.operation; });
  const transactionSizes=value.schemaVersion===LEGACY_OVERLAY_SCHEMA_VERSION
    ? operations.map(()=>1)
    : Array.isArray(value.transactionSizes) ? value.transactionSizes.map(Number) : [];
  if(transactionSizes.some(size=>!Number.isInteger(size)||size<1)||transactionSizes.reduce((sum,size)=>sum+size,0)!==operations.length)throw new Error("The reporter overlay transaction boundaries are invalid.");
  const redoTransactions=Array.isArray(value.redoTransactions)?value.redoTransactions.map(transaction=>{
    if(!Array.isArray(transaction)||!transaction.length)throw new Error("The reporter overlay redo history is invalid.");
    return transaction.map(item=>{const result=validateOperation(item);if(!result.ok)throw new Error(result.message);return result.operation});
  }):[];
  return { ...emptyOverlay(depositionId), ...value, schemaVersion:OVERLAY_SCHEMA_VERSION, operations, transactionSizes, redoTransactions };
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

function joinSegments(segments, operation) {
  const left=segmentHolding(segments,operation.leadingFirstWordId),boundaryLeft=segmentHolding(segments,operation.leadingWordId),boundaryRight=segmentHolding(segments,operation.trailingWordId),right=segmentHolding(segments,operation.trailingLastWordId);
  if([left,boundaryLeft,boundaryRight,right].some(index=>index<0))return{ok:false,reason:"WORD_NOT_FOUND"};
  if(boundaryRight!==boundaryLeft+1||left>boundaryLeft||boundaryRight>right)return{ok:false,reason:"PARAGRAPHS_NOT_ADJACENT"};
  const joined=segments.slice(left,right+1),leading=joined[0],trailing=joined.at(-1);
  if(joined.some(item=>item.sourceJobIdentity!==leading.sourceJobIdentity||item.sourceUploadId!==leading.sourceUploadId))return{ok:false,reason:"SOURCE_BOUNDARY"};
  const merged={...leading,forceParagraphBoundaryBefore:true,asrWordIds:joined.flatMap(item=>item.asrWordIds||[]),end:trailing.end??leading.end};
  const following=segments[right+1]?{...segments[right+1],forceParagraphBoundaryBefore:true}:null;
  return{ok:true,segments:[...segments.slice(0,left),merged,...(following?[following]:[]),...segments.slice(right+2)]};
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
  const replaced = new Map(), deleted = new Set(), inserted = new Map(), insertedBefore = new Map(), authoredIds = new Set();
  // Keyed by the word the flag starts at, so flagging the same passage twice moves the mark
  // rather than stacking two, and an unflag has one thing to address.
  const flags = new Map(), reviews = new Map();
  // Keyed by the word the examination begins at, which is what makes a second boundary on the
  // same word detectable.
  const examinations = new Map();
  // The utterances the reporter has said are colloquy. A set, not a list: marking one paragraph
  // twice says the same thing twice and discards nothing, which is why this is idempotent where a
  // second examination boundary on one word is refused -- that one carries a person and a type that
  // could differ, and silently replacing it would lose a recorded fact.
  const colloquy = new Set();
  const anchorExists = id => (knownWordIds ? knownWordIds.has(id) : current.some(segment => segment.asrWordIds.includes(id)));

  overlay.operations.forEach((operation, index) => {
    const orphan = reason => orphaned.push({ index, operation, reason });
    if (operation.op === "split") {
      const result = splitSegments(current, operation.segmentId, operation.beforeWordId);
      if (!result.ok) return orphan(result.reason);
      current = result.segments;
      return;
    }
    if(operation.op==="join"){
      const result=joinSegments(current,operation);
      if(!result.ok)return orphan(result.reason);
      current=result.segments;
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
      if (!anchorExists(operation.wordId) && !authoredIds.has(operation.wordId)) return orphan("WORD_NOT_FOUND");
      replaced.set(operation.wordId, operation.text);
      return;
    }
    if (operation.op === "delete") {
      if (!anchorExists(operation.wordId) && !authoredIds.has(operation.wordId)) return orphan("WORD_NOT_FOUND");
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
    if(operation.op==="review"){
      if(!anchorExists(operation.wordId))return orphan("WORD_NOT_FOUND");
      reviews.set(operation.wordId,{disposition:operation.disposition,at:operation.at,actor:operation.actor});
      return;
    }
    if (operation.op === "examination") {
      // Resolved against segment order rather than anchorExists, for the reason flags are: a word
      // that exists in the evidence but sits in no segment cannot begin anything in the reading.
      if (segmentHolding(current, operation.atWordId) < 0) return orphan("WORD_NOT_FOUND");
      // Refused, not overwritten -- and this is where it differs from `flag`, deliberately.
      // Re-flagging a passage moves a mark that means "listen again"; nothing is lost. A boundary
      // is the reporter's statement that a named person began examining at this word, so quietly
      // replacing one discards a recorded fact about the proceeding while looking like success.
      // The correction path is undo, which is the correction path for every other operation here.
      if (examinations.has(operation.atWordId)) return orphan("EXAMINATION_ALREADY_BOUNDED");
      examinations.set(operation.atWordId, { atWordId:operation.atWordId, examinerPersonId:operation.examinerPersonId, type:operation.type });
      return;
    }
    if (operation.op === "colloquy") {
      // Resolved against segment order for the reason flags and boundaries are: a word present in
      // the evidence but held by no segment cannot classify anything in the reading.
      if (segmentHolding(current, operation.wordId) < 0) return orphan("WORD_NOT_FOUND");
      colloquy.add(operation.wordId);
      return;
    }
    if (operation.op === "uncolloquy") {
      // Reported rather than ignored, exactly as unflag is. A clear that silently did nothing
      // leaves the reporter believing a line reads as a question again when it still reads as
      // colloquy on the page they are about to certify.
      if (!colloquy.delete(operation.wordId)) return orphan("COLLOQUY_NOT_FOUND");
      return;
    }
    const anchor=operation.afterWordId??operation.beforeWordId;
    if (!anchorExists(anchor)) return orphan("WORD_NOT_FOUND");
    const target=operation.beforeWordId?insertedBefore:inserted;
    const list = target.get(anchor) ?? [];
    // The id is positional, so the same overlay against the same projection produces the same
    // ids every time -- I4. It carries no evidence anchor, which is the point: reporter-authored
    // text must stay distinguishable from anything the microphone produced.
    // Preserve the established after-anchor identity exactly; Phase 5 adds a namespaced form
    // only for the newly supported before-anchor case, so existing overlays do not drift.
    const authored={ id:operation.beforeWordId?`overlay:${anchor}:before:${list.length + 1}`:`overlay:${anchor}:${list.length + 1}`, text:operation.text, authored:true };
    list.push(authored);authoredIds.add(authored.id);
    target.set(anchor, list);
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
  // Transcript order, not the order the reporter marked them in. A reporter who notices the
  // redirect first and goes back for the cross has still described the same proceeding, and
  // whatever walks paragraphs in order needs the boundaries in the order it will meet them.
  const examinationBoundaries = [...examinations.values()]
    .map(boundary => ({ boundary, at:order.indexOf(boundary.atWordId) }))
    .filter(item => item.at >= 0)
    .sort((left, right) => left.at - right.at)
    .map(item => item.boundary);
  // Like `flagged`, deliberately not folded into replaced/deleted/inserted: a boundary changes no
  // word the reader reads.
  // Like `flagged` and the boundaries, deliberately not folded into replaced/deleted/inserted: a
  // classification changes no word the reader reads. Nothing consumes this yet -- §247-B is the
  // labeller, and keeping the operation inert first is the discipline Phase B used.
  return { segments:current, replaced, deleted, inserted, insertedBefore, flagged, reviews, examinations:examinationBoundaries, colloquy, orphaned };
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

/** Appends one user action, which may contain several low-level operations. */
export function appendTransaction(overlay, inputs) {
  const current=validateOverlay(overlay,overlay?.depositionId);
  const batch=[];
  for(const input of Array.isArray(inputs)?inputs:[inputs]){
    const result=validateOperation(input);
    if(!result.ok)throw new Error(result.message);
    batch.push(result.operation);
  }
  if(!batch.length)throw new Error("A reporter transaction requires at least one operation.");
  return {...current,operations:[...current.operations,...batch],transactionSizes:[...current.transactionSizes,batch.length],redoTransactions:[]};
}

/** Removes the last complete user action, not merely its final implementation operation. */
export function undoLastTransaction(overlay){
  const current=validateOverlay(overlay,overlay?.depositionId);
  const size=current.transactionSizes.at(-1)??0;
  if(!size)return{overlay:current,removed:null};
  const removed=current.operations.slice(-size);
  return{overlay:{...current,operations:current.operations.slice(0,-size),transactionSizes:current.transactionSizes.slice(0,-1),redoTransactions:[...current.redoTransactions,removed]},removed};
}

export function redoLastTransaction(overlay){
  const current=validateOverlay(overlay,overlay?.depositionId);
  const restored=current.redoTransactions.at(-1)??null;
  if(!restored)return{overlay:current,restored:null};
  return{overlay:{...current,operations:[...current.operations,...restored],transactionSizes:[...current.transactionSizes,restored.length],redoTransactions:current.redoTransactions.slice(0,-1)},restored};
}
