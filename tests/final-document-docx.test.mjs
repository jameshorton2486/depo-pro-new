import test from "node:test";
import assert from "node:assert/strict";
import { createFixedPageDocxSpec } from "../server/final-document-docx.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../server/texas-freelance-deposition-profile.mjs";

test("fixed-page DOCX spec retains all modeled lines and trace identities",()=>{
  const lines=Array.from({length:25},(_,index)=>({position:index+1,content:index?"":"    Q.    Synthetic question?",occupied:index===0,paragraphId:index?null:"p1",fragments:index?[]:[{id:"w1",sourceWordId:"e1"}]}));
  const spec=createFixedPageDocxSpec({modelHash:"model",source:{reviewStateHash:"review"},layoutProfile:TEXAS_FREELANCE_DEPOSITION_V1,pages:[{id:"page-1",pageNumber:1,lines}]});
  assert.equal(spec.renderer,"DEPO_PRO_INTERNAL_FIXED_PAGE_OOXML_V1");assert.equal(spec.pages[0].lines.length,25);assert.deepEqual(spec.pages[0].lines[0].sourceWordIds,["e1"]);assert.equal(spec.profile.text.widthTwips,9122);
});

test("fixed-page DOCX boundary refuses another profile",()=>assert.throws(()=>createFixedPageDocxSpec({layoutProfile:{id:"other"},pages:[]}),/FIXED_DOCX_PROFILE_REQUIRED/));
