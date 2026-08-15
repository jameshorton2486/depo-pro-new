import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { depositionStorageRoot } from "../server/storage-config.mjs";
import { ALLOW_SYNCED_ROOT, classifyStorageRoot } from "../server/storage-safety.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),environmentFile=path.join(root,".env.local");
if(fs.existsSync(environmentFile))process.loadEnvFile(environmentFile);
const bundledNode=path.join(root,"node_modules","node","bin","node.exe"),runtime=fs.existsSync(bundledNode)?bundledNode:process.execPath;
const nodeVersion=spawnSync(runtime,["--version"],{encoding:"utf8",windowsHide:true}).stdout.trim(),depositions=depositionStorageRoot();
async function endpoint(url){try{const response=await fetch(url,{headers:{Origin:"http://localhost:3000"}});return response.ok?await response.json():{ready:false,httpStatus:response.status}}catch{return null}}
const [admin,preflight]=await Promise.all([endpoint("http://127.0.0.1:4317/api/admin/status"),endpoint("http://127.0.0.1:4317/api/system/preflight")]);
const projectStorage=classifyStorageRoot(root),depositionsStorage=classifyStorageRoot(depositions);
const warnings=[...projectStorage.warnings.map(item=>({...item,scope:"projectRoot"})),...depositionsStorage.warnings.map(item=>({...item,scope:"depositionsRoot"}))];
const report={projectRoot:root,projectStorage,depositionsRoot:depositions,depositionsRootExists:depositionsStorage.exists,depositionsStorage,storageWarnings:warnings,storageWarningsAcknowledged:projectStorage.acknowledged||depositionsStorage.acknowledged,bundledNode:nodeVersion||"unavailable",localApiRunning:Boolean(admin),credentials:admin?{administratorInitialized:Boolean(admin.initialized),claudeConfigured:Boolean(admin.anthropicConfigured),deepgramConfigured:Boolean(admin.deepgramConfigured)}:"local API is not running",preflightReady:preflight?.overallReady??false};
console.log(JSON.stringify(report,null,2));
for(const warning of warnings)console.warn(`WARNING ${warning.code} (${warning.scope}): ${warning.message} Set ${ALLOW_SYNCED_ROOT}=1 to acknowledge this deliberately.`);
// Storage warnings never fail the check -- see classifyStorageRoot for why. A missing
// deposition root is a different matter: nothing can be written at all.
if(!report.depositionsRootExists)process.exitCode=1;
