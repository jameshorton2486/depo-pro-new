// The assembly write path, exercised rather than source-pinned.
//
// Eight tests read server/local-api.mjs with readFileSync and assert on source strings, because
// importing it used to bind a port. That guard landed in 2A precisely so this file would not
// become the ninth: the write path for document-assembly authority is the last thing that should
// be checked by grepping for its own name.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ASSEMBLY_SCHEMA_VERSION, AssemblyConflictError, AssemblyRefusedError,
  assemblyReadiness, readAssembly, validateAssembly, writeAssembly,
} from "../server/complete-transcript-assembly.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPOSITION = "DEP-20260827-ASMBL";

function disposableRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-assembly-"));
  fs.mkdirSync(path.join(root, "reporter", "cause", "witness", "intake"), { recursive: true });
  fs.writeFileSync(path.join(root, "reporter", "cause", "witness", "deposition.json"),
    JSON.stringify({ id: DEPOSITION, storagePath: "reporter/cause/witness" }, null, 2));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const validOperator = () => ({
  jurisdiction: "texas-state",
  signatureDisposition: "waived",
  signatureDispositionBasis: "Stated on the record",
  examiningCounselId: "counsel-1",
});
const valid = () => ({ schemaVersion: ASSEMBLY_SCHEMA_VERSION, operator: validOperator() });
const actor = () => ({ preparedBy: "Riley Reporter", preparedAt: "2026-08-27T12:00:00.000Z" });

test("a preparation writes, reads back, and reports ready", () => {
  const storageRoot = disposableRoot();
  const written = writeAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot, assembly: valid(), expectedRevision: 0, actor: actor() });

  assert.equal(written.revision, 1);
  const readiness = assemblyReadiness(repositoryRoot, { depositionId: DEPOSITION, storageRoot });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.revision, 1);
  assert.deepEqual(readiness.blocking, []);
  // Provenance is on the record, not merely accepted at the door.
  assert.equal(readiness.assembly.preparedBy, "Riley Reporter");
  assert.equal(readiness.assembly.preparedAt, "2026-08-27T12:00:00.000Z");
});

test("stale-revision writes are refused rather than merged or overwritten", () => {
  const storageRoot = disposableRoot();
  writeAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot, assembly: valid(), expectedRevision: 0, actor: actor() });

  // A second reporter who read revision 0 before the first write landed.
  const stale = { ...valid(), operator: { ...validOperator(), signatureDispositionBasis: "A different basis" } };
  assert.throws(
    () => writeAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot, assembly: stale, expectedRevision: 0, actor: actor() }),
    (error) => error instanceof AssemblyConflictError && error.code === "ASSEMBLY_REVISION_CONFLICT",
  );

  // The refusal must leave the first write intact. Losing it quietly is the outcome the check exists to prevent.
  const readiness = assemblyReadiness(repositoryRoot, { depositionId: DEPOSITION, storageRoot });
  assert.equal(readiness.revision, 1);
  assert.equal(readiness.assembly.operator.signatureDispositionBasis, "Stated on the record");
});

test("a write with no author and a write with no time are both refused", () => {
  const storageRoot = disposableRoot();
  for (const [label, missing] of [["who", { preparedAt: "2026-08-27T12:00:00.000Z" }], ["when", { preparedBy: "Riley Reporter" }]]) {
    assert.throws(
      () => writeAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot, assembly: valid(), expectedRevision: 0, actor: missing }),
      (error) => error instanceof AssemblyRefusedError,
      `a preparation with no ${label} was accepted`,
    );
  }
  // Nothing was written by either refusal.
  assert.equal(readAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot }).exists, false);
});

test("schema validation names each missing field in reporter language and a machine code", () => {
  const findings = validateAssembly({ schemaVersion: ASSEMBLY_SCHEMA_VERSION, operator: {} });
  const codes = findings.map(finding => finding.code);
  assert.ok(codes.includes("ASSEMBLY_JURISDICTION"));
  assert.ok(codes.includes("ASSEMBLY_SIGNATURE_DISPOSITION"));
  assert.ok(codes.includes("ASSEMBLY_SIGNATURE_BASIS"));
  assert.ok(codes.includes("ASSEMBLY_EXAMINER_MISSING"));
  // Both registers on every finding: the code for logs and evidence, prose for the screen.
  for (const finding of findings) {
    assert.match(finding.code, /^ASSEMBLY_[A-Z_]+$/);
    assert.ok(finding.message.length > 20 && !/[A-Z_]{6,}/.test(finding.message), `not reporter-facing prose: ${finding.message}`);
  }
});

// The binding, not the validator.
//
// The test above proves validateAssembly reports the right findings when called directly. It
// says nothing about whether the write path calls it -- and it does not: removing
// validateAssembly from writeAssembly killed no test until this one existed. A validator nothing
// invokes is a validator that refuses nothing.
test("writeAssembly refuses a schema-invalid preparation and writes nothing", () => {
  const storageRoot = disposableRoot();
  assert.throws(
    () => writeAssembly(repositoryRoot, {
      depositionId: DEPOSITION, storageRoot, expectedRevision: 0, actor: actor(),
      assembly: { schemaVersion: ASSEMBLY_SCHEMA_VERSION, operator: { jurisdiction: "texas-state" } },
    }),
    (error) => error instanceof AssemblyRefusedError
      && error.findings.some(finding => finding.code === "ASSEMBLY_SIGNATURE_DISPOSITION")
      && error.findings.some(finding => finding.code === "ASSEMBLY_EXAMINER_MISSING"),
  );
  assert.equal(readAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot }).exists, false);
});

test("a stored preparation that no longer satisfies the schema reports blocked rather than ready", () => {
  const storageRoot = disposableRoot();
  // Written straight to disk: a preparation that was valid when stored, under a schema that has
  // since gained a requirement. Readiness must re-derive from the rules, not trust the file.
  fs.writeFileSync(path.join(storageRoot, "reporter", "cause", "witness", "intake", "complete-transcript-assembly.json"),
    JSON.stringify({ schemaVersion: ASSEMBLY_SCHEMA_VERSION, revision: 4, preparedBy: "Riley Reporter", preparedAt: "2026-08-27T12:00:00.000Z", operator: { jurisdiction: "texas-state", signatureDisposition: "waived", signatureDispositionBasis: "Stated on the record" } }, null, 2));

  const readiness = assemblyReadiness(repositoryRoot, { depositionId: DEPOSITION, storageRoot });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blocking.map(finding => finding.code), ["ASSEMBLY_EXAMINER_MISSING"]);
});

test("an unprepared deposition is blocked with prose, not with an enum", () => {
  const storageRoot = disposableRoot();
  const readiness = assemblyReadiness(repositoryRoot, { depositionId: DEPOSITION, storageRoot });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.exists, false);
  assert.equal(readiness.blocking[0].code, "COMPLETE_TRANSCRIPT_ASSEMBLY_REQUIRED");
  assert.match(readiness.blocking[0].message, /Prepare Complete Transcript/);
});

test("a preparation written before revisions existed still reads, and the next write supersedes it", () => {
  const storageRoot = disposableRoot();
  // Exactly what scripts/create-milestone2-browser-fixture.mjs writes: version 1.0.0, no
  // revision, no author. Refusing to read it would remove the only complete transcript this
  // application can currently produce.
  fs.writeFileSync(path.join(storageRoot, "reporter", "cause", "witness", "intake", "complete-transcript-assembly.json"),
    JSON.stringify({ schemaVersion: "1.0.0", generatedAt: "2026-08-26T12:00:00.000Z", operator: validOperator() }, null, 2));

  const before = readAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot });
  assert.equal(before.exists, true);
  assert.equal(before.legacy, true);
  assert.equal(before.revision, 0);

  const written = writeAssembly(repositoryRoot, { depositionId: DEPOSITION, storageRoot, assembly: valid(), expectedRevision: 0, actor: actor() });
  assert.equal(written.revision, 1);
  assert.equal(written.assembly.schemaVersion, ASSEMBLY_SCHEMA_VERSION);
  assert.equal(written.assembly.preparedBy, "Riley Reporter");
});

test("the assembly authority does not carry pages, line numbers, or index references", () => {
  const storageRoot = disposableRoot();
  const written = writeAssembly(repositoryRoot, {
    depositionId: DEPOSITION, storageRoot, expectedRevision: 0, actor: actor(),
    // A caller trying to smuggle layout in through the administrative door.
    assembly: { ...valid(), pages: [{ pageNumber: 1 }], index: { reportersCertification: { startPage: 13 } } },
  });
  // Pagination belongs to the shared paginator. A second copy here is a second answer.
  assert.equal(written.assembly.pages, undefined);
  assert.equal(written.assembly.index, undefined);
});
