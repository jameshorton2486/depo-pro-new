import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { KEYTERM_PRODUCT_CAP } from "../server/keyterm-limits.mjs";
import { buildKeytermSet, collectKeytermCandidates, nameTerms } from "../server/keyterm-coverage.mjs";

const CANONICAL = createCanonicalDepositionRecord({
  witness:"Mohammad Etminan, M.D.",
  parties:["Rocio Laura Elizondo Vargas","Leonardo Isaias Rodriguez","Sandy Dean Koepke","Standing Seam & Specialty Company, Inc."],
  attorneys:[
    { name:"Dennis J. Bentley", firm:"Marco Crawford Law, PLLC" },
    { name:"Marco A. Crawford", firm:"Marco Crawford Law, PLLC" },
    { name:"Christian R. Ramon", firm:"Vidaurri, Rodriguez & Reyna, LLC" },
  ],
  reporterProfile:{ name:"Miah Bardot" },
});
const EXTRACTED = ["discectomy","laminectomy","foraminal","pars interarticularis","radiculopathy","Waddell","LaGrande"];
const built = buildKeytermSet({ canonical:CANONICAL, extracted:EXTRACTED });
const has = term => built.wire.some(item => item.toLocaleLowerCase("en-US") === term.toLocaleLowerCase("en-US"));

test("the names the ASR missed are now submitted",()=>{
  // Measured misses: Bentley 0 of 36, Ramon 1 of 24, Rocio 3 of 8, Mohammad 0 of 7,
  // Elizondo 0 of 2. Every one of them is in the Notice and none was ever sent.
  for (const term of ["Bentley","Ramon","Rocio","Mohammad","Elizondo","Crawford"]) {
    assert.ok(has(term),`${term} must be submitted`);
  }
});

test("full names go in as phrases, not just surnames",()=>{
  // Deepgram rendered the plaintiff "Rico, Laura, Alessandro, Vargas". A surname-only term
  // cannot repair that; the phrase gives the model the whole sequence to match.
  assert.ok(has("Rocio Laura Elizondo Vargas"));
  assert.ok(has("Leonardo Isaias Rodriguez"));
  assert.ok(has("Dennis Bentley"));
});

test("nameTerms drops honorifics, suffixes and bare initials",()=>{
  assert.deepEqual(nameTerms("Mohammad Etminan, M.D."),["Mohammad Etminan","Mohammad","Etminan"]);
  // The phrase drops the initial too: "Dennis J. Bentley" is written, "Dennis Bentley" is said,
  // and a phrase that cannot match what the microphone heard is a wasted slot.
  assert.deepEqual(nameTerms("Dennis J. Bentley"),["Dennis Bentley","Dennis","Bentley"]);
  assert.deepEqual(nameTerms("Dr. Sandy Dean Koepke Jr."),["Sandy Dean Koepke","Sandy","Dean","Koepke"]);
  assert.deepEqual(nameTerms(""),[]);
});

test("a compound surname stays whole rather than becoming useless particles",()=>{
  assert.deepEqual(nameTerms("Maria de la Cruz"),["Maria de la Cruz","Maria","Cruz"]);
});

test("every term carries its provenance",()=>{
  // The Notice contradicts itself -- "STANDING SEAM" in the caption, "Standing Steam" in the
  // certificate of service. A reporter cannot judge a term without seeing where it came from.
  const candidates = collectKeytermCandidates({ canonical:CANONICAL, extracted:EXTRACTED });
  for (const candidate of candidates) {
    assert.ok(candidate.source,`${candidate.term} has no source`);
    assert.ok(["party","counsel","firm","witness","reporter","extraction"].includes(candidate.source));
  }
  const bentley = built.terms.find(item => item.term === "Bentley");
  assert.equal(bentley.source,"counsel");
  assert.equal(bentley.details[0],"Dennis J. Bentley");
});

test("people outrank extracted vocabulary when the cap bites",()=>{
  // The people who speak are the people whose names must survive truncation. Under the old
  // behaviour the set was seven medical terms and five party surnames, and no attorney at all.
  const squeezed = buildKeytermSet({ canonical:CANONICAL, extracted:EXTRACTED, cap:8 });
  assert.equal(squeezed.wire.length,8);
  assert.equal(squeezed.terms.every(item => item.source !== "extraction"),true,"vocabulary is dropped before people");
  assert.ok(squeezed.dropped.length > 0);
});

test("truncation is never silent",()=>{
  const squeezed = buildKeytermSet({ canonical:CANONICAL, extracted:EXTRACTED, cap:5 });
  const problem = squeezed.problems.find(item => item.code === "CAP_EXCEEDED");
  assert.ok(problem,"dropping terms without reporting is the defect this exists to prevent");
  assert.deepEqual(problem.dropped, squeezed.dropped.map(item => item.term));
});

test("the cap is 50 everywhere, matching the server",()=>{
  assert.equal(built.cap,KEYTERM_PRODUCT_CAP);
  assert.equal(KEYTERM_PRODUCT_CAP,50);
});

test("case-insensitive duplicates collapse and keep the stronger source",()=>{
  const canonical = createCanonicalDepositionRecord({ parties:["Vargas"], attorneys:[{ name:"vargas", firm:"" }] });
  const result = buildKeytermSet({ canonical, extracted:["VARGAS"] });
  assert.equal(result.wire.filter(term => term.toLowerCase() === "vargas").length,1);
  assert.equal(result.terms.find(item => item.term.toLowerCase() === "vargas").source,"counsel","counsel outranks party and extraction");
});

test("common organisation words are not boosted on their own",()=>{
  // "Law", "Company", "Specialty" as standalone keyterms spend a slot and bias recognition
  // toward a common word across six hours of testimony. The distinctive phrase still goes in.
  for (const generic of ["Law","Company","Specialty","Standing","Seam"]) {
    assert.equal(has(generic),false,`${generic} must not be submitted alone`);
  }
  assert.ok(has("Standing Seam Specialty Company"),"the phrase is distinctive even though its parts are not");
  assert.ok(has("Marco Crawford Law"));
  assert.ok(has("Vidaurri"),"a genuinely unusual firm name token is still worth a slot");
});

test("an empty canonical record produces an empty set rather than throwing",()=>{
  const result = buildKeytermSet({ canonical:{}, extracted:[] });
  assert.deepEqual(result.wire,[]);
  assert.deepEqual(result.problems,[]);
});
