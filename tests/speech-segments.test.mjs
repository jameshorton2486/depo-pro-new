import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSpeechSegments,detectSpeechSegments,SPEECH_DETECTION_PARAMETERS } from "../server/speech-segments.mjs";

function writeWav(file,{durationSec=5,silent=[]}={}){const rate=16000,frames=rate*durationSec,data=Buffer.alloc(frames*2);for(let index=0;index<frames;index++){const time=index/rate,isSilent=silent.some(([start,end])=>time>=start&&time<end),sample=isSilent?0:.01*Math.sin(2*Math.PI*440*time);data.writeInt16LE(Math.round(sample*32767),index*2)}const wav=Buffer.alloc(44+data.length);wav.write("RIFF",0);wav.writeUInt32LE(36+data.length,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(data.length,40);data.copy(wav,44);fs.writeFileSync(file,wav)}

test("segments-tile-full-duration",()=>{const segments=buildSpeechSegments(20,[{startSec:3,endSec:7},{startSec:12,endSec:18}],SPEECH_DETECTION_PARAMETERS);assert.equal(segments[0].startSec,0);assert.equal(segments.at(-1).endSec,20);for(let index=1;index<segments.length;index++)assert.equal(segments[index-1].endSec,segments[index].startSec)});

test("quiet-speech-not-marked-silent",async t=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),"depo-speech-")),file=path.join(directory,"quiet.wav");t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));writeWav(file);const result=await detectSpeechSegments(file);assert.deepEqual(result.segments,[{startSec:0,endSec:5,kind:"speech"}])});

test("padding-applied",()=>{const silence=buildSpeechSegments(10,[{startSec:2,endSec:8}],SPEECH_DETECTION_PARAMETERS).find(item=>item.kind==="silence");assert.deepEqual(silence,{startSec:2.3,endSec:7.7,kind:"silence"})});

test("short-pause-not-marked-silent",async t=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),"depo-pause-")),file=path.join(directory,"pause.wav");t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));writeWav(file,{silent:[[2,3.2]]});const result=await detectSpeechSegments(file);assert.deepEqual(result.segments,[{startSec:0,endSec:5,kind:"speech"}])});
