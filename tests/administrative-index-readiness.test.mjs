import assert from "node:assert/strict";
import test from "node:test";
import { deriveExhibitIndexEntries, validateAdministrativeIndexReadiness } from "../server/administrative-index-readiness.mjs";

const lines = text => Array.from({ length: 25 }, (_, index) => ({ position:index+1, content:index ? "" : text, paragraphId:index ? null : "paragraph-1", fragments:index ? [] : [{ sourceWordId:"word-1" }] }));
const printModel = { modelHash:"transcript-model", source:{ reviewStateHash:"review-state" }, pages:[{ pageNumber:1, lines:lines("Testimony") }] };
const event = reference => ({ id:"event-1", exhibitId:"exhibit-1", status:"ACTIVE", label:"1", description:"Contract", transcriptReferences:[reference], material:{kind:"PHYSICAL"}, custody:{status:"RESOLVED",holder:"Counsel",sourceAnchor:"custody"}, sealedHandling:{status:"NOT_APPLICABLE"}, packageDisposition:"EXCLUDED" });
const record = reference => ({ exhibitLifecycle:{ auditEvents:[], exhibitEvents:[event(reference)] } });

test("exhibit pages derive from stable paragraph or word identity plus final front matter", () => {
  assert.equal(deriveExhibitIndexEntries(record({ sourceAnchor:"evidence", paragraphId:"paragraph-1" }), printModel, 3)[0].page, 4);
  assert.equal(deriveExhibitIndexEntries(record({ sourceAnchor:"evidence", sourceWordId:"word-1" }), printModel, 5)[0].page, 6);
});

test("free-form transcript wording and page-like anchors cannot manufacture an index page", () => {
  assert.throws(() => deriveExhibitIndexEntries(record({ sourceAnchor:"transcript:8:2", quotedText:"mark this exhibit" }), printModel, 3), /EXHIBIT_INDEX_REFERENCE_UNRESOLVED/);
});

test("administrative readiness validates required roles, final pagination and current exhibits", () => {
  const pages = [
    {pageNumber:1,role:"title",sectionKind:"administrative",lines:lines("Title")},
    {pageNumber:2,role:"appearances",sectionKind:"administrative",lines:lines("Appearances")},
    {pageNumber:3,role:"index",sectionKind:"administrative",lines:lines("Index")},
    {pageNumber:4,role:"testimony",sectionKind:"testimony",lines:lines("Testimony")},
    {pageNumber:5,role:"certification1",sectionKind:"administrative",lines:lines("Certificate")},
  ];
  const model={modelHash:"complete",variant:"TEXAS_STATE_SIGNATURE_WAIVED",signatureDisposition:"waived",layoutProfile:{linesPerPage:25},pages,pagination:{index:{appearances:{startPage:2},examinations:[{examiner:"Counsel",startPage:4,endPage:4}],reportersCertification:{startPage:5},exhibits:[{exhibitId:"exhibit-1",page:4}]}}};
  const exhibits={lifecycleDigest:"ledger",exhibits:[event({paragraphId:"paragraph-1"})]};
  const result=validateAdministrativeIndexReadiness(model,exhibits); assert.equal(result.ready,true); assert.deepEqual(result.findings,[]); assert.ok(result.projectionDigest);
  model.pages[4].pageNumber=99; assert.equal(validateAdministrativeIndexReadiness(model,exhibits).findings.some(item=>item.code==="ADMINISTRATIVE_PAGE_SEQUENCE_INVALID"),true);
});
