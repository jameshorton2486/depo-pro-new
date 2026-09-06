import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeposition } from "../server/deposition-store.mjs";
import { createDepositionBackup, restoreDepositionBackup, verifyDepositionBackup } from "../server/deposition-backup.mjs";
import crypto from "node:crypto";

const root = process.cwd();

test("backup verification refuses a junction omitted from the manifest", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "depo-backup-link-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const backup = path.join(temporary, "backup"), outside = path.join(temporary, "outside");
  fs.mkdirSync(backup); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "evidence.txt"), "must not disappear");
  fs.symlinkSync(outside, path.join(backup, "linked-evidence"), process.platform === "win32" ? "junction" : "dir");
  fs.writeFileSync(path.join(backup, "backup-manifest.json"), JSON.stringify({
    recordType: "DEPO_PRO_DEPOSITION_BACKUP_V1", storagePath: "deposition", files: [],
    inventorySha256: crypto.createHash("sha256").update("[]").digest("hex"),
  }));
  assert.throws(() => verifyDepositionBackup(backup), /symbolic links or junctions/);
  assert.equal(fs.readFileSync(path.join(outside, "evidence.txt"), "utf8"), "must not disappear");
});

test("a complete deposition backup verifies and restores byte-for-byte without overwriting", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-backup-")); t.after(() => fs.rmSync(temporary, { recursive:true, force:true }));
  const storageRoot = path.join(temporary, "storage"), backups = path.join(temporary, "backups"), restoredRoot = path.join(temporary, "restored");
  const record = createDeposition(root, { deposition:{ id:"DEP-20260903-BACK1", caseStyle:"Backup v. Restore", witness:"Backup Witness", courtReporterName:"Backup Reporter", causeNumber:"BACKUP-1", depositionDate:"2026-09-03" } }, { storageRoot });
  const large = Buffer.alloc(2 * 1024 * 1024 + 17, 71);
  const evidencePath = path.join(storageRoot, ...record.storagePath.split("/"), "large-fixture.bin");
  fs.writeFileSync(evidencePath, large);
  const created = createDepositionBackup(root, { depositionId:record.id, storageRoot, backupRoot:backups, now:new Date("2026-09-03T12:00:00.000Z") });
  assert.equal(created.manifest.files.find(file => file.path === "large-fixture.bin").sha256, crypto.createHash("sha256").update(large).digest("hex"));
  const verified = verifyDepositionBackup(created.backupDirectory); assert.equal(verified.valid, true); assert.ok(verified.filesVerified > 0);
  const redirectedRoot = path.join(temporary, "redirected"), outside = path.join(temporary, "outside");
  fs.mkdirSync(redirectedRoot); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(redirectedRoot, record.storagePath.split("/")[0]), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => restoreDepositionBackup(created.backupDirectory, { storageRoot: redirectedRoot }), /outside configured storage through a junction/);
  const restored = restoreDepositionBackup(created.backupDirectory, { storageRoot:restoredRoot }); assert.equal(restored.depositionId, record.id);
  assert.throws(() => restoreDepositionBackup(created.backupDirectory, { storageRoot:restoredRoot }), /already exists/);
});

test("backup verification detects tampering and refuses unsafe destinations", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-backup-tamper-")); t.after(() => fs.rmSync(temporary, { recursive:true, force:true }));
  const storageRoot = path.join(temporary, "storage"), record = createDeposition(root, { deposition:{ id:"DEP-20260903-BACK2", caseStyle:"Backup v. Tamper", witness:"Tamper Witness", courtReporterName:"Backup Reporter", causeNumber:"BACKUP-2", depositionDate:"2026-09-03" } }, { storageRoot });
  assert.throws(() => createDepositionBackup(root, { depositionId:record.id, storageRoot, backupRoot:path.join(storageRoot, ...record.storagePath.split("/"), "backups") }), /inside/);
  const alias = path.join(temporary, "source-alias");
  fs.symlinkSync(path.join(storageRoot, ...record.storagePath.split("/")), alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => createDepositionBackup(root, { depositionId:record.id, storageRoot, backupRoot:alias }), /including through a junction/);
  const created = createDepositionBackup(root, { depositionId:record.id, storageRoot, backupRoot:path.join(temporary, "backups") });
  fs.appendFileSync(path.join(created.backupDirectory, "deposition.json"), "tampered");
  assert.throws(() => verifyDepositionBackup(created.backupDirectory), /verification failed/);
});
