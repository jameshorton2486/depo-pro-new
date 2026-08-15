import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./page-model.mjs";

export const DEFAULT_TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/insertion-pages/", import.meta.url));
const CARET_FIELD = /\^([a-z][a-zA-Z0-9_.-]*)\^/g;

export function extractCaretInventory(body) {
  return [...body.matchAll(CARET_FIELD)].map((match) => match[1]);
}

// Template integrity is byte-exact, so the checkout's line endings must not reach the hash.
// LF is the canonical form: manifest hashes and rendering both read the normalized body.
export function canonicalTemplateBody(body) {
  return body.replace(/\r\n?/g, "\n");
}

export async function loadTemplateVariant(variant, { root = DEFAULT_TEMPLATE_ROOT } = {}) {
  const directory = path.resolve(root, variant);
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.available || manifest.reviewStatus !== "reviewed") {
    return { variant, available: false, manifest, manifestPath, expectedPath: manifest.expectedTemplatePath ?? directory, templates: {} };
  }

  const templates = {};
  for (const [role, specification] of Object.entries(manifest.templates ?? {})) {
    const filePath = path.join(directory, specification.file);
    const body = canonicalTemplateBody(await readFile(filePath, "utf8"));
    const bodyHash = sha256(body);
    if (bodyHash !== specification.sha256) throw new Error(`Template hash mismatch for ${variant}/${specification.file}`);
    templates[role] = { body, filePath, sha256: bodyHash, fields: extractCaretInventory(body) };
  }
  return { variant, available: true, manifest, manifestPath, templates };
}

export async function templateAvailability(variant, options) {
  try {
    return await loadTemplateVariant(variant, options);
  } catch (error) {
    if (error?.code === "ENOENT") return { variant, available: false, expectedPath: path.join(options?.root ?? DEFAULT_TEMPLATE_ROOT, variant), templates: {} };
    throw error;
  }
}
