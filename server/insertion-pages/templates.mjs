import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./page-model.mjs";

export const DEFAULT_TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/insertion-pages/", import.meta.url));
export const APPROVALS_FILE = "approvals.json";
const CARET_FIELD = /\^([a-z][a-zA-Z0-9_.-]*)\^/g;

export function extractCaretInventory(body) {
  return [...body.matchAll(CARET_FIELD)].map((match) => match[1]);
}

// Template integrity is byte-exact, so the checkout's line endings must not reach the hash.
// LF is the canonical form: manifest hashes and rendering both read the normalized body.
export function canonicalTemplateBody(body) {
  return body.replace(/\r\n?/g, "\n");
}

// What an approval is recorded against: this variant's name, plus every template file it renders
// from and the hash that file must have. Nothing else in the manifest is covered, so bumping
// `version` or editing `scope` does not un-approve a variant -- only a change to what gets
// rendered does.
//
// Why a digest rather than a name. `reviewedBy` was a free-text string the editing author set for
// themselves. It said someone had blessed *something*; it never said which bytes. So an inventory
// could be edited, re-hashed to satisfy the integrity check, and shipped with the same approving
// string still sitting there -- which is exactly what happened on 2026-08-24, when two manifests
// generated certified pages normally while carrying
// "inverted-guard-reconciliation-pending-project-owner-approval" in that field. The string was a
// comment in a JSON field, and comments do not refuse.
//
// A digest cannot be typed as a comment. It changes the instant the content changes, so an edit is
// unapproved by default rather than by the author remembering to say it is.
export function templateContentDigest(variant, manifest) {
  const templates = Object.entries(manifest.templates ?? {}).map(([role, specification]) => [role, { file: specification.file, sha256: specification.sha256 }]);
  return sha256({ variant, templates: Object.fromEntries(templates) });
}

export function templateAuthorityDigest(manifest) {
  return manifest.authority ? sha256(manifest.authority) : null;
}

// A missing approvals file is not a pass. It is the same answer as an approvals file with no entry
// for this variant: nothing has been approved, so nothing generates.
export async function readTemplateApprovals(root = DEFAULT_TEMPLATE_ROOT) {
  try {
    return JSON.parse(await readFile(path.resolve(root, APPROVALS_FILE), "utf8")).approvals ?? {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export function templateApproval(variant, manifest, approvals) {
  const recorded = approvals?.[variant] ?? null;
  const contentDigest = templateContentDigest(variant, manifest);
  const authorityDigest = templateAuthorityDigest(manifest);
  const contentCurrent = recorded?.contentDigest === contentDigest;
  const authorityCurrent = !authorityDigest || recorded?.authorityDigest === authorityDigest;
  const state = !recorded ? "unrecorded" : contentCurrent && authorityCurrent ? "current" : "stale";
  return { state, contentDigest, authorityDigest, approvedDigest: recorded?.contentDigest ?? null, approvedAuthorityDigest: recorded?.authorityDigest ?? null, approvedBy: recorded?.approvedBy ?? null, approverRole:recorded?.approverRole ?? null, approvalScope:recorded?.approvalScope ?? null, approvedAt: recorded?.approvedAt ?? null };
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

  // Deliberate, and the cost is the point rather than an obstacle.
  //
  // Under this gate every template edit blocks all generation for that variant until someone
  // re-approves it. On 2026-08-24 three inventory edits landed within a few hours; each one would
  // have stopped certified output until re-approved. That is the intended behaviour. A certificate
  // is the artifact a court may be asked to rely on, and "an edit nobody approved went out" is not
  // a failure worth trading for the convenience of not re-running one command.
  //
  // What keeps it from making ordinary work impossible is that re-approval is one command --
  // `node scripts/approve-insertion-template.mjs <VARIANT> --by "<name>"` -- and it is deliberately
  // a different command from whatever recomputed the hashes. If one action did both, approval
  // would be a side effect of editing and this gate would refuse nothing.
  //
  // What it does not do: prove who approved. `approvedBy` is still a name someone types, and
  // nothing here verifies it. What the digest buys is that approval now names *what* was approved,
  // so an unapproved edit fails closed on its own, and re-approving is a separate commit touching
  // a file whose only content is approvals -- visible in review rather than buried among hashes.
  const approval = templateApproval(variant, manifest, await readTemplateApprovals(root));
  if (approval.state !== "current") {
    return { variant, available: false, approval, manifest, manifestPath, expectedPath: manifest.expectedTemplatePath ?? directory, templates: {} };
  }
  return { variant, available: true, approval, manifest, manifestPath, templates };
}

export async function templateAvailability(variant, options) {
  try {
    return await loadTemplateVariant(variant, options);
  } catch (error) {
    if (error?.code === "ENOENT") return { variant, available: false, expectedPath: path.join(options?.root ?? DEFAULT_TEMPLATE_ROOT, variant), templates: {} };
    throw error;
  }
}

export async function insertionTemplateCatalog(options = {}) {
  const variants = [
    "TEXAS_STATE_SIGNATURE_REQUESTED",
    "TEXAS_STATE_SIGNATURE_WAIVED",
    "TEXAS_STATE_AFFIRMATION_SIGNATURE_REQUESTED",
    "TEXAS_STATE_AFFIRMATION_SIGNATURE_WAIVED",
    "FEDERAL_OATH_REVIEW_REQUESTED",
    "FEDERAL_OATH_REVIEW_NOT_REQUESTED",
    "FEDERAL_AFFIRMATION_REVIEW_REQUESTED",
    "FEDERAL_AFFIRMATION_REVIEW_NOT_REQUESTED",
  ];
  return Promise.all(variants.map(async (variant) => {
    const loaded = await templateAvailability(variant, options);
    const manifest = loaded.manifest ?? {};
    return {
      variant,
      templateId: manifest.templateId ?? null,
      version: manifest.version ?? null,
      available: Boolean(loaded.available),
      reviewStatus: manifest.reviewStatus ?? "unknown",
      sourceFigures: manifest.sourceFigures ?? [],
      roles: Object.keys(manifest.templates ?? {}).filter((role) => role !== "fieldInventory"),
      approval: loaded.approval ?? null,
      blockedBy: manifest.blockedBy ?? [],
      expectedTemplatePath: loaded.expectedPath ?? null,
    };
  }));
}
