import assert from "node:assert/strict";
import test from "node:test";
import { recommendProcessing } from "../server/audio-pipeline.mjs";
import { AUDIO_TOOL_PROFILES } from "../server/rx-profiles.mjs";

const DE_HUM = "rx12-de-hum-dynamic-v1", HIGH_PASS = "low-frequency-rolloff-v2";

// Every finding measured and undetected, so each case states only what it turns on. A test
// that passed `{lineHum:{detected:true}}` alone would read `findings.uncertain.detected` as
// undefined and skip the fail-closed guard by accident rather than by policy.
function findings(detected = {}) {
  const names = ["lowLevel", "clipping", "lowFrequencyEnergy", "unevenLevels", "lineHum", "impulses", "echo", "clean", "uncertain"];
  return Object.fromEntries(names.map(name => [name, { measured:true, detected:detected[name] === true, confidence:.7, evidence:null }]));
}

test("hum alone recommends De-hum",()=>{
  const result = recommendProcessing(findings({ lineHum:true }));
  assert.equal(result.route,"candidate");
  assert.deepEqual(result.candidateProfileIds,[DE_HUM]);
});

test("rumble alone recommends the high-pass filter",()=>{
  const result = recommendProcessing(findings({ lowFrequencyEnergy:true }));
  assert.equal(result.route,"candidate");
  assert.deepEqual(result.candidateProfileIds,[HIGH_PASS]);
});

test("hum and rumble together chain both in catalog order",()=>{
  const result = recommendProcessing(findings({ lineHum:true, lowFrequencyEnergy:true }));
  assert.equal(result.route,"candidate");
  // Order comes from resolveAudioToolChain reading chainOrder, not from this test's opinion:
  // De-hum is 2 and the high-pass is 3, so the assertion is derived rather than typed.
  const expected = [DE_HUM, HIGH_PASS].sort((a,b)=>AUDIO_TOOL_PROFILES[a].chainOrder-AUDIO_TOOL_PROFILES[b].chainOrder);
  assert.deepEqual(result.candidateProfileIds,expected);
});

test("clipping with hum still preserves the original",()=>{
  // Clipping is destroyed data. A De-hum candidate over it would sound better while hiding
  // the damage, which is the one outcome worse than no candidate at all.
  const result = recommendProcessing(findings({ clipping:true, lineHum:true }));
  assert.equal(result.route,"review");
  assert.deepEqual(result.candidateProfileIds,[]);
  assert.equal(result.candidateProfile,null);
});

test("uncertain analysis with hum still preserves the original",()=>{
  const result = recommendProcessing(findings({ uncertain:true, lineHum:true }));
  assert.equal(result.route,"review");
  assert.deepEqual(result.candidateProfileIds,[]);
});

test("uneven levels do not suppress an actionable hum",()=>{
  // Levels have no qualified module, so they route to review on their own. Hum does. The
  // presence of an unfixable concern must not withhold the fix for a separate one.
  const result = recommendProcessing(findings({ unevenLevels:true, lineHum:true }));
  assert.equal(result.route,"candidate");
  assert.deepEqual(result.candidateProfileIds,[DE_HUM]);
});

test("level concerns alone still route to review with no candidate",()=>{
  for (const name of ["lowLevel","unevenLevels"]) {
    const result = recommendProcessing(findings({ [name]:true }));
    assert.equal(result.route,"review",`${name} must not produce a candidate`);
    assert.deepEqual(result.candidateProfileIds,[]);
  }
});

test("nothing detected leaves the original alone",()=>{
  const result = recommendProcessing(findings());
  assert.equal(result.route,"original");
  assert.deepEqual(result.candidateProfileIds,[]);
  assert.equal(result.candidateProfile,null);
});

test("impulses and echo do not trigger a candidate, because their modules are not ASR-safe",()=>{
  // De-click recommends for `impulses` and De-reverb for `echo`, and both are asrSafe:false.
  // This is the assertion that the asrSafe filter is doing work rather than being decorative.
  for (const name of ["impulses","echo"]) {
    const result = recommendProcessing(findings({ [name]:true }));
    assert.equal(result.route,"original",`${name} must not auto-apply a review-only module`);
    assert.deepEqual(result.candidateProfileIds,[]);
  }
});

test("every automatically applied profile is marked ASR-safe in the catalog",()=>{
  // Sweeps the whole finding space rather than the cases above, so a future profile that is
  // eligible for some combination this file does not enumerate is still caught.
  const names = ["lowLevel","clipping","lowFrequencyEnergy","unevenLevels","lineHum","impulses","echo"];
  for (let mask = 0; mask < (1 << names.length); mask += 1) {
    const detected = Object.fromEntries(names.filter((_, index) => mask & (1 << index)).map(name => [name, true]));
    for (const id of recommendProcessing(findings(detected)).candidateProfileIds) {
      assert.equal(AUDIO_TOOL_PROFILES[id]?.asrSafe,true,`${id} was recommended automatically for ${JSON.stringify(detected)} but is not asrSafe`);
    }
  }
});

test("two ASR-safe profiles that exclude each other route to review, not to a failed intake",()=>{
  // Not reachable with the shipped catalog -- it is reachable the moment someone adds a second
  // asrSafe profile that excludes an existing one, which catalog-derived selection now makes
  // possible where a hardcoded profile id did not. Injected rather than left as an untested
  // claim. Letting the throw escape would mark the whole analysis failed and discard valid
  // measurements over a catalog conflict that has nothing to do with the recording.
  const catalog = {
    a:{ id:"a", displayName:"A", asrSafe:true, chainOrder:1, recommendFor:["lineHum"], excludes:["b"] },
    b:{ id:"b", displayName:"B", asrSafe:true, chainOrder:2, recommendFor:["lineHum"], excludes:["a"] },
  };
  const resolveChain = ids => { if (ids.includes("a") && ids.includes("b")) throw new Error("A cannot be combined with B."); return ids.map(id => catalog[id]); };
  const result = recommendProcessing(findings({ lineHum:true }), { catalog, resolveChain });
  assert.equal(result.route,"review");
  assert.deepEqual(result.candidateProfileIds,[]);
  assert.match(result.reason,/cannot be combined/);
});

test("the singular candidateProfile field still carries the first chained profile",()=>{
  const result = recommendProcessing(findings({ lineHum:true, lowFrequencyEnergy:true }));
  assert.equal(result.candidateProfile,result.candidateProfileIds[0]);
  assert.equal(result.candidateProfile,DE_HUM);
});
