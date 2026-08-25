import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { appendTransaction, emptyOverlay, redoLastTransaction, undoLastTransaction, validateOverlay } from "../server/reporter-overlay.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const render=overlay=>renderTranscript({working:WORKING,evidence:[EVIDENCE],speakerCandidates:SPEAKER_CANDIDATES,examinerIdentity:"counsel-bentley",overlay});

test("stable paragraph identities survive an unrelated earlier split",()=>{
  const before=render(emptyOverlay("DEP"));
  const target=before.paragraphs.at(-1);
  const early=before.paragraphs.find(paragraph=>paragraph.asrWordIds.length>2);
  const overlay=appendTransaction(emptyOverlay("DEP"),{op:"split",beforeWordId:early.asrWordIds[1]});
  const after=render(overlay);
  const same=after.paragraphs.find(paragraph=>paragraph.asrWordIds.includes(target.asrWordIds[0]));
  assert.equal(same.id,target.id);
  assert.equal(same.id,`paragraph:${target.asrWordIds[0]}`);
});

test("evidence and authored tokens have distinct stable identities after serialization",()=>{
  const anchor=WORKING.segments[0].asrWordIds[0];
  const overlay=appendTransaction(emptyOverlay("DEP"),{op:"insert",afterWordId:anchor,text:"reporter note"});
  const reloaded=validateOverlay(JSON.parse(JSON.stringify(overlay)),"DEP");
  const words=render(reloaded).paragraphs.flatMap(paragraph=>paragraph.words);
  const evidence=words.find(word=>word.id===anchor);
  const authored=words.find(word=>word.authored);
  assert.deepEqual({tokenId:evidence.tokenId,tokenKind:evidence.tokenKind,sourceWordId:evidence.sourceWordId},{tokenId:anchor,tokenKind:"evidence",sourceWordId:anchor});
  assert.equal(authored.tokenKind,"authored");
  assert.equal(authored.sourceWordId,null);
  assert.equal(authored.tokenId,`overlay:${anchor}:1`);
  assert.equal(EVIDENCE.words.some(word=>word.id===authored.tokenId),false);
});

test("split plus label undo and redo as one atomic action",()=>{
  const anchor=WORKING.segments.find(segment=>segment.asrWordIds.length>2).asrWordIds[1];
  const edited=appendTransaction(emptyOverlay("DEP"),[
    {op:"split",beforeWordId:anchor},
    {op:"label",wordId:anchor,speakerIdentity:"counsel-ramon",transcriptRole:"DEFENDING_ATTORNEY"},
  ]);
  assert.deepEqual(edited.transactionSizes,[2]);
  const undone=undoLastTransaction(edited);
  assert.equal(undone.overlay.operations.length,0);
  assert.equal(undone.removed.length,2);
  const redone=redoLastTransaction(undone.overlay);
  assert.deepEqual(redone.overlay.operations,edited.operations);
  assert.deepEqual(redone.overlay.transactionSizes,[2]);
});

test("a new transaction clears redo history",()=>{
  const one=appendTransaction(emptyOverlay("DEP"),{op:"delete",wordId:"word:1"});
  const undone=undoLastTransaction(one).overlay;
  assert.equal(undone.redoTransactions.length,1);
  const replacement=appendTransaction(undone,{op:"delete",wordId:"word:2"});
  assert.deepEqual(replacement.redoTransactions,[]);
});

test("legacy overlays load without migration and preserve rendered operation order",()=>{
  const legacy={schemaVersion:"1.0.0",recordType:"REPORTER_OVERLAY",depositionId:"DEP",operations:[
    {op:"delete",wordId:"word:1"},{op:"replace",wordId:"word:2",text:"two"},
  ]};
  const normalized=validateOverlay(legacy,"DEP");
  assert.equal(normalized.schemaVersion,"2.0.0");
  assert.deepEqual(normalized.transactionSizes,[1,1]);
  assert.deepEqual(normalized.operations.map(operation=>operation.op),["delete","replace"]);
});
