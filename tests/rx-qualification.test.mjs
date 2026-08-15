import assert from "node:assert/strict";
import test from "node:test";
import { findTransients, measureAlignment } from "../server/rx-qualification.mjs";

// Synthetic signals, so the detection maths is covered without the audio fixture. The gated
// suite in rx-qualification.integration.test.mjs exercises the same functions against real
// RX output once a fixture and installed plug-ins are present.
function withImpulses(frames, positions, { amplitude = 20000, shift = 0 } = {}) {
  const samples = new Int16Array(frames);
  for (let index = 0; index < frames; index += 1) samples[index] = Math.round(Math.sin(index / 32) * 400); // room tone
  for (const position of positions) { const at = position + shift; if (at >= 0 && at < frames) samples[at] = amplitude; }
  return samples;
}

test("transient detection reports one frame per impulse, not one per loud sample",()=>{
  const positions=[0,48000,144000,480000];
  assert.deepEqual(findTransients(withImpulses(520000,positions)),positions);
});

test("transient detection collapses a cluster to its strongest sample",()=>{
  const samples=withImpulses(100000,[50000]);
  samples[50001]=25000; samples[50002]=24000;
  assert.deepEqual(findTransients(samples),[50001]);
});

test("alignment reports zero offset for an unshifted derivative",()=>{
  const positions=[0,48000,144000],source=withImpulses(200000,positions);
  const result=measureAlignment(source,withImpulses(200000,positions));
  assert.equal(result.aligned,true);
  assert.equal(result.markers,3);
  assert.equal(result.maxAbsoluteOffsetFrames,0);
  assert.equal(result.constantOffset,0);
});

test("alignment reports the measured offset in frames rather than a bare failure",()=>{
  // A plug-in with 512 samples of uncompensated latency. Frame parity would still pass:
  // the length is identical, only the position moved. This is the case the protocol exists
  // to catch, and the number is the diagnosis -- constant means compensable.
  const positions=[48000,144000,192000],source=withImpulses(300000,positions);
  const result=measureAlignment(source,withImpulses(300000,positions,{shift:512}));
  assert.equal(result.aligned,false);
  assert.equal(result.maxAbsoluteOffsetFrames,512);
  assert.equal(result.constantOffset,512,"a constant offset is fixed latency and can be compensated deterministically");
  assert.deepEqual(result.offsets.map(item=>item.offsetFrames),[512,512,512]);
});

test("a varying offset is reported as non-constant, because it cannot be compensated",()=>{
  const source=withImpulses(300000,[48000,144000,192000]);
  const derivative=withImpulses(300000,[48000,144000,192000]);
  derivative[144000]=0; derivative[144000+300]=20000; // second marker drifts, others do not
  const result=measureAlignment(source,derivative);
  assert.equal(result.constantOffset,null,"a null constant offset means the shift is variable");
  assert.equal(result.maxAbsoluteOffsetFrames,300);
});

test("alignment on a silent fixture reports no markers rather than a false pass",()=>{
  const silent=new Int16Array(48000);
  const result=measureAlignment(silent,silent);
  assert.equal(result.markers,0);
  assert.equal(result.aligned,false,"no markers must not read as aligned");
  assert.equal(result.maxAbsoluteOffsetFrames,null);
});
