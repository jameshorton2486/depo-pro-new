import fs from "node:fs";
import path from "node:path";

export function applicationIdentity(root) {
  const packageFile = path.join(root, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  return Object.freeze({
    product: "Depo-Pro New",
    version: String(packageJson.version),
    runtime: `Node ${process.versions.node}`,
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
  });
}

export function runtimeStatus(root, { storageRoot, apiPort, allowedOrigins } = {}) {
  const identity = applicationIdentity(root);
  return {
    ...identity,
    ready: Boolean(storageRoot && fs.existsSync(storageRoot)),
    storage: {
      configured: Boolean(storageRoot),
      available: Boolean(storageRoot && fs.existsSync(storageRoot)),
      root: storageRoot ? path.resolve(storageRoot) : null,
    },
    localApi: { port: apiPort, binding: "127.0.0.1" },
    allowedOrigins: [...(allowedOrigins ?? [])].sort(),
  };
}
