// A live deposition's canonical record refuses writes until the reporter deliberately opens it.
//
// WHY THIS EXISTS. An automated browser qualification wrote deposition.actualStart on Production
// Trial #1 -- a real deposition, a real evidentiary field -- because the qualification was pointed at
// the live record instead of a disposable copy, and nothing in the application distinguished the two.
// The value happened to be right. Nothing about the mechanism made it so.
//
// WHY IT DOES NOT DETECT AUTOMATION. The obvious design is a flag the qualification harness sets,
// refusing writes while it is set. That fails exactly where the real incident happened: the browser
// driving that write was an ordinary one, with no flag anywhere, and a mechanism that trusts
// automation to declare itself protects nothing from the automation that does not.
//
// So this asks a different question. Not "who is writing?" -- the application has no identity and
// cannot know -- but "has a human deliberately opened this record in the last few minutes?" That is
// answerable from state the application actually holds, and the answer is no for every unattended
// process, whatever it is running in.
//
// SCOPE. The canonical record and its correction log: the evidentiary facts and their history, which
// is what a court could be asked to rely on and what the incident damaged. Deliberately NOT the
// transcript overlay -- the reporter corrects the transcript continuously, and a record that demanded
// an unlock every fifteen minutes to do the day's work would be turned off within a day.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PROTECTION_FILE = "protection.json";
export const DEPOSITION_PROTECTED = "DEPOSITION_PROTECTED";

/** The files this guard covers. Both live in <deposition>/intake/. */
export const GUARDED_FILES = Object.freeze(["canonical-deposition-record.json", "canonical-corrections.jsonl"]);

// Long enough to finish a correction, short enough that a forgotten unlock closes itself. An unlock
// the reporter has to remember to reverse is one that stays open, and a protection that is usually
// open is not a protection.
export const UNLOCK_WINDOW_MS = 15 * 60 * 1000;

const atomic = (file, value) => {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`, descriptor = fs.openSync(temporary, "wx");
  try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
};

/**
 * The deposition folder a guarded file belongs to, or null.
 *
 * Derived from the path rather than passed in, because the guard sits in the write primitive where
 * no deposition id is in scope -- and that is the point: a future canonical writer is covered without
 * knowing this module exists.
 */
export function depositionFolderFor(file) {
  const resolved = path.resolve(file);
  if (!GUARDED_FILES.includes(path.basename(resolved))) return null;
  const intake = path.dirname(resolved);
  if (path.basename(intake) !== "intake") return null;
  return path.dirname(intake);
}

export function readProtection(directory) {
  const file = path.join(directory, PROTECTION_FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    // A protection file that cannot be read is treated as protecting, not as absent. The failure
    // mode of guessing wrong in the other direction is an unguarded write to a live record.
    const refusal = new Error(`${directory} carries a protection marker that could not be read, so it is treated as protected. Repair or remove ${PROTECTION_FILE}.`, { cause: error });
    refusal.code = DEPOSITION_PROTECTED;
    throw refusal;
  }
}

/** Whether an unlock is currently open. Exported so the screen and the guard cannot disagree. */
export function unlockState(protection, now = Date.now()) {
  const until = Date.parse(protection?.unlockedUntil ?? "");
  const open = Number.isFinite(until) && until > now;
  return { open, unlockedUntil: open ? new Date(until).toISOString() : null, msRemaining: open ? until - now : 0 };
}

/**
 * Refuses a write to a protected record that nobody has opened.
 *
 * Called from the atomic write primitives, so it covers every canonical writer at once. Guarding the
 * eight write functions individually would have left the ninth -- whichever gets added next -- open.
 */
export function assertWritable(file, { now = Date.now() } = {}) {
  const directory = depositionFolderFor(file);
  if (!directory) return;
  const protection = readProtection(directory);
  if (!protection?.protected) return;
  const { open } = unlockState(protection, now);
  if (open) return;

  // The filename is on the error, not in the sentence. A reporter reading this has no reason to know
  // what canonical-corrections.jsonl is, and a refusal that opens with one reads as a crash.
  const refusal = new Error(
    `This deposition is protected${protection.reason ? `: ${protection.reason}` : "."} `
    + "Its canonical record and correction log are closed to writes until a reporter opens them on the Opening screen. "
    + "If this refusal came from an automated run, it did its job: point the run at a disposable copy.",
  );
  refusal.code = DEPOSITION_PROTECTED;
  refusal.deposition = directory;
  refusal.file = path.basename(file);
  throw refusal;
}

/** Marks a deposition's canonical record protected. */
export function protectDeposition(directory, { reason, at = new Date().toISOString() } = {}) {
  const text = String(reason ?? "").trim();
  if (!text) throw new Error("Protecting a deposition requires a reason, so a later reader knows what it is protecting.");
  const existing = readProtection(directory) ?? {};
  atomic(path.join(directory, PROTECTION_FILE), { ...existing, protected: true, reason: text, protectedAt: at, unlockedUntil: null });
  return readProtection(directory);
}

/**
 * Opens a protected record for one window.
 *
 * Every unlock is kept. It is not the correction log -- that log records what changed, and this
 * records that a person opened the door, which is a different fact and would be circular to store
 * inside a file this guard protects.
 */
export function unlockDeposition(directory, { reason, now = Date.now() } = {}) {
  const text = String(reason ?? "").trim();
  if (!text) throw new Error("Opening a protected deposition requires a reason.");
  const protection = readProtection(directory);
  if (!protection?.protected) throw new Error("That deposition is not protected, so there is nothing to open.");
  const at = new Date(now).toISOString(), unlockedUntil = new Date(now + UNLOCK_WINDOW_MS).toISOString();
  atomic(path.join(directory, PROTECTION_FILE), {
    ...protection, unlockedUntil,
    unlocks: [...(protection.unlocks ?? []), { at, until: unlockedUntil, reason: text, origin: "OPENING" }],
  });
  return readProtection(directory);
}

/**
 * Lifts protection for good.
 *
 * DELIBERATELY NOT A ROUTE, AND NOT A BUTTON. It sits beside the unlock in neither the API nor the
 * screen, because a control that ends protection permanently, one click from the one that opens it
 * for fifteen minutes, becomes the control people press. The weaker action must not be the more
 * convenient one. scripts/protect-deposition.mjs is the way in, which is a thing a person types on
 * purpose and cannot reach by clicking around.
 *
 * The marker is rewritten rather than deleted, so the fact that this deposition WAS protected -- and
 * every unlock taken while it was -- survives lifting it. A trail that disappears when the thing it
 * describes ends is not a trail.
 */
export function unprotectDeposition(directory, { reason, at = new Date().toISOString() } = {}) {
  const text = String(reason ?? "").trim();
  if (!text) throw new Error("Lifting protection requires a reason, which is the whole record of why it was lifted.");
  const protection = readProtection(directory);
  if (!protection?.protected) throw new Error("That deposition is not protected, so there is nothing to lift.");
  atomic(path.join(directory, PROTECTION_FILE), {
    ...protection, protected: false, unlockedUntil: null, unprotectedAt: at, unprotectedReason: text,
  });
  return readProtection(directory);
}

/** What the screen shows. Null for an unprotected deposition, so the banner is absent rather than off. */
export function protectionProjection(directory, { now = Date.now() } = {}) {
  const protection = readProtection(directory);
  if (!protection?.protected) return null;
  const { open, unlockedUntil, msRemaining } = unlockState(protection, now);
  return { protected: true, reason: protection.reason ?? null, unlocked: open, unlockedUntil, msRemaining, unlockCount: (protection.unlocks ?? []).length };
}
