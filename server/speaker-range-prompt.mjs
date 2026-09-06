// Pass 2: saying who spoke a particular stretch of words.
//
// The existing speaker pass addresses a whole diarization cluster -- "speaker 3 is the witness" --
// and Production Trial #1 broke that in both directions on its first pass. One cluster held the
// witness answering the oath AND counsel reserving questions. One witness answer sat alone in a
// cluster of strangers. Neither is a statement about a cluster, so neither can be made.
//
// This pass makes the smaller statement: THESE WORDS, from this one to this one, were spoken by
// this person. That is the only thing it may say.
//
// WHAT IT MAY NOT SAY, and why the list is enforced by schema rather than by instruction:
//
//   Not Q., not A., not colloquy. Those are derived, downstream, from who spoke and who is
//   examining, by rules that are already qualified. Trial #1 proved the derivation works by hand --
//   a corrected speaker at 78:52 produced its own A. with nothing asserting it. A model given that
//   authority would be overruling a rule that is right, using a judgement that is a guess.
//
//   Not the words. This pass has no text authority at all. The schema has no field for it and the
//   validator refuses a speaker proposal that carries one.
//
//   Not a new person. Every identity must be one already in this deposition's record. A name the
//   model finds in the transcript and cannot match to the roster is not proposed at all; the
//   existing whole-cluster pass is where a missing participant is surfaced.
//
//   Not label, not split, not any overlay operation. The model proposes the fact; the server plans
//   the mutation. A model choosing its own operations would be choosing how the record is written.
export const SPEAKER_RANGE_PROMPT_VERSION = "speaker-range-v1.0.0";

/** The only correction type this pass may attempt. Withheld capability beats withheld permission. */
export const SPEAKER_RANGE_CORRECTION_TYPES = Object.freeze(["speaker_assignment"]);

export const SPEAKER_RANGE_SYSTEM = [
  "You identify who spoke a specific stretch of words in a deposition transcript. You never finalize anything; a court reporter reviews and accepts every proposal before it reaches the record.",
  "",
  "You are given one chunk of a transcript. Each utterance carries the machine's diarization cluster -- the speech-recognition system's guess at which voice it was -- and, where the reporter has already established it, a canonical person.",
  "",
  "The diarization cluster is evidence, not an answer. One cluster routinely holds two people, and one person is routinely split across clusters. That is why this pass exists.",
  "",
  "Report a range only when the transcript itself shows who spoke it:",
  "- somebody says their own name on the record",
  "- somebody is addressed by name and answers",
  "- the words can only belong to one role in the room, such as an oath administered or an appearance stated",
  "- a question and its answer make the two speakers plain from the exchange",
  "",
  "Rules:",
  "- Anchor every proposal to the wordId of the first word and the wordId of the last word, copied exactly from the chunk. Words marked as context are for reading only.",
  "- Propose only a canonical participant id from the supplied roster, copied exactly. If a person speaking is not on the roster, propose nothing for those words.",
  "- Make the range no larger than the evidence. When you can identify one sentence, propose that sentence, not the surrounding paragraph.",
  "- Do not propose a range that merely restates a cluster the reporter has already mapped. That assignment is already in the transcript.",
  "- Never say whether speech is a question, an answer, or colloquy. Those follow from who spoke and are decided elsewhere.",
  "- Never propose a change to the words, the punctuation, the numbers, or the dates. You have no authority over the text.",
  "- Two proposals may not cover the same word.",
  "",
  "Give the evidence in your own words for every proposal, and a confidence from 0 to 1. Confidence is advisory: a high number authorizes nothing.",
  "",
  "Prefer no proposal to an uncertain one. Return no proposals at all when the chunk shows nothing. That is a correct answer and the common one.",
].join("\n");

/**
 * Forces structured output, and the schema IS the authority boundary.
 *
 * There is no field for proposed text, no field for an element type, and no field for an overlay
 * operation, so the model cannot express those things whatever it is asked to do. `correctionType`
 * is a single-value enum for the same reason: an instruction can be misread, an enum cannot.
 */
export const speakerRangeTool = Object.freeze({
  name: "propose_speaker_ranges",
  description: "Report each stretch of words in this chunk that was spoken by a canonical participant other than the one currently recorded. Report nothing else.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      chunkId: { type: "string", description: "The chunkId given in the request, copied exactly." },
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            wordId: { type: "string", description: "Id of the FIRST word of the range, copied exactly from the chunk." },
            endWordId: { type: "string", description: "Id of the LAST word of the range, copied exactly. The same id as wordId for a single word." },
            correctionType: { type: "string", enum: ["speaker_assignment"] },
            speakerIdentity: { type: "string", description: "Canonical participant id from the supplied roster, copied exactly." },
            confidenceScore: { type: "number", minimum: 0, maximum: 1 },
            evidenceSource: { type: "string", enum: ["transcript", "case_context", "case_material", "keyterm"] },
          },
          required: ["wordId", "endWordId", "correctionType", "speakerIdentity", "confidenceScore", "evidenceSource"],
        },
      },
    },
    required: ["chunkId", "proposals"],
  },
});

/**
 * The chunk as the model sees it.
 *
 * Each utterance carries its diarization cluster and whatever canonical identity is already
 * recorded, because the question being asked is precisely whether those two agree. Word ids are
 * inline so a range can be anchored to evidence rather than to a position.
 */
export function buildSpeakerRangePrompt(chunk, { roster = [], clusters = new Map(), additionalInstructions = "" } = {}) {
  const lines = [`chunkId: ${chunk.chunkId}`, "", "Canonical participants (id | default role | name):"];
  for (const person of roster) lines.push(`${person.id} | ${person.defaultRole || "UNRECORDED"} | ${person.label}`);
  lines.push("", "Transcript chunk:");
  for (const utterance of chunk.utterances) {
    const cluster = clusters.get(utterance.id);
    const recorded = utterance.speakerIdentity ? `recorded as ${utterance.speakerIdentity}` : "no canonical speaker recorded";
    const diarization = Number.isInteger(cluster) ? `diarization cluster ${cluster}` : "no diarization cluster";
    lines.push("", `[${utterance.editable ? "EDITABLE" : "CONTEXT ONLY -- cannot be proposed against"}] ${diarization} | ${recorded}`);
    lines.push(utterance.words.map(word => (word.editable ? `${word.text}⟨${word.id}⟩` : word.text)).join(" "));
  }
  if (String(additionalInstructions).trim()) {
    lines.push("", "Reporter-requested checks (these do not widen what you may propose):", String(additionalInstructions).trim());
  }
  return lines.join("\n");
}
