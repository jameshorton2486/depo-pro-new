import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import WebSocket from "ws";
import {depositionDirectory} from "./deposition-store.mjs";
import {getCaptureSession} from "./live-capture.mjs";
import {captureSessionRoot} from "./storage-config.mjs";
import {KEYTERM_PRODUCT_CAP} from "./keyterm-limits.mjs";

export const DEEPGRAM_LIVE_CONFIGURATION_VERSION="deepgram-live-v1.2.0";
// Channels that carry more than one voice, and therefore need diarization to produce turn breaks.
//
// A RULING, 2026-08-19, not a defect. The earlier reasoning was that a dedicated microphone carries
// one voice and diarizing it would invent turns the room never had -- true of a channel assigned to
// one person, and false of the setup this is actually used in: a single microphone covering a room
// with several speakers. Without diarization that channel produces one unbroken block, which is the
// thing the live view exists to avoid.
//
// Roles naming a single participant stay undiarized, because for them the original reasoning holds.
const SHARED_ROLES=new Set(["LOCAL_MICROPHONE","VIRTUAL_MEETING_AUDIO"]);
const active=new Map(),now=()=>new Date().toISOString();
function atomic(file,value){const temp=`${file}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2),{flag:"wx"});fs.renameSync(temp,file)}
function locations(root,depositionId,sessionId,storageRoot){const deposition=depositionId?depositionDirectory(root,depositionId,{storageRoot}):captureSessionRoot();const directory=depositionId?path.join(deposition,"live-capture",sessionId):path.join(deposition,sessionId);return{directory,file:path.join(directory,"live-session.json"),events:path.join(directory,"live-events.jsonl")}}
/**
 * The live socket URL, with the deposition's own names attached.
 *
 * Names are what a deposition turns on, and they are what streaming ASR gets wrong: Etminan,
 * Cukjati, Bardot, Herber are not in any general vocabulary. The batch pass already builds this
 * list from the people the deposition actually has and gets them right; the live index was opening
 * its socket without it and guessing at every one. The list already existed -- nothing passed it.
 *
 * Deepgram takes `keyterm` repeated per term on Nova-3 streaming. The product cap of 50 is well
 * inside Deepgram's 500-token request ceiling, so the cap that applies is Depo-Pro's own.
 *
 * The cap is applied here rather than by the caller. It was enforced in one line in local-api's
 * liveKeyterms, which is correct for the one caller there is and worth nothing against the next
 * one -- and the test that read as covering it asserted only that the constant equals 50, which is
 * true whether or not anything applies it. Removing that line passed the whole suite. Holding the
 * cap in the function that builds the request means no caller can exceed it.
 *
 * An unassigned capture has no deposition and therefore no list. It connects without one rather
 * than failing: recording is the thing that must not be blocked, and a nameless index is still an
 * index.
 */
export function buildDeepgramLiveUrl(source,keyterms=[]){const query=new URLSearchParams({model:"nova-3",language:"en-US",encoding:"linear16",sample_rate:"16000",channels:"1",interim_results:"true",endpointing:"300",punctuate:"true",smart_format:"true",filler_words:"true",profanity_filter:"false",vad_events:"true"});if(SHARED_ROLES.has(source.role))query.set("diarize","true");for(const term of keyterms.slice(0,KEYTERM_PRODUCT_CAP))query.append("keyterm",term);return `wss://api.deepgram.com/v1/listen?${query}`}
function publicRecord(record){return structuredClone(record)}
const EVENTS_IN_MEMORY=400, LINE_END=String.fromCharCode(10);
/*
 * The record used to be rewritten in full on every message, interim results included. Over an
 * eight-hour deposition that is roughly 35 GB of atomic writes to produce a 10 MB result, and each
 * write grows as the day goes on -- the cost rises exactly when the reporter can least afford it.
 *
 * Finalized events are append-only facts, so they append. The manifest carries state, channels,
 * connection history and errors, and is written when one of those changes rather than per word.
 */
function persist(runtime){runtime.record.updatedAt=now();const manifest={...runtime.record};delete manifest.finalizedEvents;atomic(runtime.paths.file,manifest)}
function appendEvent(runtime,event){
  runtime.eventCount=(runtime.eventCount??0)+1;
  fs.appendFileSync(runtime.paths.events,JSON.stringify(event)+LINE_END);
  runtime.record.finalizedEvents.push(event);
  /* The screen shows the tail; the log holds all of it. Without this the in-memory record grows for
     eight hours and every one-second poll serialises the whole thing. */
  const extra=runtime.record.finalizedEvents.length-EVENTS_IN_MEMORY;
  if(extra>0)runtime.record.finalizedEvents.splice(0,extra);
}
/* Finalized events read back from the append log, newest last. */
function readEventLog(file){
  if(!fs.existsSync(file))return[];
  return fs.readFileSync(file,"utf8").split(LINE_END).filter(Boolean);
}

// Deepgram's timestamps are relative to the STREAM, and a reconnection opens a new stream whose
// clock restarts at zero. Left alone, a channel that drops once shows [00:00:03] partway through a
// proceeding -- worse than no timestamp, because it reads as a real position in the recording, and
// locating a moment in the audio is the only job the live text has.
//
// The offset is measured from the channel's FIRST open and recorded when the socket opens, so it is
// persisted evidence rather than the reading machine's clock. It carries the imprecision of a
// wall-clock difference between two connects -- sub-second, against a gap of minutes -- and it is
// the only cross-epoch anchor the stream provides.
//
// Deepgram's own `start` is never touched. The offset is carried alongside it.
function normalizedEvent(source,epoch,payload,sessionOffsetSeconds){const alternative=payload.channel?.alternatives?.[0]??{},words=(alternative.words??[]).map(word=>({word:word.word,punctuatedWord:word.punctuated_word??word.word,start:word.start,end:word.end,confidence:word.confidence,speaker:word.speaker??null}));return{id:crypto.randomUUID(),type:payload.is_final?"FINAL":"INTERIM",receivedAt:now(),epoch,sessionOffsetSeconds,channelId:source.id,channelRole:source.role,channelIndex:payload.channel_index??[0],start:payload.start??null,duration:payload.duration??null,isFinal:Boolean(payload.is_final),speechFinal:Boolean(payload.speech_final),transcript:alternative.transcript??"",words}}
export function startDeepgramLive(root,{depositionId,sessionId,storageRoot,apiKey,keyterms=[],WebSocketClass=WebSocket,spawnProcess=spawn}={}){
  if(!apiKey)throw new Error("Deepgram is not configured. Local recording continues without live text.");
  const capture=getCaptureSession(root,{depositionId,sessionId,storageRoot});
  if(capture.state!=="RECORDING")throw new Error("Local recording must be running before Deepgram Live starts.");
  const paths=locations(root,depositionId,sessionId,storageRoot),record={schemaVersion:"1.0.0",recordType:"REPORTER_LIVE_TRANSCRIPT_AID",configurationVersion:DEEPGRAM_LIVE_CONFIGURATION_VERSION,sessionId,depositionId,state:"CONNECTING",canonicalTranscriptAuthority:false,workingTranscriptWrites:false,sourceOfCanonicalEvidence:false,timeline:{timesRelativeTo:"deepgram-stream",reason:"Deepgram timestamps are relative to the stream it received, which begins when this connection opens -- not when recording began. A reconnection starts a new stream and therefore a new clock, which is what epoch identifies.",usableFor:"Locating a moment for read-back within the same channel and the same epoch, where playback begins several seconds before the hit.",doNotUseFor:"Positioning playback in a different channel, or comparing times across epochs as though one clock ran throughout."},channels:capture.sources.map(source=>({id:source.id,role:source.role,deviceId:source.deviceId,connectionState:"CONNECTING",epoch:1,streamOriginAt:null,sessionOffsetSeconds:0})),connectionHistory:[],finalizedEvents:[],interimByChannel:{},errors:[],createdAt:now(),updatedAt:now()};
  const runtime={paths,record,connections:[],keepalive:null};
  fs.mkdirSync(paths.directory,{recursive:true});atomic(paths.file,record);active.set(sessionId,runtime);

  /* One connection attempt for one channel. Re-entrant, because over an eight hours a dropped
     socket is close to certain and used to end that channel's index for good. */
  const connect=connection=>{
    const {source}=connection,channel=record.channels.find(item=>item.id===source.id);
    const url=buildDeepgramLiveUrl(source,keyterms),socket=new WebSocketClass(url,{headers:{Authorization:`Token ${apiKey}`}});
    connection.socket=socket;socket.binaryType="arraybuffer";
    channel.connectionState="CONNECTING";channel.epoch=connection.epoch;

    socket.on("open",()=>{
      channel.connectionState="OPEN";connection.retries=0;
      // First open for this channel is the origin of its continuous session clock.
      if(!channel.streamOriginAt)channel.streamOriginAt=now();
      connection.sessionOffsetSeconds=Math.max(0,(Date.parse(now())-Date.parse(channel.streamOriginAt))/1000);
      channel.sessionOffsetSeconds=connection.sessionOffsetSeconds;
      record.connectionHistory.push({type:"CONNECTED",at:now(),channelId:source.id,epoch:connection.epoch,url:url.replace(/keyterm=[^&]+/g,"keyterm=REDACTED")});
      const process=spawnProcess("ffmpeg",["-hide_banner","-loglevel","warning","-f","dshow","-i",`audio=${source.deviceId}`,"-ac","1","-ar","16000","-c:a","pcm_s16le","-f","s16le","pipe:1"],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
      connection.process=process;
      process.stdout.on("data",chunk=>{if(socket.readyState===WebSocketClass.OPEN)socket.send(chunk)});
      process.stderr.on("data",chunk=>{const message=chunk.toString();if(/error|lost|failed/i.test(message))record.errors.push({at:now(),channelId:source.id,kind:"DERIVATIVE",message:message.slice(-1000)})});
      process.once("exit",code=>{if(!connection.stopping&&record.state==="OPEN"&&code!==0)record.errors.push({at:now(),channelId:source.id,kind:"DERIVATIVE_EXIT",code,message:`The audio feed for ${source.role||source.id} exited unexpectedly with code ${code}. The local recording is unaffected.`})});
      if(record.channels.every(item=>item.connectionState==="OPEN"))record.state="OPEN";
      persist(runtime);
    });

    socket.on("message",data=>{
      try{
        const payload=JSON.parse(data.toString());if(payload.type!=="Results")return;
        const event=normalizedEvent(source,connection.epoch,payload,connection.sessionOffsetSeconds??0);
        if(event.isFinal){appendEvent(runtime,event);delete record.interimByChannel[source.id]}
        else record.interimByChannel[source.id]=event;
      }catch(error){record.errors.push({at:now(),channelId:source.id,kind:"MESSAGE_PARSE",message:error.message});persist(runtime)}
    });

    socket.on("close",(code,reason)=>{
      channel.connectionState="CLOSED";
      record.connectionHistory.push({type:"DISCONNECTED",at:now(),channelId:source.id,epoch:connection.epoch,code,reason:String(reason??"")});
      if(connection.process)connection.process.kill();
      /* Asked to stop, or the session is already closed: this is the end, not a fault. */
      if(connection.stopping||record.state==="CLOSED"){if(record.state!=="CLOSED")record.state="DEGRADED";persist(runtime);return}
      record.state="RECONNECTING";
      /* Backoff so an outage is not hammered, capped at thirty seconds so a long deposition
         recovers rather than backing off into uselessness. Each reconnection is a new epoch,
         because Deepgram restarts its clock at zero and a reader must be able to tell. */
      const attempt=(connection.retries=(connection.retries??0)+1),delay=Math.min(30000,1000*2**Math.min(attempt-1,5));
      record.connectionHistory.push({type:"RECONNECT_SCHEDULED",at:now(),channelId:source.id,attempt,delayMs:delay});
      persist(runtime);
      connection.timer=setTimeout(()=>{
        if(!active.has(sessionId)||connection.stopping)return;
        connection.epoch+=1;connect(connection);
      },delay);
      if(typeof connection.timer?.unref==="function")connection.timer.unref();
    });

    socket.on("error",error=>{record.errors.push({at:now(),channelId:source.id,kind:"WEBSOCKET",message:error.message});persist(runtime)});
  };

  for(const source of capture.sources){
    const connection={source,socket:null,process:null,epoch:1,retries:0,stopping:false,timer:null};
    runtime.connections.push(connection);connect(connection);
  }
  runtime.keepalive=setInterval(()=>{for(const {socket} of runtime.connections)if(socket&&socket.readyState===WebSocketClass.OPEN)socket.send(JSON.stringify({type:"KeepAlive"}))},8000);
  return publicRecord(record);
}
export async function stopDeepgramLive(_root,{sessionId}={}){const runtime=active.get(sessionId);if(!runtime)throw new Error("Deepgram Live is not active.");clearInterval(runtime.keepalive);for(const connection of runtime.connections){connection.stopping=true;if(connection.timer)clearTimeout(connection.timer);if(connection.process)connection.process.kill();if(connection.socket&&connection.socket.readyState===WebSocket.OPEN){connection.socket.send(JSON.stringify({type:"Finalize"}));await new Promise(resolve=>setTimeout(resolve,250));connection.socket.send(JSON.stringify({type:"CloseStream"}));connection.socket.close()}}runtime.record.state="CLOSED";runtime.record.closedAt=now();runtime.record.interimByChannel={};persist(runtime);active.delete(sessionId);return publicRecord(runtime.record)}
/* The manifest no longer carries the events, so a finished session reattaches them from the append
   log. Read-back needs the whole index, so it asks for it explicitly; the live screen only ever
   shows the tail. */
export function getDeepgramLive(root,{depositionId,sessionId,storageRoot,eventLimit=EVENTS_IN_MEMORY}={}){
  const runtime=active.get(sessionId);
  if(runtime)return publicRecord(runtime.record);
  const {file,events}=locations(root,depositionId,sessionId,storageRoot);
  const record=JSON.parse(fs.readFileSync(file,"utf8"));
  const lines=readEventLog(events);
  /* Count and tail both come from the log. The manifest is a summary of state and is allowed to
     lag -- after an unclean stop it will, and the log is what says what was actually captured. */
  return {...record,finalizedEventCount:lines.length,
    finalizedEvents:lines.slice(-eventLimit).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean)};
}
export const _testing={active,normalizedEvent};
