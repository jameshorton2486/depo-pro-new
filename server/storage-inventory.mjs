import fs from "node:fs";
import path from "node:path";
import { scanDepositions } from "./deposition-store.mjs";

function directoryBytes(directory) {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directoryBytes(candidate);
    else if (entry.isFile()) total += fs.statSync(candidate).size;
  }
  return total;
}

export function inspectStorage(root, { storageRoot, audioRoot = path.join(root, "data", "audio-intake") } = {}) {
  const library = scanDepositions(root, { storageRoot });
  const linked = new Set(library.depositions.flatMap(record => [
    ...(record.audioIntakeIds ?? []),
    ...(record.audio ?? []).map(item => item.uploadId),
  ].filter(Boolean)));
  const audits = [];
  let corruptAuditCount = 0;
  if (fs.existsSync(audioRoot)) for (const entry of fs.readdirSync(audioRoot, { withFileTypes:true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(audioRoot, entry.name), file = path.join(directory, "audit.json");
    if (!fs.existsSync(file)) { corruptAuditCount += 1; continue; }
    try {
      const audit = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!audit?.storage?.original?.sha256) throw new Error("missing original identity");
      audits.push({ uploadId:entry.name, sha256:audit.storage.original.sha256, originalBytes:Number(audit.storage.original.bytes) || 0, totalBytes:directoryBytes(directory) });
    } catch { corruptAuditCount += 1; }
  }
  const shaGroups = new Map();
  for (const audit of audits) {
    if (!shaGroups.has(audit.sha256)) shaGroups.set(audit.sha256, []);
    shaGroups.get(audit.sha256).push(audit);
  }
  const duplicates = [...shaGroups.values()].filter(group => group.length > 1);
  const duplicateOriginalBytes = duplicates.reduce((total, group) => total + group.slice(1).reduce((sum, audit) => sum + audit.originalBytes, 0), 0);
  const unlinked = audits.filter(audit => !linked.has(audit.uploadId));
  return {
    schemaVersion:"1.0.0",
    depositions:library.depositions.length,
    depositionIssues:library.issues.length,
    audioAudits:audits.length,
    linkedAudioAudits:audits.length - unlinked.length,
    unlinkedAudioAudits:unlinked.length,
    unlinkedBytes:unlinked.reduce((sum, audit) => sum + audit.totalBytes, 0),
    uniqueOriginals:shaGroups.size,
    duplicateGroups:duplicates.length,
    duplicateOriginalBytes,
    corruptAuditCount,
    cleanupAllowed:false,
  };
}
