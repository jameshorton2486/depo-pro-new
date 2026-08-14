import fs from "node:fs";
import { Readable } from "node:stream";

export const DEEPGRAM_PLAYGROUND_OPTIONS = {
  model: "nova-3", language: "en", diarize: "true", diarize_model: "latest", filler_words: "true", numerals: "true",
  paragraphs: "true", punctuate: "true", smart_format: "true", utterances: "true",
};

export class DeepgramRequestError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "DeepgramRequestError";
    this.status = status;
    this.code = code || "";
  }
}

export function isDeepgramMediaError(error) {
  if (!(error instanceof DeepgramRequestError) || ![400, 415, 422].includes(error.status)) return false;
  return /audio|codec|container|decode|encoding|media|format|stream|m4a|aac/i.test(`${error.code} ${error.message}`);
}

export async function transcribeWithDeepgram({ apiKey, filePath, keyterms = [], fetchImpl=fetch, timeoutMs=Number(process.env.DEEPGRAM_TIMEOUT_MS)||2*60*60*1000 }) {
  if (!apiKey) throw new Error("Add the Deepgram API key in Administrator Settings first.");
  const terms = [...new Set(keyterms.map(term => String(term).trim()).filter(Boolean))].slice(0, 100);
  const params = new URLSearchParams(DEEPGRAM_PLAYGROUND_OPTIONS);
  terms.forEach(term => params.append("keyterm", term));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),startedAt=Date.now(); let response;
  console.log("[external:Deepgram transcription] request started",{keytermCount:terms.length,timeoutMs});
  try { response = await fetchImpl(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST", headers: { Authorization: `Token ${apiKey}`, "content-type": "application/octet-stream" },
    body: Readable.toWeb(fs.createReadStream(filePath)), duplex: "half", signal:controller.signal,
  }); console.log("[external:Deepgram transcription] response received",{status:response.status,elapsedMs:Date.now()-startedAt}); } catch(error) { console.error("[external:Deepgram transcription] request failed",{elapsedMs:Date.now()-startedAt,error:error instanceof Error?error.message:String(error)});if(error?.name==="AbortError") throw new DeepgramRequestError("Deepgram transcription timed out. The source remains preserved; retry when ready.",{code:"TIMEOUT"}); throw error; } finally { clearTimeout(timer); }
  const payload = await response.json();
  if (!response.ok) { console.error("[external:Deepgram transcription] request failed",{status:response.status,elapsedMs:Date.now()-startedAt,code:payload?.err_code||payload?.code||""});throw new DeepgramRequestError(payload?.err_msg || payload?.message || `Deepgram returned HTTP ${response.status}.`, { status: response.status, code: payload?.err_code || payload?.code }); }
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0] || {};
  const paragraphs = alternative?.paragraphs?.paragraphs || [];
  const utterances = payload?.results?.utterances || [];
  const diarizationAvailable=[...paragraphs,...utterances,...(alternative.words||[])].some(item=>Number.isInteger(item?.speaker));
  return {
    provider:"deepgram", model:payload?.metadata?.models?.[0]||"nova-3", requestId:payload?.metadata?.request_id||"",
    transcript:alternative.transcript||"", confidence:alternative.confidence??null, words:alternative.words||[], paragraphs, utterances,
    keyterms:terms, keytermCount:terms.length, options:DEEPGRAM_PLAYGROUND_OPTIONS, diarization:{requested:true,available:diarizationAvailable}, createdAt:new Date().toISOString(),
  };
}
