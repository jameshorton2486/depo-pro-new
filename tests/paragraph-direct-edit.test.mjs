import assert from "node:assert/strict";
import test from "node:test";
import { paragraphEditTransaction, wordCharacterRanges } from "../app/paragraph-edit-transaction.mjs";
import { appendTransaction, applyOverlay, emptyOverlay, redoLastTransaction, undoLastTransaction } from "../server/reporter-overlay.mjs";

const paragraph={id:"paragraph:job:word:1",text:"Good morning, Doctor.",words:[
  {id:"job:word:1",text:"Good",display:"Good"},
  {id:"job:word:2",text:"morning,",display:"morning,"},
  {id:"job:word:3",text:"Doctor.",display:"Doctor."},
]};

test("direct edit maps punctuation and capitalization to one evidence-anchored replacement",()=>{
  assert.deepEqual(paragraphEditTransaction(paragraph,"Good morning, doctor?"),[{op:"replace",wordId:"job:word:3",text:"doctor?"}]);
});

test("direct edit supports insertion at the start, middle, and end without invented evidence ids",()=>{
  assert.deepEqual(paragraphEditTransaction(paragraph,"Well, Good morning, Doctor."),[{op:"insert",beforeWordId:"job:word:1",text:"Well,"}]);
  assert.deepEqual(paragraphEditTransaction(paragraph,"Good very morning, Doctor."),[{op:"insert",afterWordId:"job:word:1",text:"very"}]);
  assert.deepEqual(paragraphEditTransaction(paragraph,"Good morning, Doctor. Thank you."),[{op:"insert",afterWordId:"job:word:3",text:"Thank you."}]);
});

test("selection replacement and deletion are one atomic low-level transaction",()=>{
  assert.deepEqual(paragraphEditTransaction(paragraph,"Good afternoon."),[
    {op:"replace",wordId:"job:word:2",text:"afternoon."},{op:"delete",wordId:"job:word:3"},
  ]);
  const overlay=appendTransaction(emptyOverlay("DEP"),paragraphEditTransaction(paragraph,"Good afternoon."));
  assert.deepEqual(overlay.transactionSizes,[2]);
  const undone=undoLastTransaction(overlay);
  assert.equal(undone.overlay.operations.length,0);
  assert.deepEqual(redoLastTransaction(undone.overlay).overlay.operations,overlay.operations);
});

test("token character ranges retain stable anchors for styled and mixed text",()=>{
  const styled={id:"p",text:"On April 24, 2026 we met.",words:[{id:"w1",display:"On"},{id:"w2",display:"April 24, 2026"},{id:"w3",display:"we"},{id:"w4",display:"met."}]};
  assert.deepEqual(wordCharacterRanges(styled).map(({word,start,end})=>[word.id,start,end]),[["w1",0,2],["w2",3,17],["w3",18,20],["w4",21,25]]);
  assert.deepEqual(paragraphEditTransaction(styled,"On April 24, 2026 we spoke."),[{op:"replace",wordId:"w4",text:"spoke."}]);
});

test("reporter-authored tokens can be corrected and deleted while evidence anchors remain unchanged",()=>{
  const segments=[{id:"s1",asrWordIds:["w1","w2"]}],knownWordIds=new Set(["w1","w2"]);
  let overlay=appendTransaction(emptyOverlay("DEP"),{op:"insert",afterWordId:"w1",text:"authored"});
  let applied=applyOverlay(segments,overlay,{knownWordIds});
  const authored=applied.inserted.get("w1")[0];
  assert.equal(authored.id,"overlay:w1:1");
  overlay=appendTransaction(overlay,{op:"replace",wordId:authored.id,text:"corrected authored"});
  applied=applyOverlay(segments,overlay,{knownWordIds});
  assert.equal(applied.replaced.get(authored.id),"corrected authored");
  overlay=appendTransaction(overlay,{op:"delete",wordId:authored.id});
  assert.ok(applyOverlay(segments,overlay,{knownWordIds}).deleted.has(authored.id));
});

test("new text beside a reporter-authored token remains authored and reuses its stable id",()=>{
  const mixed={id:"p",text:"authored Evidence",words:[{id:"overlay:w1:before:1",text:"authored",authored:true},{id:"w1",text:"Evidence",display:"Evidence"}]};
  assert.deepEqual(paragraphEditTransaction(mixed,"new authored Evidence"),[{op:"replace",wordId:"overlay:w1:before:1",text:"new authored"}]);
  assert.deepEqual(paragraphEditTransaction(mixed,"authored added Evidence"),[{op:"replace",wordId:"overlay:w1:before:1",text:"authored added"}]);
});

test("removing a complete paragraph is deferred as structural editing",()=>{
  assert.throws(()=>paragraphEditTransaction(paragraph,""),/EMPTY_PARAGRAPH/);
});

test("whitespace-only joining is refused as unauthorized structural editing",()=>{
  assert.throws(()=>paragraphEditTransaction(paragraph,"Goodmorning, Doctor."),/STRUCTURAL_WHITESPACE/);
});
