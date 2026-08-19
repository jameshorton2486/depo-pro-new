import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {createCaptureSession,enumerateWindowsAudioSources,parseDirectShowDevices,_testing} from "../server/live-capture.mjs";

test("DirectShow enumeration retains stable device IDs and recognizes loopback sources",()=>{const text='[dshow] "Microphone (USB)" (audio)\n[dshow]   Alternative name "@device_mic"\n[dshow] "Stereo Mix (Realtek)" (audio)\n[dshow]   Alternative name "@device_mix"';assert.deepEqual(parseDirectShowDevices(text),[{id:"@device_mic",name:"Microphone (USB)",backend:"windows-directshow",kind:"input"},{id:"@device_mix",name:"Stereo Mix (Realtek)",backend:"windows-directshow",kind:"loopback"}])});
test("enumeration reports unsupported platforms honestly",()=>{if(process.platform!=="win32")assert.equal(enumerateWindowsAudioSources().supported,false)});
test("session schema is N-channel and streaming-independent",()=>{const storageRoot=fs.mkdtempSync(path.join(os.tmpdir(),"depo-live-")),folder=path.join(storageRoot,"reporter","cause","witness");fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,"deposition.json"),JSON.stringify({id:"DEP-20260818-ABCDE",caseStyle:"A v. B",witness:"Witness"}));const session=createCaptureSession(process.cwd(),{depositionId:"DEP-20260818-ABCDE",storageRoot,sources:Array.from({length:4},(_,i)=>({id:`ch${i+1}`,role:`ROLE_${i+1}`,deviceId:`device-${i+1}`}))});assert.equal(session.sources.length,4);assert.equal(session.streaming.enabled,false);assert.equal(session.authoritativeAudio,"independent-lossless-local-channels");assert.equal(new Set(session.sources.map(source=>source.id)).size,4);assert.ok(fs.existsSync(path.join(folder,"live-capture",session.sessionId,"capture-session.json")));fs.rmSync(storageRoot,{recursive:true,force:true})});
test("source validation rejects duplicate channel IDs and unsafe device values",()=>{assert.throws(()=>_testing.validateSources([{id:"ch1",deviceId:"a"},{id:"ch1",deviceId:"b"}]),/unique/);assert.throws(()=>_testing.validateSources([{id:"ch1",deviceId:"bad\nname"}]),/valid Windows/)});
test("recording health distinguishes signal, silence, clipping and dropped frames",()=>{const source=_testing.validateSources([{id:"ch1",deviceId:"mic"}])[0];_testing.observeHealth(source,"RMS level dB: -32.5\nPeak level dB: -0.2\nbuffer overrun dropped");assert.equal(source.health.receivedAudio,true);assert.equal(source.health.silence,false);assert.equal(source.health.clipping,true);assert.equal(source.health.droppedFrames,1)});

test("levels are read while the recording runs, not only when it ends",()=>{
  // The defect this closes: astats prints "RMS level dB:" only in its end-of-stream summary, so a
  // recording that runs for hours printed nothing and the meters stayed dead for the whole
  // deposition -- exactly when confidence monitoring matters. Preflight was unaffected because its
  // process runs to completion, which is why this survived until a real capture was run.
  //
  // This is the format ffmpeg actually emitted, taken from a live run against the Razer mic.
  const source = _testing.validateSources([{ id: "ch1", deviceId: "mic" }])[0];
  const streaming = [
    "[Parsed_ametadata_1 @ 000002b8] lavfi.astats.Overall.RMS_level=-56.848448",
    "[Parsed_ametadata_2 @ 000002b8] lavfi.astats.Overall.Peak_level=-39.859849",
    "[Parsed_ametadata_1 @ 000002b8] lavfi.astats.Overall.RMS_level=-34.140563",
    "[Parsed_ametadata_2 @ 000002b8] lavfi.astats.Overall.Peak_level=-11.998626",
  ].join("\n");
  _testing.observeHealth(source, streaming);
  assert.equal(source.health.rmsDb, -34.140563, "the most recent reading wins, which is what a meter shows");
  assert.equal(source.health.peakDb, -11.998626);
  assert.equal(source.health.receivedAudio, true);
  assert.equal(source.health.silence, false);
  assert.equal(source.health.clipping, false);
});

test("the end-of-stream summary is still read, so the final reading is not lost",()=>{
  const source = _testing.validateSources([{ id: "ch1", deviceId: "mic" }])[0];
  _testing.observeHealth(source, "lavfi.astats.Overall.RMS_level=-40.0\n[Parsed_astats_0 @ x] RMS level dB: -12.25\n[Parsed_astats_0 @ x] Peak level dB: -0.10");
  assert.equal(source.health.rmsDb, -12.25);
  assert.equal(source.health.clipping, true);
});

test("the recording filter asks for levels throughout, not a summary at the end",()=>{
  // Asserted on the constant the spawn actually uses, so a future edit that drops the printing
  // filter and silently restores the dead meter fails here.
  assert.match(_testing.LEVEL_FILTER, /astats=metadata=1/);
  assert.match(_testing.LEVEL_FILTER, /ametadata=mode=print:key=lavfi\.astats\.Overall\.RMS_level/);
  assert.match(_testing.LEVEL_FILTER, /ametadata=mode=print:key=lavfi\.astats\.Overall\.Peak_level/);
});

test("the recording process is actually given the level filter",async()=>{
  // The constant being right is not the same as the spawn using it. Without this, keeping the
  // filter defined and quietly dropping it from the arguments restores the dead meter and every
  // other test still passes.
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const { createCaptureSession, startCaptureSession } = await import("../server/live-capture.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-meter-"));
  try {
    const storageRoot = path.join(root, "depos"), directory = path.join(storageRoot, "r", "c", "d");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: "DEP-20260819-METER" }));
    const session = createCaptureSession(null, { depositionId: "DEP-20260819-METER", storageRoot,
      sources: [{ id: "ch1", role: "WITNESS", deviceId: "mic", deviceName: "Mic" }] });

    const spawned = [];
    const spawnProcess = (command, args) => {
      spawned.push({ command, args });
      return { stderr: { on(){} }, once(){}, kill(){} };
    };
    startCaptureSession(null, { depositionId: "DEP-20260819-METER", sessionId: session.sessionId, storageRoot, spawnProcess });

    assert.equal(spawned.length, 1);
    const filterIndex = spawned[0].args.indexOf("-af");
    assert.ok(filterIndex >= 0, "the recording applies an audio filter");
    assert.equal(spawned[0].args[filterIndex + 1], _testing.LEVEL_FILTER, "and it is the one that prints levels while running");
    assert.ok(spawned[0].args.includes("pcm_s24le"), "while still recording losslessly");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
