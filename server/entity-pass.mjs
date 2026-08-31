// Pass 1: resolving names the microphone got wrong.
//
// This is the first place a model touches the transcript, and it is deliberately the narrowest
// useful task: the ASR heard "Atamanan" where the record says "Etminan", and the record is what
// settles it. The model is not asked what the testimony should say. It is asked which word in this
// chunk is a misheard rendering of a name that already exists in this deposition's own record.
//
// Three constraints make that a task a model can be held to, and all three are enforced by the
// validator rather than by the prompt, because an instruction is a request and a gate is a rule:
//
//   Only spelling. The pass cannot delete a word, restructure a paragraph, reassign a speaker or
//   replace a phrase, because those correction types are not enabled for it.
//
//   Only names already in the record. Every proposed value must come from a lexicon built from the
//   canonical deposition record and the keyterms -- the witness, the reporter, counsel, the
//   parties. A name the model invents has nowhere to come from.
//
//   Never digits. A year, an age or a dosage is substance, and no correction to a name changes one.
//
// NOTHING IS APPLIED. The pass produces proposals and writes them beside the transcript for the
// reporter to accept or reject. Every proposal carries the review-state hash of the transcript it
// was generated against, so one that has gone stale is refused at acceptance rather than rebased
// onto text the reporter has since changed.
import fs from "node:fs";
import path from "node:path";
import { buildCorrectionChunks } from "./correction-chunker.mjs";
import { validateProposals } from "./correction-validator.mjs";
import { depositionDirectory } from "./deposition-store.mjs";
import { fetchExternal } from "./external-fetch.mjs";
import { nameTerms } from "./keyterm-coverage.mjs";

export const ENTITY_PASS_VERSION = "entity-resolution-v1.0.0";
/** The only correction type this pass may attempt. Withheld capability beats withheld permission. */
export const ENTITY_PASS_CORRECTION_TYPES = Object.freeze(["spelling"]);

const value = field => (field && typeof field === "object" && "value" in field ? field.value : field);
const text = candidate => String(value(candidate) ?? "").trim();

/**
 * The names this pass is allowed to propose, drawn from the deposition's own record.
 *
 * Whole names and their parts, because the ASR mishears a surname on its own as readily as a full
 * name. Counsel who did not appear are included: they are named in the caption and in argument
 * whether or not they were in the room, and a pass that could not spell them would leave exactly
 * the corrections it exists to make.
 */
export function buildEntityLexicon({ canonical, keyterms = [] } = {}) {
  const terms = new Set();
  const add = candidate => { for (const term of nameTerms(text(candidate))) if (term) terms.add(term); };

  add(canonical?.deposition?.witness);
  add(canonical?.reporter?.fullName);
  for (const attorney of canonical?.counsel ?? []) add(attorney.fullName);
  for (const party of canonical?.parties ?? []) {
    add(party.name);
    add(party.captionDisplayName);
    for (const alias of party.aliases ?? []) add(alias.name);
  }
  for (const participant of [...(canonical?.participants?.interpreters ?? []), ...(canonical?.participants?.videographers ?? [])]) add(participant.fullName ?? participant.name);
  for (const term of keyterms) add(term);
  return [...terms].filter(Boolean).sort();
}

/** Forces structured output. A free-text answer is not a proposal and has nowhere to go. */
export const entityProposalTool = Object.freeze({
  name: "propose_entity_corrections",
  description: "Report every word in this chunk that is a misheard rendering of a name from the authoritative list. Report nothing else.",
  input_schema: {
    type: "object",
    properties: {
      chunkId: { type: "string", description: "The chunkId given in the request, copied exactly." },
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            wordId: { type: "string", description: "The id of the editable word to correct, copied exactly from the chunk." },
            correctionType: { type: "string", enum: ["spelling"] },
            proposedValue: { type: "string", description: "The corrected spelling. Must appear in the authoritative name list." },
            confidenceScore: { type: "number", description: "0 to 1." },
            evidenceSource: { type: "string", enum: ["keyterm", "case_context", "case_material", "transcript"] },
          },
          required: ["wordId", "correctionType", "proposedValue", "confidenceScore", "evidenceSource"],
          additionalProperties: false,
        },
      },
    },
    required: ["chunkId", "proposals"],
  },
});

export const ENTITY_PASS_SYSTEM = [
  "You correct misheard proper names in deposition transcripts produced by speech recognition.",
  "",
  "You are given one chunk of a transcript and the authoritative list of names that appear in this deposition's record: the witness, the court reporter, counsel, and the parties.",
  "",
  "Report a word only when it is a plausible mishearing of a name on that list. 'Atamanan' for 'Etminan' is the case this exists for.",
  "",
  "Rules:",
  "- Propose only values that appear in the authoritative list, exactly as spelled there.",
  "- Anchor every proposal to the wordId of an editable word, copied exactly. Words marked as context are for reading only and cannot be corrected.",
  "- Never change a number. Years, ages, amounts and dosages are testimony, not spelling.",
  "- Do not correct grammar, punctuation, filler words, or anything that is not a name.",
  "- Do not add, remove or reorder words. One word in, one word out.",
  "- If a word is merely unusual, or if you are unsure which name it is, leave it alone. A missed correction costs nothing; a wrong one enters a court record.",
  "",
  "Return no proposals at all if the chunk contains no misheard names. That is the common case and it is a correct answer.",
].join("\n");

/** The chunk as the model sees it: editable words with their ids, context marked as unusable. */
export function buildChunkPrompt(chunk, lexicon, additionalInstructions = "") {
  const lines = [`chunkId: ${chunk.chunkId}`, "", "Authoritative names:", lexicon.join(", "), "", "Transcript chunk:"];
  for (const utterance of chunk.utterances) {
    const speaker = utterance.transcriptRole ? `${utterance.transcriptRole}` : "UNLABELLED";
    lines.push("", `[${utterance.editable ? "EDITABLE" : "CONTEXT ONLY -- cannot be corrected"}] ${speaker}`);
    lines.push(utterance.words.map(word => (word.editable ? `${word.text}⟨${word.id}⟩` : word.text)).join(" "));
  }
  if (String(additionalInstructions).trim()) lines.push("", "Reporter-requested checks (these do not expand the allowed correction types or authoritative name list):", String(additionalInstructions).trim());
  return lines.join("\n");
}

async function submitToClaude({ apiKey, model, prompt }) {
  const response = await fetchExternal("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 4096, system: ENTITY_PASS_SYSTEM,
      tools: [entityProposalTool], tool_choice: { type: "tool", name: entityProposalTool.name },
      messages: [{ role: "user", content: prompt }],
    }),
  }, { label: "entity-pass" });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || "Claude request failed.");
  const call = result.content?.find(item => item.type === "tool_use" && item.name === entityProposalTool.name);
  if (!call) throw new Error("Claude did not return structured proposals.");
  return call.input;
}

/**
 * Runs the pass and writes its proposals, applying nothing.
 *
 * `submit` is injectable so the pass can be exercised without a network call, which is how every
 * test of it runs. A chunk that fails is recorded and the pass continues: one bad response should
 * not discard the corrections found in the rest of the transcript.
 */
export async function runEntityPass(root, { depositionId, storageRoot, apiKey, model, passStartedAt, submit = submitToClaude, limitChunks = null, additionalInstructions = "" } = {}) {
  if (!apiKey) throw new Error("Add the Anthropic API key in Administrator Settings before running a correction pass.");
  if (!model) throw new Error("A correction pass requires an explicit model.");
  if (!passStartedAt) throw new Error("A correction pass requires an explicit start time, so its pass id is reproducible.");

  const jobs = await import("./transcription-jobs.mjs");
  const store = { depositionId, storageRoot };
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const transcript = jobs.getWorkingTranscript(root, store);
  const evidence = jobs.readAsrEvidence(root, store);
  const overlay = jobs.readReporterOverlay(root, store);
  const canonical = JSON.parse(fs.readFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), "utf8"));
  const intake = JSON.parse(fs.readFileSync(path.join(directory, "intake", "intake.json"), "utf8"));

  const lexicon = buildEntityLexicon({ canonical, keyterms: intake.keyterms ?? [] });
  if (!lexicon.length) throw new Error("This deposition's record names nobody, so there is no authority to correct spellings against.");
  const roster = new Set((canonical?.counsel ?? []).map(item => item.id).concat(["witness", "reporter"]));

  const { passId, chunks, reviewStateHash, transcriptContentHash, findings } = buildCorrectionChunks({ depositionId, transcript, evidence, overlay, passStartedAt });
  const selected = limitChunks ? chunks.slice(0, limitChunks) : chunks;

  const accepted = [], declined = [], failures = [];
  for (const chunk of selected) {
    try {
      const response = await submit({ apiKey, model, prompt: buildChunkPrompt(chunk, lexicon, additionalInstructions), chunk });
      const verdict = validateProposals(response, { chunk, roster, allowedCorrectionTypes: ENTITY_PASS_CORRECTION_TYPES, lexicon });
      if (verdict.rejected) { failures.push({ chunkId: chunk.chunkId, ...verdict.rejected }); continue; }
      for (const proposal of verdict.accepted) accepted.push({ ...proposal, chunkId: chunk.chunkId, reviewStateHash });
      for (const item of verdict.declined) declined.push({ chunkId: chunk.chunkId, ...item });
    } catch (error) {
      failures.push({ chunkId: chunk.chunkId, code: "CHUNK_FAILED", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const record = {
    schemaVersion: "1.0.0",
    recordType: "CORRECTION_PROPOSALS",
    passType: "entity-resolution",
    passVersion: ENTITY_PASS_VERSION,
    passId, depositionId, model, passStartedAt, additionalInstructions:String(additionalInstructions).trim(),
    transcriptContentHash, reviewStateHash,
    // Stated so nobody downstream has to infer it: these are proposals, and they change nothing
    // until a reporter accepts them.
    applied: false,
    appliedOperations: [],
    chunksTotal: chunks.length, chunksSubmitted: selected.length,
    lexiconSize: lexicon.length,
    chunkFindings: findings,
    accepted, declined, failures,
    completedAt: new Date().toISOString(),
  };
  const file = path.join(directory, "transcript", "correction-passes", `${passId}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

export function readCorrectionPass(root, { depositionId, passId, storageRoot } = {}) {
  const file = path.join(depositionDirectory(root, depositionId, { storageRoot }), "transcript", "correction-passes", `${passId}.json`);
  if (!fs.existsSync(file)) throw new Error("Correction pass was not found.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function listCorrectionPasses(root, { depositionId, storageRoot } = {}) {
  const directory = path.join(depositionDirectory(root, depositionId, { storageRoot }), "transcript", "correction-passes");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => name.endsWith(".json")).map(name => {
    const record = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    return { passId: record.passId, passType: record.passType, model: record.model, passStartedAt: record.passStartedAt, applied: record.applied, accepted: record.accepted.length, declined: record.declined.length, failures: record.failures.length };
  }).sort((left, right) => String(right.passStartedAt).localeCompare(String(left.passStartedAt)));
}
