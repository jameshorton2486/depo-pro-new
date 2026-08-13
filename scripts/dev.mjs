import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnvironment = path.join(root, ".env.local");
if (fs.existsSync(localEnvironment)) process.loadEnvFile(localEnvironment);
const bundledNode = path.join(root, "node_modules", "node", "bin", process.platform === "win32" ? "node.exe" : "node");
const runtime = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
const processes = [
  spawn(runtime, ["server/local-api.mjs"], { cwd: root, stdio: "inherit" }),
  spawn(runtime, ["node_modules/vinext/dist/cli.js", "dev"], { cwd: root, stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) if (!child.killed) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of processes) {
  child.on("error", error => { console.error(error); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 0); });
}
