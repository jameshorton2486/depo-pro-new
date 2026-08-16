import assert from "node:assert/strict";
import test from "node:test";
import { findTransients, measureAlignment, measureMarkerSurvival, measureStableGlobalAlignment } from "../server/rx-qualification.mjs";

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

// The global correlator finds its coarse estimate on a decimated amplitude ENVELOPE, so the
// signal must have envelope structure for it to work -- real room tone, table noise and
// speech all do. A signal of constant amplitude gives a flat envelope, the coarse stage
// lands on 0, and the fine refinement window (bounded to +/-2 decimation steps around it)
// cannot reach a larger true lag.
function modulated(frames, { shift = 0 } = {}) {
  let state = 4242;
  const noise = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return (state / 0xffffffff) * 2 - 1; };
  const base = new Float64Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const level = 0.25 + 0.75 * Math.abs(Math.sin(index / 21000));
    base[index] = level * (noise() * 4000 + Math.sin(index / 17) * 900);
  }
  const out = new Int16Array(frames);
  for (let index = 0; index < frames; index += 1) { const from = index - shift; out[index] = from >= 0 && from < frames ? Math.round(base[from]) : 0; }
  return out;
}

test("stable global alignment agrees across search widths for a real shift",()=>{
  const source=modulated(400000);
  const shifted=modulated(400000,{shift:512});
  const same=measureStableGlobalAlignment(source,source,{searches:[8192,20000]});
  assert.equal(same.stable,true);
  assert.equal(same.offsetFrames,0);
  assert.equal(same.aligned,true);
  const moved=measureStableGlobalAlignment(source,shifted,{searches:[8192,20000]});
  assert.equal(moved.stable,true);
  assert.equal(moved.offsetFrames,512);
  assert.equal(moved.aligned,false,"a real shift is a measurement, not an alignment");
});

test("an offset that moves with the search width is reported as indeterminate, not as a shift",()=>{
  // The De-click and De-reverb case. Their whole-file correlation returned -90 at +/-8192
  // and +31931 at +/-48000, and 6506 versus 9727 respectively. Input and output are not
  // related by a time shift at all, so neither number is a latency and neither may be
  // recorded as one.
  let state=7;
  const noise=()=>{state^=state<<13;state>>>=0;state^=state>>>17;state^=state<<5;state>>>=0;return Math.round((state/0xffffffff)*2000-1000)};
  const source=new Int16Array(400000), unrelated=new Int16Array(400000);
  for(let index=0;index<400000;index+=1){source[index]=noise();unrelated[index]=noise()}
  const result=measureStableGlobalAlignment(source,unrelated,{searches:[8192,20000]});
  assert.equal(result.stable,false);
  assert.equal(result.indeterminate,true);
  assert.equal(result.offsetFrames,null,"no offset may be reported when the estimate is not stable");
  assert.equal(result.aligned,false);
  assert.match(result.note,/not a time shift/);
});

test("marker survival is measured in the output, not assumed from the fixture",()=>{
  const positions=[48000,144000];
  const source=withImpulses(200000,positions);
  // A module that removed the markers entirely: validating them against the source said
  // nothing about whether a marker measurement taken here means anything.
  const stripped=withImpulses(200000,[]);
  const survived=measureMarkerSurvival(source,source);
  assert.deepEqual(survived.map(item=>item.retention),[1,1]);
  const removed=measureMarkerSurvival(source,stripped);
  assert.equal(removed.length,2);
  assert.ok(removed.every(item=>item.retention<0.1),`a destroyed marker must show near-zero retention, got ${JSON.stringify(removed.map(item=>item.retention))}`);
});

test("marker survival reports partial attenuation rather than a pass or fail",()=>{
  const source=withImpulses(200000,[48000],{amplitude:20000});
  const attenuated=withImpulses(200000,[48000],{amplitude:6000});
  const [marker]=measureMarkerSurvival(source,attenuated);
  assert.ok(marker.retention>0.25&&marker.retention<0.35,`expected roughly 0.3 retention, got ${marker.retention}`);
});
