import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The certificate asks for a firm registration number, and there are two honest answers: the number,
// or a recorded reason it does not apply. This store holds both.
//
// WHAT THIS COMMENT USED TO SAY, AND WHY IT WAS WRONG. It argued that no firmRegistrationNumber
// field was needed, because "three certified transcripts, both jurisdictions, six signature blocks,
// and not one prints a firm registration number" -- and concluded from that silence that Miah Bardot
// certifies under an individual Texas CSR with no firm.
//
// The Etminan Notice of Deposition, served on all counsel on 17 April 2026, states:
//
//   REPORTER & VIDEO:  SA Legal Solutions
//
// and its first page is that firm's own job sheet for the assignment. So at least one of those six
// signature blocks belongs to a deposition reported through a firm, and prints no registration
// number anyway. A certificate that omits a fact does not assert that the fact does not apply, and
// the whole design assumption was an inference drawn from that omission.
//
// The lesson generalises past this field: specimen silence is not specimen evidence. Reading a
// requirement OUT of the model because no example exercised it is how a store comes to be unable to
// record something true. See the deferred certificate blanks for the same mistake in the other
// direction -- there, a missing value printed nothing and took the sentence with it.
//
// firmRegistrationWaiver stays, and its presence IS the waiver -- there is no separate applicable
// flag, so the record cannot hold "not applicable" with nothing to say why, which is the state a
// certificate could not defend. The two are alternatives, not a pair: a reporter has a number or has
// a reason, and validateCredentials accepts either.
//
// csrExpiration is here because six byte-identical signature blocks across three certified
// transcripts all carry "EXPIRES 6-30-2026", the reviewed template prints
// ^reporter.csrExpirationDate^, and validateInsertionInput blocks without it -- so a store that
// could not hold one made a certification page unrenderable for the reporter this application is
// for.
const REPORTER_FIELDS = ["name", "company", "email", "phone", "licenseNumber", "csrExpiration", "taxId", "address", "firmRegistrationNumber", "firmRegistrationWaiver"];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function storeFile(storageRoot) {
  return path.join(path.resolve(storageRoot), "reporters.json");
}

function text(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

// Refused rather than coerced, because String() has an answer for everything and some of those
// answers print on a certified page. A caller reading the canonical record and sending a field back
// hands over { value: "2486" } -- the envelope shape -- and String() turns that into the literal
// "[object Object]", which would appear in a signature block as a firm registration number.
//
// Every field on the whitelist, not only the number: a name mangled the same way is the same defect
// on the same page. null and undefined are still fine and still mean "not recorded"; what is refused
// is a structure that has no text form worth printing.
function reporterText(field, value, maximum = 1000) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    throw new Error(`Court reporter ${field} must be text, not ${Array.isArray(value) ? "a list" : "an object"}.`);
  }
  return text(value, maximum);
}

function normalizeReporter(input) {
  const id = text(input?.id || crypto.randomUUID(), 128);
  if (!ID_PATTERN.test(id)) throw new Error("Court reporter ID is invalid.");
  const reporter = { id };
  for (const field of REPORTER_FIELDS) reporter[field] = reporterText(field, input?.[field]);
  if (!reporter.name) throw new Error("Court reporter name is required.");
  return reporter;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}

export function listReporters(storageRoot) {
  const file = storeFile(storageRoot);
  if (!fs.existsSync(file)) return [];
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  if (document?.schemaVersion !== "1.0.0" || !Array.isArray(document.reporters)) {
    throw new Error("Court reporter directory is malformed or unsupported.");
  }
  return document.reporters.map(normalizeReporter).sort((a, b) => a.name.localeCompare(b.name));
}

function writeReporters(storageRoot, reporters) {
  const normalized = reporters.map(normalizeReporter);
  const ids = new Set();
  for (const reporter of normalized) {
    if (ids.has(reporter.id)) throw new Error(`Court reporter ID ${reporter.id} appears more than once.`);
    ids.add(reporter.id);
  }
  normalized.sort((a, b) => a.name.localeCompare(b.name));
  atomicJson(storeFile(storageRoot), { schemaVersion:"1.0.0", updatedAt:new Date().toISOString(), reporters:normalized });
  return normalized;
}

export function createReporter(storageRoot, input) {
  const reporter = normalizeReporter(input);
  const reporters = listReporters(storageRoot);
  if (reporters.some(item => item.id === reporter.id)) throw new Error("Court reporter already exists.");
  writeReporters(storageRoot, [...reporters, reporter]);
  return reporter;
}

/**
 * Corrects a profile that already exists. Its own verb, deliberately.
 *
 * Nothing could change a stored reporter before this. createReporter refuses an id it already holds,
 * and importReporters skips one -- and that skip is correct, because a legacy import must never
 * clobber a profile somebody has since corrected. Between them there was no path at all, so a
 * mistyped CSR licence number, expiration, address or firm registration was permanent, and every one
 * of those prints in the signature block of every certificate that reporter signs.
 *
 * Found at the first screen of Production Trial #1: the deposition could not be created because the
 * reporter's licence number was wrong and could not be fixed. It is also the likeliest reason this
 * store holds two profiles for one reporter.
 *
 * REFUSES an id it does not hold rather than falling through to an insert. An update that quietly
 * created would answer "this profile is not here" by manufacturing one, and the caller would never
 * learn it had the wrong id. Depositions reference the reporter by id, so the id never moves.
 */
export function updateReporter(storageRoot, input) {
  // An update must say who it is updating. normalizeReporter invents an id when none is supplied,
  // which is right for a creation and wrong here: without this the caller gets "not found" naming a
  // UUID it never sent, which describes the wrong problem.
  if (!text(input?.id, 128)) throw new Error("Court reporter ID is required to correct a profile.");
  const reporter = normalizeReporter(input);
  const reporters = listReporters(storageRoot);
  const at = reporters.findIndex(item => item.id === reporter.id);
  if (at < 0) throw new Error(`Court reporter ${reporter.id} was not found, so there is nothing to correct.`);
  writeReporters(storageRoot, reporters.map((item, index) => index === at ? reporter : item));
  return reporter;
}

export function importReporters(storageRoot, input) {
  if (!Array.isArray(input)) throw new Error("Court reporters must be an array.");
  const existing = listReporters(storageRoot);
  const byId = new Map(existing.map(reporter => [reporter.id, reporter]));
  for (const candidate of input) {
    const reporter = normalizeReporter(candidate);
    if (!byId.has(reporter.id)) byId.set(reporter.id, reporter);
  }
  return writeReporters(storageRoot, [...byId.values()]);
}
