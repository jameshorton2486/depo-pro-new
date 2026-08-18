import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertUploadId, parseAudioMeasurements, readAudioAudit, readStoredTranscript, recordTranscription } from "../server/audio-pipeline.mjs";
import { compareTranscripts, DEFAULT_MAX_COMPARISON_WORDS } from "../server/transcript-quality.mjs";

test("clipping remains unmeasured when ffmpeg omits histogram_0db", () => {
  const result=parseAudioMeasurements("Peak level dB: -1.0\nmean_volume: -20.0 dB");
  assert.equal(result.clippedSampleCount,null);
  assert.equal(result.clippingMeasured,false);
});

test("audio intake identifiers reject traversal and accept UUIDs", () => {
  assert.throws(()=>assertUploadId("../../../outside"),/Invalid audio intake identifier/);
  assert.equal(assertUploadId("6253b304-c5aa-4603-8934-7e44e009456f"),"6253b304-c5aa-4603-8934-7e44e009456f");
});

test("transcript comparison retains edit counts with rolling memory", () => {
  const result=compareTranscripts("alpha beta gamma","alpha delta gamma extra");
  assert.deepEqual({substitutions:result.substitutions,deletions:result.deletions,insertions:result.insertions,errors:result.errors},{substitutions:1,deletions:0,insertions:1,errors:2});
});

test("transcript comparison refuses past its bound rather than truncating", () => {
  // Sized from the constant, so raising the bound cannot leave this asserting a stale number --
  // it did assert 5000 until the bound moved. The refusal matters more than the number: a WER
  // measured over a truncated prefix and reported as the transcript's would be a quality claim
  // about text the comparison never saw.
  const oversized=Array.from({length:DEFAULT_MAX_COMPARISON_WORDS+1},()=>"word").join(" ");
  assert.throws(()=>compareTranscripts(oversized,"word"),new RegExp(`limited to ${DEFAULT_MAX_COMPARISON_WORDS} words`));
});

test("a full deposition is inside the comparison bound", () => {
  // The bound exists to stop a runaway, not to stop the job the reporter actually has. A
  // four-hour deposition is about 12,200 words per side.
  assert.ok(DEFAULT_MAX_COMPARISON_WORDS >= 25_000, "a four-hour deposition must compare without an override");
});

test("Deepgram payload is immutable and external to the audit record", async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"transcript-store-")),uploadId=crypto.randomUUID(),operationId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(directory,{recursive:true});
  const audit={schemaVersion:"3.0.0",uploadId,selectedSource:"original",storage:{original:{key:`audio-intake/${uploadId}/original.wav`,sha256:"source",immutable:true},derivatives:[]},transcripts:{},history:[]};
  fs.writeFileSync(path.join(directory,"audit.json"),JSON.stringify(audit));
  const transcript={provider:"deepgram",operationId,requestId:"request",model:"nova-3",createdAt:new Date().toISOString(),transcript:"alpha beta",words:[{word:"alpha"},{word:"beta"}],confidence:.9,keytermCount:0};
  await recordTranscription(root,audit,"original",transcript);
  const saved=readAudioAudit(root,uploadId),metadata=saved.transcripts.original;
  assert.equal("words" in metadata,false);assert.equal(metadata.wordCount,2);assert.match(metadata.path,/\/transcripts\//);
  assert.deepEqual(await readStoredTranscript(root,saved,"original"),transcript);
  assert.throws(()=>fs.writeFileSync(path.join(root,"data",metadata.path),"replacement",{flag:"wx"}),/exist/i);
});
