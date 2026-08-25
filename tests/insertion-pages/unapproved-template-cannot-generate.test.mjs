import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../../server/insertion-pages/build-pages.mjs";
import { sha256 } from "../../server/insertion-pages/page-model.mjs";
import { APPROVALS_FILE, DEFAULT_TEMPLATE_ROOT, canonicalTemplateBody, loadTemplateVariant, templateContentDigest } from "../../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../../server/insertion-pages/validate.mjs";

// The hole this closes.
//
// Three mechanisms guard the insertion-page templates and they cover different things. The
// per-template sha256 makes an edit DETECTABLE -- a changed .tmpl with a stale hash cannot load.
// `available` plus `reviewStatus` make a variant UNUSABLE. Neither refuses an edit that was made,
// re-hashed, and never approved: the manifest's `reviewedBy` was where approval was supposed to be
// recorded, and nothing in server/, app/, tests/ or scripts/ read it. On 2026-08-24 two manifests
// sat committed reading "inverted-guard-reconciliation-pending-project-owner-approval" in that
// field and generated certified pages exactly as if approved.
//
// So the scenario below is the one that used to pass silently: edit an inventory, recompute its
// hash so the integrity check is satisfied, do not approve, generate. It must now refuse, and
// refuse with a finding that says why.
//
// The first test is the control and it is not optional. A refusal test that passed because the
// hash mismatched would prove nothing about approval. The control makes the identical edit, has it
// approved, and shows it generating -- so when the second test refuses, the hash is known to have
// matched and approval is the only thing that changed.

const VARIANT = "TEXAS_STATE_SIGNATURE_REQUESTED";
const SENTINEL_FIELD = "reporter.approvalGateSentinel";

async function templateRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "depo-pro-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(DEFAULT_TEMPLATE_ROOT, root, { recursive: true });
  return root;
}

// Edit the field inventory the way an author would, then bring the manifest hash back in line so
// the integrity check is satisfied. This is exactly the pair of actions the old gate permitted.
async function editInventoryAndRehash(root) {
  const manifestPath = path.join(root, VARIANT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const inventoryPath = path.join(root, VARIANT, manifest.templates.fieldInventory.file);
  const edited = `${canonicalTemplateBody(await readFile(inventoryPath, "utf8"))}^${SENTINEL_FIELD}^\n`;
  await writeFile(inventoryPath, edited);
  manifest.templates.fieldInventory.sha256 = sha256(edited);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest, inventoryPath };
}

async function approve(root, variant, manifest) {
  const approvalsPath = path.join(root, APPROVALS_FILE);
  const document = JSON.parse(await readFile(approvalsPath, "utf8"));
  document.approvals[variant] = { contentDigest: templateContentDigest(variant, manifest), approvedBy: "test-approver", approvedAt: "2026-08-24" };
  await writeFile(approvalsPath, `${JSON.stringify(document, null, 2)}\n`);
}

// A record that renders, so "refused" is measured against a run that is otherwise complete.
function inputFor(template) {
  const record = createCanonicalDepositionRecord({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    witness: "Jordan Example", depositionDate: "2026-08-01", remote: true, remotePlatform: "Zoom",
    parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }],
    attorneys: [
      { name: "Pat Counsel", firm: "Plaintiff Firm", address: "100 Main, San Antonio, Texas", phone: "210-555-0101", represents: ["Alex Plaintiff"], appeared: true, participation: { method: "remote-video" } },
      { name: "Dana Counsel", firm: "Defense Firm", address: "200 Main, San Antonio, Texas", phone: "210-555-0102", represents: ["Delta Company"], appeared: true, participation: { method: "remote-video" } },
    ],
    reporterProfile: { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31", company: "Reporter Firm", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" },
  });
  return assembleInsertionInput({
    record, template, intake: { counselOfRecord: ["Pat Counsel", "Dana Counsel"] },
    operator: {
      jurisdiction: "texas-state", signatureDisposition: "requested", signatureDispositionBasis: "Requested on the record.",
      appearances: record.counsel.map((attorney) => ({ ...attorney, participation: { method: { value: "zoom" }, detail: { value: "Zoom" } } })),
      courtHeadingLine: "IN THE DISTRICT COURT OF", countyCourtLine: "BEXAR COUNTY, TEXAS", judicialDistrictLine: "45TH JUDICIAL DISTRICT",
      proceedingHeading: "ORAL AND VIDEOTAPED DEPOSITION OF", witnessLocation: { physicalAddress: "San Antonio, Texas" },
      titleNarrative: ["Jordan Example, produced as a witness and duly sworn,", "was taken remotely by Zoom before Riley Reporter,", "Certified Shorthand Reporter in and for Texas."],
      certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff", serviceDate: "August 14, 2026", certificationDate: "August 14, 2026", furtherCertificationDate: "August 30, 2026" },
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 5, endPage: 40 }], changesAndSignature: { startPage: 41 }, reportersCertification: { startPage: 43 }, entries: [], actualSectionPages: {}, declaredSectionPages: {} } },
  });
}

const blockingCodes = (findings) => findings.filter(({ severity }) => severity === "blocking").map(({ code }) => code);

test("control: the same edit, once approved, loads and drives generation", async (t) => {
  const root = await templateRoot(t);
  const { manifest } = await editInventoryAndRehash(root);
  await approve(root, VARIANT, manifest);

  const template = await loadTemplateVariant(VARIANT, { root });
  assert.equal(template.available, true, "an approved, correctly hashed variant must load");
  assert.equal(template.approval.state, "current");
  assert.ok(template.templates.fieldInventory.fields.includes(SENTINEL_FIELD), "the edit must be live in the loaded inventory");

  const findings = validateInsertionInput(inputFor(template));
  assert.ok(!blockingCodes(findings).includes("CERT_TEMPLATE_UNAPPROVED"), "approved content must not report as unapproved");
  // The edit changes what generation does: an inventory field nothing supplies is now demanded.
  assert.ok(findings.some((finding) => finding.code === "UNEXPECTED_BLANK" && finding.target === SENTINEL_FIELD),
    "the edited inventory must actually be driving validation, or this control proves nothing about what an edit reaches");

  const pages = buildTexasInsertionPageSet(inputFor(template), { setId: "control", depositionId: "DEP-CONTROL", generatedAt: "2026-08-24T00:00:00.000Z" });
  assert.ok(pages.pages.length > 0, "the approved variant must still generate certified pages");
});

test("an edited and re-hashed inventory that nobody approved refuses to generate", async (t) => {
  const root = await templateRoot(t);
  const { manifest, inventoryPath } = await editInventoryAndRehash(root);

  // The integrity check is satisfied -- this is the state the old gate let through, not a corrupt
  // checkout. If this assertion ever fails, everything below is testing the hash.
  assert.equal(sha256(canonicalTemplateBody(await readFile(inventoryPath, "utf8"))), manifest.templates.fieldInventory.sha256,
    "the manifest hash must describe the edited file, or the refusal below is the integrity check and not the approval gate");

  const template = await loadTemplateVariant(VARIANT, { root });
  assert.equal(template.approval.state, "stale", "an approval recorded against the pre-edit content is stale, not current");
  assert.equal(template.available, false);
  assert.deepEqual(template.templates, {}, "an unapproved variant must hand out no templates to render from");

  const findings = validateInsertionInput(inputFor(template));
  const refusal = findings.find(({ code }) => code === "CERT_TEMPLATE_UNAPPROVED");
  assert.ok(refusal, `generation was not refused for an unapproved edit; blocking findings were ${blockingCodes(findings).join(", ") || "none"}`);
  assert.equal(refusal.severity, "blocking", "a warning does not refuse; word-service throws only on blocking findings");
  assert.match(refusal.message, /edited after their last approval/, "the finding must name the reason a reader has to act on");
  assert.match(refusal.message, /approve-insertion-template/, "and must say how to clear it");
  assert.ok(!blockingCodes(findings).includes("CERT_TEMPLATE_UNAVAILABLE"),
    "an edited-but-unapproved template is not a missing one; reporting it as unavailable sends the reader looking for a file that is present");

  assert.throws(() => buildTexasInsertionPageSet(inputFor(template), { setId: "refused", depositionId: "DEP-REFUSED", generatedAt: "2026-08-24T00:00:00.000Z" }),
    "an unapproved variant must not be able to build pages even if a caller ignores the finding");
});

test("a reviewed variant with no approval recorded at all is unapproved, not merely unavailable", async (t) => {
  const root = await templateRoot(t);
  await writeFile(path.join(root, APPROVALS_FILE), `${JSON.stringify({ approvals: {} }, null, 2)}\n`);

  const template = await loadTemplateVariant(VARIANT, { root });
  assert.equal(template.approval.state, "unrecorded");
  const refusal = validateInsertionInput(inputFor(template)).find(({ code }) => code === "CERT_TEMPLATE_UNAPPROVED");
  assert.ok(refusal, "a reviewed variant with no approval entry must refuse");
  assert.match(refusal.message, /No approval is recorded/);
});

test("a deleted approvals file does not read as approval", async (t) => {
  const root = await templateRoot(t);
  await rm(path.join(root, APPROVALS_FILE));
  const template = await loadTemplateVariant(VARIANT, { root });
  assert.equal(template.available, false, "a missing approvals file must fail closed");
  assert.equal(template.approval.state, "unrecorded");
});

test("an approval digest lifted from another variant does not approve this one", async (t) => {
  const root = await templateRoot(t);
  const approvalsPath = path.join(root, APPROVALS_FILE);
  const document = JSON.parse(await readFile(approvalsPath, "utf8"));
  document.approvals[VARIANT] = { ...document.approvals.TEXAS_STATE_SIGNATURE_WAIVED };
  await writeFile(approvalsPath, `${JSON.stringify(document, null, 2)}\n`);

  const template = await loadTemplateVariant(VARIANT, { root });
  assert.equal(template.approval.state, "stale", "an approval entry naming another variant's content does not approve this variant's content");
});

test("an approval does not carry to a second variant built from identical templates", async (t) => {
  // The test above passes for a weaker reason than it looks: the two Texas variants render from
  // different template sets, so their digests differ whether or not the variant name is in them.
  // This is what actually measures the binding -- same templates, same hashes, different variant.
  // Without the name in the digest, approving one would silently approve the other.
  const root = await templateRoot(t);
  await cp(path.join(root, VARIANT), path.join(root, "TEXAS_STATE_SIGNATURE_REQUESTED_COPY"), { recursive: true });

  const original = await loadTemplateVariant(VARIANT, { root });
  const copy = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED_COPY", { root });
  assert.equal(original.approval.state, "current", "control: the approved original must load, or the copy failing means nothing");
  assert.equal(copy.approval.state, "unrecorded", "a variant nobody approved must not inherit approval from identical content approved elsewhere");
  assert.equal(copy.available, false);
});

test("a manifest edit that changes nothing rendered leaves the approval standing", async (t) => {
  // The gate has to tell an edit to the certified content apart from housekeeping, or every touch
  // of the manifest blocks generation and authors learn to route around it.
  const root = await templateRoot(t);
  const manifestPath = path.join(root, VARIANT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "1.0.1";
  manifest.scope = `${manifest.scope} (note added)`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const template = await loadTemplateVariant(VARIANT, { root });
  assert.equal(template.approval.state, "current");
  assert.equal(template.available, true);
});

test("an unreviewed stub variant still reports unavailable, not unapproved", async (t) => {
  // Two different facts, kept apart. No approval is recorded for the federal stubs either, and if
  // approval were checked first they would start reporting an approval problem instead of the
  // missing source that is actually their problem.
  const root = await templateRoot(t);
  const template = await loadTemplateVariant("FEDERAL_SIGNATURE_REQUESTED", { root });
  assert.equal(template.available, false);
  assert.equal(template.approval, undefined, "a variant with no reviewed template has nothing to be approved");
  const codes = blockingCodes(validateInsertionInput({ ...inputFor(template), variant: "FEDERAL_SIGNATURE_REQUESTED" }));
  assert.ok(codes.includes("CERT_TEMPLATE_UNAVAILABLE"));
  assert.ok(!codes.includes("CERT_TEMPLATE_UNAPPROVED"));
});

test("the templates this repository ships are approved, so ordinary generation is not blocked", async () => {
  const template = await loadTemplateVariant(VARIANT);
  assert.equal(template.approval.state, "current");
  assert.equal(template.approval.approvedBy, "project-owner-approved-UFM-source");
});
