import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectRx } from "./rx-adapter.mjs";
import { RX_PROFILES } from "./rx-profiles.mjs";
import { ANALYSIS_VERSION, ROUTING_VERSION } from "./audio-pipeline.mjs";
import { DEEPGRAM_CONFIGURATION_VERSION } from "./deepgram-service.mjs";
import { OVERLAY_SCHEMA_VERSION } from "./reporter-overlay.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function command(name,args=["-version"]){const result=spawnSync(name,args,{encoding:"utf8",windowsHide:true,timeout:15000});const text=`${result.stdout||""}\n${result.stderr||""}`.trim().split(/\r?\n/)[0];return {ready:result.status===0,version:result.status===0?text:null,error:result.status===0?null:(result.error?.message||text||"Unavailable")}}
export function systemPreflight({config=null}={}){
  const rx=inspectRx({includeExecutable:true}),python=process.env.DEPO_PRO_RX_PYTHON||path.join(root,".venv-pedalboard","Scripts","python.exe"),pluginRoot=process.env.RX_VST3_ROOT||"C:\\Program Files\\Common Files\\VST3\\iZotope";
  const pedalboard=fs.existsSync(python)?command(python,["-c","import pedalboard; print(pedalboard.version.__version__)"]):{ready:false,version:null,error:"Python environment not found"};
  // The Word deliverable runs on a Python this readiness check did not cover, which is how a
  // machine could report ready and then fail at the one step that produces the transcript. The
  // interpreter is whatever DEPO_PRO_PYTHON names, or bare "python" -- resolved exactly as
  // final-document-docx.mjs resolves it, so this check cannot pass while the renderer would fail.
  // Declared in requirements-docx.txt; neither package is a Node dependency, so nothing else
  // in the tree records that the final document depends on them.
  const docxPython=process.env.DEPO_PRO_PYTHON||"python";
  const docxRenderer=command(docxPython,["-c","import docx,lxml;print('python-docx '+docx.__version__)"]);

  const components={node:{ready:Number(process.versions.node.split(".")[0])>=22,version:process.versions.node},ffmpeg:command("ffmpeg"),ffprobe:command("ffprobe"),rxEditor:{ready:rx.available,version:rx.version,detail:rx.fallback},pythonWorker:{ready:fs.existsSync(python)&&fs.existsSync(path.join(root,"server","rx-pedalboard-worker.py")),version:python},pedalboard,docxRenderer,rxModules:Object.fromEntries(Object.values(RX_PROFILES).map(profile=>[profile.module,{ready:fs.existsSync(path.join(pluginRoot,profile.pluginFile)),version:profile.version}])),deepgram:{ready:!!config?.deepgramApiKey,version:null},claude:{ready:!!config?.anthropicApiKey,version:config?.claudeModel||null}};
  const ready=Object.values(components).every(value=>"ready" in value?value.ready:Object.values(value).every(item=>item.ready));
  // The versions the RUNNING process is executing, not the ones in the tree.
  //
  // local-api.mjs is long-lived and never hot-reloads, so a server started before a policy
  // change keeps applying the old one indefinitely. That happened today: routing v3 landed at
  // 09:07 and an upload at 13:28 was still written by v2 code, which took an investigation to
  // establish. Three separate stale-code incidents in one day -- a downloaded snapshot, this
  // process, and an audit performed against the snapshot. Reading these off a live endpoint
  // makes "is the server current?" a glance instead of an archaeology exercise.
  return {checkedAt:new Date().toISOString(),overallReady:ready,components,
    running:{startedAt:new Date(Date.now()-Math.round(process.uptime()*1000)).toISOString(),
      routingPolicyVersion:ROUTING_VERSION,analysisVersion:ANALYSIS_VERSION,
      deepgramConfigurationVersion:DEEPGRAM_CONFIGURATION_VERSION,overlaySchemaVersion:OVERLAY_SCHEMA_VERSION}};
}
