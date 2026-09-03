import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeposition } from "../server/deposition-store.mjs";
import { createDepositionBackup, restoreDepositionBackup, verifyDepositionBackup } from "../server/deposition-backup.mjs";

const root = process.cwd();

test("a complete deposition backup verifies and restores byte-for-byte without overwriting", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-backup-")); t.after(() => fs.rmSync(temporary, { recursive:true, force:true }));
  const storageRoot = path.join(temporary, "storage"), backups = path.join(temporary, "backups"), restoredRoot = path.join(temporary, "restored");
  const record = createDeposition(root, { deposition:{ id:"DEP-20260903-BACK1", caseStyle:"Backup v. Restore", witness:"Backup Witness", courtReporterName:"Backup Reporter", causeNumber:"BACKUP-1", depositionDate:"2026-09-03" } }, { storageRoot });
  const created = createDepositionBackup(root, { depositionId:record.id, storageRoot, backupRoot:backups, now:new Date("2026-09-03T12:00:00.000Z") });
  const verified = verifyDepositionBackup(created.backupDirectory); assert.equal(verified.valid, true); assert.ok(verified.filesVerified > 0);
  const restored = restoreDepositionBackup(created.backupDirectory, { storageRoot:restoredRoot }); assert.equal(restored.depositionId, record.id);
  assert.throws(() => restoreDepositionBackup(created.backupDirectory, { storageRoot:restoredRoot }), /already exists/);
});

test("backup verification detects tampering and refuses unsafe destinations", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-backup-tamper-")); t.after(() => fs.rmSync(temporary, { recursive:true, force:true }));
  const storageRoot = path.join(temporary, "storage"), record = createDeposition(root, { deposition:{ id:"DEP-20260903-BACK2", caseStyle:"Backup v. Tamper", witness:"Tamper Witness", courtReporterName:"Backup Reporter", causeNumber:"BACKUP-2", depositionDate:"2026-09-03" } }, { storageRoot });
  assert.throws(() => createDepositionBackup(root, { depositionId:record.id, storageRoot, backupRoot:path.join(storageRoot, ...record.storagePath.split("/"), "backups") }), /inside/);
  const created = createDepositionBackup(root, { depositionId:record.id, storageRoot, backupRoot:path.join(temporary, "backups") });
  fs.appendFileSync(path.join(created.backupDirectory, "deposition.json"), "tampered");
  assert.throws(() => verifyDepositionBackup(created.backupDirectory), /verification failed/);
});
