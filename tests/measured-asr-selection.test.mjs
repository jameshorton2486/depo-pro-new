import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readAudioAudit, recordComparison, selectAsrSource } from "../server/audio-pipeline.mjs";
import { compareTranscripts } from "../server/transcript-quality.mjs";
import { buildTermGroups } from "../server/term-groups.mjs";

// Mirrors what POST /api/transcript/compare records: the term group set is resolved
// server-side and stamped onto the comparison, never taken from the caller.
const SET = buildTermGroups("deposition-core-v1");
function scored(reference, hypothesis, criticalTerms = [], set = SET) {
  return { termGroupSetId:set?.termGroupSetId ?? null, termGroupSetVersion:set?.termGroupSetVersion ?? null, ...compareTranscripts(reference, hypothesis, criticalTerms, set?.groups ?? {}) };
}

function fixture(t, { selectedSource = "original", selectedDerivativeOperationId = null, selectedAudioSha256 = "original-sha", comparisons = [] } = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-measured-selection-")),uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId),operationId=crypto.randomUUID();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(directory,{recursive:true});
  const audit={schemaVersion:"3.0.0",uploadId,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,sha256:"original-sha",immutable:true},derivatives:[{kind:"rx-asr",key:`audio-intake/${uploadId}/candidate.flac`,sha256:"processed-sha",operationId,timelinePreserved:true,selectableForTranscription:true}]},selectedSource,selectedDerivativeOperationId,selectedAudioSha256,comparisons,transcripts:{},history:[]};
  fs.writeFileSync(path.join(directory,"audit.json"),JSON.stringify(audit));
  return { root, uploadId, operationId, audit };
}

test("recording a comparison does not change the selected ASR source",async t=>{
  const { root, uploadId, operationId, audit }=fixture(t);
  const reference="Jane Doe did not attend the examination yesterday",terms=["Jane Doe","did not"];
  const set=buildTermGroups("deposition-core-v1",{ufmEntries:[{canonical:"Jane Doe",category:"person"}]});
  await recordComparison(root,audit,{source:"original",...scored(reference,"Jane Doe did attend examination yesterday",terms,set)});
  await recordComparison(root,audit,{source:"processed",derivativeOperationId:operationId,...scored(reference,reference,terms,set)});

  const recorded=readAudioAudit(root,uploadId);
  assert.equal(recorded.comparisons.length,2);
  assert.equal(recorded.selectedSource,"original","recording must not reassign the ASR source");
  assert.equal(recorded.selectedAudioSha256,"original-sha");
  assert.equal(recorded.automaticSelection,undefined);
  assert.equal(recorded.selectionBasis,undefined);
});

test("explicit selection accepts a proven candidate and preserves original as a candidate",async t=>{
  const { root, uploadId, operationId, audit }=fixture(t);
  const reference="Jane Doe did not attend the examination yesterday",terms=["Jane Doe","did not"];
  const set=buildTermGroups("deposition-core-v1",{ufmEntries:[{canonical:"Jane Doe",category:"person"}]});
  await recordComparison(root,audit,{source:"original",...scored(reference,"Jane Doe did attend examination yesterday",terms,set)});
  await recordComparison(root,audit,{source:"processed",derivativeOperationId:operationId,...scored(reference,reference,terms,set)});

  const result=await selectAsrSource(root,uploadId);
  assert.equal(result.status,"selected");
  const saved=readAudioAudit(root,uploadId);
  assert.equal(saved.selectedSource,"processed");
  assert.equal(saved.selectedDerivativeOperationId,operationId);
  assert.equal(saved.selectedAudioSha256,"processed-sha");
  assert.equal(saved.selectionBasis,"measured-human-reference");
  assert.equal(saved.automaticSelection.measuredWer,true);
  assert.deepEqual(saved.automaticSelection.candidateSet,["original","processed"]);
});

test("explicit selection retains original when the RX candidate loses a negation",async t=>{
  const { root, uploadId, operationId, audit }=fixture(t,{selectedSource:"processed",selectedDerivativeOperationId:null,selectedAudioSha256:"processed-sha"});
  const reference="No I did not authorize the payment on August 15 2026";
  await recordComparison(root,audit,{source:"original",...scored(reference,"No I did not authorize payment August fifty twenty six")});
  await recordComparison(root,audit,{source:"processed",derivativeOperationId:operationId,...scored(reference,"I did authorize the payment on August 15 2026")});

  const result=await selectAsrSource(root,uploadId);
  assert.equal(result.status,"selected");
  const saved=readAudioAudit(root,uploadId);
  assert.equal(saved.selectedSource,"original");
  assert.equal(saved.selectedDerivativeOperationId,null);
  assert.equal(saved.selectedAudioSha256,"original-sha");
  assert.ok(saved.automaticSelection.metrics.categoryRegressions.includes("negations"));
});

test("schemaVersion 1 comparison records are excluded from pairing and cannot drive selection",async t=>{
  // A v1 record predates referenceSha256. It reports a perfect processed result, so if it
  // were admitted to pairing it would win outright against the v2 original recorded below.
  const legacy={schemaVersion:1,source:"processed",wer:0,deletions:0,substitutions:0,insertions:0,criticalTermsMissed:[]};
  const { root, uploadId, audit }=fixture(t,{comparisons:[legacy]});
  const reference="No I did not authorize the payment on August 15 2026";
  await recordComparison(root,audit,{source:"original",...scored(reference,"No I did not authorize payment August fifty twenty six")});

  const result=await selectAsrSource(root,uploadId);
  assert.equal(result.status,"insufficient-comparisons");
  const saved=readAudioAudit(root,uploadId);
  assert.equal(saved.comparisons.length,2,"the legacy record is retained, only excluded from pairing");
  assert.equal(saved.selectedSource,"original");
  assert.equal(saved.automaticSelection,undefined);
});

test("a pair of schemaVersion 1 records cannot select, despite matching on absent hashes",async t=>{
  // Both records lack referenceSha256. `undefined === undefined` is true, so without the
  // guards in selectAsrSource these two would pair and hand the win to the processed
  // candidate -- with no evidence the two were scored against the same reference at all.
  const comparisons=[
    {schemaVersion:1,source:"original",wer:.4,deletions:9,substitutions:4,insertions:0,criticalTermsMissed:[]},
    {schemaVersion:1,source:"processed",wer:0,deletions:0,substitutions:0,insertions:0,criticalTermsMissed:[]},
  ];
  const { root, uploadId }=fixture(t,{comparisons});

  const result=await selectAsrSource(root,uploadId);
  assert.equal(result.status,"insufficient-comparisons");
  const saved=readAudioAudit(root,uploadId);
  assert.equal(saved.selectedSource,"original");
  assert.equal(saved.automaticSelection,undefined);
});

test("an unresolved term group set refuses selection rather than selecting on a weaker check",async t=>{
  // The processed candidate is perfect and would win on WER. It was scored without a
  // resolved set, so the case-term and negation groups it was supposed to check may never
  // have been applied. Refusing is the only safe answer.
  const { root, uploadId, operationId, audit }=fixture(t);
  const reference="No I did not authorize the payment on August 15 2026";
  await recordComparison(root,audit,{source:"original",...scored(reference,"No I did not authorize payment August fifty twenty six")});
  await recordComparison(root,audit,{source:"processed",derivativeOperationId:operationId,...scored(reference,reference,[],null)});

  const result=await selectAsrSource(root,uploadId);
  assert.equal(result.status,"term-group-set-unresolved");
  assert.equal(result.selection,null);
  assert.match(result.blocker,/term group set/);
  const saved=readAudioAudit(root,uploadId);
  assert.equal(saved.selectedSource,"original");
  assert.equal(saved.automaticSelection,undefined);
});

test("candidates scored under different term group sets refuse to pair",async t=>{
  const { root, uploadId, operationId, audit }=fixture(t);
  const reference="No I did not authorize the payment on August 15 2026";
  const other={termGroupSetId:"deposition-core-v1",termGroupSetVersion:"2.0.0",groups:SET.groups};
  await recordComparison(root,audit,{source:"original",...scored(reference,"No I did not authorize payment August fifty twenty six")});
  await recordComparison(root,audit,{source:"processed",derivativeOperationId:operationId,...scored(reference,reference,[],other)});

  const result=await selectAsrSource(root,uploadId);
  assert.equal(result.status,"term-group-set-mismatch");
  assert.equal(result.selection,null);
  assert.match(result.blocker,/1\.0\.0.*2\.0\.0|2\.0\.0.*1\.0\.0/);
  assert.equal(readAudioAudit(root,uploadId).automaticSelection,undefined);
});

test("unknown term group set ids are refused at resolution",()=>{
  assert.throws(()=>buildTermGroups("does-not-exist"),/Unsupported term group set/);
  assert.throws(()=>buildTermGroups(undefined),/Unsupported term group set/);
});

test("case terms are drawn from UFM registry categories and intake keyterms",()=>{
  const built=buildTermGroups("deposition-core-v1",{
    ufmEntries:[
      {canonical:"Jane Doe",category:"person"},{canonical:"Delta Company",category:"organization"},
      {canonical:"metoprolol",category:"pharmaceutical"},{canonical:"Exhibit 12",category:"exhibit"},
      {canonical:"ignored",category:"other"},
    ],
    keyterms:[{term:"spoliation"},"laches"],
  });
  assert.deepEqual(built.groups.properNames,["Jane Doe","Delta Company"]);
  assert.deepEqual(built.groups.medicalTerms,["metoprolol"]);
  assert.deepEqual(built.groups.exhibitTerms,["Exhibit 12"]);
  assert.deepEqual(built.groups.keyterms,["spoliation","laches"]);
  assert.ok(built.groups.negations.includes("did not")===false&&built.groups.negations.includes("not"));
  assert.equal(built.termGroupSetVersion,"1.0.0");
});

test("selection rejects an upload identifier that is not a UUID",async()=>{
  // Inherited from mutateAudioAudit, which asserts before any path is built. Pinned here so
  // the endpoint's reliance on it is visible rather than incidental.
  await assert.rejects(()=>selectAsrSource("C:/nowhere","../../etc/passwd"),/Invalid audio intake identifier/);
  await assert.rejects(()=>selectAsrSource("C:/nowhere",""),/Invalid audio intake identifier/);
});

test("selection is a no-op when only one side has been compared",async t=>{
  const { root, uploadId, audit }=fixture(t);
  const reference="No I did not authorize the payment on August 15 2026";
  await recordComparison(root,audit,{source:"original",...scored(reference,"No I did not authorize payment August fifty twenty six")});

  const result=await selectAsrSource(root,uploadId);
  assert.equal(result.status,"insufficient-comparisons");
  assert.equal(result.selection,null);
  assert.equal(readAudioAudit(root,uploadId).automaticSelection,undefined);
});
