import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { measureAudioQuality } from "../server/audio-pipeline.mjs";

function writeFixture(file){
  const rate=16000,frames=rate*2,data=Buffer.alloc(frames*2);
  for(let i=0;i<frames;i++){let sample=.12*Math.sin(2*Math.PI*60*i/rate)+.04*Math.sin(2*Math.PI*5000*i/rate);if(i===4000||i===18000)sample=.95;data.writeInt16LE(Math.round(sample*32767),i*2)}
  const wav=Buffer.alloc(44+data.length);wav.write("RIFF",0);wav.writeUInt32LE(36+data.length,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(data.length,40);data.copy(wav,44);fs.writeFileSync(file,wav);
}

test("synthetic fixture yields bounded hum, impulse, and fricative measurements",async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"depo-audio-measure-")),file=path.join(directory,"fixture.wav");
  try{writeFixture(file);const result=await measureAudioQuality(file);assert.equal(result.humLineFrequencyHz,60);assert.ok(Number.isFinite(result.humHarmonicMeanDb));assert.ok(result.impulseCount>=2);assert.ok(Number.isFinite(result.fricativeBandMeanDb))}finally{fs.rmSync(directory,{recursive:true,force:true})}
});
