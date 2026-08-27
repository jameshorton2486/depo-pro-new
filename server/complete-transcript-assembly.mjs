// The administrative authority a complete transcript is assembled from.
//
// This module owns one file per deposition -- intake/complete-transcript-assembly.json -- and
// nothing else. It does not construct pages, line numbers, index references, or prose. Those
// belong to the shared paginator and the templates, and a second source for them would be a
// second answer to questions that must have one.
//
// Until now the only writer of that file was scripts/create-milestone2-browser-fixture.mjs, so
// the complete transcript existed for fixture-created depositions and for nothing else.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";

export const ASSEMBLY_SCHEMA_VERSION = "1.1.0";
const ASSEMBLY_FILE = path.join("intake", "complete-transcript-assembly.json");
const JURISDICTIONS = Object.freeze(["texas-state", "federal"]);
const DISPOSITIONS = Object.freeze(["requested", "waived"]);

// Reporter-facing prose alongside the machine code, both from the server.
//
// The banner used to display COMPLETE_TRANSCRIPT_ASSEMBLY_REQUIRED because that was the only
// thing the server said. Translating an enum in the browser would let the display claim to know
// more than the server told it, so the server says it in both registers: the code for logs and
// evidence, the prose for the person reading the screen.
const blocked = (code, message, field = null) => ({ code, message, field });

function assemblyPath(root, depositionId, storageRoot) {
  return path.join(depositionDirectory(root, depositionId, { storageRoot }), ASSEMBLY_FILE);
}

// Temp file plus rename on the same volume, matching the house pattern in opening-procedures.mjs.
// Never read-delete-write: the prior assembly must still be on disk and intact until the
// replacement is durably written, because a crash between the delete and the write would leave a
// deposition with no assembly authority and no way to tell that it ever had one.
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}

const text = value => typeof value === "string" ? value.trim() : "";

/**
 * Schema validation. Returns blocking findings; an empty array means the shape is acceptable.
 *
 * Absence is never repaired here. A field left out is reported, not defaulted -- a default would
 * put a value nobody chose onto a certified record and give it the same standing as one a
 * reporter entered deliberately.
 */
export function validateAssembly(input) {
  const findings = [];
  if (!input || typeof input !== "object") {
    return [blocked("ASSEMBLY_MALFORMED", "The complete transcript preparation could not be read as a record.")];
  }
  if (input.schemaVersion !== ASSEMBLY_SCHEMA_VERSION) {
    findings.push(blocked("ASSEMBLY_SCHEMA_VERSION", `This preparation is version ${input.schemaVersion ?? "(none)"}; this application writes version ${ASSEMBLY_SCHEMA_VERSION}.`, "schemaVersion"));
  }
  const operator = input.operator;
  if (!operator || typeof operator !== "object") {
    findings.push(blocked("ASSEMBLY_OPERATOR_MISSING", "No preparation details were supplied.", "operator"));
    return findings;
  }
  if (!JURISDICTIONS.includes(operator.jurisdiction)) {
    findings.push(blocked("ASSEMBLY_JURISDICTION", "Choose the jurisdiction this deposition was taken in.", "operator.jurisdiction"));
  }
  if (!DISPOSITIONS.includes(operator.signatureDisposition)) {
    findings.push(blocked("ASSEMBLY_SIGNATURE_DISPOSITION", "Record whether signature was requested or waived.", "operator.signatureDisposition"));
  }
  if (!text(operator.signatureDispositionBasis)) {
    findings.push(blocked("ASSEMBLY_SIGNATURE_BASIS", "Record how the signature disposition was established, as it is printed on the certificate.", "operator.signatureDispositionBasis"));
  }
  // Canonical identity, never a typed name. A name copied here would be a second place the
  // examiner is recorded, free to disagree with the participant roster the speaker map uses.
  if (!text(operator.examiningCounselId)) {
    findings.push(blocked("ASSEMBLY_EXAMINER_MISSING", "Select the examining attorney from the participants on this deposition.", "operator.examiningCounselId"));
  }
  return findings;
}

/**
 * Provenance. Who prepared this, and when.
 *
 * Separate from schema validation because it is a different kind of requirement: the schema says
 * what a preparation must contain to render, provenance says what the record must carry to be
 * relied on afterwards. `preparedAt` is not defaulted to now(). A timestamp the application
 * invented is indistinguishable on the page from one a reporter's action produced.
 */
export function validateProvenance(actor) {
  const findings = [];
  if (!text(actor?.preparedBy)) findings.push(blocked("ASSEMBLY_PROVENANCE_WHO", "The preparation must record who prepared it.", "preparedBy"));
  if (!text(actor?.preparedAt)) findings.push(blocked("ASSEMBLY_PROVENANCE_WHEN", "The preparation must record when it was prepared.", "preparedAt"));
  else if (Number.isNaN(Date.parse(actor.preparedAt))) findings.push(blocked("ASSEMBLY_PROVENANCE_WHEN", "The preparation time could not be read as a date.", "preparedAt"));
  return findings;
}

/**
 * Reads the stored assembly.
 *
 * A file written before revisions and provenance existed (schemaVersion 1.0.0) still reads.
 * Refusing it would take away the only complete transcript this application could produce, and
 * reading a record is not the act provenance protects -- writing one is. Its revision reads as 0,
 * so the first write through this module supersedes it and records an author for the replacement.
 *
 * DELETE THIS LEGACY BRANCH AT CHECKPOINT 3.
 *
 * Trigger, so this is not carried as an unnamed compatibility path: delete it once a test asserts
 * that no assembly file in the tree reads revision 0. The whole legacy population was ever one
 * synthetic fixture -- no reporter-created deposition has had an assembly file, because until
 * this module existed nothing but the fixture generator could write one -- and that generator now
 * calls writeAssembly like every other caller. When that test exists, this branch is dead code
 * carrying a compatibility promise to no one.
 */
export function readAssembly(root, { depositionId, storageRoot } = {}) {
  const file = assemblyPath(root, depositionId, storageRoot);
  if (!fs.existsSync(file)) {
    return { exists: false, revision: 0, assembly: null, legacy: false };
  }
  const assembly = JSON.parse(fs.readFileSync(file, "utf8"));
  const revision = Number.isInteger(assembly.revision) ? assembly.revision : 0;
  return { exists: true, revision, assembly, legacy: assembly.schemaVersion !== ASSEMBLY_SCHEMA_VERSION };
}

export class AssemblyConflictError extends Error {
  constructor(expected, actual) {
    super(`ASSEMBLY_REVISION_CONFLICT: this preparation was changed elsewhere. You were editing revision ${expected}; the stored preparation is now revision ${actual}. Reload before saving so the other change is not lost.`);
    this.code = "ASSEMBLY_REVISION_CONFLICT";
    this.expected = expected;
    this.actual = actual;
  }
}

export class AssemblyRefusedError extends Error {
  constructor(findings) {
    super(findings.map(finding => finding.message).join(" "));
    this.code = "ASSEMBLY_REFUSED";
    this.findings = findings;
  }
}

/**
 * Writes the assembly, or refuses.
 *
 * `expectedRevision` is what the caller last read. A mismatch is refused rather than merged or
 * overwritten: two reporters preparing the same deposition are making different decisions about
 * the same certificate, and silently keeping the later one loses the earlier without telling
 * anybody it existed.
 */
export function writeAssembly(root, { depositionId, storageRoot, assembly, expectedRevision, actor } = {}) {
  const findings = [...validateAssembly(assembly), ...validateProvenance(actor)];
  if (findings.length) throw new AssemblyRefusedError(findings);

  const current = readAssembly(root, { depositionId, storageRoot });
  if (!Number.isInteger(expectedRevision)) {
    throw new AssemblyRefusedError([blocked("ASSEMBLY_REVISION_REQUIRED", "The preparation must say which revision it is replacing. Reload and try again.", "expectedRevision")]);
  }
  if (expectedRevision !== current.revision) throw new AssemblyConflictError(expectedRevision, current.revision);

  const stored = {
    schemaVersion: ASSEMBLY_SCHEMA_VERSION,
    revision: current.revision + 1,
    preparedBy: text(actor.preparedBy),
    preparedAt: text(actor.preparedAt),
    // Retained so an assembly can still say when the document it describes was generated,
    // which is a different fact from when the preparation was recorded.
    generatedAt: text(assembly.generatedAt) || null,
    operator: assembly.operator,
    intake: assembly.intake ?? {},
  };
  atomicJson(assemblyPath(root, depositionId, storageRoot), stored);
  return { revision: stored.revision, assembly: stored };
}

/**
 * The readiness projection, computed here and displayed by the browser.
 *
 * The browser is not given the rules. A screen that decides for itself whether a deposition is
 * ready is a second authority on the question, and the two will disagree the first time one of
 * them changes.
 */
export function assemblyReadiness(root, { depositionId, storageRoot } = {}) {
  const current = readAssembly(root, { depositionId, storageRoot });
  if (!current.exists) {
    return {
      ready: false,
      revision: 0,
      exists: false,
      blocking: [blocked("COMPLETE_TRANSCRIPT_ASSEMBLY_REQUIRED", "This deposition has not been prepared for a complete transcript yet. Open Prepare Complete Transcript to record the jurisdiction, signature disposition, examining attorney, and certificate details.")],
      assembly: null,
    };
  }
  const blocking = validateAssembly(current.assembly);
  return { ready: blocking.length === 0, revision: current.revision, exists: true, legacy: current.legacy, blocking, assembly: current.assembly };
}
