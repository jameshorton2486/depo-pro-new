import { spawn } from "node:child_process";

export const SPEECH_DETECTION_PARAMETERS=Object.freeze({noiseThresholdDb:-45,minSilenceSec:2,paddingMs:300});

function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]}),output=[];child.stdout.on("data",chunk=>output.push(chunk));child.stderr.on("data",chunk=>output.push(chunk));child.once("error",reject);child.once("close",code=>code===0?resolve(Buffer.concat(output).toString("utf8")):reject(new Error(Buffer.concat(output).toString("utf8").trim()||`${command} failed.`)))})}

export function buildSpeechSegments(totalDurationSec,rawSilences,{paddingMs=300}={}){
  const duration=Math.max(0,Number(totalDurationSec)),padding=paddingMs/1000;
  const silences=rawSilences.map(item=>({startSec:Math.max(0,item.startSec+padding),endSec:Math.min(duration,item.endSec-padding)})).filter(item=>item.endSec>item.startSec).sort((a,b)=>a.startSec-b.startSec);
  const segments=[];let cursor=0;
  for(const silence of silences){const start=Math.max(cursor,silence.startSec),end=Math.max(start,silence.endSec);if(start>cursor)segments.push({startSec:cursor,endSec:start,kind:"speech"});if(end>start)segments.push({startSec:start,endSec:end,kind:"silence"});cursor=end}
  if(cursor<duration)segments.push({startSec:cursor,endSec:duration,kind:"speech"});
  if(!segments.length&&duration>0)segments.push({startSec:0,endSec:duration,kind:"speech"});
  return segments;
}

export function parseSilenceDetect(text,totalDurationSec,parameters=SPEECH_DETECTION_PARAMETERS){
  const starts=[...text.matchAll(/silence_start:\s*([\d.]+)/g)].map(match=>Number(match[1])),ends=[...text.matchAll(/silence_end:\s*([\d.]+)/g)].map(match=>Number(match[1]));
  const rawSilences=starts.map((startSec,index)=>({startSec,endSec:ends[index]??totalDurationSec}));
  return buildSpeechSegments(totalDurationSec,rawSilences,parameters);
}

export async function detectSpeechSegments(file,parameters=SPEECH_DETECTION_PARAMETERS){
  const probe=JSON.parse(await run("ffprobe",["-v","error","-show_entries","format=duration","-of","json",file])),totalDurationSec=Number(probe.format?.duration);
  if(!Number.isFinite(totalDurationSec)||totalDurationSec<=0)throw new Error("Audio duration could not be measured for silence detection.");
  const output=await run("ffmpeg",["-hide_banner","-nostats","-i",file,"-af",`silencedetect=noise=${parameters.noiseThresholdDb}dB:d=${parameters.minSilenceSec}`,"-f","null","-"]);
  const segments=parseSilenceDetect(output,totalDurationSec,parameters),speechDurationSec=segments.filter(item=>item.kind==="speech").reduce((sum,item)=>sum+item.endSec-item.startSec,0);
  return {parameters:{...parameters},totalDurationSec,speechDurationSec,segments};
}
