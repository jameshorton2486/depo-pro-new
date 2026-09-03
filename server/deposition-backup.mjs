import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { depositionDirectory } from "./deposition-store.mjs";

export const BACKUP_RECORD_TYPE = "DEPO_PRO_DEPOSITION_BACKUP_V1";

function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function filesBelow(directory, current = directory) {
  const found = [];
  for (const entry of fs.readdirSync(current, { withFileTypes:true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(directory, absolute));
    else if (entry.isFile()) found.push(path.relative(directory, absolute));
  }
  return found;
}

function inventory(directory, excluded = new Set()) {
  return filesBelow(directory).filter(file => !excluded.has(file)).map(relativePath => {
    const absolute = path.join(directory, relativePath), stat = fs.statSync(absolute);
    return { path:relativePath.split(path.sep).join("/"), bytes:stat.size, sha256:digestFile(absolute) };
  }).sort((a,b) => a.path.localeCompare(b.path));
}

function inventoryDigest(files) {
  return crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function safeRelative(value) {
  const normalized = path.normalize(String(value || ""));
  if (!normalized || path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) throw new Error("Backup contains an unsafe storage path.");
  return normalized;
}

export function verifyDepositionBackup(backupDirectory) {
  const root = path.resolve(backupDirectory), manifestFile = path.join(root, "backup-manifest.json");
  if (!fs.existsSync(manifestFile)) throw new Error("Backup manifest is missing.");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.recordType !== BACKUP_RECORD_TYPE) throw new Error("Backup manifest type is not supported.");
  const actual = inventory(root, new Set(["backup-manifest.json"]));
  if (inventoryDigest(actual) !== manifest.inventorySha256 || JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error("Backup verification failed: stored bytes do not match the manifest.");
  safeRelative(manifest.storagePath);
  return { valid:true, manifest, filesVerified:actual.length, bytesVerified:actual.reduce((sum,file) => sum + file.bytes, 0) };
}

export function createDepositionBackup(root, { depositionId, storageRoot, backupRoot, now = new Date() }) {
  if (!backupRoot) throw new Error("Choose a backup destination.");
  const source = depositionDirectory(root, depositionId, { storageRoot }), resolvedStorage = path.resolve(storageRoot);
  const relativeStoragePath = safeRelative(path.relative(resolvedStorage, source));
  const destinationRoot = path.resolve(backupRoot);
  if (destinationRoot === source || destinationRoot.startsWith(`${source}${path.sep}`)) throw new Error("The backup destination cannot be inside the deposition being backed up.");
  fs.mkdirSync(destinationRoot, { recursive:true });
  const stamp = now.toISOString().replace(/[:.]/g, "-"), name = `DepoPro-${depositionId}-${stamp}`;
  const destination = path.join(destinationRoot, name), temporary = path.join(destinationRoot, `.${name}.${crypto.randomUUID()}.tmp`);
  if (fs.existsSync(destination)) throw new Error("A backup with this identity already exists.");
  try {
    fs.cpSync(source, temporary, { recursive:true, errorOnExist:true, force:false });
    const sourceInventory = inventory(source), copiedInventory = inventory(temporary);
    if (JSON.stringify(sourceInventory) !== JSON.stringify(copiedInventory)) throw new Error("The deposition changed while the backup was being created. Try again after recording and edits stop.");
    const manifest = { recordType:BACKUP_RECORD_TYPE, depositionId, createdAt:now.toISOString(), storagePath:relativeStoragePath.split(path.sep).join("/"), files:copiedInventory, inventorySha256:inventoryDigest(copiedInventory) };
    fs.writeFileSync(path.join(temporary, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding:"utf8", flag:"wx" });
    fs.renameSync(temporary, destination);
    verifyDepositionBackup(destination);
    return { backupDirectory:destination, manifest };
  } catch (error) { fs.rmSync(temporary, { recursive:true, force:true }); throw error; }
}

export function restoreDepositionBackup(backupDirectory, { storageRoot }) {
  const verification = verifyDepositionBackup(backupDirectory), targetRoot = path.resolve(storageRoot);
  fs.mkdirSync(targetRoot, { recursive:true });
  const target = path.resolve(targetRoot, safeRelative(verification.manifest.storagePath));
  if (!(target.startsWith(`${targetRoot}${path.sep}`))) throw new Error("Backup restore target is outside configured storage.");
  if (fs.existsSync(target)) throw new Error("Restore blocked: a deposition already exists at the target location.");
  fs.mkdirSync(path.dirname(target), { recursive:true });
  const temporary = `${target}.${crypto.randomUUID()}.restore`;
  try {
    fs.cpSync(path.resolve(backupDirectory), temporary, { recursive:true });
    fs.rmSync(path.join(temporary, "backup-manifest.json"));
    const restored = inventory(temporary);
    if (JSON.stringify(restored) !== JSON.stringify(verification.manifest.files)) throw new Error("Restored deposition failed byte verification.");
    fs.renameSync(temporary, target);
    return { depositionId:verification.manifest.depositionId, restoredDirectory:target, filesRestored:restored.length };
  } catch (error) { fs.rmSync(temporary, { recursive:true, force:true }); throw error; }
}
