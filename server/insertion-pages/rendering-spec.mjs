import crypto from "node:crypto";

const FRONT_ROLES = new Set(["title", "appearances", "index"]);

function normalizedPage(page, index) {
  if (!page || !Array.isArray(page.lines) || page.lines.length !== 25) {
    throw new Error(`RENDERING_SPEC_INVALID: page ${index + 1} must contain exactly 25 lines.`);
  }
  return {
    id: String(page.id ?? `${page.role ?? "page"}-${index + 1}`),
    role: String(page.role ?? "transcript"),
    lines: page.lines.map((line, lineIndex) => ({
      line: lineIndex + 1,
      text: String(line?.text ?? ""),
      fields: Array.isArray(line?.fields) ? line.fields.map(String) : [],
    })),
  };
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createRenderingSpec({ depositionId, insertionPageSet, transcriptPages = [], generatedAt }) {
  const insertionPages = insertionPageSet.pages.map(normalizedPage);
  const bodyPages = transcriptPages.map(normalizedPage);
  const front = insertionPages.filter((page) => FRONT_ROLES.has(page.role));
  const back = insertionPages.filter((page) => !FRONT_ROLES.has(page.role));
  const pages = [...front, ...bodyPages, ...back].map((page, index) => ({ ...page, pageNumber: index + 1 }));
  const content = {
    schemaVersion: 1,
    depositionId,
    generatedAt,
    source: { insertionPageSetSha256: insertionPageSet.sha256, canonicalTranscriptIncluded: bodyPages.length > 0 },
    layout: { paper: "LETTER", font: "Courier New", fontSizePt: 12, linesPerPage: 25, renderer: "PYTHON_TRANSCRIPT_FORMATTER" },
    pages,
  };
  return { ...content, sha256: stableHash(content) };
}

export function workspaceDocumentFromRenderingSpec(spec) {
  return {
    type: "deposition-document",
    version: 1,
    renderingSpecSha256: spec.sha256,
    pages: spec.pages.map((page) => ({
      id: page.id,
      role: page.role,
      pageNumber: page.pageNumber,
      content: page.lines.map((line) => ({ type: "transcriptLine", attrs: { line: line.line, fields: line.fields }, content: line.text ? [{ type: "text", text: line.text }] : [] })),
    })),
  };
}
