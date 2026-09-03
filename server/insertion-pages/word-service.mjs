import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { depositionDirectory } from "../deposition-store.mjs";
import { assertStorageRootIsLocal } from "../storage-config.mjs";
import { assembleInsertionInput } from "./assemble.mjs";
import { buildInsertionPageSet } from "./build-pages.mjs";
import { createRenderingSpec, workspaceDocumentFromRenderingSpec } from "./rendering-spec.mjs";
import { loadTemplateVariant } from "./templates.mjs";
import { validateInsertionInput } from "./validate.mjs";

const rendererScript = fileURLToPath(new URL("./python-docx-renderer.py", import.meta.url));
const defaultFormatterRoot = path.join(os.homedir(), "transcript_formatter");

// Resolved here rather than at module load, because DEPO_PRO_FORMATTER_ROOT is what actually
// reaches the renderer and checking only the default would leave the override unguarded.
export function formatterRoot(environment = process.env) {
  return assertStorageRootIsLocal(path.resolve(environment.DEPO_PRO_FORMATTER_ROOT ?? defaultFormatterRoot), "The transcript formatter root", environment);
}

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

// transcript/canonical-rendering-spec.json has no writer anywhere in this tree. Nothing produces
// it -- not this module, not the local API, not scripts/, not the transcript print model. The only
// reference to that path is the read below.
//
// So the throw two lines down reads as a missing file and is actually a missing producer, and the
// difference matters: no amount of running the app in the right order will create it. Full Word
// export cannot run until something writes it. `mode: "standalone"` is the only path that reaches
// a rendered document today, and it returns an empty body rather than a transcript.
//
// The next author here would be assuming a spec exists because a reader for it does. It does not.
// buildTranscriptPrintModel paginates the body and is already served at an API route, so the pages
// exist -- what is absent is anything that writes them to this path in this shape.
//
// Named the same way operator.reporter is named in assemble.mjs: recorded, not fixed.
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
  const routingInput = assembleInsertionInput({ record, intake: request.intake ?? {}, operator: request.operator ?? {}, pagination: request.pagination ?? {}, template:null });
  const variant = routingInput.variant;
  if (!variant) throw new Error(`CERT_VARIANT_UNSPECIFIED: ${routingInput.certificationRoute?.reason ?? "jurisdiction and disposition facts are required"}.`);
  const template = await loadTemplateVariant(variant);
  const assembled = assembleInsertionInput({ record, intake: request.intake ?? {}, operator: request.operator ?? {}, pagination: request.pagination ?? {}, template });
  const findings = validateInsertionInput(assembled);
  const blockers = findings.filter((finding) => finding.severity === "blocking");
  if (blockers.length) throw new Error(`INSERTION_VALIDATION_BLOCKED: ${blockers.map((finding) => `${finding.code}:${finding.target}`).join(", ")}`);
  // The standalone path has no transcript behind it and therefore no authoritative pagination, so
  // what it renders is a certificate-only document with no index. The full document is generated
  // from the Workspace, through the complete-transcript model that owns the page numbers.
  const pageSet = buildInsertionPageSet(assembled, { setId: randomId(), depositionId, generatedAt: now(), certificateOnly: true });
  const renderingSpec = createRenderingSpec({ depositionId, insertionPageSet: pageSet, transcriptPages: readCanonicalTranscriptPages(directory, request), generatedAt: now() });
  const specPath = safeTranscriptPath(directory, request.renderingSpecRelativePath ?? "transcript/final-rendering-spec.json");
  writeJsonAtomic(specPath, renderingSpec);
  return { directory, variant, findings, pageSet, renderingSpec, specPath, workspaceDocument: workspaceDocumentFromRenderingSpec(renderingSpec) };
}

export async function createInsertionWordArtifact(root, depositionId, request, options = {}) {
  const prepared = await prepareInsertionRenderingArtifact(root, depositionId, request, options);
  const outputPath = safeTranscriptPath(prepared.directory, request.outputRelativePath ?? (request.mode === "standalone" ? "transcript/insertion-pages.docx" : "transcript/transcript-with-insertion-pages.docx"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync(process.env.DEPO_PRO_PYTHON ?? "python", [rendererScript, "--spec", prepared.specPath, "--output", outputPath, "--formatter-root", formatterRoot()], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`PYTHON_DOCX_RENDER_FAILED: ${(result.stderr || result.stdout || "unknown formatter error").trim()}`);
  const renderer = JSON.parse(result.stdout.trim());
  return { outputPath, bytes: fs.statSync(outputPath).size, mode: request.mode === "standalone" ? "standalone" : "full", variant: prepared.variant, findings: prepared.findings, pageSetSha256: prepared.pageSet.sha256, renderingSpecSha256: prepared.renderingSpec.sha256, renderingSpecPath: prepared.specPath, renderer };
}
