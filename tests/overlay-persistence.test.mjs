import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendReporterOperations, getWorkingTranscript, readReporterOverlay, redoReporterOperation, STALE_REPORTER_TRANSACTION, undoReporterOperation, writeReporterOverlay } from "../server/transcription-jobs.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";

// A throwaway deposition workspace. The overlay is the only thing written here, which is the
// property under test: no path added by Step 5 may touch working.json or asr-evidence.json.
function workspace(t) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-overlay-"));
  t.after(()=>fs.rmSync(storageRoot,{ recursive:true, force:true }));
  const depositionId = "DEP-20260817-WS001";
  const directory = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(directory, "transcript"), { recursive:true });
  fs.mkdirSync(path.join(directory, "deepgram", "jobs", "job1"), { recursive:true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id:depositionId, storagePath:"reporter/cause/witness", audio:[] }));
  const working = { schemaVersion:"1.1.0", recordType:"WORKING_TRANSCRIPT", derivedFrom:["job1"], speakerMap:{ status:"unreconciled", assignments:[] }, segments:[{ id:"job1:segment:1", asrWordIds:["job1:word:1","job1:word:2"], text:"one two" }] };
  const evidence = { schemaVersion:"1.1.0", recordType:"CANONICAL_ASR_EVIDENCE", jobIdentity:"job1", words:[{ id:"job1:word:1", word:"one", punctuatedWord:"One" },{ id:"job1:word:2", word:"two", punctuatedWord:"two." }] };
  const workingFile = path.join(directory, "transcript", "working.json");
  const evidenceFile = path.join(directory, "deepgram", "jobs", "job1", "asr-evidence.json");
  fs.writeFileSync(workingFile, JSON.stringify(working));
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
  return { storageRoot, depositionId, workingFile, evidenceFile, overlayFile:path.join(directory, "transcript", "reporter-overlay.json"),
    digest:file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
}
const ROOT = process.cwd();

// Every authoritative mutation now has to say which transcript it was made against. These cases
// are about what the overlay stores, not about currency, so they read the state they are about to
// act on -- which is what a caller holding a freshly rendered transcript would carry.
const current = w => computeReviewStateHash({
  transcript: getWorkingTranscript(ROOT, { depositionId:w.depositionId, storageRoot:w.storageRoot }),
  overlay: readReporterOverlay(ROOT, { depositionId:w.depositionId, storageRoot:w.storageRoot }),
});


test("a deposition with no edits has no overlay file and reads as empty",t=>{
  const w = workspace(t);
  assert.equal(fs.existsSync(w.overlayFile),false);
  const overlay = readReporterOverlay(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot });
  assert.deepEqual(overlay.operations,[]);
  assert.equal(fs.existsSync(w.overlayFile),false,"reading must not create the file");
});

test("appending writes only the overlay, never the projection or the evidence",t=>{
  const w = workspace(t);
  const workingBefore = w.digest(w.workingFile), evidenceBefore = w.digest(w.evidenceFile);
  appendReporterOperations(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot, operations:[{ op:"replace", wordId:"job1:word:2", text:"too." }] ,expectedReviewStateHash:current(w) });
  assert.ok(fs.existsSync(w.overlayFile));
  assert.equal(w.digest(w.workingFile), workingBefore,"working.json must be byte-identical after an edit");
  assert.equal(w.digest(w.evidenceFile), evidenceBefore,"asr-evidence.json must be byte-identical after an edit");
});

test("operations accumulate in order and survive a reread",t=>{
  const w = workspace(t);
  appendReporterOperations(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot, operations:[{ op:"delete", wordId:"job1:word:1" }] ,expectedReviewStateHash:current(w) });
  appendReporterOperations(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot, operations:[{ op:"replace", wordId:"job1:word:2", text:"two" }] ,expectedReviewStateHash:current(w) });
  const overlay = readReporterOverlay(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot });
  assert.deepEqual(overlay.operations.map(operation => operation.op),["delete","replace"]);
});

test("undo removes the last atomic reporter transaction from disk",t=>{
  const w = workspace(t);
  appendReporterOperations(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot, operations:[{ op:"delete", wordId:"job1:word:1" },{ op:"delete", wordId:"job1:word:2" }] ,expectedReviewStateHash:current(w) });
  const { removed } = undoReporterOperation(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot ,expectedReviewStateHash:current(w) });
  assert.deepEqual(removed.map(operation=>operation.wordId),["job1:word:1","job1:word:2"]);
  assert.equal(readReporterOverlay(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot }).operations.length,0);
});

test("atomic undo and redo survive save and reopen",t=>{
  const w=workspace(t);
  appendReporterOperations(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot,operations:[{op:"split",beforeWordId:"job1:word:2"},{op:"label",wordId:"job1:word:2",speakerIdentity:"witness",transcriptRole:"WITNESS"}],expectedReviewStateHash:current(w) });
  assert.deepEqual(readReporterOverlay(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot}).transactionSizes,[2]);
  undoReporterOperation(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot,expectedReviewStateHash:current(w) });
  assert.equal(readReporterOverlay(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot}).operations.length,0);
  redoReporterOperation(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot,expectedReviewStateHash:current(w) });
  assert.deepEqual(readReporterOverlay(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot}).operations.map(item=>item.op),["split","label"]);
});

test("a stale expected review state refuses the entire transaction",t=>{
  const w=workspace(t);
  const transcript=JSON.parse(fs.readFileSync(w.workingFile,"utf8"));
  const expected=computeReviewStateHash({transcript,overlay:readReporterOverlay(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot})});
  appendReporterOperations(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot,operations:{op:"delete",wordId:"job1:word:1"},expectedReviewStateHash:expected});
  assert.throws(()=>appendReporterOperations(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot,operations:{op:"delete",wordId:"job1:word:2"},expectedReviewStateHash:expected}),error=>error.code===STALE_REPORTER_TRANSACTION);
  assert.deepEqual(readReporterOverlay(ROOT,{depositionId:w.depositionId,storageRoot:w.storageRoot}).operations.map(item=>item.wordId),["job1:word:1"]);
});

test("an invalid operation is refused and nothing is written",t=>{
  const w = workspace(t);
  assert.throws(()=>appendReporterOperations(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot, operations:[{ op:"nonsense" }] }));
  assert.equal(fs.existsSync(w.overlayFile),false,"a rejected batch must leave no partial file");
});

test("a corrupt overlay is refused rather than silently reset",t=>{
  // Resetting would discard a reporter's corrections without telling them, which is worse than
  // refusing to open the screen.
  const w = workspace(t);
  fs.writeFileSync(w.overlayFile, JSON.stringify({ schemaVersion:"0.0.1", operations:[] }));
  assert.throws(()=>readReporterOverlay(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot }),/invalid or unsupported/);
});

test("writing is atomic: no temp file is left behind",t=>{
  const w = workspace(t);
  writeReporterOverlay(ROOT,{ depositionId:w.depositionId, storageRoot:w.storageRoot, overlay:{ schemaVersion:"1.0.0", recordType:"REPORTER_OVERLAY", depositionId:w.depositionId, operations:[] } });
  const stray = fs.readdirSync(path.dirname(w.overlayFile)).filter(name => name.includes(".tmp"));
  assert.deepEqual(stray,[]);
});
