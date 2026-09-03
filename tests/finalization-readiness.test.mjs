import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import {
  READINESS_SEVERITY,
  _testing,
  getFinalizationReadiness,
  projectFinalizationReadiness,
} from "../server/finalization-readiness.mjs";

const DEPOSITION = "DEP-20260903-FINAL";
const category = (findings = [], status = "READY") => ({ status, findings });
const digestTree = root => {
  const entries = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else entries.push([path.relative(root, file).replaceAll("\\", "/"), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
    }
  };
  visit(root);
  return entries;
};

function fixture() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-final-readiness-"));
  const directory = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: DEPOSITION, storagePath: "reporter/cause/witness", caseStyle: "Example v. Example", witness: "Jordan Example", depositionDate: "2026-09-03" }));
  const record = createCanonicalDepositionRecord({ caseStyle: "Example v. Example", causeNumber: "1:26-cv-40", jurisdictionType: "federal", court: "United States District Court", witness: "Jordan Example", depositionDate: "2026-09-03" });
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify(record, null, 2));
  test.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  return { storageRoot };
}

test("only hard blockers control ready", () => {
  const categories = {
    transcript: category([{ code: "WARN", severity: READINESS_SEVERITY.WARNING }], "READY_WITH_WARNINGS"),
    administration: category(), review: category(), certification: category(), exhibits: category(),
    output: category([{ code: "INFO", severity: READINESS_SEVERITY.INFORMATIONAL }], "NOT_EVALUATED"),
  };
  const ready = projectFinalizationReadiness({ profile: "FEDERAL_DEPOSITION", evaluatedAt: "2026-09-03T12:00:00.000Z", source: {}, categories });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockers, []);

  categories.exhibits = category([{ code: "EXHIBIT_BLOCK", severity: READINESS_SEVERITY.HARD_BLOCKER }], "BLOCKED");
  assert.equal(projectFinalizationReadiness({ profile: "FEDERAL_DEPOSITION", evaluatedAt: "2026-09-03T12:00:00.000Z", source: {}, categories }).ready, false);
});

test("the evaluation digest is stable across evaluation time", () => {
  const input = { profile: "FEDERAL_DEPOSITION", source: { revision: 2 }, categories: {} };
  const first = projectFinalizationReadiness({ ...input, evaluatedAt: "2026-09-03T12:00:00.000Z" });
  const second = projectFinalizationReadiness({ ...input, evaluatedAt: "2026-09-04T12:00:00.000Z" });
  assert.equal(first.evaluationDigest, second.evaluationDigest);
});

test("wrapped certification validation retains every authoritative blocker code", () => {
  assert.deepEqual(
    _testing.modelFailureCodes(new Error("COMPLETE_TRANSCRIPT_VALIDATION_BLOCKED:OATH_REQUIRED:opening.oath,RULE_30E_REQUIRED:review.election")),
    ["OATH_REQUIRED", "RULE_30E_REQUIRED"],
  );
});

test("an empty exhibit array is not proof that no exhibits existed", async () => {
  const { storageRoot } = fixture();
  const report = await getFinalizationReadiness(null, { depositionId: DEPOSITION, storageRoot, evaluatedAt: "2026-09-03T12:00:00.000Z" });
  assert.equal(report.profile, "FEDERAL_DEPOSITION");
  assert.equal(report.ready, false);
  assert.equal(report.categories.exhibits.status, "BLOCKED");
  const exhibitFinding = report.categories.exhibits.findings.find(item => item.code === "EXHIBIT_AUDIT_REQUIRED");
  assert.ok(exhibitFinding);
  assert.equal(exhibitFinding.sourceSubsystem, "CANONICAL_EXHIBIT_LIFECYCLE");
  assert.equal(exhibitFinding.remediation, "EXHIBITS");
});

test("readiness evaluation does not change the deposition", async () => {
  const { storageRoot } = fixture();
  const before = digestTree(storageRoot);
  await getFinalizationReadiness(null, { depositionId: DEPOSITION, storageRoot, evaluatedAt: "2026-09-03T12:00:00.000Z" });
  assert.deepEqual(digestTree(storageRoot), before);
});

test("a missing canonical record is a reportable blocker rather than an exception", async () => {
  const { storageRoot } = fixture();
  const canonicalFile = path.join(storageRoot, "reporter", "cause", "witness", "intake", "canonical-deposition-record.json");
  fs.rmSync(canonicalFile);
  const report = await getFinalizationReadiness(null, { depositionId: DEPOSITION, storageRoot, evaluatedAt: "2026-09-03T12:00:00.000Z" });
  assert.equal(report.ready, false);
  assert.equal(report.categories.administration.findings[0].code, "FINALIZATION_CANONICAL_RECORD_REQUIRED");
});

test("the readiness endpoint is read-only and accepts no client readiness assertion", () => {
  const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  assert.match(source, /startsWith\("\/api\/finalization\/readiness\?"\)[\s\S]{0,100}req\.method === "GET"/);
  assert.doesNotMatch(source, /\/api\/finalization\/readiness[\s\S]{0,100}req\.method === "POST"/);
});
