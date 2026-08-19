import assert from "node:assert/strict";
import test from "node:test";
import {buildDeepgramLiveUrl,_testing} from "../server/deepgram-live.mjs";
test("streaming configuration uses raw mono PCM and preserves verbatim features",()=>{const url=new URL(buildDeepgramLiveUrl({role:"LOCAL_MICROPHONE"}));assert.equal(url.origin,"wss://api.deepgram.com");assert.equal(url.pathname,"/v1/listen");assert.equal(url.searchParams.get("encoding"),"linear16");assert.equal(url.searchParams.get("sample_rate"),"16000");assert.equal(url.searchParams.get("channels"),"1");assert.equal(url.searchParams.get("interim_results"),"true");assert.equal(url.searchParams.get("filler_words"),"true");assert.equal(url.searchParams.get("profanity_filter"),"false");assert.equal(url.searchParams.get("diarize"),"true","a room microphone carries several voices; see SHARED_ROLES")});
test("shared remote channel enables streaming diarization without conflating channel identity",()=>{const url=new URL(buildDeepgramLiveUrl({role:"VIRTUAL_MEETING_AUDIO"}));assert.equal(url.searchParams.has("diarize_model"),false,"Nova-3 rejects diarize_model with HTTP 400")});
test("interim text is ephemeral while finalized events retain channel plus speaker",()=>{const source={id:"meeting-audio",role:"VIRTUAL_MEETING_AUDIO"},payload={type:"Results",is_final:true,speech_final:false,channel_index:[0,1],start:2,duration:1,channel:{alternatives:[{transcript:"Um, yes.",words:[{word:"um",punctuated_word:"Um,",start:2,end:2.2,confidence:.9,speaker:3}]}]}};const event=_testing.normalizedEvent(source,2,payload);assert.equal(event.type,"FINAL");assert.equal(event.channelId,"meeting-audio");assert.equal(event.words[0].speaker,3);assert.equal(event.words[0].punctuatedWord,"Um,")});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {getDeepgramLive,startDeepgramLive,stopDeepgramLive} from "../server/deepgram-live.mjs";

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
  return {root,storageRoot,depositionId,sessionId,directory};
}

function fakes(){
  const handlers={},exits=[];
  const built=[];
  class Socket{
    static OPEN=1;
    constructor(){this.readyState=1;this.binaryType="";built.push(this);}
    on(event,fn){handlers[event]=fn;return this}
    send(){} close(){}
  }
  const spawnProcess=()=>({
    stdout:{on(){}}, stderr:{on(){}},
    once:(event,fn)=>{if(event==="exit")exits.push(fn)},
    kill(){for(const fn of exits)fn(1);},   // a killed ffmpeg exits non-zero, as it does in practice
  });
  return {Socket,spawnProcess,handlers,exits,built};
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

test("finalized events append rather than rewriting the whole record",async()=>{
  // Measured at the real event rate, an eight-hour deposition rewrote the growing record on every
  // message -- about 35 GB of atomic writes to produce a 10 MB result, getting slower as the day
  // went on. Events are append-only facts, so they append; the manifest is written when state
  // changes.
  const value=recordingFixture(),{Socket,spawnProcess,handlers}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();
    const results=n=>({type:"Results",is_final:true,start:n,duration:1,channel:{alternatives:[{transcript:`line ${n}`,words:[{word:"line",punctuated_word:"line",start:n,end:n+0.4,speaker:0}]}]}});
    for(let n=0;n<5;n++)handlers.message(JSON.stringify(results(n)));

    const dir=path.join(value.directory,"live-capture",value.sessionId);
    const log=path.join(dir,"live-events.jsonl");
    assert.ok(fs.existsSync(log),"an append log exists");
    assert.equal(fs.readFileSync(log,"utf8").trim().split("\n").length,5,"one line per finalized event");

    const during=JSON.parse(fs.readFileSync(path.join(dir,"live-session.json"),"utf8"));
    assert.equal(during.finalizedEvents,undefined,"the manifest no longer carries the events");

    const closed=await stopDeepgramLive(null,{sessionId:value.sessionId});
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,"live-session.json"),"utf8"));
    assert.equal(manifest.finalizedEventCount,5,"it carries the count instead, written when state changes");
    assert.equal(closed.finalizedEvents.length,5,"and the events are still readable through the API");
    assert.deepEqual(closed.finalizedEvents.map(e=>e.transcript),["line 0","line 1","line 2","line 3","line 4"]);
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("a dropped socket reconnects, on a new epoch",async()=>{
  // Over eight hours a drop is close to certain, and a drop used to end that channel's index for
  // good. epoch has been in the schema for this since the beginning and never incremented; a
  // reconnection restarts Deepgram's clock at zero, so a reader must be able to tell which stream
  // a timestamp belongs to.
  const value=recordingFixture(),{Socket,spawnProcess,handlers}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();
    handlers.close(1006,"abnormal");   // the socket drops unprompted

    const dir=path.join(value.directory,"live-capture",value.sessionId);
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,"live-session.json"),"utf8"));
    assert.equal(manifest.state,"RECONNECTING","a drop is not the end");
    const scheduled=manifest.connectionHistory.find(entry=>entry.type==="RECONNECT_SCHEDULED");
    assert.ok(scheduled,"a reconnection is scheduled");
    assert.equal(scheduled.attempt,1);
    assert.ok(scheduled.delayMs>=1000,"with backoff rather than immediately");
    await stopDeepgramLive(null,{sessionId:value.sessionId});
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("stopping cancels a pending reconnect",async()=>{
  const value=recordingFixture(),{Socket,spawnProcess,handlers}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();handlers.close(1006,"abnormal");
    const closed=await stopDeepgramLive(null,{sessionId:value.sessionId});
    assert.equal(closed.state,"CLOSED","a reconnection must not resurrect a stopped session");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

const settle=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test("a dropped socket actually reconnects, on the next epoch",async()=>{
  // The earlier test only proved a reconnection was scheduled, which a mutation that never fires
  // the timer passed happily. This one waits for the backoff and checks the connection came back.
  const value=recordingFixture(),{Socket,spawnProcess,handlers,built}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();
    handlers.close(1006,"abnormal");
    await settle(1300);          // first backoff is one second
    assert.equal(built.length,2,"a fresh socket was constructed for the reconnection");
    handlers.open();             // the new socket opens
    const closed=await stopDeepgramLive(null,{sessionId:value.sessionId});
    const connected=closed.connectionHistory.filter(entry=>entry.type==="CONNECTED");
    assert.equal(connected.length,2,"it connected again after the drop");
    assert.deepEqual(connected.map(entry=>entry.epoch),[1,2],"and the second stream is a new epoch");
    // Deepgram restarts its clock at zero on a new stream, so events must say which one they are on.
    assert.equal(closed.channels[0].epoch,2);
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("a session asked to stop does not reconnect afterwards",async()=>{
  const value=recordingFixture(),{Socket,spawnProcess,handlers,built}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();handlers.close(1006,"abnormal");
    const before=built.length;
    const closed=await stopDeepgramLive(null,{sessionId:value.sessionId});
    await settle(1300);          // past the backoff the drop had scheduled
    assert.equal(built.length,before,"no new socket was constructed after the session stopped");
    assert.equal(closed.state,"CLOSED");
    const manifest=JSON.parse(fs.readFileSync(path.join(value.directory,"live-capture",value.sessionId,"live-session.json"),"utf8"));
    assert.equal(manifest.state,"CLOSED");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("the in-memory tail is bounded while the log keeps everything",async()=>{
  // Eight hours is roughly 7,000 events. Holding them all in the record means every one-second
  // poll serialises the whole day.
  const value=recordingFixture(),{Socket,spawnProcess,handlers}=fakes();
  try{
    startDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot,apiKey:"k",WebSocketClass:Socket,spawnProcess});
    handlers.open();
    for(let n=0;n<450;n++)handlers.message(JSON.stringify({type:"Results",is_final:true,start:n,duration:1,channel:{alternatives:[{transcript:`line ${n}`,words:[{word:"line",punctuated_word:"line",start:n,end:n+0.4,speaker:0}]}]}}));
    const live=getDeepgramLive(null,{depositionId:value.depositionId,sessionId:value.sessionId,storageRoot:value.storageRoot});
    assert.equal(live.finalizedEvents.length,400,"the record holds a bounded tail");
    assert.equal(live.finalizedEvents.at(-1).transcript,"line 449","and the tail is the newest");
    await stopDeepgramLive(null,{sessionId:value.sessionId});
    const log=fs.readFileSync(path.join(value.directory,"live-capture",value.sessionId,"live-events.jsonl"),"utf8").trim().split("\n");
    assert.equal(log.length,450,"while the append log keeps every event");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});
