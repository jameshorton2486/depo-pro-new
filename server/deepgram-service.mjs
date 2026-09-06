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
// Every option that reaches Deepgram lives here, including the ones whose value matches the
// provider default. An option left out is one whose behaviour is decided elsewhere and can
// change without a diff -- and because Compare scores original against RX-enhanced audio, any
// parameter that differs between the two runs is measured as an RX effect.
//
// `diarize` is deliberately absent, and must stay absent.
//
// `diarize_model` both enables diarization and selects the version -- it is a complete request
// on its own. The older `diarize=true` is deprecated, and on batch it routes to the v1
// diarizer to preserve behaviour for existing integrations. Sending both puts two conflicting
// selectors in one request with no documented precedence: either a 400, or a silent downgrade
// to v1. That downgrade is the dangerous one. It produces a transcript that looks correct and
// mislabels speakers more often, on a legal record, with nothing to notice.
//
// Pinning `v2` rather than `latest` is the same reasoning: `latest` is v2 today and will not
// always be, and a diarizer that changes under a stored job identity is the ADR-0018 defect.
export const DEEPGRAM_PLAYGROUND_OPTIONS = {
  model: "nova-3", language: "en", diarize_model: "v2", filler_words: "true",
  profanity_filter: "false", numerals: "true", paragraphs: "true", punctuate: "true",
  smart_format: "true", utterances: "true",
};
// -v2-2: profanity_filter pinned explicitly.
// -v2-3: diarize:"true" added on a mistaken reading of the API -- diarize_model alone is a
//        complete request, and the extra flag risked a silent downgrade to the v1 diarizer.
// -v2-3 reverted, and this string went back to -v2-2 with it: the option set is byte-identical
// to what -v2-2 described, and a version identifies a configuration rather than a point in
// history. Two runs of the same request must land on the same job identity.
//
// The two drift directions are not symmetric, which is why the guard below is where the effort
// goes. Options change while the version holds means two different requests share an identity
// -- wrong output under a false identity, and the digest guard catches it. Version changes
// while the options hold means one request under two identities: a cache miss and a duplicate
// paid call. Wasteful, never incorrect. Deriving the version from the digest would close the
// second, and it is not worth building for a cost measured in money rather than correctness.
//
// This string is part of transcriptionIdentity, and two jobs sharing a configuration version
// while the request differed is the ADR-0018 defect. It is hand-maintained, so a guard in
// tests/deepgram-verbatim.test.mjs pins it to a digest of the options: change any option
// without bumping this and the suite fails rather than silently reusing an identity.
//
// The one live bump, -v2-1 to -v2-2, happened while zero transcripts existed, so no cached job
// was invalidated by it.
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
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),startedAt=Date.now(); let response, rawResponseBytes;
  const correlator={uploadId,operationId};console.log("[external:Deepgram transcription] request started",{...correlator,keytermCount:terms.length,timeoutMs});
  try { response = await fetchImpl(request.url, {
    method: "POST", headers: { Authorization: `Token ${apiKey}`, "content-type": "application/octet-stream" },
    body: Readable.toWeb(fs.createReadStream(filePath)), duplex: "half", signal:controller.signal,
  }); rawResponseBytes = Buffer.from(await response.arrayBuffer()); console.log("[external:Deepgram transcription] response received",{...correlator,status:response.status,elapsedMs:Date.now()-startedAt}); } catch(error) { console.error("[external:Deepgram transcription] request failed",{...correlator,elapsedMs:Date.now()-startedAt,error:error instanceof Error?error.message:String(error)});if(error?.name==="AbortError") throw new DeepgramRequestError("Deepgram transcription timed out. The source remains preserved; retry when ready.",{code:"TIMEOUT"}); throw error; } finally { clearTimeout(timer); }
  const rawResponseText=rawResponseBytes.toString("utf8"),responseHeaders=Object.fromEntries(response.headers?.entries?.()||[]);let payload;
  try{payload=JSON.parse(rawResponseText)}catch{throw new DeepgramRequestError("Deepgram returned a non-JSON response.",{status:response.status,code:"INVALID_JSON_RESPONSE",request,rawResponseBytes,responseHeaders})}
  if (!response.ok) { console.error("[external:Deepgram transcription] request failed",{...correlator,status:response.status,elapsedMs:Date.now()-startedAt,code:payload?.err_code||payload?.code||""});throw new DeepgramRequestError(payload?.err_msg || payload?.message || `Deepgram returned HTTP ${response.status}.`, { status: response.status, code: payload?.err_code || payload?.code,request,rawResponseBytes,responseHeaders }); }
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0] || {};
  const paragraphs = alternative?.paragraphs?.paragraphs || [];
  const utterances = payload?.results?.utterances || [];
  const diarizationAvailable=[...paragraphs,...utterances,...(alternative.words||[])].some(item=>Number.isInteger(item?.speaker));
  const normalized={
    provider:"deepgram", operationId, model:payload?.metadata?.models?.[0]||"nova-3", requestId:payload?.metadata?.request_id||"",
    transcript:alternative.transcript||"", confidence:alternative.confidence??null, words:alternative.words||[], paragraphs, utterances,
    // `requested` is read from the request that was actually sent, not asserted -- it was
    // hardcoded true, which would have recorded a request as made whatever the query string
    // said. It keys on `diarize_model`, because that is the parameter that enables
    // diarization; keying it on the deprecated `diarize` flag would report false on every
    // correct request.
    keyterms:terms, keytermCount:terms.length, options:request.options, diarization:{requested:Boolean(request.options?.diarize_model),diarizerModel:request.options?.diarize_model??null,available:diarizationAvailable}, createdAt:new Date().toISOString(),
  };
  return {request,rawResponseBytes,rawResponseText,payload,response:{status:response.status,headers:responseHeaders},normalized};
}
