import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { allowedApiOrigins } from "../server/api-origins.mjs";
import { applicationIdentity, runtimeStatus } from "../server/runtime-status.mjs";
import { configurationText, parseConfigurationArguments } from "../scripts/configure-local.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local configuration is explicit, local-only, and keeps UI and API ports distinct", () => {
  const directory = path.join(os.tmpdir(), "depo-pro-release-configuration");
  const text = configurationText({ storageRoot: directory, port: "3100", apiPort: "4417" });
  assert.match(text, /DEPO_PRO_DEPOSITIONS_ROOT=/); assert.match(text, /PORT=3100/); assert.match(text, /LOCAL_API_PORT=4417/);
  assert.throws(() => configurationText({ storageRoot: directory, port: "3100", apiPort: "3100" }), /different/);
  assert.deepEqual(parseConfigurationArguments(["--storage-root", directory, "--port", "3100", "--api-port", "4417"]), { "storage-root": directory, port: "3100", "api-port": "4417" });
  assert.deepEqual(parseConfigurationArguments(["--force", "--allow-synced-root"]), { force:true, allowSyncedRoot:true });
  assert.deepEqual([...allowedApiOrigins({ PORT: "3100" })].sort(), ["http://127.0.0.1:3100", "http://localhost:3100"]);
});

test("runtime identity comes from the installed package and reports configured storage", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-runtime-"));
  test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const identity = applicationIdentity(root), status = runtimeStatus(root, { storageRoot: directory, apiPort: 4317, allowedOrigins: new Set(["http://localhost:3000"]) });
  assert.equal(identity.version, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
  assert.equal(status.ready, true); assert.equal(status.storage.available, true); assert.deepEqual(status.allowedOrigins, ["http://localhost:3000"]);
});

test("the production start command coordinates both services instead of starting only the UI", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const source = fs.readFileSync(path.join(root, "scripts", "start-local.mjs"), "utf8");
  assert.equal(packageJson.scripts.start, "node scripts/start-local.mjs");
  assert.match(source, /server\/local-api\.mjs/); assert.match(source, /vinext\/dist\/cli\.js/); assert.match(source, /assertPortAvailable/); assert.match(source, /waitForReady/);
});
