import path from "node:path";

export const DEFAULT_DEPOSITIONS_ROOT = "C:\\Users\\james\\depos";

export function depositionStorageRoot(environment=process.env) {
  return path.resolve(environment.DEPO_PRO_DEPOSITIONS_ROOT || DEFAULT_DEPOSITIONS_ROOT);
}
