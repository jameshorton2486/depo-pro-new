import assert from "node:assert/strict";
import test from "node:test";
import {buildDeepgramLiveUrl,_testing} from "../server/deepgram-live.mjs";
test("streaming configuration uses raw mono PCM and preserves verbatim features",()=>{const url=new URL(buildDeepgramLiveUrl({role:"LOCAL_MICROPHONE"}));assert.equal(url.origin,"wss://api.deepgram.com");assert.equal(url.pathname,"/v1/listen");assert.equal(url.searchParams.get("encoding"),"linear16");assert.equal(url.searchParams.get("sample_rate"),"16000");assert.equal(url.searchParams.get("channels"),"1");assert.equal(url.searchParams.get("interim_results"),"true");assert.equal(url.searchParams.get("filler_words"),"true");assert.equal(url.searchParams.get("profanity_filter"),"false");assert.equal(url.searchParams.has("diarize_model"),false)});
test("shared remote channel enables streaming diarization without conflating channel identity",()=>{const url=new URL(buildDeepgramLiveUrl({role:"VIRTUAL_MEETING_AUDIO"}));assert.equal(url.searchParams.get("diarize_model"),"latest")});
test("interim text is ephemeral while finalized events retain channel plus speaker",()=>{const source={id:"meeting-audio",role:"VIRTUAL_MEETING_AUDIO"},payload={type:"Results",is_final:true,speech_final:false,channel_index:[0,1],start:2,duration:1,channel:{alternatives:[{transcript:"Um, yes.",words:[{word:"um",punctuated_word:"Um,",start:2,end:2.2,confidence:.9,speaker:3}]}]}};const event=_testing.normalizedEvent(source,2,payload);assert.equal(event.type,"FINAL");assert.equal(event.channelId,"meeting-audio");assert.equal(event.words[0].speaker,3);assert.equal(event.words[0].punctuatedWord,"Um,")});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {startDeepgramLive,stopDeepgramLive} from "../server/deepgram-live.mjs";

/** A capture session already recording, which is the only state Deepgram may start from. */
function recordingFixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-dgstop-"));
  const storageRoot=path.join(root,"depos"),directory=path.join(storageRoot,"r","c","d");
  const sessionId="LIVE-20260819000000-AAAAAA",depositionId="DEP-20260819-DGSTP";
  fs.mkdirSync(path.join(directory,"live-capture",sessionId),{recursive:true});
  fs.writeFileSync(path.join(directory,"deposition.json"),JSON.stringify({id:depositionId}));
  fs.writeFileSync(path.join(directory,"live-capture",sessionId,"capture-session.json"),JSON.stringify({
    sessionId,depositionId,state:"RECORDING",
    sources:[{id:"ch1",role:"WITNESS",deviceId:"mic",state:"RECORDING"}],
  }));
  return {root,storageRoot,depositionId,sessionId};
}

function fakes(){
  const handlers={},exits=[];
  class Socket{
    static OPEN=1;
    constructor(){this.readyState=1;this.binaryType="";}
    on(event,fn){handlers[event]=fn;return this}
    send(){} close(){}
  }
  const spawnProcess=()=>({
    stdout:{on(){}}, stderr:{on(){}},
    once:(event,fn)=>{if(event==="exit")exits.push(fn)},
    kill(){for(const fn of exits)fn(1);},   // a killed ffmpeg exits non-zero, as it does in practice
  });
  return {Socket,spawnProcess,handlers,exits};
}

test("stopping Deepgram does not record the shutdown as an error",async()=>{
  // Every clean stop reported "Deepgram reported 1 error" because the feed was killed while the
  // record still said OPEN, and a killed ffmpeg exits non-zero. On the one screen where an error
  // might be the microphone dying, that trains a reporter to ignore errors.
  const value=recordingFixture(),{Socket,spawnProcess,handlers}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();                       // the socket opens and the feed process starts
    const closed=await stopDeepgramLive(null,{sessionId:value.sessionId});
    assert.equal(closed.state,"CLOSED");
    assert.deepEqual(closed.errors,[],"a normal stop is not a fault");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("a feed that dies on its own is still reported",async()=>{
  // The guard is per connection, not a session-wide mute, so a channel that genuinely fails while
  // the session is running is still a real failure.
  const value=recordingFixture(),{Socket,spawnProcess,handlers,exits}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();
    for(const fn of exits)fn(1);           // the feed dies unprompted, before any stop
    const closed=await stopDeepgramLive(null,{sessionId:value.sessionId});
    assert.equal(closed.errors.length,1);
    assert.equal(closed.errors[0].kind,"DERIVATIVE_EXIT");
    assert.match(closed.errors[0].message,/exited unexpectedly with code 1/);
    assert.match(closed.errors[0].message,/local recording is unaffected/,"and says what it does not mean");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});
