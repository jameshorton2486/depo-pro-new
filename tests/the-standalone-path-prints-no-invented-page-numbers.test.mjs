import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";

// The standalone Certification path sent no pagination, and the index printed
// "Appearances................ 2" from `?? 2` and a certificate line ending in blank space from
// `?? ""`. Both looked like answers. Nothing computed either, and nothing anywhere knew they were
// invented -- the exact shape where a green suite and a plausible certified page coexist.
//
// There is no second paginator to fix this with, and there must not be: complete-transcript
// pagination is the only authority that knows where sections land. So the index refuses, and a
// document that cannot have one does not get one.
const SCREEN = new URL("../app/InsertionPagesScreen.tsx", import.meta.url);

async function pageSet({ pagination, certificateOnly }) {
  const record = createCanonicalDepositionRecord({
    court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber:"2026-CI-90210",
    witness:"Dana Ellsworth Whitaker", depositionDate:"2026-08-28", remote:true, remotePlatform:"Zoom",
    parties:[{ name:"Dana Ellsworth Whitaker", role:"Plaintiff" }, { name:"Brazos Ridge Logistics, LLC", role:"Defendant" }],
    attorneys:[{ name:"Marisol Vantongeren-Okafor", firm:"Vantongeren & Okafor LLP", address:"1 Riverwalk Plaza", phone:"210-555-0101", represents:["Dana Ellsworth Whitaker"], side:"PLAINTIFF" }],
    reporterProfile:{ name:"Marguerite Okonkwo-Vance", licenseNumber:"CSR 9174", csrExpiration:"2027-12-31", company:"Okonkwo-Vance Reporting", firmRegistrationNumber:"5678", address:"1 Riverwalk Plaza", phone:"210-555-0143" },
  });
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  const appearances = record.counsel.map(a => ({ ...a, participation:{ method:{ value:"zoom" }, detail:{ value:"Zoom" } } }));
  const input = assembleInsertionInput({
    record, template, intake:{ counselOfRecord:["Marisol Vantongeren-Okafor"] },
    operator:{
      jurisdiction:"texas-state", signatureDisposition:"waived", signatureDispositionBasis:"Waived on the record", appearances,
      courtHeadingLine:"IN THE DISTRICT COURT OF", countyCourtLine:"BEXAR COUNTY, TEXAS", judicialDistrictLine:"45TH JUDICIAL DISTRICT",
      proceedingHeading:"ORAL DEPOSITION OF", witnessLocation:{ physicalAddress:"San Antonio, Texas" }, titleNarrative:["Sworn."],
      certification:{ custodialAttorney:"Marisol Vantongeren-Okafor", charges:"500.00", chargesResponsibleParty:"Plaintiff", serviceDate:"August 28, 2026", certificationDate:"August 28, 2026" },
      timeUsed:{ totalOnRecordMinutes:60, parties:[{ name:"Marisol Vantongeren-Okafor", minutes:60 }] },
    },
    pagination,
  });
  return buildTexasInsertionPageSet(input, { setId:"s", depositionId:"DEP-20260828-STD1", generatedAt:"2026-08-28T00:00:00.000Z", certificateOnly });
}

const AUTHORITATIVE = { index:{ appearances:{ startPage:2 }, examinations:[{ examiner:"Marisol Vantongeren-Okafor", startPage:4, endPage:12 }], reportersCertification:{ startPage:13 } } };

test("an appearances page with no authoritative number refuses", async () => {
  await assert.rejects(() => pageSet({ pagination:{ index:{ reportersCertification:{ startPage:13 } } }, certificateOnly:false }),
    /INDEX_PAGE_UNAVAILABLE.*Appearances/);
});

test("a certificate page with no authoritative number refuses", async () => {
  await assert.rejects(() => pageSet({ pagination:{ index:{ appearances:{ startPage:2 } } }, certificateOnly:false }),
    /INDEX_PAGE_UNAVAILABLE.*Reporter's Certificate/);
});

test("a certificate-only document carries no index at all", async () => {
  // Not an index with blanks in it. The page is absent, because an index states where sections land
  // and only complete-transcript pagination knows that.
  const pages = await pageSet({ pagination:{}, certificateOnly:true });
  assert.ok(!pages.pages.some(page => page.role === "index"), "a certificate-only document grew an index");
  const text = pages.pages.flatMap(page => page.lines).map(line => line.text).join("\n");
  assert.doesNotMatch(text, /Appearances\.{4,}/, "an index line reached a document with no pagination");
});

test("with authoritative pagination the index prints the numbers it was given", async () => {
  const pages = await pageSet({ pagination:AUTHORITATIVE, certificateOnly:false });
  const text = pages.pages.flatMap(page => page.lines).map(line => line.text).join(" ").replace(/\s+/g, " ");
  assert.match(text, /Appearances\.+ 2\b/);
  assert.match(text, /Reporter's Certificate\.+ 13\b/);
});

test("the standalone screen routes the full document rather than rendering one", () => {
  const text = fs.readFileSync(SCREEN, "utf8");
  const source = ts.createSourceFile("InsertionPagesScreen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let routes = false;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "button"
        && node.children.map(child => child.getText()).join("").includes("generate in the Workspace")) {
      routes = node.openingElement.attributes.getText().includes("onClick={onBack}");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(routes, "the screen does not hand the full document to the Workspace");
  // And it keeps the job it is authoritative for: writing certification values to the record.
  assert.match(text, /api\/deposition\/certification/, "the screen stopped saving certification values");
});
