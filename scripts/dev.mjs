import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnvironment = path.join(root, ".env.local");
if (fs.existsSync(localEnvironment)) process.loadEnvFile(localEnvironment);
const bundledNode = path.join(root, "node_modules", "node", "bin", process.platform === "win32" ? "node.exe" : "node");
const runtime = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
// Every worktree is the same checkout, so without this they all bind 3000 and the browser cannot
// tell which tree answered. A server left running in one tree then serves a tab opened for another,
// and the code on screen is not the code being worked on -- which has happened, and cost a day
// chasing caching and stale-session explanations that were never possible. PORT lives in .env.local,
// which is gitignored, so each tree keeps its own without dirtying the branch it has checked out.
const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  // Not defaulted to 3000: an unreadable PORT would put this tree back on the shared port, which is
  // the failure this exists to prevent, and it would do it silently.
  console.error(`PORT is "${process.env.PORT}", which is not a port number. Fix ${localEnvironment}.`);
  process.exit(1);
}
const processes = [
  spawn(runtime, ["server/local-api.mjs"], { cwd: root, stdio: "inherit" }),
  spawn(runtime, ["node_modules/vinext/dist/cli.js", "dev", "--port", String(port)], { cwd: root, stdio: "inherit" }),
];
// Says which tree is being served, so the answer is in the terminal rather than in a process table.
console.log(`Depo Pro dev serving ${root} on http://localhost:${port}`);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) if (!child.killed) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide:true, stdio:"ignore" });
    else child.kill();
  }
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of processes) {
  child.on("error", error => { console.error(error); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 0); });
}
