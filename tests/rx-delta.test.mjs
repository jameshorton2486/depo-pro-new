import assert from "node:assert/strict";
import test from "node:test";
import { compareRxMeasurements } from "../server/rx-delta.mjs";

test("RX delta distinguishes resolved and worsened measurements", () => {
  const result=compareRxMeasurements(
    {meanVolumeDb:-35,lowFrequencyMeanDb:-43,dynamicRangeDb:20,clippedSampleCount:0},
    {meanVolumeDb:-23,lowFrequencyMeanDb:-43,dynamicRangeDb:40,clippedSampleCount:20},
  );
  assert.equal(result.find(item=>item.id==="lowFrequencyEnergy").status,"resolved");
  assert.equal(result.find(item=>item.id==="level").status,"resolved");
  assert.equal(result.find(item=>item.id==="dynamicRange").status,"worsened");
  assert.equal(result.find(item=>item.id==="clipping").status,"worsened");
});

test("original clipping is retained as evidence when processing conceals it", () => {
  const clipping=compareRxMeasurements({clippedSampleCount:100},{clippedSampleCount:0}).find(item=>item.id==="clipping");
  assert.equal(clipping.status,"concealed");
  assert.match(clipping.note,/original-recording defect/);
});
