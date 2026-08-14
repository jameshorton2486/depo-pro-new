import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { depositionDirectory } from "../deposition-store.mjs";
import { assembleInsertionInput } from "./assemble.mjs";
import { buildTexasInsertionPageSet } from "./build-pages.mjs";
import { createRenderingSpec, workspaceDocumentFromRenderingSpec } from "./rendering-spec.mjs";
import { loadTemplateVariant } from "./templates.mjs";
import { validateInsertionInput } from "./validate.mjs";
import { selectInsertionVariant } from "./variants.mjs";

const rendererScript = fileURLToPath(new URL("./python-docx-renderer.py", import.meta.url));
const defaultFormatterRoot = path.join(os.homedir(), "transcript_formatter");

function safeTranscriptPath(directory, relativePath) {
  const normalized = String(relativePath).replace(/\\/g, "/");
  if (!normalized.startsWith("transcript/") || normalized.includes("..") || path.isAbsolute(normalized)) throw new Error("Artifact path must remain inside the deposition transcript workspace.");
  return path.join(directory, ...normalized.split("/"));
}

function writeJsonAtomic(destination, value) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, destination);
}

function readCanonicalTranscriptPages(directory, request) {
  if (Array.isArray(request.transcriptPages)) return request.transcriptPages;
  if (request.mode === "standalone") return [];
  const source = safeTranscriptPath(directory, request.canonicalRenderingRelativePath ?? "transcript/canonical-rendering-spec.json");
  if (!fs.existsSync(source)) throw new Error("CANONICAL_TRANSCRIPT_RENDERING_REQUIRED: create the canonical transcript rendering specification before full Word export.");
  return JSON.parse(fs.readFileSync(source, "utf8")).pages ?? [];
}

export async function prepareInsertionRenderingArtifact(root, depositionId, request, { storageRoot, now = () => new Date().toISOString(), randomId = () => crypto.randomUUID() } = {}) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const canonicalPath = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(canonicalPath)) throw new Error("Canonical deposition record was not found in the workspace.");
  const record = JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
  const variant = selectInsertionVariant(request.operator);
  if (!variant) throw new Error("CERT_VARIANT_UNSPECIFIED: jurisdiction and signature disposition are required.");
  const template = await loadTemplateVariant(variant);
  const assembled = assembleInsertionInput({ record, intake: request.intake ?? {}, operator: request.operator ?? {}, pagination: request.pagination ?? {}, template });
  const findings = validateInsertionInput(assembled);
  const blockers = findings.filter((finding) => finding.severity === "blocking");
  if (blockers.length) throw new Error(`INSERTION_VALIDATION_BLOCKED: ${blockers.map((finding) => `${finding.code}:${finding.target}`).join(", ")}`);
  const pageSet = buildTexasInsertionPageSet(assembled, { setId: randomId(), depositionId, generatedAt: now() });
  const renderingSpec = createRenderingSpec({ depositionId, insertionPageSet: pageSet, transcriptPages: readCanonicalTranscriptPages(directory, request), generatedAt: now() });
  const specPath = safeTranscriptPath(directory, request.renderingSpecRelativePath ?? "transcript/final-rendering-spec.json");
  writeJsonAtomic(specPath, renderingSpec);
  return { directory, variant, findings, pageSet, renderingSpec, specPath, workspaceDocument: workspaceDocumentFromRenderingSpec(renderingSpec) };
}

export async function createInsertionWordArtifact(root, depositionId, request, options = {}) {
  const prepared = await prepareInsertionRenderingArtifact(root, depositionId, request, options);
  const outputPath = safeTranscriptPath(prepared.directory, request.outputRelativePath ?? (request.mode === "standalone" ? "transcript/insertion-pages.docx" : "transcript/transcript-with-insertion-pages.docx"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync(process.env.DEPO_PRO_PYTHON ?? "python", [rendererScript, "--spec", prepared.specPath, "--output", outputPath, "--formatter-root", process.env.DEPO_PRO_FORMATTER_ROOT ?? defaultFormatterRoot], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`PYTHON_DOCX_RENDER_FAILED: ${(result.stderr || result.stdout || "unknown formatter error").trim()}`);
  const renderer = JSON.parse(result.stdout.trim());
  return { outputPath, bytes: fs.statSync(outputPath).size, mode: request.mode === "standalone" ? "standalone" : "full", variant: prepared.variant, findings: prepared.findings, pageSetSha256: prepared.pageSet.sha256, renderingSpecSha256: prepared.renderingSpec.sha256, renderingSpecPath: prepared.specPath, renderer };
}
