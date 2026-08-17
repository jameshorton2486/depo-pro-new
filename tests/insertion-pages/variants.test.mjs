import assert from "node:assert/strict";
import test from "node:test";
import { hasBlockingFindings, validateInsertionInput } from "../../server/insertion-pages/validate.mjs";
import { captionJurisdiction, selectInsertionVariant } from "../../server/insertion-pages/variants.mjs";

test("variant selection has no implicit default", () => {
  assert.equal(selectInsertionVariant(), null);
  assert.equal(selectInsertionVariant({ jurisdiction: "texas-state", signatureDisposition: "requested" }), "TEXAS_STATE_SIGNATURE_REQUESTED");
  assert.equal(selectInsertionVariant({ jurisdiction: "federal", signatureDisposition: "waived" }), "FEDERAL_SIGNATURE_WAIVED");
});

test("caption jurisdiction identifies a United States District Court", () => {
  assert.equal(captionJurisdiction("IN THE UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TEXAS"), "federal");
});

test("a court type alone never implies Texas",()=>{
  // The defect: `district court` satisfied the old alternation on its own, so
  // `IN THE DISTRICT COURT OF DOUGLAS COUNTY, NEBRASKA` returned texas-state. Texas
  // certification language on a Nebraska transcript, with nothing raised.
  for(const court of [
    "IN THE DISTRICT COURT OF DOUGLAS COUNTY, NEBRASKA",
    "IN THE DISTRICT COURT OF OKLAHOMA COUNTY, STATE OF OKLAHOMA",
    "SUPERIOR COURT OF THE STATE OF CALIFORNIA",
    "IN THE CIRCUIT COURT OF COOK COUNTY, ILLINOIS",
  ]) assert.equal(captionJurisdiction(court),"unsupported",`${court} must not read as Texas`);
});

test("Texas captions are still recognised, including the abbreviation",()=>{
  for(const court of [
    "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS",
    "IN THE COUNTY COURT AT LAW NO. 2, HARRIS COUNTY, TEXAS",
    "IN THE JUSTICE COURT, PRECINCT 1, TRAVIS COUNTY, TEX.",
  ]) assert.equal(captionJurisdiction(court),"texas-state",court);
});

test("federal is matched before any state name in the same caption",()=>{
  // Both of these contain "TEXAS". Order matters: a federal court sitting in Texas is
  // federal, not Texas state.
  assert.equal(captionJurisdiction("UNITED STATES DISTRICT COURT FOR THE SOUTHERN DISTRICT OF TEXAS"),"federal");
  assert.equal(captionJurisdiction("UNITED STATES BANKRUPTCY COURT, NORTHERN DISTRICT OF TEXAS"),"federal");
});

test("an unreadable caption returns null rather than guessing",()=>{
  // null is "undetermined" and leaves the operator's selection standing. That is different
  // from "unsupported", which blocks. Neither may be a confident wrong answer.
  assert.equal(captionJurisdiction("IN THE DISTRICT COURT"),null);
  assert.equal(captionJurisdiction(""),null);
  assert.equal(captionJurisdiction(),null);
  assert.equal(captionJurisdiction("TEXARKANA MUNICIPAL COURT"),null,"a place name containing tex- is not Texas");
});

test("an out-of-state caption blocks even when the operator selected Texas",()=>{
  // The end-to-end case. CERT_JURISDICTION_MISMATCH cannot cover this alone: it fires only
  // when detection disagrees with the operator, so once detection stopped calling Nebraska
  // "texas-state" this combination would have produced no finding at all.
  const input={
    jurisdiction:"texas-state", signatureDisposition:"requested", signatureDispositionBasis:"Stated on the record",
    variant:"TEXAS_STATE_SIGNATURE_REQUESTED", template:{available:true},
    appearances:[], counselReconciliation:{expectedNames:[]}, pages:[], layoutProfile:{id:"test-profile"},
    caption:{ court:"IN THE DISTRICT COURT OF DOUGLAS COUNTY, NEBRASKA" },
  };
  const findings=validateInsertionInput(input);
  const stop=findings.find(item=>item.code==="CERT_JURISDICTION_UNSUPPORTED");
  assert.ok(stop,`expected a blocking unsupported-jurisdiction finding, got ${findings.map(item=>item.code).join(", ")||"none"}`);
  assert.equal(stop.severity,"blocking");
  assert.equal(hasBlockingFindings(findings),true,"the document must not be produced");
});

test("a Texas caption with a Texas selection raises no jurisdiction finding",()=>{
  const findings=validateInsertionInput({
    jurisdiction:"texas-state", signatureDisposition:"requested", signatureDispositionBasis:"Stated on the record",
    variant:"TEXAS_STATE_SIGNATURE_REQUESTED", template:{available:true},
    appearances:[], counselReconciliation:{expectedNames:[]}, pages:[], layoutProfile:{id:"test-profile"},
    caption:{ court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS" },
  });
  assert.equal(findings.some(item=>String(item.code).startsWith("CERT_JURISDICTION")),false,findings.map(item=>item.code).join(", "));
});
