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

// Not memoised, deliberately. classifyStorageRoot costs ~320us per call, which is only worth
// caching if something calls it in a loop -- and nothing does. base() in deposition-store.mjs
// short-circuits to path.resolve(storageRoot) whenever a storageRoot is passed, and local-api.mjs
// resolves once at boot and threads it into every endpoint, so a scanDepositions over the real
// library performs zero classifications. Caching the verdict would have meant holding it across a
// junction appearing mid-process or Dropbox being configured while the server ran, which is a
// staleness risk taken in exchange for nothing measurable.
export function assertStorageRootIsLocal(resolved, description, environment=process.env) {
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

  return resolved;
}

/**
 * Resolves the root without judging it.
 *
 * scripts/local-status.mjs exists to REPORT on an unsafe root, and it classifies the root itself
 * a few lines later. If it resolved through the enforcing path it would die on an exception in
 * exactly the case it was written to explain -- the reporter would get a stack trace where the
 * diagnostic belongs. Nothing that writes should use this.
 */
export function resolveDepositionStorageRoot(environment=process.env,homedir=os.homedir) {
  if(environment.DEPO_PRO_DEPOSITIONS_ROOT)return path.resolve(environment.DEPO_PRO_DEPOSITIONS_ROOT);
  return resolveDefaultDepositionsRoot(homedir);
}

export function depositionStorageRoot(environment=process.env,homedir=os.homedir) {
  return assertStorageRootIsLocal(resolveDepositionStorageRoot(environment,homedir),"The deposition storage root",environment);
}
