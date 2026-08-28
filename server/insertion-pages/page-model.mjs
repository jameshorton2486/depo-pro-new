import { createHash } from "node:crypto";
import { UFM_FREELANCE_LAYOUT_PROFILE, isLayoutProfileVerified } from "./layout-profile.mjs";

export const INSERTION_PAGE_SET_VERSION = "1.0.0";

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function createPage({ pageNumber, role, lines = [] }) {
  return {
    pageNumber,
    role,
    lines: lines.map((entry, index) => ({
      line: entry.line ?? index + 1,
      text: entry.text ?? "",
      fields: [...(entry.fields ?? [])],
    })),
  };
}

export function pageOverflowFindings(pages, profile = UFM_FREELANCE_LAYOUT_PROFILE) {
  return pages.flatMap((page) => page.lines.length > profile.linesPerPage ? [{
    code: "PAGE_LINE_OVERFLOW",
    target: `pages.${page.pageNumber}.lines`,
    severity: "blocking",
    message: `Page ${page.pageNumber} (${page.role}) has ${page.lines.length} lines; the profile permits ${profile.linesPerPage}.`,
    path: `pages.${page.pageNumber}.lines`,
  }] : []);
}

export function horizontalOverflowFindings(pages, profile) {
  if (!Number.isInteger(profile?.charactersPerLine)) throw new Error("HORIZONTAL_OVERFLOW_PROFILE_REQUIRED");
  return pages.flatMap((page) => page.lines.flatMap((line, index) => String(line.text ?? line.content ?? "").length > profile.charactersPerLine ? [{
    code: "HORIZONTAL_LINE_OVERFLOW",
    target: `pages.${page.pageNumber}.lines.${index + 1}`,
    severity: "blocking",
    message: `Page ${page.pageNumber} (${page.role}) line ${index + 1} occupies ${String(line.text ?? line.content ?? "").length} characters; the profile permits ${profile.charactersPerLine}.`,
    path: `pages.${page.pageNumber}.lines.${index + 1}`,
  }] : []));
}

export function createInsertionPageSet(input, { profile = UFM_FREELANCE_LAYOUT_PROFILE } = {}) {
  const unsigned = {
    schemaVersion: INSERTION_PAGE_SET_VERSION,
    setId: input.setId,
    depositionId: input.depositionId,
    variant: input.variant,
    templateHashes: { ...(input.templateHashes ?? {}) },
    layoutProfileId: profile.id,
    layoutVerified: isLayoutProfileVerified(profile),
    pages: (input.pages ?? []).map(createPage),
    intentionalBlanks: [...(input.intentionalBlanks ?? [])].sort(),
    generatedAt: input.generatedAt,
  };
  return { ...unsigned, sha256: sha256(unsigned) };
}
