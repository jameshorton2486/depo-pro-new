import fs from "node:fs";
import { Readable } from "node:stream";

// Verbatim fidelity is decided here, before anything downstream can recover it.
//
// The reporter-verified Etminan transcript contains 134 "um", 100 "uh" and 2 "mm-hmm". A
// Texas deposition record is verbatim: disfluencies and profanity are evidence, not noise.
// So `filler_words` is not a preference, and `profanity_filter` off is not a default to lean
// on -- Deepgram's default happens to be off today, but an unpinned default is one that can
// change under us and start censoring a record with no diff to show for it.
//
// Pinning it also has to happen before Compare runs. If the two sides of an original-versus-
// enhanced comparison were transcribed under different parameters, a filler-word difference
// scores as an ASR error and the conclusion reads as an RX effect. Same discipline as the RX
// qualification protocol: hold every input constant except the one being measured.
export const DEEPGRAM_PLAYGROUND_OPTIONS = {
  model: "nova-3", language: "en", diarize_model: "v2", filler_words: "true", profanity_filter: "false",
  numerals: "true", paragraphs: "true", punctuate: "true", smart_format: "true", utterances: "true",
};
// v2: profanity_filter pinned explicitly. The request now differs, so this version differs --
// it is part of transcriptionIdentity, and two jobs sharing a configuration version while the
// request differed is the ADR-0018 defect. Bumped while zero transcripts exist, so no cached
// job is invalidated by it.
export const DEEPGRAM_CONFIGURATION_VERSION = "prerecorded-nova3-diarizer-v2-2";

export class DeepgramRequestError extends Error {
  constructor(message, { status, code, request=null, rawResponseBytes=null, responseHeaders=null } = {}) {
    super(message);
    this.name = "DeepgramRequestError";
    this.status = status;
    this.code = code || "";
    this.request=request;this.rawResponseBytes=rawResponseBytes;this.responseHeaders=responseHeaders;
  }
}

export function isDeepgramMediaError(error) {
  if (!(error instanceof DeepgramRequestError) || ![400, 415, 422].includes(error.status)) return false;
  return /audio|codec|container|decode|encoding|media|format|stream|m4a|aac/i.test(`${error.code} ${error.message}`);
}

export function buildDeepgramRequest(keyterms = []) {
  const terms=keyterms.map(term=>String(term).trim()).filter(Boolean);
  const params = new URLSearchParams(DEEPGRAM_PLAYGROUND_OPTIONS);
  terms.forEach(term => params.append("keyterm", term));
  return {url:`https://api.deepgram.com/v1/listen?${params}`,options:{...DEEPGRAM_PLAYGROUND_OPTIONS},keyterms:[...terms]};
}

export async function transcribeWithDeepgram({ apiKey, filePath, keyterms = [], request:preparedRequest=null, uploadId, operationId, fetchImpl=fetch, timeoutMs=Number(process.env.DEEPGRAM_TIMEOUT_MS)||2*60*60*1000 }) {
  if (!apiKey) throw new Error("Add the Deepgram API key in Administrator Settings first.");
  const request=preparedRequest||buildDeepgramRequest(keyterms),terms=request.keyterms;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),startedAt=Date.now(); let response;
  const correlator={uploadId,operationId};console.log("[external:Deepgram transcription] request started",{...correlator,keytermCount:terms.length,timeoutMs});
  try { response = await fetchImpl(request.url, {
    method: "POST", headers: { Authorization: `Token ${apiKey}`, "content-type": "application/octet-stream" },
    body: Readable.toWeb(fs.createReadStream(filePath)), duplex: "half", signal:controller.signal,
  }); console.log("[external:Deepgram transcription] response received",{...correlator,status:response.status,elapsedMs:Date.now()-startedAt}); } catch(error) { console.error("[external:Deepgram transcription] request failed",{...correlator,elapsedMs:Date.now()-startedAt,error:error instanceof Error?error.message:String(error)});if(error?.name==="AbortError") throw new DeepgramRequestError("Deepgram transcription timed out. The source remains preserved; retry when ready.",{code:"TIMEOUT"}); throw error; } finally { clearTimeout(timer); }
  const rawResponseBytes=Buffer.from(await response.arrayBuffer()),rawResponseText=rawResponseBytes.toString("utf8"),responseHeaders=Object.fromEntries(response.headers?.entries?.()||[]);let payload;
  try{payload=JSON.parse(rawResponseText)}catch{throw new DeepgramRequestError("Deepgram returned a non-JSON response.",{status:response.status,code:"INVALID_JSON_RESPONSE",request,rawResponseBytes,responseHeaders})}
  if (!response.ok) { console.error("[external:Deepgram transcription] request failed",{...correlator,status:response.status,elapsedMs:Date.now()-startedAt,code:payload?.err_code||payload?.code||""});throw new DeepgramRequestError(payload?.err_msg || payload?.message || `Deepgram returned HTTP ${response.status}.`, { status: response.status, code: payload?.err_code || payload?.code,request,rawResponseBytes,responseHeaders }); }
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0] || {};
  const paragraphs = alternative?.paragraphs?.paragraphs || [];
  const utterances = payload?.results?.utterances || [];
  const diarizationAvailable=[...paragraphs,...utterances,...(alternative.words||[])].some(item=>Number.isInteger(item?.speaker));
  const normalized={
    provider:"deepgram", operationId, model:payload?.metadata?.models?.[0]||"nova-3", requestId:payload?.metadata?.request_id||"",
    transcript:alternative.transcript||"", confidence:alternative.confidence??null, words:alternative.words||[], paragraphs, utterances,
    keyterms:terms, keytermCount:terms.length, options:DEEPGRAM_PLAYGROUND_OPTIONS, diarization:{requested:true,available:diarizationAvailable}, createdAt:new Date().toISOString(),
  };
  return {request,rawResponseBytes,rawResponseText,payload,response:{status:response.status,headers:responseHeaders},normalized};
}
