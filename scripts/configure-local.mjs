import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOW_SYNCED_ROOT, classifyStorageRoot } from "../server/storage-safety.mjs";
import { depositionStorageRoot } from "../server/storage-config.mjs";

export function parseConfigurationArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--allow-synced-root") result.allowSyncedRoot = true;
    else if (token === "--force") result.force = true;
    else if (["--storage-root", "--port", "--api-port"].includes(token)) { if (!values[index + 1]) throw new Error(`${token} requires a value.`); result[token.slice(2)] = values[++index]; }
    else throw new Error(`Unknown option: ${token}`);
  }
  return result;
}

export function configurationText({ storageRoot, port = "3000", apiPort = "4317", allowSyncedRoot = false }) {
  const appPort = Number(port), localPort = Number(apiPort);
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) throw new Error("Choose a valid application port.");
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535 || localPort === appPort) throw new Error("Choose a different valid local API port.");
  const lines = [`DEPO_PRO_DEPOSITIONS_ROOT=${path.resolve(storageRoot)}`, `PORT=${appPort}`, `LOCAL_API_PORT=${localPort}`];
  if (allowSyncedRoot) lines.push(`${ALLOW_SYNCED_ROOT}=1`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), options = parseConfigurationArguments(process.argv.slice(2));
  const storageRoot = path.resolve(options["storage-root"] ?? depositionStorageRoot());
  fs.mkdirSync(storageRoot, { recursive: true });
  const classification = classifyStorageRoot(storageRoot, { environment: process.env });
  if ((classification.warnings.length || classification.suppressedWarnings.length) && !options.allowSyncedRoot) throw new Error(`The selected storage root is not qualified as local evidence storage. Choose a local non-synchronized folder, or deliberately pass --allow-synced-root after reviewing the risk.`);
  const text = configurationText({ storageRoot, port: options.port, apiPort: options["api-port"], allowSyncedRoot: options.allowSyncedRoot });
  const file = path.join(root, ".env.local"), temporary = `${file}.${process.pid}.tmp`;
  if (fs.existsSync(file) && !options.force) throw new Error(`${file} already exists. Review it, or pass --force to replace it deliberately.`);
  fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" }); fs.renameSync(temporary, file);
  console.log(`Depo-Pro local configuration written to ${file}`); console.log(`Deposition storage initialized at ${storageRoot}`); console.log("Next: npm run build, then npm start");
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
