// Regenerates working.json and asr-evidence.json from each deposition's preserved raw
// Deepgram response.
//
// Needed because working.json is a projection: changing deriveSegments changes what the
// projection should be, but nothing in the stored record signals that it is now stale -- the
// evidence hash is unaffected, so the integrity check that normally triggers a rebuild stays
// green. This forces it.
//
// No Deepgram call is made. rebuildFromRaw reads raw-response.json off disk and verifies its
// SHA-256 before using it, so a corrupted response fails loudly rather than silently
// re-deriving from bad bytes. Nothing here costs money.
//
// Usage: node scripts/rebuild-transcripts.mjs [--apply]
// Without --apply it reports what would change and writes nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { depositionStorageRoot } from "../server/storage-config.mjs";
import { getTranscriptionJob, listTranscriptionJobs } from "../server/transcription-jobs.mjs";

const apply = process.argv.includes("--apply");
const storageRoot = depositionStorageRoot();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function depositions(directory, depth = 0) {
  if (depth > 4 || !fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes:true }).filter(entry => entry.isDirectory() && !entry.name.startsWith("."));
  return entries.flatMap(entry => {
    const full = path.join(directory, entry.name);
    return fs.existsSync(path.join(full, "deposition.json")) ? [full] : depositions(full, depth + 1);
  });
}

function duplicateWordCount(file) {
  if (!fs.existsSync(file)) return null;
  const working = JSON.parse(fs.readFileSync(file, "utf8"));
  const seen = new Set(); let duplicates = 0;
  for (const segment of working.segments || []) for (const id of segment.asrWordIds || []) { if (seen.has(id)) duplicates += 1; else seen.add(id); }
  return duplicates;
}

let changed = 0;
for (const directory of depositions(storageRoot)) {
  const record = JSON.parse(fs.readFileSync(path.join(directory, "deposition.json"), "utf8"));
  const depositionId = record.id ?? path.basename(directory);
  const workingFile = path.join(directory, "transcript", "working.json");
  const before = duplicateWordCount(workingFile);
  if (before === null) continue;
  const jobs = listTranscriptionJobs(root, { depositionId, storageRoot }).filter(job => job.status === "completed");
  if (!jobs.length) continue;
  console.log(`\n${depositionId}`);
  console.log(`  completed jobs        : ${jobs.length}`);
  console.log(`  duplicate word claims : ${before}`);
  if (!before) { console.log("  -> already a clean partition, nothing to do"); continue; }
  if (!apply) { console.log("  -> would rebuild (re-run with --apply)"); changed += 1; continue; }
  for (const job of jobs) getTranscriptionJob(root, { depositionId, jobId: job.jobId, storageRoot, force:true });
  const after = duplicateWordCount(workingFile);
  console.log(`  duplicate word claims after rebuild: ${after}`);
  if (after !== 0) { console.error(`  !! rebuild did not produce a partition for ${depositionId}`); process.exitCode = 1; }
  changed += 1;
}
console.log(`\n${apply ? "rebuilt" : "would rebuild"}: ${changed} deposition(s)`);
