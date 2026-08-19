import os from "node:os";
import path from "node:path";

export function resolveDefaultDepositionsRoot(homedir=os.homedir) {
  let userProfile;
  try{userProfile=homedir()}catch{throw new Error("Deposition storage root is unavailable: set DEPO_PRO_DEPOSITIONS_ROOT or configure an operating-system user home directory.")}
  if(!String(userProfile||"").trim())throw new Error("Deposition storage root is unavailable: set DEPO_PRO_DEPOSITIONS_ROOT or configure an operating-system user home directory.");
  return path.join(userProfile,"depos");
}

export function depositionStorageRoot(environment=process.env,homedir=os.homedir) {
  if(environment.DEPO_PRO_DEPOSITIONS_ROOT)return path.resolve(environment.DEPO_PRO_DEPOSITIONS_ROOT);
  return resolveDefaultDepositionsRoot(homedir);
}

/**
 * Where a recording lives before it belongs to a deposition.
 *
 * Beside the depositions rather than inside one, because the point of an unassigned capture is that
 * it does not yet know its destination -- the reporter presses record and decides afterwards. The
 * leading dot matters: depositionDirectories skips dot-prefixed folders, so an unassigned session
 * is not scanned as a malformed deposition and does not appear in the library as an orphan.
 *
 * Same volume as the depositions, so assignment is a rename rather than a copy of several
 * gigabytes, and the local-evidence-primary rule is unchanged.
 */
export function captureSessionRoot(environment=process.env,homedir=os.homedir) {
  return path.join(depositionStorageRoot(environment,homedir),".sessions");
}
