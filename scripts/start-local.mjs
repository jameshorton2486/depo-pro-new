import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { allowedApiOrigins, localApiPort } from "../server/api-origins.mjs";
import { depositionStorageRoot } from "../server/storage-config.mjs";

export const APPLICATION_URL_HOST = "127.0.0.1";

export function launchConfiguration(root, environment = process.env) {
  const rawPort = environment.PORT, port = rawPort === undefined || rawPort === "" ? 3000 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT is "${rawPort}", which is not a valid application port.`);
  const apiPort = localApiPort(environment);
  if (apiPort === port) throw new Error("The application and local API must use different ports.");
  const storageRoot = depositionStorageRoot(environment);
  if (!fs.existsSync(storageRoot)) throw new Error(`The deposition storage root does not exist: ${storageRoot}. Run npm run configure first.`);
  const buildDirectory = path.join(root, ".vinext");
  if (!fs.existsSync(buildDirectory)) throw new Error("The production application has not been built. Run npm run build first.");
  allowedApiOrigins(environment);
  return { root, port, apiPort, storageRoot, applicationUrl: `http://${APPLICATION_URL_HOST}:${port}` };
}

export async function assertPortAvailable(port, host = APPLICATION_URL_HOST) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", error => reject(new Error(`Port ${port} is already in use. Close the other Depo-Pro process or configure another port. (${error.code ?? "PORT_ERROR"})`)));
    probe.once("listening", () => probe.close(resolve));
    probe.listen(port, host);
  });
}

export async function waitForReady(url, { attempts = 60, intervalMs = 250, headers } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { const response = await fetch(url, { cache: "no-store", headers }); if (response.ok) return true; lastError = new Error(`HTTP ${response.status}`); }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Depo-Pro did not become ready at ${url}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const environmentFile = path.join(root, ".env.local");
  if (fs.existsSync(environmentFile)) process.loadEnvFile(environmentFile);
  const config = launchConfiguration(root), bundledNode = path.join(root, "node_modules", "node", "bin", process.platform === "win32" ? "node.exe" : "node");
  const runtime = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
  await assertPortAvailable(config.port); await assertPortAvailable(config.apiPort);
  const children = [
    spawn(runtime, ["server/local-api.mjs"], { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: "inherit", windowsHide: true }),
    spawn(runtime, ["node_modules/vinext/dist/cli.js", "start", "--port", String(config.port)], { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: "inherit", windowsHide: true }),
  ];
  let stopping = false;
  const stop = code => { if (stopping) return; stopping = true; for (const child of children) if (!child.killed) { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else child.kill(); } process.exit(code); };
  process.on("SIGINT", () => stop(0)); process.on("SIGTERM", () => stop(0));
  for (const child of children) { child.on("error", error => { console.error(error); stop(1); }); child.on("exit", code => { if (!stopping) stop(code || 1); }); }
  try {
    await waitForReady(`http://127.0.0.1:${config.apiPort}/api/system/runtime`, { attempts: 80, headers: { Origin: config.applicationUrl } });
    await waitForReady(config.applicationUrl, { attempts: 80 });
    console.log(`Depo-Pro New is ready at ${config.applicationUrl}`);
    console.log(`Deposition storage: ${config.storageRoot}`);
    console.log("Press Ctrl+C to stop both local services safely.");
  } catch (error) { console.error(error instanceof Error ? error.message : error); stop(1); }
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
