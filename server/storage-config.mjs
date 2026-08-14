import path from "node:path";

export const DEFAULT_DEPOSITIONS_ROOT = process.env.USERPROFILE?path.join(process.env.USERPROFILE,"depos"):undefined;

export function depositionStorageRoot(environment=process.env) {
  if(environment.DEPO_PRO_DEPOSITIONS_ROOT)return path.resolve(environment.DEPO_PRO_DEPOSITIONS_ROOT);
  if(environment.USERPROFILE)return path.join(environment.USERPROFILE,"depos");
  throw new Error("Deposition storage root is unavailable: set DEPO_PRO_DEPOSITIONS_ROOT or USERPROFILE.");
}
