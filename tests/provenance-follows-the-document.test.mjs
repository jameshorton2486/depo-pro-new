// A canonical field's `source` is a claim about where the value came from. Marking a
// reporter-typed value NOD_EXTRACTED asserts that a Notice of Deposition said something no
// document said -- worse than a blank, because a reader cannot tell it is wrong.
//
// The Etminan record proved it in production: intake.notice is null, no notice was ever supplied,
// and twelve populated fields claim NOD_EXTRACTED anyway.
import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";

const input = {
  caseStyle:"Garza v. Home Depot", causeNumber:"25-CV-00598-OLG", witness:"Heath Thomas",
  depositionDate:"2026-04-30", court:"United States District Court", county:"Bexar",
  attorneys:[{ name:"Lucia D. Zhan", firm:"Brothers, Alvarado, Piazza & Cozort, P.C.", represents:["Home Depot U.S.A., Inc.","Shawn Herber"] }],
};
const populated = record => [
  ...Object.entries(record.case ?? {}), ...Object.entries(record.deposition ?? {}),
].filter(([, item]) => item && typeof item === "object" && "source" in item && item.value !== null && item.value !== "");

test("with no notice, nothing claims a notice as its source", () => {
  const record = createCanonicalDepositionRecord(input);
  const lying = populated(record).filter(([, item]) => item.source === "NOD_EXTRACTED");
  assert.deepEqual(lying.map(([name]) => name), [],
    "a value the reporter typed must not assert that a document supplied it");
});

test("with no notice, document-sourced fields are attributed to the reporter", () => {
  const record = createCanonicalDepositionRecord(input);
  assert.equal(record.deposition.depositionDate.source, "REPORTER_ENTERED");
  assert.equal(record.case.causeNumber.source, "REPORTER_ENTERED");
});

test("with a notice, the fields the extraction supplied keep its attribution", () => {
  const record = createCanonicalDepositionRecord(
    { ...input, extractedFields:["depositionDate","causeNumber"] }, { noticeSupplied:true });
  assert.equal(record.deposition.depositionDate.source, "NOD_EXTRACTED");
  assert.equal(record.case.causeNumber.source, "NOD_EXTRACTED");
  assert.ok(populated(record).some(([, item]) => item.source === "NOD_EXTRACTED"));
});

test("a filed notice does not attribute a field the extraction never supplied", () => {
  // What this file half-fixed. It stopped a record with no notice from claiming one, and left
  // "a notice was filed, so the field may claim it" standing -- which made the claim about the
  // document rather than about the value. In a real record that put 25 of 51 Notice-attributed
  // fields on things the Notice never said, including a date the reporter typed by hand.
  const record = createCanonicalDepositionRecord(
    { ...input, extractedFields:["causeNumber"] }, { noticeSupplied:true });
  assert.equal(record.case.causeNumber.source, "NOD_EXTRACTED", "the one it did supply");
  assert.equal(record.deposition.depositionDate.source, "REPORTER_ENTERED",
    "a filed notice is not evidence that this field came off it");
  assert.equal(record.case.court.source, "REPORTER_ENTERED");
});

test("counsel is attributed on the same terms as the rest of the record", () => {
  // Counsel used to default to NOD_EXTRACTED independently, so a record could disagree with
  // itself about whether a document existed.
  const without = createCanonicalDepositionRecord(input);
  const with_ = createCanonicalDepositionRecord(
    { ...input, extractedFields:["attorneys"] }, { noticeSupplied:true });
  assert.equal(without.counsel[0].fullName.source, "REPORTER_ENTERED");
  assert.equal(with_.counsel[0].fullName.source, "NOD_EXTRACTED");
  // And counsel the extraction did not supply is not attributed to the notice either.
  const typed = createCanonicalDepositionRecord(input, { noticeSupplied:true });
  assert.equal(typed.counsel[0].fullName.source, "REPORTER_ENTERED");
});

test("the reporter profile is never attributed to the notice either way", () => {
  for (const options of [{}, { noticeSupplied:true }]) {
    const record = createCanonicalDepositionRecord({ ...input, courtReporterName:"Miah Bardot" }, options);
    assert.equal(record.reporter.fullName.source, "REPORTER_PROFILE");
  }
});

test("createDeposition attributes by whether a notice was actually filed", async t => {
  // Through the real creation path, not the builder in isolation: the builder can be correct
  // while createDeposition never tells it a notice arrived, which is how this was unenforced.
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const crypto = await import("node:crypto");
  const { createDeposition } = await import("../server/deposition-store.mjs");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-provenance-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const options = { storageRoot: path.join(root, "depos") };
  const common = { caseStyle:"Smith v. Jones", courtReporterName:"Brenda Miah", causeNumber:"2026-CV-00123", audioIntakeIds:[], keyterms:[],
    canonicalSeed:{ extractedFields:["depositionDate","causeNumber"] } };

  const withNotice = createDeposition(root, {
    deposition:{ ...common, id:"DEP-20260813-ABCDE", witness:"Alex Smith", depositionDate:"2026-08-13" },
    artifacts:{ notice:{ name:"notice.pdf", base64:Buffer.from("notice").toString("base64") } },
  }, options);
  const withoutNotice = createDeposition(root, {
    deposition:{ ...common, id:"DEP-20260814-FGHIJ", witness:"Jordan Jones", depositionDate:"2026-08-14" },
  }, options);

  assert.equal(withNotice.canonicalData.deposition.depositionDate.source, "NOD_EXTRACTED",
    "a notice was filed and the extraction supplied this field, so it may claim it");
  assert.equal(withoutNotice.canonicalData.deposition.depositionDate.source, "REPORTER_ENTERED",
    "no notice was filed, so nothing may claim one");
  assert.equal(withoutNotice.canonicalData.case.causeNumber.source, "REPORTER_ENTERED");
  void crypto;
});
