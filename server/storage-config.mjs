import os from "node:os";
import path from "node:path";

function defaultDepositionsRoot(homedir=os.homedir) {
  let userProfile;
  try{userProfile=homedir()}catch{throw new Error("Deposition storage root is unavailable: set DEPO_PRO_DEPOSITIONS_ROOT or configure an operating-system user home directory.")}
  if(!String(userProfile||"").trim())throw new Error("Deposition storage root is unavailable: set DEPO_PRO_DEPOSITIONS_ROOT or configure an operating-system user home directory.");
  return path.join(userProfile,"depos");
}

export const DEFAULT_DEPOSITIONS_ROOT = defaultDepositionsRoot();

export function depositionStorageRoot(environment=process.env,homedir=os.homedir) {
  if(environment.DEPO_PRO_DEPOSITIONS_ROOT)return path.resolve(environment.DEPO_PRO_DEPOSITIONS_ROOT);
  return defaultDepositionsRoot(homedir);
}
