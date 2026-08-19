import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { qualifyProfile, writeQualificationRecord } from "../server/rx-qualification.mjs";

// Gated exactly like the existing RX integration suite: skipped until the plug-ins and a
// disposable fixture are present. DEPO_PRO_RX_QUALIFICATION_OUT, when set, is where the
// records are written so they can become part of a profile's catalog entry.
const enabled = process.env.RUN_RX_INTEGRATION === "1";
const fixture = process.env.DEPO_PRO_RX_TEST_AUDIO ? path.resolve(process.env.DEPO_PRO_RX_TEST_AUDIO) : null;
const output = process.env.DEPO_PRO_RX_QUALIFICATION_OUT ? path.resolve(process.env.DEPO_PRO_RX_QUALIFICATION_OUT) : null;

// Named for the same reason as the module suite: a silent skip here would read as "De-hum is
// qualified" when what it means is "nothing measured it".
const unqualified = !enabled
  ? "RUN_RX_INTEGRATION=1 is required: qualification measures the installed RX 12 plug-ins."
  : !fixture
    ? "DEPO_PRO_RX_TEST_AUDIO must point at the disposable RX fixture; asrSafe stays a prior until it does."
    : false;
const unwritable = unqualified || (!output && "DEPO_PRO_RX_QUALIFICATION_OUT must name a directory for the qualification record.");

// De-hum and De-click first, deliberately. Both carry asrSafe: true in shipped code and are
// selectable by an operator today, so they are the two whose unmeasured status is live
// exposure rather than a future concern.
const FIRST = [["rx12-de-hum-dynamic-v1"], ["rx12-de-click-conservative-v1"]];

for (const profileIds of FIRST) test(`qualification protocol runs against ${profileIds.join("+")}`,{skip:unqualified,timeout:900000},async t=>{
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(),"depo-rx-qual-")); t.after(()=>fs.rmSync(workRoot,{recursive:true,force:true}));
  const record = await qualifyProfile({ fixturePath:fixture, profileIds, workRoot });

  // The record must be complete whether the profile passed or failed. A failing profile that
  // produced no record is indistinguishable from one that was never run, and asrSafe: true
  // stays live in the catalog either way.
  assert.equal(record.qualificationVersion,"rx-qualification-v1");
  assert.deepEqual(record.profileIds,profileIds);
  assert.ok(record.fixture.sha256,"the fixture must be identified by hash");
  assert.ok(Object.values(record.pluginBinarySha256).every(Boolean),"every RX plug-in binary must be hashed");
  assert.ok(record.worker.hostVersion,"Pedalboard version is part of provenance");
  assert.ok(record.worker.numpyVersion,"numpy version is part of provenance");
  assert.ok(record.modules.every(item=>item.pluginVersion),"full plug-in versions must be recorded, not just the major");
  for (const name of ["frameParity","determinism","chunkInvariance","alignment","realTimeFactor"]) assert.ok(record.results[name],`${name} must be present in the record`);
  assert.equal(typeof record.passed,"boolean");

  assert.equal(record.results.determinism.separateProcesses,true,"determinism must be measured across separate worker invocations");
  assert.ok(record.results.frameParity.chunksRun>=30,`the fixture must run the chunk loop many times, ran ${record.results.frameParity.chunksRun}`);
  assert.ok(Number.isFinite(record.results.realTimeFactor.factor),"real-time factor must be measured");
  assert.ok(record.results.alignment.markers>0,"the fixture must carry transient markers for the impulse test");

  if (output) writeQualificationRecord(output,record);

  // Diagnosis, not just a verdict -- a constant offset is compensable latency, a varying one
  // is not, and the distinction decides whether the profile can be salvaged.
  if (!record.passed) t.diagnostic(`FAILED ${profileIds.join("+")}: ${record.failures.join(", ")}; alignment offset frames max=${record.results.alignment.maxAbsoluteOffsetFrames} constant=${record.results.alignment.constantOffset}; rtf=${record.results.realTimeFactor.factor}`);
  t.diagnostic(`${profileIds.join("+")} rtf=${record.results.realTimeFactor.factor?.toFixed(3)} chunks=${record.results.frameParity.chunksRun} markers=${record.results.alignment.markers}`);
});

test("a qualification record is written to disk so it can become part of the catalog entry",{skip:unwritable,timeout:900000},async t=>{
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(),"depo-rx-qual-out-")); t.after(()=>fs.rmSync(workRoot,{recursive:true,force:true}));
  const record = await qualifyProfile({ fixturePath:fixture, profileIds:["rx12-de-hum-dynamic-v1"], workRoot });
  const file = writeQualificationRecord(output,record);
  const written = JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(written.fixture.sha256,record.fixture.sha256);
  assert.equal(written.passed,record.passed);
  assert.ok(written.at,"the record must be dated so it can be flagged stale against a newer plug-in version");
});
