import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { extractionTool } from "./extraction-schema.mjs";
import { saveAndAnalyzeAudio, saveAudioForTools, readAudioAudit, publicAudit, selectAudioSource, resolveAudioPath, createDeepgramCompatibilityDerivative, recordTranscription, recordComparison, mutateAudioAudit } from "./audio-pipeline.mjs";
import { transcribeWithDeepgram, isDeepgramMediaError } from "./deepgram-service.mjs";
import { compareTranscripts } from "./transcript-quality.mjs";
import { inspectRx } from "./rx-adapter.mjs";
import { createRxDerivative, RxProcessingError } from "./rx-processing.mjs";
import { systemPreflight } from "./preflight.mjs";
import { createDeposition, resolveDepositionAudio, scanDepositions } from "./deposition-store.mjs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const terminologyPrompt = fs.readFileSync(path.join(root, "prompts", "extraction", "case_terms", "v2.md"), "utf8");
const secretFile = path.join(root, "data", "secrets.dat");
const port = 4317;
const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

function dpapi(mode, value) {
  const script = mode === "encrypt"
    ? 'Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($e)'
    : 'Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($d)';
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input: value, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Windows secret protection failed.");
  return result.stdout.trim();
}

function loadSecrets() {
  if (!fs.existsSync(secretFile)) return null;
  return JSON.parse(dpapi("decrypt", fs.readFileSync(secretFile, "utf8")));
}
function saveSecrets(value) {
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, dpapi("encrypt", JSON.stringify(value)), { encoding: "utf8", mode: 0o600 });
}
function hashCode(code, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(code, salt, 32).toString("hex") };
}
function validCode(code, config) {
  if (!config?.adminHash || !code) return false;
  const actual = crypto.scryptSync(code, config.adminSalt, 32);
  return crypto.timingSafeEqual(actual, Buffer.from(config.adminHash, "hex"));
}
function json(res, status, body, origin) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": origin, "vary": "Origin", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function body(req, max = 25 * 1024 * 1024) {
  const parts=[]; let size=0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error("Request is too large."); parts.push(chunk); }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}
function contentBlock(file) {
  if (file.type === "application/pdf") return { type:"document", source:{ type:"base64", media_type:"application/pdf", data:file.base64 } };
  if (file.type === "text/plain") return { type:"document", source:{ type:"text", media_type:"text/plain", data:Buffer.from(file.base64,"base64").toString("utf8") } };
  throw new Error("Claude extraction currently accepts PDF or plain-text notices. Convert Word files to PDF first.");
}

async function fetchExternal(url, options, { label, attempts = 2, timeoutMs = 120000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      console.log(`[external:${label}] request started`, { attempt });
      const response = await fetch(url, { ...options, signal: controller.signal });
      console.log(`[external:${label}] response received`, { attempt, status: response.status, elapsedMs: Date.now() - startedAt });
      if (attempt < attempts && [429, 500, 502, 503, 504].includes(response.status)) {
        await response.arrayBuffer();
        await new Promise(resolve => setTimeout(resolve, 750 * attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      console.error(`[external:${label}] request failed`, { attempt, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, 750 * attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof Error && lastError.name === "AbortError") throw new Error(`${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Please try again.`);
  throw new Error(`${label} could not be reached after ${attempts} attempts. Check the internet connection and try again.`);
}
async function transcribeAudioWithCompatibility({ apiKey, audit, source, keyterms }) {
  const requestedPath = resolveAudioPath(root, audit, source);
  try {
    const result = await transcribeWithDeepgram({ apiKey, filePath: requestedPath, keyterms });
    return { ...result, audioDelivery: { requestedSource: source, deliveredSource: source, converted: false, reason: "Deepgram accepted the selected audio directly." } };
  } catch (error) {
    if (!isDeepgramMediaError(error)) throw error;
    const fallback = await createDeepgramCompatibilityDerivative(root, audit, source);
    const result = await transcribeWithDeepgram({ apiKey, filePath: fallback.path, keyterms });
    return { ...result, audioDelivery: { requestedSource: source, deliveredSource: "compatibility-wav", converted: true, reason: "Deepgram could not decode the selected file, so Depo-Pro automatically retried with a lossless PCM WAV derivative.", derivativeKey: fallback.derivative.key, derivativeSha256: fallback.derivative.sha256, sourceSha256: fallback.derivative.sourceSha256 } };
  }
}
const server = http.createServer(async (req,res) => {
  const origin=req.headers.origin || "";
  if (!allowedOrigins.has(origin)) return json(res,403,{error:"Origin not allowed."},"null");
  if (req.method === "OPTIONS") { res.writeHead(204,{"access-control-allow-origin":origin,"access-control-allow-methods":"GET,POST","access-control-allow-headers":"content-type,x-admin-code,x-file-name"}); return res.end(); }
  try {
    if (req.url === "/api/audio/analyze" && req.method === "POST") {
      const originalName = decodeURIComponent(String(req.headers["x-file-name"] || "audio.bin"));
      const profile = await saveAndAnalyzeAudio(req, { root, originalName, contentType:req.headers["content-type"] });
      return json(res,200,profile,origin);
    }
    if (req.url === "/api/rx/status" && req.method === "GET") return json(res,200,inspectRx(),origin);
    if (req.url === "/api/system/preflight" && req.method === "GET") return json(res,200,systemPreflight({config:loadSecrets()}),origin);
    if (req.url === "/api/depositions" && req.method === "GET") return json(res,200,scanDepositions(root),origin);
    if (req.url === "/api/depositions" && req.method === "POST") {
      const input=await body(req,100*1024*1024);return json(res,201,createDeposition(root,input),origin);
    }
    if (req.url?.startsWith("/api/depositions/audio?") && req.method === "GET") {
      const url=new URL(req.url,"http://localhost"),resolved=resolveDepositionAudio(root,url.searchParams.get("id"),url.searchParams.get("index"));
      res.writeHead(200,{"content-type":path.extname(resolved.file).toLowerCase()===".flac"?"audio/flac":"application/octet-stream","content-length":fs.statSync(resolved.file).size,"content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(resolved.item.name)}`,"access-control-allow-origin":origin,"vary":"Origin","cache-control":"no-store"});return fs.createReadStream(resolved.file).pipe(res);
    }
    if (req.url === "/api/audio/select" && req.method === "POST") {
      const input=await body(req,64*1024); return json(res,200,await selectAudioSource(root,input.uploadId,input.source,"user-override",input.derivativeOperationId),origin);
    }
    if (req.url === "/api/audio/tools/upload" && req.method === "POST") {
      const originalName = decodeURIComponent(String(req.headers["x-file-name"] || "audio.bin"));
      return json(res,201,await saveAudioForTools(req,{root,originalName,contentType:req.headers["content-type"]}),origin);
    }
    if (req.url === "/api/audio/rx-process" && req.method === "POST") {
      const input=await body(req,64*1024); const audit=readAudioAudit(root,input.uploadId); const originalPath=resolveAudioPath(root,audit,"original");
      const recordAuditEvent=async event=>mutateAudioAudit(root,audit.uploadId,current=>current.history.push(event));
      const derivative=await createRxDerivative(root,audit,{originalPath,profileId:input.profileId,recordAuditEvent});
      const updated=await mutateAudioAudit(root,audit.uploadId,current=>{current.storage.derivatives.push(derivative);current.history.push({event:"rx-derivative-created",at:new Date().toISOString(),operationId:derivative.operationId,key:derivative.key,sha256:derivative.sha256,sourceSha256:derivative.sourceSha256,profileId:derivative.profileId})});
      return json(res,200,{derivative,audit:updated},origin);
    }
    if (req.url?.startsWith("/api/audio/derivative?") && req.method === "GET") {
      const url=new URL(req.url,"http://localhost"),audit=readAudioAudit(root,url.searchParams.get("uploadId"));
      const operationId=url.searchParams.get("operationId"),derivative=audit.storage.derivatives.find(item=>item.operationId===operationId);
      if(!derivative) throw new Error("Processed audio was not found.");
      const file=path.resolve(root,"data",derivative.key),directory=path.resolve(root,"data","audio-intake",audit.uploadId)+path.sep;
      if(!file.startsWith(directory)) throw new Error("Processed audio path is invalid.");
      res.writeHead(200,{"content-type":path.extname(file).toLowerCase()===".flac"?"audio/flac":"audio/wav","content-length":derivative.bytes,"access-control-allow-origin":origin,"vary":"Origin","cache-control":"no-store"}); return fs.createReadStream(file).pipe(res);
    }
    if (req.url === "/api/audio/auto-select" && req.method === "POST") {
      const input=await body(req,2*1024*1024),audit=readAudioAudit(root,input.uploadId);
      audit.automaticSelection={status:"not-run",method:"user-triggered-sampled-comparison",winner:"original",measuredWer:false,reason:"No full-file comparison was run during intake. The original remains selected until the user requests a sampled comparison."};
      const updated=await mutateAudioAudit(root,audit.uploadId,current=>{current.automaticSelection=audit.automaticSelection});return json(res,200,updated,origin);
    }    if (req.url === "/api/audio/transcribe" && req.method === "POST") {
      const input=await body(req,2*1024*1024); const config=loadSecrets(); const audit=readAudioAudit(root,input.uploadId); const source=input.source||audit.selectedSource;
      const transcript=await transcribeAudioWithCompatibility({apiKey:config?.deepgramApiKey,audit,source,keyterms:input.keyterms||[]});
      await recordTranscription(root,audit,source,transcript); return json(res,200,{source,...transcript},origin);
    }
    if (req.url === "/api/transcript/compare" && req.method === "POST") {
      const input=await body(req,10*1024*1024); const audit=readAudioAudit(root,input.uploadId); const source=input.source||audit.selectedSource; const hypothesis=input.hypothesis||audit.transcripts?.[source]?.transcript||"";
      const comparison={source,...compareTranscripts(input.reference,hypothesis,input.criticalTerms||[])}; await recordComparison(root,audit,comparison); return json(res,200,comparison,origin);
    }
    if (req.url?.startsWith("/api/audio/audit?") && req.method === "GET") {
      const uploadId=new URL(req.url,"http://localhost").searchParams.get("uploadId"); return json(res,200,publicAudit(readAudioAudit(root,uploadId)),origin);
    }    if (req.url === "/api/admin/status" && req.method === "GET") {
      const config=loadSecrets(); return json(res,200,{ initialized:!!config?.adminHash, anthropicConfigured:!!config?.anthropicApiKey, deepgramConfigured:!!config?.deepgramApiKey },origin);
    }
    if (req.url === "/api/admin/secrets" && req.method === "POST") {
      const input=await body(req,64*1024); const current=loadSecrets();
      if (current && !validCode(input.adminCode,current)) return json(res,401,{error:"The administrator access code is incorrect."},origin);
      if (!current && (!input.adminCode || input.adminCode.length < 8)) return json(res,400,{error:"Create an administrator access code with at least 8 characters."},origin);
      const derived=current ? {salt:current.adminSalt,hash:current.adminHash} : hashCode(input.adminCode);
      saveSecrets({ adminSalt:derived.salt, adminHash:derived.hash, anthropicApiKey:input.anthropicApiKey || current?.anthropicApiKey || "", deepgramApiKey:input.deepgramApiKey || current?.deepgramApiKey || "", claudeModel:input.claudeModel || current?.claudeModel || "claude-sonnet-4-5" });
      return json(res,200,{ok:true},origin);
    }
    if (req.url === "/api/claude/extract-notice" && req.method === "POST") {
      const config=loadSecrets(); if (!config?.anthropicApiKey) return json(res,503,{error:"Add the Anthropic API key in Administrator Settings first."},origin);
      const input=await body(req); const document=contentBlock(input.file); const supportingDocuments=(input.supportingFiles||[]).slice(0,10).map((file,index)=>[{type:"text",text:`Supporting document ${index+1}: ${file.name}. Use this only to confirm spellings, proper names, firms, locations, and specialized terminology. Do not override conflicting deposition facts from the Notice.`},contentBlock(file)]).flat();
      const tool=extractionTool;
      const response=await fetchExternal("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":config.anthropicApiKey,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:config.claudeModel,max_tokens:8192,system:terminologyPrompt+"\n\nCompatibility requirement: In the same extraction, populate the setup object for the Depo-Pro setup screen. The Notice controls setup facts when sources conflict.",tools:[tool],tool_choice:{type:"tool",name:"extract_deposition_intake"},messages:[{role:"user",content:[{type:"text",text:"The first document is the authoritative Notice of Deposition. Supporting documents follow."},document,...supportingDocuments]}]})},{label:"Claude document analysis"});
      const result=await response.json(); if(!response.ok) return json(res,response.status,{error:result?.error?.message || "Claude request failed."},origin);
      const toolUse=result.content?.find((item)=>item.type==="tool_use"&&item.name==="extract_deposition_intake"); if(!toolUse) throw new Error("Claude did not return structured intake data.");
      const data=toolUse.input;
      const seen=new Set();
      data.deepgram_keyterms.terms=(data.deepgram_keyterms.terms||[]).filter((item)=>{const term=String(item.term||"").trim();const key=term.toLowerCase();if(!term||seen.has(key))return false;seen.add(key);item.term=term;return true;}).slice(0,60);
      const wire=data.deepgram_keyterms.terms.map((item)=>item.term);
      const estimatedTokens=wire.reduce((sum,term)=>sum+Math.ceil(term.length/4)+1,0);
      data.deepgram_keyterms.wire=wire;
      data.deepgram_keyterms.term_count=wire.length;
      data.deepgram_keyterms.estimated_tokens=estimatedTokens;
      data.deepgram_keyterms.budget={token_ceiling:500,working_target:400,quality_target_range:[25,50],product_cap:60};
      data.ufm_registry.entry_count=(data.ufm_registry.entries||[]).length;
      const deepgramArtifact={case_id:data.case_id,case_style:data.setup.caseStyle,deponent:data.setup.witness,deposition_date:data.setup.depositionDate,generated_from:data.generated_from,prompt_version:"case_terms/v2",...data.deepgram_keyterms};
      const ufmData={case_id:data.case_id,case_style:data.setup.caseStyle,deponent:data.setup.witness,deposition_date:data.setup.depositionDate,generated_from:data.generated_from,prompt_version:"case_terms/v2",caption:data.caption,speaker_map:data.speaker_map,collisions:data.collisions,entries:data.ufm_registry.entries,entry_count:data.ufm_registry.entry_count,logistics:data.logistics,anomalies:data.anomalies,extraction_report:data.extraction_report};
      const anomalyWarnings=(data.anomalies||[]).map((item)=>`Review flag: ${item.detail||item.type||"Document anomaly"}${item.action?` — ${item.action}`:""}`);
      return json(res,200,{...data.setup,keyterms:wire,deepgramArtifact,ufmData,warnings:[...(data.setup.warnings||[]),...(data.extraction_report.low_confidence_spellings||[]).map((term)=>`Low-confidence spelling: ${term}`),...anomalyWarnings],confidence:data.setup.confidence},origin);
    }
    if (req.url === "/api/admin/test-keys" && req.method === "POST") {
      const config=loadSecrets();
      const results={anthropic:{ok:false,message:"Not configured"},deepgram:{ok:false,message:"Not configured"}};
      if(config?.anthropicApiKey){
        try{
          const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":config.anthropicApiKey,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:config.claudeModel,max_tokens:8,messages:[{role:"user",content:"Reply OK"}]})});
          const payload=await response.json(); results.anthropic=response.ok?{ok:true,message:`Authenticated successfully with ${config.claudeModel}.`}:{ok:false,message:payload?.error?.message||`Anthropic returned HTTP ${response.status}.`};
        }catch(error){results.anthropic={ok:false,message:error instanceof Error?error.message:"Anthropic connection failed."}}
      }
      if(config?.deepgramApiKey){
        try{
          const response=await fetch("https://api.deepgram.com/v1/auth/token",{headers:{Authorization:`Token ${config.deepgramApiKey}`}}); const payload=await response.json(); results.deepgram=response.ok?{ok:true,message:"Authenticated successfully."}:{ok:false,message:payload?.err_msg||payload?.message||`Deepgram returned HTTP ${response.status}.`};
        }catch(error){results.deepgram={ok:false,message:error instanceof Error?error.message:"Deepgram connection failed."}}
      }
      return json(res,200,results,origin);
    }    return json(res,404,{error:"Not found."},origin);
  } catch(error) { return json(res,500,{error:error instanceof Error?error.message:"Unexpected local service error.",code:error instanceof RxProcessingError?error.code:"LOCAL_API_ERROR"},origin); }
});
server.listen(port,"127.0.0.1",()=>console.log(`Depo Pro local API ready at http://127.0.0.1:${port}`));
