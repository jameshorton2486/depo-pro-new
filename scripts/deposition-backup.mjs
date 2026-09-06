import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDepositionBackup, restoreDepositionBackup, verifyDepositionBackup } from "../server/deposition-backup.mjs";
import { depositionStorageRoot } from "../server/storage-config.mjs";

function options(values) { const result = { command:values[0] }; for (let i=1;i<values.length;i+=2) { if (!values[i]?.startsWith("--") || !values[i+1]) throw new Error("Use --option value arguments."); result[values[i].slice(2)] = values[i+1]; } return result; }

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), input = options(process.argv.slice(2)), storageRoot = input["storage-root"] ? path.resolve(input["storage-root"]) : depositionStorageRoot();
  if (input.command === "create") console.log(JSON.stringify(createDepositionBackup(root, { depositionId:input["deposition-id"], storageRoot, backupRoot:input.destination }), null, 2));
  else if (input.command === "verify") console.log(JSON.stringify(verifyDepositionBackup(input.backup), null, 2));
  else if (input.command === "restore") console.log(JSON.stringify(restoreDepositionBackup(input.backup, { storageRoot }), null, 2));
  else throw new Error("Usage: backup create --deposition-id ID --destination PATH | backup verify --backup PATH | backup restore --backup PATH [--storage-root PATH]");
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
