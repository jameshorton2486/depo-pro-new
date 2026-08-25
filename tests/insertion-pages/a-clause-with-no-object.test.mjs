import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { renderTemplatePage } from "../../server/insertion-pages/render-template.mjs";
import { loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../../server/insertion-pages/validate.mjs";

// cert.custodialAttorney and cert.charges print on the signature-waived certificate but were in
// neither that variant's field inventory nor its INTENTIONAL_BLANKS, so validateFields never looked
// at them. renderTemplatePage drops a line whose fields are all absent, so the page rendered
//
//        That the original deposition was delivered to
//        That the amount of time used by each party at
//
// -- an operative certification clause with no object -- and validateInsertionInput returned zero
// blocking findings. The guard was failing open on a certified page.

async function waivedInput({ certification = {} } = {}) {
  const record = createCanonicalDepositionRecord({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    caseStyle: "Alex Plaintiff v. Delta Company", witness: "Jordan Example", depositionDate: "2026-08-01",
    remote: false, location: "300 Main, San Antonio, Texas",
    parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }],
    attorneys: [{ name: "Pat Counsel", firm: "Plaintiff Firm", address: "100 Main, San Antonio, Texas", phone: "210-555-0101", represents: ["Alex Plaintiff"] }],
    reporterProfile: { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31", company: "Reporter Firm", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" },
  });
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  return assembleInsertionInput({
    record, template, intake: { counselOfRecord: ["Pat Counsel"] },
    operator: {
      jurisdiction: "texas-state", signatureDisposition: "waived",
      signatureDispositionBasis: "Waived on the record.", certification,
      appearances: record.counsel.map((attorney) => ({ ...attorney, participation: { method: { value: "in-person" }, detail: { value: "" } } })),
      witnessLocation: { physicalAddress: "San Antonio, Texas" },
      proceedingLocation: { physicalAddress: "300 Main, San Antonio, Texas", platform: null },
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 5, endPage: 40 }], reportersCertification: { startPage: 41 }, entries: [], actualSectionPages: {}, declaredSectionPages: {} } },
  });
}

const targets = (findings) => findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.target);

test("a waived certificate with no custodial attorney blocks instead of dropping the clause", async () => {
  const findings = validateInsertionInput(await waivedInput());
  assert.ok(targets(findings).includes("cert.custodialAttorney"),
    `custodial attorney did not block; blocking findings were ${JSON.stringify(targets(findings))}`);
  assert.ok(targets(findings).includes("cert.charges"),
    `charges did not block; blocking findings were ${JSON.stringify(targets(findings))}`);
});

test("supplying the custodial attorney clears the block and restores the clause", async () => {
  const input = await waivedInput({ certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff" } });
  const blocked = targets(validateInsertionInput(input));
  assert.equal(blocked.includes("cert.custodialAttorney"), false, `still blocking: ${JSON.stringify(blocked)}`);
  assert.equal(blocked.includes("cert.charges"), false, `still blocking: ${JSON.stringify(blocked)}`);

  // The block is only worth having if the value it demands actually reaches the page.
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  const page = renderTemplatePage(template.templates.certification1, { ...input.fieldValues, "deposition.witness": "Jordan Example" }, { pageNumber: 1, role: "certification1" });
  const text = page.lines.map((line) => line.text).join("\n");
  assert.match(text, /delivered to\s*\nPat Counsel;/);
});

test("the guard is the inventory, not the renderer", async () => {
  // Mutation check in code: strip the two names from the loaded inventory and the same input that
  // blocks above stops blocking, while the rendered page still loses the clause. Nothing else in
  // the pipeline notices, which is what makes an inventory omission silent rather than loud.
  const input = await waivedInput();
  const stripped = {
    ...input,
    template: { ...input.template, templates: { ...input.template.templates,
      fieldInventory: { ...input.template.templates.fieldInventory,
        fields: input.template.templates.fieldInventory.fields.filter((field) => field !== "cert.custodialAttorney" && field !== "cert.charges") } } },
  };
  const blocked = targets(validateInsertionInput(stripped));
  assert.equal(blocked.includes("cert.custodialAttorney"), false);
  assert.equal(blocked.includes("cert.charges"), false);

  const page = renderTemplatePage(input.template.templates.certification1, input.fieldValues, { pageNumber: 1, role: "certification1" });
  assert.equal(page.lines.some((line) => line.fields.includes("cert.custodialAttorney")), false,
    "the clause is still dropped -- only the finding disappeared");
});
