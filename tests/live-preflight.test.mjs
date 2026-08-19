import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {armPreflight,confirmPlayback,createPreflight,runTestCapture,_testing,PREFLIGHT_STATES} from "../server/live-preflight.mjs";
const sources=[{id:"ch1",deviceId:"mic-a",role:"LOCAL"},{id:"ch2",deviceId:"mix-a",role:"REMOTE"}];
test("preflight lifecycle is explicit and ordered",()=>assert.deepEqual(PREFLIGHT_STATES,["NOT_TESTED","TEST_CAPTURED","PLAYBACK_CONFIRMED","ARMED"]));
test("changing any selected device invalidates the tested signature",()=>{const before=_testing.signature(sources),after=_testing.signature([{...sources[0],deviceId:"mic-b"},sources[1]]);assert.notEqual(before,after)});
test("roles and arbitrary N-channel identity contribute to readiness",()=>{assert.notEqual(_testing.signature(sources),_testing.signature([...sources,{id:"ch3",deviceId:"aux",role:"AUX"}]))});
function fixture(){const storageRoot=fs.mkdtempSync(path.join(os.tmpdir(),"depo-preflight-")),folder=path.join(storageRoot,"r","c","w");fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,"deposition.json"),JSON.stringify({id:"DEP-20260818-PF002",caseStyle:"A",witness:"B"}));return{storageRoot,folder}}
test("simulated N-channel signal completes the local-only readiness lifecycle",async()=>{const {storageRoot}=fixture(),depositionId="DEP-20260818-PF002",created=createPreflight(process.cwd(),{depositionId,storageRoot,sources});const tested=await runTestCapture(process.cwd(),{depositionId,preflightId:created.preflightId,storageRoot,captureFn:async(_device,file)=>{fs.writeFileSync(file,Buffer.alloc(128));return{rmsDb:-28,peakDb:-4}}});assert.equal(tested.state,"TEST_CAPTURED");assert.equal(tested.checks.audioReceived,true);assert.equal(confirmPlayback(process.cwd(),{depositionId,preflightId:created.preflightId,storageRoot}).state,"PLAYBACK_CONFIRMED");assert.equal(armPreflight(process.cwd(),{depositionId,preflightId:created.preflightId,storageRoot,minFreeBytes:1}).state,"ARMED");fs.rmSync(storageRoot,{recursive:true,force:true})});
test("no-signal on any independent source prevents arming",async()=>{const {storageRoot}=fixture(),depositionId="DEP-20260818-PF002",created=createPreflight(process.cwd(),{depositionId,storageRoot,sources});await runTestCapture(process.cwd(),{depositionId,preflightId:created.preflightId,storageRoot,captureFn:async(device,file)=>{fs.writeFileSync(file,Buffer.alloc(128));return device==="mix-a"?{rmsDb:-90,peakDb:-80}:{rmsDb:-30,peakDb:-5}}});confirmPlayback(process.cwd(),{depositionId,preflightId:created.preflightId,storageRoot});assert.throws(()=>armPreflight(process.cwd(),{depositionId,preflightId:created.preflightId,storageRoot,minFreeBytes:1}),/Cannot arm:.*measured/);fs.rmSync(storageRoot,{recursive:true,force:true})});

test("refusing to arm names the source, the device and the level it measured",async()=>{
  // The number was already measured and was not being said, which turned a five-second diagnosis
  // into a guess between a muted microphone, a wrong device, a privacy setting and a bug.
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const PF = await import("../server/live-preflight.mjs");
  const { SIGNAL_FLOOR_DB } = await import("../server/live-capture.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-armmsg-"));
  try {
    const storageRoot = path.join(root, "depos"), directory = path.join(storageRoot, "r", "c", "d");
    const id = "DEP-20260819-ARMER";
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id }));
    const created = PF.createPreflight(null, { depositionId: id, storageRoot, sources: [
      { id: "ch1", role: "WITNESS", deviceId: "m", deviceName: "Razer Seiren V3 Mini" },
      { id: "ch2", role: "VIRTUAL_MEETING_AUDIO", deviceId: "x", deviceName: "Stereo Mix (Realtek(R) Audio)" },
    ] });
    const captureFn = async (deviceId, file) => { fs.writeFileSync(file, Buffer.alloc(64)); return { rmsDb: deviceId === "m" ? -35.2 : -93.3, peakDb: -20 }; };
    await PF.runTestCapture(null, { depositionId: id, preflightId: created.preflightId, storageRoot, captureFn });
    PF.confirmPlayback(null, { depositionId: id, preflightId: created.preflightId, storageRoot });

    assert.throws(() => PF.armPreflight(null, { depositionId: id, preflightId: created.preflightId, storageRoot }), error => {
      assert.match(error.message, /VIRTUAL MEETING AUDIO/, "which source failed");
      assert.match(error.message, /Stereo Mix \(Realtek\(R\) Audio\)/, "which device it was");
      assert.match(error.message, /-93\.3 dB/, "and what it actually measured");
      assert.match(error.message, new RegExp(`${SIGNAL_FLOOR_DB} dB`), "against the threshold it had to clear");
      assert.equal(/Razer/.test(error.message), false, "the source that was fine is not named");
      return true;
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("preflight runs for a recording that has no deposition yet",async()=>{
  // The defect this closes: sessionPaths was taught to work without a deposition and preflight's
  // own path helper was not, so createPreflight threw "Invalid deposition ID." on the screen. Arming
  // was unreachable for exactly the recordings the change existed to enable, and the message named
  // a deposition the reporter had deliberately not chosen.
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pf-unassigned-"));
  const previous = process.env.DEPO_PRO_DEPOSITIONS_ROOT;
  process.env.DEPO_PRO_DEPOSITIONS_ROOT = root;
  try {
    const PF = await import("../server/live-preflight.mjs");
    const { captureSessionRoot } = await import("../server/storage-config.mjs");
    const sources = [{ id: "local-microphone", role: "LOCAL_MICROPHONE", deviceId: "m", deviceName: "Mic" }];
    const created = PF.createPreflight(null, { depositionId: null, sources });
    assert.equal(created.state, "NOT_TESTED");

    const captureFn = async (deviceId, file) => { fs.writeFileSync(file, Buffer.alloc(64)); return { rmsDb: -35.2, peakDb: -20 }; };
    const tested = await PF.runTestCapture(null, { depositionId: null, preflightId: created.preflightId, captureFn });
    assert.equal(tested.checks.audioReceived, true);
    assert.equal(PF.confirmPlayback(null, { depositionId: null, preflightId: created.preflightId }).state, "PLAYBACK_CONFIRMED");
    assert.equal(PF.armPreflight(null, { depositionId: null, preflightId: created.preflightId }).state, "ARMED");

    // It stores beside the sessions, not inside a deposition it does not have.
    assert.ok(fs.existsSync(path.join(captureSessionRoot(), "preflight", created.preflightId)));
    // And the arm gate is unchanged for an unassigned recording.
    const dead = PF.createPreflight(null, { depositionId: null, sources });
    await PF.runTestCapture(null, { depositionId: null, preflightId: dead.preflightId, captureFn: async (deviceId, file) => { fs.writeFileSync(file, Buffer.alloc(64)); return { rmsDb: -96.7, peakDb: -90 }; } });
    PF.confirmPlayback(null, { depositionId: null, preflightId: dead.preflightId });
    assert.throws(() => PF.armPreflight(null, { depositionId: null, preflightId: dead.preflightId }), /Cannot arm:.*-96\.7 dB/);
  } finally {
    if (previous === undefined) delete process.env.DEPO_PRO_DEPOSITIONS_ROOT; else process.env.DEPO_PRO_DEPOSITIONS_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
