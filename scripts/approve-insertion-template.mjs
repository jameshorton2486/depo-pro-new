// Record that a named person approved the insertion-page templates a variant currently has.
//
//   node scripts/approve-insertion-template.mjs TEXAS_STATE_SIGNATURE_REQUESTED --by "James Horton"
//
// This writes one entry to templates/insertion-pages/approvals.json binding an approver and a date
// to the digest of the variant's template set. Until that digest matches, loadTemplateVariant
// reports the variant unavailable and validateInsertionInput blocks with CERT_TEMPLATE_UNAPPROVED,
// so nothing generates.
//
// It deliberately does NOT recompute manifest hashes. If one command both re-hashed an edited
// template and approved the result, approval would be a side effect of editing and the gate would
// refuse nothing. When a manifest hash is stale this refuses and prints the hash the file actually
// has, so the author updates the manifest as its own act and then approves as another.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../server/insertion-pages/page-model.mjs";
import { APPROVALS_FILE, DEFAULT_TEMPLATE_ROOT, canonicalTemplateBody, templateAuthorityDigest, templateContentDigest } from "../server/insertion-pages/templates.mjs";

const [variant, ...rest] = process.argv.slice(2);
const flag = (name) => { const at = rest.indexOf(`--${name}`); return at === -1 ? null : rest[at + 1] ?? null; };
const approvedBy = flag("by");
const approvedAt = flag("at") ?? new Date().toISOString().slice(0, 10);
const root = flag("root") ?? DEFAULT_TEMPLATE_ROOT;
const approverRole = flag("role") ?? "unspecified";
const approvalScope = flag("scope") ?? variant;

const fail = (message) => { console.error(message); process.exit(2); };
if (!variant || !approvedBy) fail('Usage: node scripts/approve-insertion-template.mjs <VARIANT> --by "<name>" [--role "<role>"] [--scope "<scope>"] [--at YYYY-MM-DD] [--root <dir>]');

const manifestPath = path.resolve(root, variant, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.available || manifest.reviewStatus !== "reviewed") fail(`${variant} is not a reviewed variant (available=${manifest.available}, reviewStatus=${manifest.reviewStatus}); there is nothing to approve.`);

// Approving content nobody has hashed would mean approving whatever happens to be on disk. Verify
// the manifest describes the files before binding a name to it.
const stale = [];
for (const [role, specification] of Object.entries(manifest.templates ?? {})) {
  const filePath = path.resolve(root, variant, specification.file);
  const actual = sha256(canonicalTemplateBody(await readFile(filePath, "utf8")));
  if (actual !== specification.sha256) stale.push(`  ${role} (${specification.file}): manifest says ${specification.sha256}, file is ${actual}`);
}
if (stale.length) fail([`${variant} manifest hashes do not describe the files on disk. Update ${path.relative(process.cwd(), manifestPath)} first, then approve:`, ...stale].join("\n"));

const approvalsPath = path.resolve(root, APPROVALS_FILE);
const existing = await readFile(approvalsPath, "utf8").then(JSON.parse, (error) => { if (error?.code === "ENOENT") return {}; throw error; });
const contentDigest = templateContentDigest(variant, manifest);
const authorityDigest = templateAuthorityDigest(manifest);
const previous = existing.approvals?.[variant] ?? null;
if (previous?.contentDigest === contentDigest && (!authorityDigest || previous?.authorityDigest === authorityDigest)) {
  console.log(`${variant} is already approved at ${contentDigest} by ${previous.approvedBy} on ${previous.approvedAt}. Nothing written.`);
  process.exit(0);
}

const approvals = { ...existing.approvals, [variant]: { contentDigest, authorityDigest, approvedBy, approverRole, approvalScope, approvedAt } };
const document = {
  ...existing,
  approvals: Object.fromEntries(Object.keys(approvals).sort().map((key) => [key, approvals[key]])),
};
await writeFile(approvalsPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`${variant} approved by ${approvedBy} on ${approvedAt}.`);
console.log(`  content digest: ${contentDigest}${previous ? `\n  previous:       ${previous.contentDigest} (${previous.approvedBy}, ${previous.approvedAt})` : ""}`);
console.log(`Commit ${path.relative(process.cwd(), approvalsPath)} as its own reviewable change.`);
