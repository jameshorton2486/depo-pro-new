// A separate, review-only pass. Entity correction cannot assign speakers by design; giving that
// pass this capability would let a spelling proposal silently change every Q. and A. attribution.
export const SPEAKER_ATTRIBUTION_PROMPT_VERSION = "speaker-attribution-v1.0.0";

export const SPEAKER_ATTRIBUTION_SYSTEM = [
  "You propose speaker identities and transcript roles for a deposition. You never finalize them.",
  "Use only the supplied audio-linked transcript excerpts, canonical participant roster, and explicit self-identifications.",
  "Return evidence for every proposal, a confidence from 0 to 1, and leave the speaker unassigned when evidence is insufficient.",
  "A name spoken in an appearance may be proposed as a missing participant, but must not be added to the canonical roster automatically.",
  "The reporter must accept, change, or reject every proposed identity and role before the speaker map is saved.",
  "Role rules:",
  "- QUESTIONING_ATTORNEY produces Q. only after that identity and role are confirmed.",
  "- WITNESS produces A. only in response to a confirmed question sequence; witness colloquy remains THE WITNESS.",
  "- DEFENDING_ATTORNEY, COURT_REPORTER, VIDEOGRAPHER, INTERPRETER, and OTHER remain colloquy under their confirmed labels.",
  "- Do not infer Q. or A. from punctuation alone.",
  "Formatting exception:",
  "- A literal K. is acceptable only when it is a line designation preceded by exactly two ordinary spaces and consists of K followed immediately by a period.",
  "- Do not use that exception for a K inside testimony, with zero/one/three spaces, or without the period.",
].join("\n");

export const speakerAttributionTool = Object.freeze({
  name:"propose_speaker_attributions",
  input_schema:{type:"object",additionalProperties:false,properties:{proposals:{type:"array",items:{type:"object",additionalProperties:false,properties:{sourceJobIdentity:{type:"string"},deepgramSpeaker:{type:"integer"},speakerIdentity:{type:["string","null"]},missingParticipantName:{type:["string","null"]},transcriptRole:{type:["string","null"],enum:["QUESTIONING_ATTORNEY","DEFENDING_ATTORNEY","WITNESS","COURT_REPORTER","VIDEOGRAPHER","INTERPRETER","OTHER",null]},confidence:{type:"number",minimum:0,maximum:1},evidence:{type:"string"}},required:["sourceJobIdentity","deepgramSpeaker","speakerIdentity","missingParticipantName","transcriptRole","confidence","evidence"]}}},required:["proposals"]}
});
