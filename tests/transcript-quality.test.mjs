import assert from "node:assert/strict";
import test from "node:test";
import { tokenizationIntegrity, tokenizationDelta } from "../server/transcript-quality.mjs";

test("tokenization integrity reports a distribution, not a verdict",()=>{
  // A word error rate cannot see a six-second token. The scan reports the shape so a threshold
  // is chosen from the population rather than from intuition -- legitimate long tokens exist.
  const words = Array.from({ length:100 }, (_, i) => ({ id:`w${i}`, punctuatedWord:"word", start:i * 0.25, end:i * 0.25 + 0.24 }));
  words.push({ id:"long", punctuatedWord:"C572224LRicoLauraElizondoVargas,", start:200, end:206 });
  const report = tokenizationIntegrity(words, { keyterms:["Elizondo","Vargas","Rocio"] });
  assert.equal(report.words,101);
  assert.equal(report.duration.p50,0.24);
  assert.equal(report.duration.max,6);
  assert.equal(report.longestByDuration[0].seconds,6);
  // The mechanism, not just the count: a token holding two of the keyterms this run was told to
  // expect is a different finding from one that is merely long.
  assert.equal(report.concatenatedEntities.length,1);
  assert.deepEqual(report.concatenatedEntities[0].entities.sort(),["elizondo","vargas"]);
});

test("a long token carrying no keyterm is not reported as concatenated",()=>{
  // Length alone is not the finding. A spelled-out cause number is long and legitimate.
  const words = [{ id:"a", punctuatedWord:"antidisestablishmentarianism", start:0, end:3 }];
  assert.equal(tokenizationIntegrity(words, { keyterms:["Vargas"] }).concatenatedEntities.length,0);
});

test("segmentation collapse is visible against an unchanged total",()=>{
  // The failure this exists to catch: two runs differing by eleven words overall while one
  // passage loses six tokens. Comparing totals would call that a rounding difference.
  const baseline = Array.from({ length:12 }, (_, i) => ({ id:`b${i}`, punctuatedWord:"x", start:i < 6 ? i : 100 + i }));
  const candidate = Array.from({ length:7 }, (_, i) => ({ id:`c${i}`, punctuatedWord:"x", start:i < 1 ? 0 : 100 + i + 5 }));
  const delta = tokenizationDelta(baseline, candidate, { windowSeconds:30 });
  assert.equal(delta.totalBaseline,12);
  assert.equal(delta.collapsed[0].fromSeconds,0);
  assert.equal(delta.collapsed[0].lost,5,"the first window lost five tokens");
});
