import os from "node:os";
import path from "node:path";
import { ALLOW_SYNCED_ROOT, classifyStorageRoot } from "./storage-safety.mjs";

export function resolveDefaultDepositionsRoot(homedir=os.homedir) {
  let userProfile;
  try{userProfile=homedir()}catch{throw new Error("Deposition storage root is unavailable: set DEPO_PRO_DEPOSITIONS_ROOT or configure an operating-system user home directory.")}
  if(!String(userProfile||"").trim())throw new Error("Deposition storage root is unavailable: set DEPO_PRO_DEPOSITIONS_ROOT or configure an operating-system user home directory.");
  return path.join(userProfile,"depos");
}

/**
 * Refuses a storage root that a sync client, a junction, or a network share can reach into.
 *
 * The hazard classifyStorageRoot describes is not theoretical for the files this guards. A sync
 * engine resolves a write conflict by keeping both sides -- `asr-evidence-<machine>.json` beside
 * the original -- and asr-evidence.json is immutable precisely so that cannot happen. A delayed
 * or partial write during an eight-hour capture is the same hazard against audio.
 *
 * This throws where local-status.mjs warns, and the asymmetry is deliberate. That script reports
 * on a root the reporter chose; this runs on the root about to be written to. A warning at the
 * point of writing is a warning nobody reads until the record is already in a sync folder.
 *
 * ALLOW_SYNCED_ROOT downgrades the refusal to a startup warning rather than silencing it, so a
 * working copy that legitimately lives in such a place is still usable and still says so.
 */

// classifyStorageRoot walks the ancestry with lstat -- measured at ~320us per call on this
// machine. base() in deposition-store.mjs resolves the root on every store operation, so an
// unmemoised check would add that to each one. The verdict depends only on the path and on the
// environment variables the sync roots are read from, so it is cached on exactly those, which
// also keeps a caller passing an explicit environment from reading another caller's answer.
const settled = new Set();
const VERDICT_INPUTS = ["OneDrive","OneDriveConsumer","OneDriveCommercial","iCloudDrive","LOCALAPPDATA",ALLOW_SYNCED_ROOT];

export function assertStorageRootIsLocal(resolved, description, environment=process.env) {
  const key = JSON.stringify([resolved, ...VERDICT_INPUTS.map(name => environment[name] ?? null)]);
  if (settled.has(key)) return resolved;

  const classification = classifyStorageRoot(resolved, { environment });
  const findings = [...classification.warnings, ...classification.suppressedWarnings];
  if (findings.length) {
    const detail = findings.map(finding => finding.client
      ? `${finding.code} (${finding.client}, detected via ${finding.detectedVia})`
      : `${finding.code}${finding.link ? ` (${finding.link})` : ""}`).join("; ");
    if (!classification.acknowledged) {
      throw new Error(`${description} is ${resolved}, which is not safe for evidentiary storage: ${detail}. ${findings.map(finding => finding.message).join(" ")} Move it to local storage, or set ${ALLOW_SYNCED_ROOT}=1 to accept this deliberately.`);
    }
    console.warn(`WARNING ${detail}: ${description} is ${resolved}. ${findings.map(finding => finding.message).join(" ")} Continuing because ${ALLOW_SYNCED_ROOT}=1.`);
  }

  settled.add(key);
  return resolved;
}

export function depositionStorageRoot(environment=process.env,homedir=os.homedir) {
  if(environment.DEPO_PRO_DEPOSITIONS_ROOT)return assertStorageRootIsLocal(path.resolve(environment.DEPO_PRO_DEPOSITIONS_ROOT),"The deposition storage root",environment);
  return assertStorageRootIsLocal(resolveDefaultDepositionsRoot(homedir),"The deposition storage root",environment);
}
