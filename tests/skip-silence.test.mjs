import assert from "node:assert/strict";
import test from "node:test";
import { skipSilenceTarget } from "../server/speech-segments.mjs";

test("skip-silence-advances-past-silence-segments",()=>{const segments=[{startSec:0,endSec:3,kind:"speech"},{startSec:3,endSec:7,kind:"silence"},{startSec:7,endSec:10,kind:"speech"},{startSec:10,endSec:14,kind:"silence"}];assert.equal(skipSilenceTarget(2,segments),2);assert.equal(skipSilenceTarget(3,segments),7);assert.equal(skipSilenceTarget(8,segments),8);assert.equal(skipSilenceTarget(12,segments),14)});
