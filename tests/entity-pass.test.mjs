import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ENTITY_PASS_CORRECTION_TYPES, buildChunkPrompt, buildEntityLexicon, entityProposalTool, listCorrectionPasses, readCorrectionPass, runEntityPass } from "../server/entity-pass.mjs";

const DEPOSITION = "DEP-20260818-ENTTY";
const JOB = "job";
const STARTED = "2026-08-18T14:00:00.000Z";
const field = value => ({ value, source: "NOD_EXTRACTED", state: "EXTRACTED", confidence: null, citations: [] });

/** A transcript that mishears the witness's surname twice, and says a year the pass must not touch. */
const LINE = "Doctor Atamanan examined the patient in 1991 and Mister Atamanan signed the report".split(" ");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-entity-"));
  const storageRoot = path.join(root, "depos");
  const directory = path.join(storageRoot, "reporter", "cause", "deposition");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.mkdirSync(path.join(directory, "transcript"), { recursive: true });
  fs.mkdirSync(path.join(directory, "deepgram"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: DEPOSITION }));
  fs.writeFileSync(path.join(directory, "intake", "intake.json"), JSON.stringify({ keyterms: ["Etminan", "Elizondo"] }));
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify({
    deposition: { witness: field("Mohammad Etminan, M.D.") },
    reporter: { fullName: field("Miah Bardot") },
    counsel: [{ id: "attorney-1", fullName: field("Steven A. Nunez"), actualAppearance: field(true), appearanceRole: field("QUESTIONING_ATTORNEY") }],
    parties: [{ id: "party-1", name: field("Delia Garza"), role: field("PLAINTIFF"), captionDisplayName: field("Delia Garza"), aliases: [] }],
    participants: { interpreters: [], videographers: [] },
  }));

  const words = LINE.map((word, index) => ({ id: `${JOB}:word:${index + 1}`, word, punctuatedWord: word, start: index * 0.5, end: index * 0.5 + 0.4, confidence: 0.9, deepgramSpeaker: 0, speakerConfidence: 0.9 }));
  fs.writeFileSync(path.join(directory, "transcript", "working.json"), JSON.stringify({
    schemaVersion: "1.1.0", transcript_hash: "stored-hash", derivedFrom: [JOB], depositionId: DEPOSITION,
    speakerMap: { status: "reconciled", assignments: [] },
    segments: [{ id: `${JOB}:segment:1`, sourceJobIdentity: JOB, asrWordIds: words.map(w => w.id), text: LINE.join(" "), deepgramSpeaker: 0, speakerIdentity: "witness", transcriptRole: "WITNESS", start: 0, end: 8 }],
  }));
  fs.mkdirSync(path.join(directory, "deepgram", "jobs", JOB), { recursive: true });
  fs.writeFileSync(path.join(directory, "deepgram", "jobs", JOB, "asr-evidence.json"), JSON.stringify({ jobIdentity: JOB, words }));
  return { root, storageRoot, directory };
}

const run = (value, submit, extra = {}) => runEntityPass(null, {
  depositionId: DEPOSITION, storageRoot: value.storageRoot, apiKey: "test-key", model: "claude-test", passStartedAt: STARTED, submit, ...extra,
});
const WORD = n => `${JOB}:word:${n}`;
const good = (wordId, proposedValue = "Etminan") => ({ wordId, correctionType: "spelling", proposedValue, confidenceScore: 0.93, evidenceSource: "keyterm" });

test("the lexicon is built from the deposition's own record",()=>{
  // The pass can only propose names that already exist here. That is what makes it a task with a
  // right answer rather than a judgement about what the testimony should say.
  const value = fixture();
  try {
    const canonical = JSON.parse(fs.readFileSync(path.join(value.directory, "intake", "canonical-deposition-record.json"), "utf8"));
    const lexicon = buildEntityLexicon({ canonical, keyterms: ["Elizondo"] });
    for (const expected of ["Etminan", "Bardot", "Nunez", "Garza", "Elizondo"]) assert.ok(lexicon.includes(expected), `${expected} is an authority for this deposition`);
    assert.equal(lexicon.includes("M.D."), false, "an honorific or suffix is not a name to correct to");
    assert.equal(lexicon.includes("Rodriguez"), false);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("the prompt marks context as uncorrectable and gives ids only for editable words",async()=>{
  // A model that cannot see which words it may anchor to will anchor to the wrong ones, and the
  // validator would then decline work that was never possible to do correctly.
  const value = fixture();
  try {
    let seen = null;
    await run(value, async ({ prompt, chunk }) => { seen = prompt; return { chunkId: chunk.chunkId, proposals: [] }; });
    assert.match(seen, /chunkId: [0-9a-f]{16}/);
    // Full names and their parts both, because the ASR mishears a surname alone as readily as a
    // whole name -- "Atamanan" is a mangled "Etminan", not a mangled "Mohammad Etminan".
    const listed = seen.split("Authoritative names:")[1].split("\n")[1].split(", ");
    for (const expected of ["Etminan", "Mohammad Etminan", "Bardot", "Nunez", "Garza", "Elizondo"]) {
      assert.ok(listed.includes(expected), `${expected} is offered as an authority`);
    }
    assert.match(seen, /Atamanan⟨job:word:2⟩/, "an editable word carries the id a proposal must anchor to");
    assert.match(seen, /\[EDITABLE\]/);
    // The prompt is built from the chunk, so a context utterance is marked as such wherever one exists.
    assert.match(buildChunkPrompt({ chunkId: "c", utterances: [{ editable: false, transcriptRole: "WITNESS", words: [{ id: "w1", text: "context", editable: false }] }] }, ["Etminan"]),
      /CONTEXT ONLY -- cannot be corrected/);
    assert.equal(/context⟨/.test(buildChunkPrompt({ chunkId: "c", utterances: [{ editable: false, words: [{ id: "w1", text: "context", editable: false }] }] }, [])), false,
      "a context word carries no id, so it cannot be anchored to even by mistake");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a well-formed entity correction is accepted and nothing is applied",async()=>{
  const value = fixture();
  try {
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [good(WORD(2)), good(WORD(9))] }));
    assert.equal(record.accepted.length, 2);
    assert.deepEqual(record.declined, []);
    assert.equal(record.applied, false, "a pass proposes; it never applies");
    assert.deepEqual(record.appliedOperations, []);
    for (const proposal of record.accepted) {
      assert.equal(proposal.reviewStateHash, record.reviewStateHash, "every proposal carries the state it was made against");
      assert.equal(proposal.correctionType, "spelling");
    }
    // And the transcript is untouched.
    const working = JSON.parse(fs.readFileSync(path.join(value.directory, "transcript", "working.json"), "utf8"));
    assert.equal(working.segments[0].text, LINE.join(" "));
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("the pass cannot do anything but spelling, whatever it returns",async()=>{
  // The constraints are enforced by the validator, not by the prompt. An instruction is a request.
  const value = fixture();
  try {
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [
      { wordId: WORD(7), correctionType: "word_replacement", proposedValue: "2001", confidenceScore: 0.9, evidenceSource: "transcript" },
      { wordId: WORD(4), correctionType: "structure", proposedValue: null, confidenceScore: 0.9, evidenceSource: "transcript" },
      { wordId: WORD(2), correctionType: "speaker_assignment", proposedValue: "witness", speakerIdentity: "witness", confidenceScore: 0.9, evidenceSource: "transcript" },
    ] }));
    assert.equal(record.accepted.length, 0);
    assert.deepEqual(record.declined.map(item => item.rule), ["R13", "R13", "R13"]);
    assert.equal(ENTITY_PASS_CORRECTION_TYPES.length, 1);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a name the record does not contain is declined and reported verbatim",async()=>{
  // The failure this pass most needs to refuse: a plausible name for a person who is not in the
  // case. What was attempted is the finding.
  const value = fixture();
  try {
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [good(WORD(2), "Rodriguez")] }));
    assert.equal(record.accepted.length, 0);
    assert.equal(record.declined[0].rule, "R14");
    assert.equal(record.declined[0].proposal.proposedValue, "Rodriguez");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a year is not correctable even when dressed as a spelling",async()=>{
  const value = fixture();
  try {
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [{ wordId: WORD(7), correctionType: "spelling", proposedValue: "2001", confidenceScore: 0.9, evidenceSource: "transcript" }] }));
    assert.equal(record.accepted.length, 0);
    assert.equal(record.declined[0].rule, "R12");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a response about another chunk is rejected and recorded as a failure",async()=>{
  const value = fixture();
  try {
    const record = await run(value, async () => ({ chunkId: "0000000000000000", proposals: [good(WORD(2))] }));
    assert.equal(record.accepted.length, 0);
    assert.equal(record.failures[0].code, "CHUNK_ID_MISMATCH");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a chunk that throws does not lose the rest of the pass",async()=>{
  // One bad response must not discard corrections found elsewhere in the transcript.
  const value = fixture();
  try {
    const record = await run(value, async () => { throw new Error("upstream timed out"); });
    assert.equal(record.failures.length, 1);
    assert.equal(record.failures[0].code, "CHUNK_FAILED");
    assert.match(record.failures[0].message, /timed out/);
    assert.equal(record.accepted.length, 0);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("finding nothing is a correct answer",async()=>{
  const value = fixture();
  try {
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [] }));
    assert.deepEqual([record.accepted, record.declined, record.failures], [[], [], []]);
    assert.equal(record.chunksSubmitted, record.chunksTotal);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("the pass is written where it can be read back, and says what produced it",async()=>{
  const value = fixture();
  try {
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [good(WORD(2))] }));
    const stored = readCorrectionPass(null, { depositionId: DEPOSITION, passId: record.passId, storageRoot: value.storageRoot });
    assert.equal(stored.model, "claude-test");
    assert.equal(stored.passType, "entity-resolution");
    assert.equal(stored.applied, false);
    assert.equal(stored.accepted.length, 1);
    const listed = listCorrectionPasses(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot });
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], { passId: record.passId, passType: "entity-resolution", model: "claude-test", passStartedAt: STARTED, applied: false, accepted: 1, declined: 0, failures: 0 });
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a pass without a key, a model or a start time refuses to run",async()=>{
  const value = fixture();
  try {
    const submit = async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [] });
    await assert.rejects(() => runEntityPass(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, model: "m", passStartedAt: STARTED, submit }), /Anthropic API key/);
    await assert.rejects(() => runEntityPass(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, apiKey: "k", passStartedAt: STARTED, submit }), /explicit model/);
    await assert.rejects(() => runEntityPass(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, apiKey: "k", model: "m", submit }), /explicit start time/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("the tool permits only the fields a proposal is made of",()=>{
  // Free-form prose is not a proposal. The schema refuses it before the validator has to.
  const item = entityProposalTool.input_schema.properties.proposals.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.correctionType.enum, ["spelling"]);
  assert.equal(item.properties.segmentId, undefined, "a segment id is never an anchor");
  assert.deepEqual(item.required.sort(), ["confidenceScore", "correctionType", "evidenceSource", "proposedValue", "wordId"]);
});
