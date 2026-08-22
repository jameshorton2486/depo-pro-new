// The reporter's red marks, on disk beside the event log.
//
// Red is a review marker, not an edit: it says "come back to this passage" and the timestamp beside
// it says where in the recording to listen. Marks held only in the browser are gone on reload, and
// during an eight-hour deposition a reload happens -- for any reason, at any point. A mark that
// silently disappears is worse than no mark at all, because the reporter believes it is there and
// stops holding the passage in their head.
//
// WHY A LOG OF ACTIONS RATHER THAN A LIST OF MARKS. Clearing red from one word in a marked phrase
// narrows the annotation rather than dropping it, and an append-only file cannot express a narrowed
// record without rewriting the one it already wrote. So the file holds what the reporter did --
// MARK and UNMARK over runs of words -- and the current set is a fold of those in order. Same
// relationship the canonical corrections log has to the canonical record.
//
// Anchored to word ids, never to character offsets or paragraph ids. Paragraphs regroup as a voice
// continues; a word id is `${eventId}:w${index}` over an append-only finalized event, so it cannot
// move. paragraphId is recorded for a human reading the file, and the fold never depends on it.
//
// Nothing here reaches a transcript, the working record, or any evidence file. It is a private
// index into the audio for the reporter who made it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {markRed, removeRed} from "../app/live-annotations.mjs";

export const LIVE_ANNOTATION_SCHEMA_VERSION = 1;
export const MARK = "MARK", UNMARK = "UNMARK";
const LINE_END = String.fromCharCode(10);

function validated({action, paragraphId, wordIds}) {
  if (action !== MARK && action !== UNMARK) throw new Error("A live annotation is MARK or UNMARK.");
  const ids = Array.isArray(wordIds) ? wordIds.filter(id => typeof id === "string" && id) : [];
  if (!ids.length) throw new Error("A live annotation needs at least one finalized word id.");
  if (action === MARK && !(typeof paragraphId === "string" && paragraphId))
    throw new Error("A mark needs the paragraph it was made in.");
  return {action, paragraphId: typeof paragraphId === "string" && paragraphId ? paragraphId : null, wordIds: ids};
}

/**
 * Appends one action and returns the line as written.
 *
 * Throws if the write fails rather than reporting a mark it did not store -- the caller turns a
 * word red only on the way back from here.
 */
export function appendLiveAnnotation(file, input = {}) {
  const {action, paragraphId, wordIds} = validated(input);
  const record = {
    schemaVersion: LIVE_ANNOTATION_SCHEMA_VERSION,
    recordType: "LIVE_ANNOTATION",
    // Assigned here, not by the browser. The client-side counter restarts at one on every reload
    // and in every tab, so ids it produced would collide across the day.
    annotationId: `AN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    action, type: "TEXT_COLOR", value: "RED",
    paragraphId, wordIds, at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.appendFileSync(file, JSON.stringify(record) + LINE_END);
  return record;
}

/**
 * The marks as they now stand, folded from the log in the order the reporter made them.
 *
 * Returns every mark, never a tail. The screen shows a window of the event log, so most marked
 * words are outside it by mid-morning; a mark whose words are not on screen simply does not render,
 * and it must still be here when the reporter scrolls back to them.
 */
export function readLiveAnnotations(file) {
  if (!fs.existsSync(file)) return {annotations: [], annotationLogLength: 0, unreadableLines: 0};
  const lines = fs.readFileSync(file, "utf8").split(LINE_END).filter(Boolean);
  let annotations = [], unreadableLines = 0;
  for (const line of lines) {
    let entry = null;
    try { entry = JSON.parse(line) } catch { entry = null }
    // Counted rather than ignored. One torn line -- a crash mid-append -- should not throw away
    // every other mark, but the reporter is told the count so a silent partial restore is not
    // mistaken for a complete one.
    if (entry?.recordType !== "LIVE_ANNOTATION") { unreadableLines++; continue }
    annotations = entry.action === UNMARK
      ? removeRed(annotations, {wordIds: entry.wordIds})
      : markRed(annotations, {annotationId: entry.annotationId, paragraphId: entry.paragraphId,
          wordIds: entry.wordIds, createdAt: entry.at});
  }
  return {annotations, annotationLogLength: lines.length, unreadableLines};
}
