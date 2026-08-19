import assert from "node:assert/strict";
import test from "node:test";
import { applyTermCorrections, buildTermRows } from "../server/keyterm-corrections.mjs";
import { KEYTERM_PRODUCT_CAP, KEYTERM_TOKEN_BUDGET, estimateKeytermTokens } from "../server/keyterm-limits.mjs";
import { authoritativeKeyterms } from "../server/transcription-jobs.mjs";

function intake(terms = ["Klaryx Y. Martinez", "Bellweather", "spoliation"], extra = {}) {
  return {
    keyterms:[...terms],
    deepgramArtifact:{ wire:[...terms], terms:terms.map(term => ({ term, category:"name" })), term_count:terms.length, estimated_tokens:estimateKeytermTokens(terms) },
    ufmData:{ ufm_registry:{ entries:[{ term:"Bellweather Holdings", kind:"entity" }], entry_count:1 }, extraction_report:{ low_confidence_spellings:["Klaryx Y. Martinez"] } },
    ...extra,
  };
}
const rowsOf = value => buildTermRows(value).map(row => ({ ...row }));
function correct(rows, term, correction) { return rows.map(row => row.term === term ? { ...row, correction } : row); }

test("an empty correction leaves the term unchanged",()=>{
  const result = applyTermCorrections(intake(), rowsOf(intake()));
  assert.equal(result.ok,true);
  assert.deepEqual(result.wire,["Klaryx Y. Martinez","Bellweather","spoliation"]);
  assert.deepEqual(result.corrections,[]);
});

test("a whitespace-only correction is treated as no change, not as a blank term",()=>{
  const source = intake();
  const result = applyTermCorrections(source, correct(rowsOf(source),"Bellweather","   "));
  assert.equal(result.ok,true);
  assert.deepEqual(result.wire,["Klaryx Y. Martinez","Bellweather","spoliation"]);
  assert.deepEqual(result.corrections,[]);
});

test("a correction reaches wire, terms, and keyterms together",()=>{
  const source = intake();
  const result = applyTermCorrections(source, correct(rowsOf(source),"Klaryx Y. Martinez","Clarice Y. Martinez"));
  assert.equal(result.ok,true);
  // authoritativeKeyterms prefers deepgramArtifact.wire and falls back to keyterms. If these
  // diverge the reporter's correction is present in one and absent in the other, and which
  // spelling Deepgram receives depends on which branch happens to run.
  assert.ok(result.intake.deepgramArtifact.wire.includes("Clarice Y. Martinez"));
  assert.ok(result.intake.keyterms.includes("Clarice Y. Martinez"));
  assert.ok(result.intake.deepgramArtifact.terms.some(item => item.term === "Clarice Y. Martinez"));
  assert.equal(result.intake.deepgramArtifact.wire.includes("Klaryx Y. Martinez"),false);
  assert.equal(result.intake.keyterms.includes("Klaryx Y. Martinez"),false);
});

test("the saved set is accepted by the server that would otherwise reject it",()=>{
  // The transform and authoritativeKeyterms must agree. This test is the seam between them:
  // a saved intake that the server then throws on is the exact failure this feature adds.
  const source = intake();
  const result = applyTermCorrections(source, correct(rowsOf(source),"Bellweather","Bellwether"));
  assert.equal(result.ok,true);
  const authoritative = authoritativeKeyterms(result.intake);
  assert.deepEqual(authoritative.wire,result.wire);
  assert.equal(authoritative.estimatedTokens,result.estimatedTokens);
});

test("two corrections colliding case-insensitively are reported, not silently merged",()=>{
  const source = intake(["Bellweather","BELLWEATHER Holdings","spoliation"]);
  const result = applyTermCorrections(source, correct(rowsOf(source),"BELLWEATHER Holdings","bellweather"));
  assert.equal(result.ok,false);
  assert.ok(result.problems.some(problem => problem.code === "DUPLICATE_TERM"));
  assert.equal(result.intake,undefined,"a rejected save must not produce an intake to write");
});

test("term_count and estimated_tokens are recomputed with the server's formula",()=>{
  const source = intake();
  const result = applyTermCorrections(source, correct(rowsOf(source),"spoliation","spoliation of evidence"));
  assert.equal(result.ok,true);
  const expected = result.wire.reduce((total,term)=>total+Math.ceil(term.length/4)+1,0);
  assert.equal(result.intake.deepgramArtifact.estimated_tokens,expected);
  assert.equal(result.intake.deepgramArtifact.term_count,result.wire.length);
  assert.equal(result.intake.deepgramArtifact.term_count,3);
});

test("the extracted value survives beside the correction",()=>{
  const source = intake();
  const result = applyTermCorrections(source, correct(rowsOf(source),"Klaryx Y. Martinez","Clarice Y. Martinez"));
  assert.deepEqual(result.intake.reporterTermCorrections,[{ source:"keyterm", original:"Klaryx Y. Martinez", corrected:"Clarice Y. Martinez" }]);
  assert.equal(result.intake.deepgramArtifact.terms.find(item => item.term === "Clarice Y. Martinez").extractedTerm,"Klaryx Y. Martinez");
});

test("a set over the product cap is reported before save, not at transcription time",()=>{
  const terms = Array.from({ length:KEYTERM_PRODUCT_CAP + 5 },(_,index)=>`term${index}`);
  const result = applyTermCorrections(intake(terms), rowsOf(intake(terms)));
  assert.equal(result.ok,false);
  assert.ok(result.problems.some(problem => problem.code === "PRODUCT_CAP"));
  // And the server would in fact have thrown, which is what makes this worth catching early.
  assert.throws(()=>authoritativeKeyterms(intake(terms)),/override reason/);
});

test("a set over the token budget is reported before save",()=>{
  const terms = Array.from({ length:40 },(_,index)=>`extremely lengthy specialized terminology entry number ${index}`);
  const result = applyTermCorrections(intake(terms), rowsOf(intake(terms)));
  assert.equal(result.ok,false);
  assert.ok(result.problems.some(problem => problem.code === "TOKEN_BUDGET"));
  assert.ok(result.estimatedTokens > KEYTERM_TOKEN_BUDGET);
  assert.throws(()=>authoritativeKeyterms(intake(terms),{ overrideReason:"reviewed" }),/submission budget/);
});

test("flagged rows sort to the top and carry the extraction note",()=>{
  const rows = rowsOf(intake());
  assert.equal(rows[0].term,"Klaryx Y. Martinez");
  assert.equal(rows[0].flag,"Low-confidence spelling");
  assert.equal(rows[1].flag,null);
});

test("rows cover both term sets and label their source",()=>{
  const rows = rowsOf(intake());
  assert.deepEqual([...new Set(rows.map(row => row.source))].sort(),["keyterm","ufm"]);
  assert.ok(rows.some(row => row.source === "ufm" && row.term === "Bellweather Holdings"));
});

test("a UFM correction updates the registry without touching the Deepgram wire",()=>{
  const source = intake();
  const result = applyTermCorrections(source, correct(rowsOf(source),"Bellweather Holdings","Bellwether Holdings"));
  assert.equal(result.ok,true);
  assert.equal(result.intake.ufmData.ufm_registry.entries[0].term,"Bellwether Holdings");
  assert.equal(result.intake.ufmData.ufm_registry.entries[0].extractedTerm,"Bellweather Holdings");
  assert.deepEqual(result.intake.deepgramArtifact.wire,source.deepgramArtifact.wire);
});

test("the UI cap and the server cap are the same number",()=>{
  // The defect this replaces: the screen said 60, local-api sliced at 50, and
  // authoritativeKeyterms threw above 50. Masked only because extraction truncated first.
  assert.equal(KEYTERM_PRODUCT_CAP,50);
  assert.equal(KEYTERM_TOKEN_BUDGET,400);
});
