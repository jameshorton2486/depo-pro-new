import assert from "node:assert/strict";
import test from "node:test";
import { chooseAsrSource } from "../server/asr-selection.mjs";
test("candidate wins only with a conservative advantage",()=>{assert.equal(chooseAsrSource({transcript:"Jane Doe",confidence:.80,words:[1,2]},{transcript:"Jane Doe",confidence:.83,words:[1,2]},["Jane Doe"]).winner,"processed")});
test("original wins when candidate loses a critical term",()=>{assert.equal(chooseAsrSource({transcript:"Jane Doe did not",confidence:.80,words:[1,2,3,4]},{transcript:"Jane did not",confidence:.90,words:[1,2,3]},["Jane Doe"]).winner,"original")});
test("original wins on a tie",()=>{assert.equal(chooseAsrSource({transcript:"test",confidence:.80,words:[1]},{transcript:"test",confidence:.80,words:[1]},[]).winner,"original")});
