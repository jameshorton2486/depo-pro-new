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
