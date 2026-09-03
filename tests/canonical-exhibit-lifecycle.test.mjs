import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDeposition } from "../server/deposition-store.mjs";
import { getFinalizationReadiness } from "../server/finalization-readiness.mjs";
import {
  _testing,
  getExhibitReadiness,
  recordExhibitAudit,
  recordExhibit,
  resolveExhibitLifecycle,
} from "../server/canonical-exhibit-lifecycle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const hashes = { transcriptModelHash: "transcript-hash", reviewStateHash: "review-hash" };
const audit = (result = "NO_EXHIBITS", extra = {}) => ({ id: "audit-1", kind: "EXHIBIT_AUDIT_COMPLETED", result, ...hashes, sourceAnchor: "reporter-review", recordedBy: "Reporter", recordedAt: "2026-09-03T12:00:00.000Z", ...extra });
const exhibit = (extra = {}) => ({ id: "event-1", exhibitId: "exhibit-1", kind: "CANONICAL_EXHIBIT_RECORDED", status: "ACTIVE", label: "Exhibit 1", description: "Contract", markedAt: "2026-09-03T10:00:00.000Z", markedBy: "Counsel", transcriptReferences: [{ sourceAnchor: "transcript:12:4" }], material: { kind: "RETAINED_BY_COUNSEL", file: null }, custody: { status: "RESOLVED", holder: "Counsel", sourceAnchor: "transcript:90:2" }, sealedHandling: { status: "NOT_APPLICABLE", instructions: null, sourceAnchor: null }, packageDisposition: "EXCLUDED", packageDispositionReason: "Counsel retained the original.", sourceAnchor: "transcript:12:4", recordedBy: "Reporter", recordedAt: "2026-09-03T12:00:00.000Z", ...extra });
const record = (audits = [], exhibits = []) => ({ exhibits: [], exhibitLifecycle: { schemaVersion: "1.0.0", auditEvents: audits, exhibitEvents: exhibits } });

test("unknown and affirmative no-exhibit states remain distinct", () => {
  const unknown = resolveExhibitLifecycle(record(), hashes);
  assert.equal(unknown.status, "UNKNOWN"); assert.equal(unknown.ready, false); assert.equal(unknown.findings[0].code, "EXHIBIT_AUDIT_REQUIRED");
  const none = resolveExhibitLifecycle(record([audit()]), hashes);
  assert.equal(none.status, "NO_EXHIBITS"); assert.equal(none.ready, true); assert.deepEqual(none.exhibits, []);
});

test("an audit becomes unknown and blocked when transcript evidence changes", () => {
  const result = resolveExhibitLifecycle(record([audit()]), { ...hashes, transcriptModelHash: "new-transcript" });
  assert.equal(result.status, "UNKNOWN"); assert.equal(result.ready, false); assert.equal(result.findings[0].code, "EXHIBIT_AUDIT_STALE");
});

test("missing transcript authority cannot make null audit hashes look current", () => {
  const result = resolveExhibitLifecycle(record([audit("NO_EXHIBITS", { transcriptModelHash: null, reviewStateHash: null })]), { transcriptModelHash: null, reviewStateHash: null });
  assert.equal(result.status, "UNKNOWN"); assert.equal(result.ready, false); assert.equal(result.findings.some(item => item.code === "EXHIBIT_EVIDENCE_STATE_UNAVAILABLE"), true);
});

test("transcript words and legacy empty exhibits never create canonical authority", () => {
  const result = resolveExhibitLifecycle({ exhibits: [], transcript: { text: "Let me mark this Exhibit 4." } }, hashes);
  assert.equal(result.status, "UNKNOWN"); assert.equal(result.exhibits.length, 0);
});

test("present exhibits are complete when identity, evidence and disposition are attributable", () => {
  const result = resolveExhibitLifecycle(record([audit("EXHIBITS_PRESENT")], [exhibit()]), hashes);
  assert.equal(result.status, "EXHIBITS_PRESENT_COMPLETE"); assert.equal(result.ready, true); assert.deepEqual(result.findings, []);
});

test("physical and counsel-retained exhibits do not require a Depo-Pro file", () => {
  for (const kind of ["PHYSICAL", "RETAINED_BY_COUNSEL", "NONE"]) {
    const result = resolveExhibitLifecycle(record([audit("EXHIBITS_PRESENT")], [exhibit({ material: { kind, file: null } })]), hashes);
    assert.equal(result.findings.some(item => ["EXHIBIT_FILE_MISSING", "EXHIBIT_HASH_MISSING"].includes(item.code)), false);
  }
});

test("incomplete exhibits produce stable specific blocker codes", () => {
  const broken = exhibit({ transcriptReferences: [], material: { kind: "DIGITAL_FILE", file: null }, custody: { status: "UNRESOLVED" }, sealedHandling: { status: "UNRESOLVED" }, packageDisposition: "UNRESOLVED" });
  const duplicate = exhibit({ id: "event-2", exhibitId: "exhibit-2" });
  const result = resolveExhibitLifecycle(record([audit("EXHIBITS_PRESENT")], [broken, duplicate]), hashes);
  const codes = new Set(result.findings.map(item => item.code));
  for (const code of ["EXHIBIT_REFERENCE_UNRESOLVED", "EXHIBIT_FILE_MISSING", "EXHIBIT_HASH_MISSING", "EXHIBIT_CUSTODY_UNRESOLVED", "EXHIBIT_SEALED_HANDLING_UNRESOLVED", "EXHIBIT_PACKAGE_DISPOSITION_UNRESOLVED", "EXHIBIT_NUMBER_CONFLICT"]) assert.equal(codes.has(code), true, code);
  assert.equal(result.status, "EXHIBITS_PRESENT_INCOMPLETE");
});

test("corrections supersede effective state without deleting audit history", () => {
  const first = exhibit(), corrected = exhibit({ id: "event-2", label: "Exhibit 1-A", supersedesEventId: first.id });
  const result = resolveExhibitLifecycle(record([audit("EXHIBITS_PRESENT")], [first, corrected]), hashes);
  assert.equal(result.exhibits.length, 1); assert.equal(result.exhibits[0].label, "Exhibit 1-A"); assert.equal(result.history.exhibitEvents.length, 2);
});

test("stored-file paths cannot escape the deposition", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-exhibit-path-"));
  test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => _testing.safeStoredFile(directory, "../outside.pdf"), /inside this deposition/);
});

test("digital associations record server-computed bytes, MIME type and SHA-256", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-exhibit-record-")), storageRoot = path.join(root, "depositions");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deposition = createDeposition(root, { deposition: { id: "DEP-20260903-EXH01", caseStyle: "A v. B", witness: "Witness", courtReporterName: "Reporter", causeNumber: "1", depositionDate: "2026-09-03", jurisdiction: "texas-state" } }, { storageRoot });
  const directory = path.join(storageRoot, ...deposition.storagePath.split("/")); fs.mkdirSync(path.join(directory, "exhibits"), { recursive: true });
  const bytes = Buffer.from("exhibit bytes"); fs.writeFileSync(path.join(directory, "exhibits", "one.pdf"), bytes);
  const saved = recordExhibit(root, { depositionId: deposition.id, storageRoot, actor: "Reporter", input: { label: "1", description: "Document", markedAt: "2026-09-03T10:00:00Z", markedBy: "Counsel", transcriptReferences: [{ sourceAnchor: "transcript:4:2" }], material: { kind: "DIGITAL_FILE", relativePath: "exhibits/one.pdf" }, custody: { status: "RESOLVED", holder: "Reporter", sourceAnchor: "transcript:90:1" }, sealedHandling: { status: "NOT_APPLICABLE" }, packageDisposition: "INCLUDED", sourceAnchor: "transcript:4:2" } });
  assert.equal(saved.material.file.sha256, crypto.createHash("sha256").update(bytes).digest("hex")); assert.equal(saved.material.file.bytes, bytes.length); assert.equal(saved.material.file.mimeType, "application/pdf");
  fs.rmSync(path.join(directory, "exhibits", "one.pdf"));
  const readiness = getExhibitReadiness(root, { depositionId: deposition.id, storageRoot });
  assert.equal(readiness.findings.some(item => item.code === "EXHIBIT_FILE_MISSING"), true);
});

test("reporter exhibit audits are append-only and server-bound to transcript state", async t => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-exhibit-audit-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const built = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", "create-milestone2-browser-fixture.mjs"), storageRoot], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr); const { id, directory } = JSON.parse(built.stdout);
  const first = recordExhibitAudit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "reporter-review:1" } });
  assert.ok(first.transcriptModelHash); assert.ok(first.reviewStateHash);
  assert.throws(() => recordExhibitAudit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { result: "EXHIBITS_PRESENT", sourceAnchor: "reporter-review:2" } }), /Explain why/);
  const second = recordExhibitAudit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "reporter-review:2", correctionReason: "Renewed review after reconciliation." } });
  const canonical = JSON.parse(fs.readFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), "utf8"));
  assert.equal(canonical.exhibitLifecycle.auditEvents.length, 2); assert.equal(second.supersedesEventId, first.id);
  assert.equal(getExhibitReadiness(repositoryRoot, { depositionId: id, storageRoot }).status, "NO_EXHIBITS");
  const finalization = await getFinalizationReadiness(repositoryRoot, { depositionId: id, storageRoot, evaluatedAt: "2026-09-03T12:00:00.000Z" });
  assert.equal(finalization.categories.exhibits.status, "READY"); assert.equal(finalization.ready, true);
});

test("stale reporter tabs cannot supersede newer exhibit authority", t => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-exhibit-stale-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const built = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", "create-milestone2-browser-fixture.mjs"), storageRoot], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr); const { id } = JSON.parse(built.stdout);
  const base = { label: "Exhibit 1", description: "Physical contract", markedAt: "2026-09-03T10:00:00Z", markedBy: "Counsel", transcriptReferences: [{ sourceAnchor: "transcript:4:2" }], material: { kind: "PHYSICAL" }, custody: { status: "RESOLVED", holder: "Reporter", sourceAnchor: "transcript:90:1" }, sealedHandling: { status: "NOT_APPLICABLE" }, packageDisposition: "INCLUDED", sourceAnchor: "transcript:4:2" };
  const first = recordExhibit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: base });
  const second = recordExhibit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { ...base, exhibitId: first.exhibitId, expectedEventId: first.id, label: "Exhibit 1-A", correctionReason: "Correct the label." } });
  assert.throws(() => recordExhibit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { ...base, exhibitId: first.exhibitId, expectedEventId: first.id, label: "Stale overwrite", correctionReason: "Stale tab." } }), /changed after this screen loaded/);
  const readiness = getExhibitReadiness(repositoryRoot, { depositionId: id, storageRoot });
  assert.equal(readiness.exhibits[0].id, second.id); assert.equal(readiness.exhibits[0].label, "Exhibit 1-A");

  const auditOne = recordExhibitAudit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { result: "EXHIBITS_PRESENT", expectedEventId: null, sourceAnchor: "review:one" } });
  recordExhibitAudit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { result: "EXHIBITS_PRESENT", expectedEventId: auditOne.id, sourceAnchor: "review:two", correctionReason: "Renewed review." } });
  assert.throws(() => recordExhibitAudit(repositoryRoot, { depositionId: id, storageRoot, actor: "Reporter", input: { result: "NO_EXHIBITS", expectedEventId: auditOne.id, sourceAnchor: "review:stale", correctionReason: "Stale tab." } }), /changed after this screen loaded/);
});

test("the API exposes exhibit writes and read-only readiness without accepting a client-derived state", () => {
  const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  assert.match(source, /\/api\/exhibits\/audit/); assert.match(source, /\/api\/exhibits\/record/); assert.match(source, /\/api\/exhibits\/readiness/);
  assert.match(source, /expectedEventId/);
  assert.doesNotMatch(source, /input\.(ready|transcriptModelHash|reviewStateHash)/);
});
