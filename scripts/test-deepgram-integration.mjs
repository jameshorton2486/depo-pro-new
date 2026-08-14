import fs from "node:fs";
import process from "node:process";
import { transcribeWithDeepgram } from "../server/deepgram-service.mjs";

const apiKey=process.env.DEEPGRAM_API_KEY,fixture=process.env.DEEPOPRO_DEEPGRAM_TEST_AUDIO;
if(!apiKey||!fixture){console.error("Set DEEPGRAM_API_KEY and DEEPOPRO_DEEPGRAM_TEST_AUDIO to an approved disposable audio fixture.");process.exit(2)}
const filePath=fixture;if(!fs.existsSync(filePath))throw new Error("DEEPOPRO_DEEPGRAM_TEST_AUDIO does not exist.");
const result=await transcribeWithDeepgram({apiKey,filePath,keyterms:["Depo-Pro integration fixture"],uploadId:"integration-fixture",operationId:"integration-fixture"}),raw=result.payload,alternative=raw?.results?.channels?.[0]?.alternatives?.[0];
if(!result.rawResponseBytes?.length||!alternative||!Array.isArray(alternative.words))throw new Error("Deepgram integration response did not contain preservable word evidence.");
if(raw?.metadata?.diarize_info?.model!=="v2")throw new Error(`Deepgram reported unexpected diarizer: ${JSON.stringify(raw?.metadata?.diarize_info||null)}`);
console.log(JSON.stringify({ok:true,requestId:raw.metadata?.request_id||null,model:raw.metadata?.models?.[0]||null,diarizeInfo:raw.metadata?.diarize_info||null,wordCount:alternative.words.length,rawBytes:result.rawResponseBytes.length},null,2));
