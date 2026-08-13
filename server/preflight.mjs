import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectRx } from "./rx-adapter.mjs";
import { RX_PROFILES } from "./rx-profiles.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function command(name,args=["-version"]){const result=spawnSync(name,args,{encoding:"utf8",windowsHide:true,timeout:15000});const text=`${result.stdout||""}\n${result.stderr||""}`.trim().split(/\r?\n/)[0];return {ready:result.status===0,version:result.status===0?text:null,error:result.status===0?null:(result.error?.message||text||"Unavailable")}}
export function systemPreflight({config=null}={}){
  const rx=inspectRx({includeExecutable:true}),python=process.env.DEPO_PRO_RX_PYTHON||path.join(root,".venv-pedalboard","Scripts","python.exe"),pluginRoot=process.env.RX_VST3_ROOT||"C:\\Program Files\\Common Files\\VST3\\iZotope";
  const pedalboard=fs.existsSync(python)?command(python,["-c","import pedalboard; print(pedalboard.version.__version__)"]):{ready:false,version:null,error:"Python environment not found"};
  const components={node:{ready:Number(process.versions.node.split(".")[0])>=22,version:process.versions.node},ffmpeg:command("ffmpeg"),ffprobe:command("ffprobe"),rxEditor:{ready:rx.available,version:rx.version,detail:rx.fallback},pythonWorker:{ready:fs.existsSync(python)&&fs.existsSync(path.join(root,"server","rx-pedalboard-worker.py")),version:python},pedalboard,rxModules:Object.fromEntries(Object.values(RX_PROFILES).map(profile=>[profile.module,{ready:fs.existsSync(path.join(pluginRoot,profile.pluginFile)),version:profile.version}])),deepgram:{ready:!!config?.deepgramApiKey,version:null},claude:{ready:!!config?.anthropicApiKey,version:config?.claudeModel||null}};
  const ready=Object.values(components).every(value=>"ready" in value?value.ready:Object.values(value).every(item=>item.ready));
  return {checkedAt:new Date().toISOString(),overallReady:ready,components};
}
