import test from "node:test";
import assert from "node:assert/strict";
import { TEXAS_FREELANCE_DEPOSITION_V1 as profile } from "../server/texas-freelance-deposition-profile.mjs";

test("Profile B production constants retain the Word-proven precision",()=>{
  assert.equal(profile.id,"TEXAS_FREELANCE_DEPOSITION_V1");
  assert.deepEqual(profile.formatBox,{leftInches:1.4333,rightClearanceInches:0.5317,widthInches:6.535,topInches:1,heightInches:8.6667,borderPoints:1});
  assert.deepEqual({left:profile.text.leftMarginTwips,right:profile.text.rightMarginTwips,width:profile.text.widthTwips},{left:2208,right:910,width:9122});
  assert.equal(profile.charactersPerLine,63);assert.equal(profile.linesPerPage,25);
});

test("proof choices are not mislabeled as UFM requirements",()=>{
  assert.equal(profile.authority.formatBox.authority,"PROFILE_B_WORD_PROVEN");
  assert.equal(profile.authority.font.authority,"DEPO_PRO_IMPLEMENTATION_CHOICE");
  assert.equal(profile.authority.lineSpacing.authority,"PROFILE_B_WORD_PROVEN");
  assert.equal(profile.authority.charactersPerLine.authority,"UFM_DERIVED");
});
