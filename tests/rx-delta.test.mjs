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

test("RX delta measures hum, impulses, and fricative-band retention",()=>{
  const result=compareRxMeasurements(
    {meanVolumeDb:-20,humLineFrequencyHz:60,humHarmonicMeanDb:-30,impulseCount:12,fricativeBandMeanDb:-24},
    {meanVolumeDb:-20,humLineFrequencyHz:60,humHarmonicMeanDb:-42,impulseCount:3,fricativeBandMeanDb:-30},
  );
  assert.equal(result.find(item=>item.id==="humHarmonics").status,"improved");
  assert.equal(result.find(item=>item.id==="impulses").status,"improved");
  assert.equal(result.find(item=>item.id==="fricativeRetention").status,"worsened");
});
