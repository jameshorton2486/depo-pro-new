import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { transcribeWithDeepgram } from "../server/deepgram-service.mjs";

const deposition = "C:\\Users\\james\\depos\\bardot_m\\c-572224-l\\mohammad_etminan_m_d_2026-04-24";
const baselineJob = "db4bca1b91a7b377c5f812e612e73a11509351c92987f56f26193219e82df38b";
const baselineRequestPath = path.join(deposition,"deepgram","jobs",baselineJob,"request.json");
const audioFile = path.join(deposition,"audio","original","Dr_Entiminan_Audio.IXZ.wav");
const secretFile = path.resolve("data","secrets.dat");
const outputDirectory = path.join(deposition,"deepgram","keyterm-experiment-2026-08-17");

const revisedKeyterms = [
  "Mohammad Etminan","Mohammad","Etminan","Dennis Bentley","Dennis","Bentley",
  "Marco","Crawford","Marco Crawford","Christian Ramon","Christian","Ramon",
  "Rocio Laura Elizondo Vargas","Rocio","Laura","Elizondo","Vargas",
  "Leonardo Isaias Rodriguez","Leonardo","Isaias","Rodriguez","Sandy Dean Koepke",
  "Sandy","Dean","Koepke","Standing Seam Specialty Company","Miah Bardot","Miah",
  "Bardot","Marco Crawford Law","Vidaurri Rodriguez Reyna","Vidaurri","Reyna",
  "discectomy","laminectomy","foraminal","pars interarticularis","radiculopathy","Waddell","LaGrande",
];

function decryptSecrets(file) {
  const encrypted=fs.readFileSync(file,"utf8");
  const command='Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($d)';
  const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",command],{input:encrypted,encoding:"utf8",windowsHide:true});
  if(result.status!==0)throw new Error("Could not decrypt the local Deepgram credential.");
  return JSON.parse(result.stdout.trim());
}

function count(words, target) {
  const folded=target.toLocaleLowerCase("en-US");
  return words.filter(item=>String(item.word??"").toLocaleLowerCase("en-US")===folded).length;
}

const baseline=JSON.parse(fs.readFileSync(baselineRequestPath,"utf8"));
const url=new URL(baseline.url);
url.searchParams.delete("keyterm");
for(const term of revisedKeyterms)url.searchParams.append("keyterm",term);
const request={url:url.toString(),options:baseline.options,keyterms:revisedKeyterms};
fs.mkdirSync(outputDirectory,{recursive:true});
const requestArtifact=JSON.stringify({
  experiment:"keyterms-only",baselineJob,baselineConfigurationVersion:baseline.configurationVersion,
  invariantOptions:baseline.options,keyterms:revisedKeyterms,url:request.url,submittedAt:new Date().toISOString(),
},null,2);
const requestFile=path.join(outputDirectory,"request.json");
if(!fs.existsSync(requestFile))fs.writeFileSync(requestFile,requestArtifact,{flag:"wx"});
if(fs.existsSync(path.join(outputDirectory,"raw-response.json")))throw new Error("The preserved experiment response already exists; refusing to submit twice.");

const secrets=decryptSecrets(secretFile);
const result=await transcribeWithDeepgram({apiKey:secrets.deepgramApiKey,filePath:audioFile,keyterms:revisedKeyterms,preparedRequest:request,uploadId:"23d963f7-6c6e-45b1-9292-1f1e6df617b6",operationId:"etminan-keyterms-only-2026-08-17"});
fs.writeFileSync(path.join(outputDirectory,"raw-response.json"),result.rawResponseBytes,{flag:"wx"});
const words=result.payload?.results?.channels?.[0]?.alternatives?.[0]?.words??[];
const summary={requestId:result.payload?.metadata?.request_id??null,wordCount:words.length,keytermCount:revisedKeyterms.length,
  counts:{Bentley:count(words,"Bentley"),Ramon:count(words,"Ramon")},baselineCounts:{Bentley:0,Ramon:1},
  completedAt:new Date().toISOString()};
fs.writeFileSync(path.join(outputDirectory,"summary.json"),JSON.stringify(summary,null,2),{flag:"wx"});
process.stdout.write(`${JSON.stringify(summary,null,2)}\n`);
