import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn,spawnSync} from "node:child_process";
import {appendDepositionAudio,depositionDirectory} from "./deposition-store.mjs";
import {captureSessionRoot} from "./storage-config.mjs";

export const LIVE_CAPTURE_SCHEMA_VERSION="1.0.0";
// Deterministic, so re-registering a channel collides with itself and is refused, and shaped as
// a UUID because that is what every other uploadId in a deposition record is.
function uploadIdForChannel(sessionId,channelId){const hex=crypto.createHash("sha256").update(`${sessionId}:${channelId}`).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`}
const active=new Map(),SOURCE_ID=/^[a-z][a-z0-9-]{0,63}$/;
const now=()=>new Date().toISOString();
function atomicJson(file,value){const temp=`${file}.${crypto.randomUUID()}.tmp`,fd=fs.openSync(temp,"wx");try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temp,file)}
function sha256(file){const hash=crypto.createHash("sha256");return new Promise((resolve,reject)=>{const input=fs.createReadStream(file);input.on("data",chunk=>hash.update(chunk));input.on("error",reject);input.on("end",()=>resolve(hash.digest("hex")))})}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Absent rather than zero: a file that is not there yet and a file of no length are different
// answers, and only one of them means a channel never started.
function fileSize(file){try{return fs.statSync(file).size}catch{return null}}
function safeDevice(value){const name=String(value??"").trim();if(!name||/[\r\n]/.test(name))throw new Error("A valid Windows audio device is required.");return name}
function sessionPaths(root,depositionId,sessionId,storageRoot){const deposition=depositionId?depositionDirectory(root,depositionId,{storageRoot}):captureSessionRoot();const directory=depositionId?path.join(deposition,"live-capture",sessionId):path.join(deposition,sessionId);return{deposition,directory,manifest:path.join(directory,"capture-session.json")}}
function readManifest(paths){return JSON.parse(fs.readFileSync(paths.manifest,"utf8"))}
// silentForSeconds is derived at read time rather than stored, because it grows while nothing is
// happening -- which is exactly the case it exists to report.
function publicSession(value,{now=Date.now}={}){const copy=structuredClone(value);
  for(const source of copy.sources??[]){if(!source.health)continue;const since=source.health.silentSince??null;
    source.health.silentForSeconds=since?Math.round((now()-since)/100)/10:0;
    source.health.silenceAlarm=copy.state==="RECORDING"&&source.state==="RECORDING"&&source.health.silentForSeconds>=SILENCE_ALARM_SECONDS}
  return copy}

export function parseDirectShowDevices(text){const devices=[],lines=String(text??"").split(/\r?\n/);for(let index=0;index<lines.length;index++){const match=lines[index].match(/\]\s+"([^"]+)" \(audio\)/);if(!match)continue;const alternative=lines[index+1]?.match(/Alternative name "([^"]+)"/);devices.push({id:alternative?.[1]??match[1],name:match[1],backend:"windows-directshow",kind:/stereo mix|loopback|virtual|cable/i.test(match[1])?"loopback":"input"})}return devices}
export function enumerateWindowsAudioSources({run=spawnSync}={}){if(process.platform!=="win32")return{platform:process.platform,supported:false,devices:[],error:"Live capture v1 requires Windows 11."};const result=run("ffmpeg",["-hide_banner","-list_devices","true","-f","dshow","-i","dummy"],{encoding:"utf8",windowsHide:true,timeout:15000});const devices=parseDirectShowDevices(`${result.stdout??""}\n${result.stderr??""}`);return{platform:"win32",supported:true,backend:"windows-directshow",devices,error:devices.length?null:(result.error?.message||"No Windows audio input or loopback sources were found.")}}
/**
 * A capture source that reads a file instead of a microphone.
 *
 * This exists to drive the live path with known audio -- four channels, an hour of dialogue, the
 * same content every run -- none of which a room with two microphones in it can provide. It is a
 * development instrument, and everything about it is arranged so that what it produces can never be
 * mistaken for, or promoted into, a record of a proceeding:
 *
 *   - It is refused unless DEPO_PRO_ALLOW_FILE_CAPTURE=1 is set in the environment, so it is not
 *     reachable at all on a reporter's machine.
 *   - Any session containing one is marked synthetic, and assignCaptureSession and
 *     registerCaptureAudio both refuse a synthetic session outright. Synthetic audio cannot become
 *     a deposition's evidence by any path through this module.
 *   - It is not offered on the Live Deposition screen. Driving it is a deliberate act from a
 *     script, not a device a reporter could pick by accident.
 *
 * The gate is read at call time rather than at import, so a test can turn it on and off around
 * itself rather than the whole process inheriting it.
 */
export const FILE_CAPTURE_FLAG="DEPO_PRO_ALLOW_FILE_CAPTURE";
/**
 * The capability to read audio from a file, held as a symbol.
 *
 * The environment flag alone was a runtime toggle, not a structure. The session route spreads the
 * request body into createCaptureSession, so with the flag set, a POST carrying
 * sources:[{kind:"file",...}] would have produced a synthetic session -- and a request is exactly
 * where this must never be reachable from.
 *
 * A symbol closes that. JSON cannot carry one: no request body, however shaped, and no amount of
 * spreading it into the call, can produce this value. Only a caller that imported this module holds
 * it, which is the driver script and nothing that arrives over HTTP. The flag stays as the second
 * condition, so the capability needs both an in-process caller and a deliberate act by the operator.
 *
 * This is the same shape as the catalog injection seam and the transcribable-proxy guard: not
 * "off by default", but unreachable from the direction the danger comes from.
 */
export const IN_PROCESS_FILE_SOURCES=Symbol("depo-pro:in-process-file-sources");
const fileCaptureAllowed=(environment=process.env)=>environment[FILE_CAPTURE_FLAG]==="1";
function validateFileSource(source,environment,capability){
  if(capability!==IN_PROCESS_FILE_SOURCES)throw new Error("A file-backed capture source cannot be requested. It is available only to a caller inside this process, and never over the API.");
  if(!fileCaptureAllowed(environment))throw new Error(`A file-backed capture source is a development instrument and is refused unless ${FILE_CAPTURE_FLAG}=1 is set.`);
  const filePath=String(source.filePath??"").trim();
  if(!filePath)throw new Error("A file-backed source requires the path of the audio file to read.");
  const resolved=path.resolve(filePath);
  if(!fs.existsSync(resolved))throw new Error(`The audio file for this source was not found: ${resolved}`);
  const channelIndex=source.channelIndex==null?null:Number(source.channelIndex);
  if(channelIndex!==null&&(!Number.isInteger(channelIndex)||channelIndex<0))throw new Error("channelIndex selects one channel of the file and must be a non-negative integer.");
  // Size and mtime now; the content hash is taken at stop, beside the artifact hashes, because it
  // is the same question asked of the same bytes and one place should answer it.
  const stat=fs.statSync(resolved);
  return {filePath:resolved,channelIndex,bytes:stat.size,modifiedAt:stat.mtime.toISOString(),sha256:null};
}
function validateSources(sources,{environment=process.env,fileSources}={}){if(!Array.isArray(sources)||!sources.length)throw new Error("Configure at least one independent audio source.");const ids=new Set();return sources.map((source,index)=>{const id=String(source.id??`ch${index+1}`);if(!SOURCE_ID.test(id)||ids.has(id))throw new Error("Every source requires a unique stable channel ID.");ids.add(id);
  const file=source.kind==="file"?validateFileSource(source,environment,fileSources):null;
  // A file source is identified by the file it reads and the channel it takes from it, so that two
  // channels of one fixture are two distinct sources rather than one repeated -- which is what the
  // preflight device signature and the duplicate checks both rely on.
  const deviceId=file?`file:${file.filePath}${file.channelIndex===null?"":`#${file.channelIndex}`}`:safeDevice(source.deviceId);
  const deviceName=file?`${path.basename(file.filePath)}${file.channelIndex===null?"":` ch${file.channelIndex+1}`}`:safeDevice(source.deviceName??source.deviceId);
  return{id,ordinal:index,role:String(source.role??"UNASSIGNED"),deviceId,deviceName,backend:file?"file":"windows-directshow",sourceFile:file,state:"CONFIGURED",format:{container:"wav",codec:"pcm_s24le",sampleRate:null,channels:null,bitsPerSample:24},timing:{configuredAt:now(),captureStartMonotonicNs:null,captureEndMonotonicNs:null},health:{rmsDb:null,peakDb:null,silence:true,clipping:false,receivedAudio:false,silentSince:null,droppedFrames:0,deviceLossEvents:0,errors:[]},artifact:null}})}
const isSynthetic=session=>(session.sources??[]).some(source=>source.backend==="file");
/**
 * A session that does not yet belong to a deposition is identified by its label and nothing else.
 *
 * Deliberately minimal: a generated id and start time, both automatic, and one line the reporter
 * types. No case style, no witness, no counsel -- those live on the deposition, and needing them
 * here would defeat the point of being able to press record first. The label is a finding aid for
 * picking the right recording out of three days of them; once the session is assigned, the
 * deposition supplies the real identity and the label stops mattering.
 */
export function createCaptureSession(root,{depositionId=null,label="",sources,storageRoot,fileSources}={}){
  const startedAt=now();
  const sessionLabel=String(label??"").trim()||`Recording ${startedAt.slice(0,10)} ${startedAt.slice(11,16)}`;
  const sessionId=`LIVE-${new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,paths=sessionPaths(root,depositionId,sessionId,storageRoot);fs.mkdirSync(path.join(paths.directory,"channels"),{recursive:true});
  const validated=validateSources(sources,{fileSources}),synthetic=isSynthetic({sources:validated});
  const session={schemaVersion:LIVE_CAPTURE_SCHEMA_VERSION,recordType:"LOCAL_MULTICHANNEL_CAPTURE_SESSION",sessionId,depositionId:depositionId??null,label:sessionLabel||null,assignedDepositionId:null,assignedAt:null,state:"CONFIGURED",authoritativeAudio:"independent-lossless-local-channels",streaming:{enabled:false,provider:null},timeline:synthetic?{channelsSampleAligned:true,interChannelOffsetMeasured:false,reason:"Every channel is read from position zero of a file, so the channels carry the same span of source audio and are aligned in content. This is a property of reading a file and says nothing about microphones: it is the reason a synthetic session cannot stand in for a captured one when the question is timing.",doNotUseFor:"Anything. This session is synthetic. It is not a recording of a proceeding and cannot be attached to a deposition."}:{channelsSampleAligned:false,interChannelOffsetMeasured:false,reason:"Each channel is captured by an independent process. The interval between starting a process and its first sample is not observable from outside it, so the channels begin at different real moments by an amount this session does not know. Measured on one DirectShow device with identical invocations, that interval varied between 28 and 83 milliseconds run to run, so no fixed correction applies.",doNotUseFor:"Attributing speech by comparing signal across channels. The offset is unmeasured, so a comparison that assumes the channels are aligned can attribute a word to the wrong speaker."},clock:{kind:"process.hrtime.bigint",originMonotonicNs:null,originWallClock:null},sources:validated,synthetic,events:[{type:"SESSION_CONFIGURED",at:now()}],createdAt:now(),updatedAt:now()};atomicJson(paths.manifest,session);return publicSession(session)}
function recordPath(paths,source){return path.join(paths.directory,"channels",`${String(source.ordinal+1).padStart(2,"0")}-${source.id}.wav`)}
// astats prints "RMS level dB:" only in its end-of-stream summary, so during a recording that runs
// for hours it prints nothing at all -- which is why the meters were dead for the whole capture
// while working in preflight, where the process runs to completion. ametadata=mode=print emits the
// same measurements as frame metadata while the stream is running. Measured at ~2.2 readings per
// second, with the written WAV unaffected.
// The level at which a source counts as having received audio at all. armPreflight refuses below
// it, so the alarm during recording uses the same number: a channel that would not have been
// allowed on the record must not pass unnoticed once it is on it.
export const SIGNAL_FLOOR_DB=-70;
// How long a channel may sit below the floor before the screen shouts. Long enough not to fire on
// a pause between questions, short enough that a dead microphone is caught in seconds rather than
// discovered at the end of the deposition.
export const SILENCE_ALARM_SECONDS=5;
const LEVEL_FILTER="astats=metadata=1:reset=25,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level";
// Both forms are read: the streaming metadata that arrives throughout, and the summary that arrives
// at the end. The last reading wins, which is what a meter shows.
function observeHealth(source,text,{now=Date.now}={}){const rms=[...text.matchAll(/(?:RMS level dB:\s*|lavfi\.astats\.Overall\.RMS_level=)(-?[\d.]+)/g)].at(-1),peak=[...text.matchAll(/(?:Peak level dB:\s*|lavfi\.astats\.Overall\.Peak_level=)(-?[\d.]+)/g)].at(-1);if(rms){source.health.rmsDb=Number(rms[1]);source.health.receivedAudio=source.health.rmsDb>SIGNAL_FLOOR_DB;source.health.silence=source.health.rmsDb<-55;source.health.silentSince=source.health.receivedAudio?null:(source.health.silentSince??now())}if(peak){source.health.peakDb=Number(peak[1]);source.health.clipping=source.health.peakDb>-0.5}if(/buffer.*overrun|dropped/i.test(text))source.health.droppedFrames++;}
// The difference between a microphone and a file is the input and its pacing, and nothing else:
// same filter, same codec, same container, same level readings, so what the rest of the session
// sees is identical either way.
//
// -re is what makes a file behave like a room. Without it ffmpeg reads as fast as the disk allows
// and a ten-minute fixture is written in seconds, which exercises none of the things the live path
// exists to do -- meters that move, a silence alarm that fires on a real interval, text arriving
// while a reporter watches. With it, ten minutes of audio takes ten minutes.
//
// pan takes one channel out of a multi-channel fixture, so four processes reading one four-channel
// file produce four independent single-channel recordings -- the shape a four-microphone room
// produces, which is the thing being exercised.
function captureArgs(source,file){
  if(source.backend!=="file")return ["-hide_banner","-loglevel","info","-thread_queue_size","4096","-f","dshow","-i",`audio=${source.deviceId}`,"-map","0:a:0","-af",LEVEL_FILTER,"-c:a","pcm_s24le","-rf64","auto","-y",file];
  const {filePath,channelIndex}=source.sourceFile;
  const filter=channelIndex===null?LEVEL_FILTER:`pan=mono|c0=c${channelIndex},${LEVEL_FILTER}`;
  return ["-hide_banner","-loglevel","info","-re","-i",filePath,"-map","0:a:0","-af",filter,"-c:a","pcm_s24le","-rf64","auto","-y",file];
}
export function startCaptureSession(root,{depositionId,sessionId,storageRoot,spawnProcess=spawn}={}){const paths=sessionPaths(root,depositionId,sessionId,storageRoot),session=readManifest(paths);if(session.state!=="CONFIGURED")throw new Error("Only a configured capture session can start.");const origin=process.hrtime.bigint(),wall=now(),children=[];try{for(const source of session.sources){const file=recordPath(paths,source),child=spawnProcess("ffmpeg",captureArgs(source,file),{windowsHide:true,stdio:["pipe","ignore","pipe"]});const runtime={child,stderr:""};child.stderr?.on("data",chunk=>{const text=chunk.toString();runtime.stderr=(runtime.stderr+text).slice(-16000);observeHealth(source,runtime.stderr)});child.once("exit",code=>{if(session.state==="RECORDING"&&code!==0){source.state="DEVICE_LOST";source.health.deviceLossEvents++;source.health.errors.push({at:now(),message:`Capture process exited with code ${code}.`});session.state="DEGRADED";session.events.push({type:"DEVICE_LOST",at:now(),sourceId:source.id,exitCode:code})}});children.push({sourceId:source.id,...runtime});source.state="RECORDING";source.timing.captureStartMonotonicNs=(process.hrtime.bigint()-origin).toString();source.artifact={relativePath:path.relative(paths.deposition,file).replaceAll("\\","/"),bytes:null,sha256:null,finalized:false}}}catch(error){for(const item of children)item.child.kill();throw error}session.state="RECORDING";session.clock={kind:"process.hrtime.bigint",originMonotonicNs:origin.toString(),originWallClock:wall};session.events.push({type:"LOCAL_RECORDING_STARTED",at:wall,sourceIds:session.sources.map(source=>source.id)});session.updatedAt=now();atomicJson(paths.manifest,session);active.set(sessionId,{paths,session,origin,children});return publicSession(session)}
async function stopChild(item){return await new Promise(resolve=>{let settled=false;const done=()=>{if(settled)return;settled=true;resolve()};item.child.once("exit",done);try{item.child.stdin.write("q\n")}catch{/* process already closed */}setTimeout(()=>{try{item.child.kill()}catch{/* process already closed */}done()},5000)})}
function probe(file){const result=spawnSync("ffprobe",["-v","error","-select_streams","a:0","-show_entries","stream=sample_rate,channels,bits_per_sample,duration_ts","-of","json",file],{encoding:"utf8",windowsHide:true,timeout:15000});if(result.status!==0)return null;return JSON.parse(result.stdout).streams?.[0]??null}
export async function stopCaptureSession(_root,{sessionId}={}){const runtime=active.get(sessionId);if(!runtime)throw new Error("The local capture process is not active in this application instance.");await Promise.all(runtime.children.map(stopChild));const end=process.hrtime.bigint();for(const source of runtime.session.sources){const file=recordPath(runtime.paths,source),child=runtime.children.find(item=>item.sourceId===source.id),media=fs.existsSync(file)?probe(file):null;source.state=fs.existsSync(file)?"FINALIZED":"FAILED";source.timing.captureEndMonotonicNs=(end-runtime.origin).toString();if(child?.stderr&&/device|buffer|overrun|lost|error/i.test(child.stderr))source.health.errors.push({at:now(),message:child.stderr.slice(-2000)});if(fs.existsSync(file)){source.format.sampleRate=Number(media?.sample_rate)||null;source.format.channels=Number(media?.channels)||null;source.artifact={...source.artifact,bytes:fs.statSync(file).size,sha256:await sha256(file),finalized:true}}}
  // What produced this audio, hashed at the same moment as the audio itself. Hashed once per
  // distinct file rather than once per channel: four channels of one fixture are one set of bytes,
  // and hashing 230 MB four times to learn the same answer is four times the wait for nothing.
  const fileHashes=new Map();
  for(const source of runtime.session.sources){
    if(!source.sourceFile)continue;
    const {filePath}=source.sourceFile;
    if(!fileHashes.has(filePath))fileHashes.set(filePath,await sha256(filePath));
    source.sourceFile.sha256=fileHashes.get(filePath);
  }
  runtime.session.state=runtime.session.sources.every(source=>source.state==="FINALIZED")?"FINALIZED":"DEGRADED";runtime.session.events.push({type:"LOCAL_RECORDING_STOPPED",at:now()});runtime.session.updatedAt=now();atomicJson(runtime.paths.manifest,runtime.session);active.delete(sessionId);return publicSession(runtime.session)}
/**
 * Finalizes a capture whose application instance ended before it was stopped.
 *
 * ffmpeg outlives the process that spawned it. When the local API dies mid-recording the audio
 * keeps arriving, but the handle that stops it is gone with the Map above, so stopCaptureSession
 * can only report that it is not holding the session. The manifest then stays at RECORDING for
 * good: unhashed, not finalized, and refused by registerCaptureAudio and assignCaptureSession
 * alike. The recording exists on disk and cannot be attached to anything.
 *
 * This finalizes it from the file instead of from the process. What it will not do is pretend the
 * stop was seen:
 *
 *   - captureEndMonotonicNs stays null. The moment capture ended is not recoverable after the
 *     fact, and a plausible number here would be a guess written into an evidentiary record.
 *   - The session lands in DEGRADED, never FINALIZED, so a recovered capture is never mistaken
 *     for one that was stopped cleanly. DEGRADED already means usable-but-something-went-wrong,
 *     and both attachment paths already accept it.
 *   - health is left as it was. The meters live in the dead process's memory and were never
 *     written, so the stored levels are unobserved rather than measured, and inventing them from
 *     the file would put a measurement in the record that nothing measured.
 *
 * A channel whose file is missing or will not decode is marked FAILED rather than finalized, so a
 * truncated capture is skipped at attachment instead of carrying a hash of something unplayable.
 */
export async function finalizeOrphanedSession(root,{depositionId,sessionId,storageRoot,settleMs=1200,wait=delay}={}){
  if(active.has(sessionId))throw new Error("This capture is running in this application instance. Stop it from the Live Deposition screen instead.");
  const paths=sessionPaths(root,depositionId,sessionId,storageRoot),session=readManifest(paths);
  if(session.state!=="RECORDING")throw new Error(`Only an interrupted capture can be recovered. This session is ${session.state}.`);
  const channels=session.sources.map(source=>({source,file:recordPath(paths,source)}));
  // Hashing a file something is still writing hashes a moving target, and the hash is the whole
  // point. Capture is constant-bitrate PCM, so a file that is still being recorded grows every
  // moment; a size that changes across the settle window means a writer is still attached.
  const before=channels.map(item=>fileSize(item.file));
  await wait(settleMs);
  const growing=channels.filter((item,index)=>fileSize(item.file)!==before[index]);
  if(growing.length)throw new Error(`Still being recorded: ${growing.map(item=>item.source.id).join(", ")}. End the capture process before recovering this session.`);
  for(const {source,file} of channels){
    const media=fs.existsSync(file)?probe(file):null;
    if(!media){source.state="FAILED";source.health.errors.push({at:now(),message:fs.existsSync(file)?"The recorded file could not be decoded, so it was not finalized.":"The recorded file is missing."});continue}
    source.format.sampleRate=Number(media.sample_rate)||null;source.format.channels=Number(media.channels)||null;
    source.artifact={...source.artifact,bytes:fs.statSync(file).size,sha256:await sha256(file),finalized:true};
    source.state="FINALIZED";
  }
  session.state="DEGRADED";
  session.events.push({type:"LOCAL_RECORDING_RECOVERED",at:now(),reason:"The application instance that started this capture ended before it was stopped. The channels were finalized and hashed from the files on disk. The moment capture ended was not observed."});
  session.updatedAt=now();
  atomicJson(paths.manifest,session);
  return publicSession(session);
}
/**
 * Registers a finished capture session's channels as this deposition's audio.
 *
 * This is the seam between the two halves of the application: the live screen makes the recording,
 * and the existing pipeline turns a recording into a certified transcript. Without it a capture
 * lived inside the deposition folder and was still invisible to the deposition.
 *
 * The upload id is derived from the session and channel rather than random, so registering the
 * same channel twice is refused by the duplicate check instead of silently adding it again under a
 * new name.
 *
 * Finalized channels are registered even when the session as a whole is DEGRADED. A channel that
 * failed must not take the surviving recordings down with it -- that would turn one device fault
 * into the loss of the record, which is the outcome the per-channel design exists to prevent. What
 * was skipped is returned rather than passed over.
 */
/**
 * The capture this application instance is recording right now for a given context, if any.
 *
 * The server owns this. A reload, a crash, a closed tab, a different browser and a different
 * machine all arrive with no local state, and every one of them has to be able to find a recording
 * that is still running -- which is only possible if the answer comes from the process holding the
 * ffmpeg handles rather than from something a client stored. A sessionId in localStorage fails on a
 * cleared cache and cannot help a second machine at all, and it makes the client authoritative over
 * state it does not own.
 *
 * `active` is the source and the manifest on disk is not. A manifest reading RECORDING says a
 * capture was started; `active` says it is still being written here and can therefore be stopped.
 * A session on disk that this instance is not holding is orphaned, which is a different condition
 * with a different remedy -- see finalizeOrphanedSession, which finalizes rather than reattaches.
 * Confusing the two is how a stray page load could end a live deposition.
 */
export function runningCaptureSession(_root,{depositionId=null}={}){
  const wanted=depositionId||null;
  for(const runtime of active.values()){
    if((runtime.session.depositionId??null)!==wanted)continue;
    return publicSession(runtime.session);
  }
  return null;
}
export function registerCaptureAudio(root,{depositionId,sessionId,storageRoot}={}){
  const paths=sessionPaths(root,depositionId,sessionId,storageRoot),session=readManifest(paths);
  if(session.state==="RECORDING")throw new Error("Stop and finalize the recording before adding it to the deposition.");
  if(session.synthetic||isSynthetic(session))throw new Error("This session was recorded from a file, not from a microphone. Synthetic audio cannot be attached to a deposition.");
  const finalized=session.sources.filter(source=>source.state==="FINALIZED"&&source.artifact?.finalized&&source.artifact.sha256);
  const skipped=session.sources.filter(source=>!finalized.includes(source)).map(source=>({id:source.id,role:source.role,state:source.state}));
  if(!finalized.length)throw new Error("This capture session has no finalized channels to add.");
  const entries=finalized.map(source=>({
    uploadId:uploadIdForChannel(sessionId,source.id),
    sha256:source.artifact.sha256,
    path:source.artifact.relativePath,
    name:`${sessionId}-${source.id}.wav`,
    source:"original",
  }));
  return {...appendDepositionAudio(root,{depositionId,entries,storageRoot}),sessionId,skipped};
}

/**
 * Attaches an unassigned recording to a deposition.
 *
 * The recording is MOVED, not copied. A deposition's audio must live inside its own folder --
 * resolveDepositionAudio refuses anything else, and rightly -- and copying would duplicate several
 * gigabytes per channel to leave a second copy nobody is going to keep in step. Same volume, so the
 * rename is atomic; a cross-volume rename falls back to copy-then-verify-then-remove rather than
 * failing, and never removes the source until the destination has been verified.
 *
 * The hash is checked twice: at the source before anything moves, and at the destination after.
 * The first says the recording is still what was captured; the second says the move did not damage
 * it. This is the only point in the application where evidence changes location, so it is the point
 * that has to prove it arrived intact.
 *
 * Assignment is deliberately the last step. The audio exists, is finalized and is hashed long
 * before anything decides where it belongs, so choosing the wrong deposition costs a correction and
 * never costs the recording.
 */
export async function assignCaptureSession(root,{sessionId,depositionId,storageRoot,rename=fs.renameSync}={}){
  if(!sessionId)throw new Error("A session id is required.");
  if(!depositionId)throw new Error("Choose the deposition this recording belongs to.");
  const paths=sessionPaths(root,null,sessionId,storageRoot),session=readManifest(paths);
  if(session.assignedDepositionId)throw new Error(`This recording is already part of deposition ${session.assignedDepositionId}.`);
  if(session.state==="RECORDING")throw new Error("Stop and finalize the recording before attaching it to a deposition.");
  if(session.synthetic||isSynthetic(session))throw new Error("This session was recorded from a file, not from a microphone. Synthetic audio cannot be attached to a deposition.");
  const finalized=session.sources.filter(source=>source.state==="FINALIZED"&&source.artifact?.finalized&&source.artifact.sha256);
  const skipped=session.sources.filter(source=>!finalized.includes(source)).map(source=>({id:source.id,role:source.role,state:source.state}));
  if(!finalized.length)throw new Error("This recording has no finalized channels to attach.");

  const deposition=depositionDirectory(root,depositionId,{storageRoot});
  const target=path.join(deposition,"audio","original");
  fs.mkdirSync(target,{recursive:true});

  // Every source is verified before anything moves, so a damaged channel is found while the
  // recording is still whole and in one place.
  const planned=[];
  for(const source of finalized){
    const from=path.resolve(paths.deposition,...source.artifact.relativePath.split("/"));
    if(!fs.existsSync(from))throw new Error(`Channel ${source.id} is missing from disk and cannot be attached.`);
    const actual=await sha256(from);
    if(actual!==source.artifact.sha256)throw new Error(`Channel ${source.id} failed SHA-256 verification before moving; the file on disk is not the one that was recorded.`);
    const name=`${sessionId}-${source.id}.wav`;
    planned.push({source,from,to:path.join(target,name),name,sha256:actual});
  }
  for(const item of planned)if(fs.existsSync(item.to))throw new Error(`${item.name} already exists in this deposition.`);

  const moved=[];
  try{
    for(const item of planned){
      try{rename(item.from,item.to)}
      catch(error){
        if(error?.code!=="EXDEV")throw error;
        // Different volume: copy, verify, and only then let go of the original.
        fs.copyFileSync(item.from,item.to,fs.constants.COPYFILE_EXCL);
        if(await sha256(item.to)!==item.sha256)throw new Error(`Channel ${item.source.id} did not survive the copy intact.`);
        fs.rmSync(item.from,{force:true});
      }
      moved.push(item);
      if(await sha256(item.to)!==item.sha256)throw new Error(`Channel ${item.source.id} failed SHA-256 verification after moving.`);
    }
  }catch(error){
    error.movedFiles=moved.map(item=>path.relative(deposition,item.to).replaceAll("\\","/"));
    throw error;
  }

  const written=appendDepositionAudio(root,{depositionId,storageRoot,entries:moved.map(item=>({
    uploadId:uploadIdForChannel(sessionId,item.source.id),sha256:item.sha256,
    path:path.relative(deposition,item.to).replaceAll("\\","/"),name:item.name,source:"original",
  }))});

  for(const item of moved){item.source.artifact.relativePath=null;item.source.artifact.movedTo={depositionId,name:item.name}}
  session.assignedDepositionId=depositionId;
  session.assignedAt=now();
  session.events.push({type:"ASSIGNED_TO_DEPOSITION",at:session.assignedAt,depositionId,channels:moved.map(item=>item.source.id)});
  session.updatedAt=now();
  atomicJson(paths.manifest,session);
  return {sessionId,depositionId,added:written.added,skipped};
}

/** Every recording not yet attached to a deposition, newest first. */
export function listCaptureSessions(){
  const directory=captureSessionRoot();
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>{
    try{
      const session=JSON.parse(fs.readFileSync(path.join(directory,item.name,"capture-session.json"),"utf8"));
      // State comes off the disk and says what the session was doing; running says whether this
      // instance is the one doing it. A session that reads RECORDING with nothing running is a
      // capture whose application instance died -- the only way to tell the two apart from
      // outside, and the difference between "leave it alone" and "this needs finalizing".
      // synthetic says the audio never came from a microphone, which no amount of state or
      // running can tell you and which decides whether it may ever be attached to a deposition.
      return {sessionId:session.sessionId,label:session.label,state:session.state,running:active.has(session.sessionId),synthetic:Boolean(session.synthetic),createdAt:session.createdAt,
        assignedDepositionId:session.assignedDepositionId??null,assignedAt:session.assignedAt??null,
        channels:(session.sources??[]).map(source=>({id:source.id,role:source.role,state:source.state,bytes:source.artifact?.bytes??null}))};
    }catch{return null}
  }).filter(Boolean).sort((left,right)=>String(right.createdAt).localeCompare(String(left.createdAt)));
}

/**
 * Renames a recording. The label is a finding aid and nothing else -- it never reaches the
 * transcript, the deposition record, or any certified output -- so it can be changed at any time,
 * including after the session has been attached to a deposition.
 */
export function renameCaptureSession(root,{sessionId,depositionId=null,label,storageRoot}={}){
  const trimmed=String(label??"").trim();
  if(!trimmed)throw new Error("A recording needs a name.");
  const paths=sessionPaths(root,depositionId,sessionId,storageRoot),session=readManifest(paths);
  session.label=trimmed;session.updatedAt=now();
  session.events.push({type:"RENAMED",at:session.updatedAt,label:trimmed});
  atomicJson(paths.manifest,session);
  return publicSession(session);
}

export function getCaptureSession(root,{depositionId,sessionId,storageRoot}={}){const paths=sessionPaths(root,depositionId,sessionId,storageRoot);return publicSession(active.get(sessionId)?.session??readManifest(paths))}
export const _testing={active,observeHealth,validateSources,LEVEL_FILTER,publicSession};
