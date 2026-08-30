import { PARTY_ROLES } from "./canonical-deposition-record.mjs";

export const extractionTool = {
  name: "extract_deposition_intake",
  description: "Extract setup metadata and distinct Deepgram recognition and UFM editorial artifacts with audit data.",
  input_schema: { type:"object", additionalProperties:false, properties:{
    setup:{type:"object",additionalProperties:false,properties:{caseStyle:{type:"string"},witness:{type:"string"},depositionDate:{type:"string"},deponentType:{type:"string"},jurisdiction:{type:"string"},court:{type:"string"},causeNumber:{type:"string"},
// A party is a NAME and a ROLE, and they are two facts. As bare strings the model had nowhere to
// put the role, so it wrote it into the name -- "Heath Thomas (Plaintiff)" -- and left the record's
// own role field empty. That reaches a certified page: captionParties composes the caption block
// from these names, so the parenthetical would print on the title page and on certification-1,
// which is a false statement in certified output for the same reason an under-populated
// `represents` array is one.
//
// `role` is nullable AND required, unlike the optional fields below. The rule there is that a
// required field invites a value where the document supplies none; a required field that can be
// answered `null` does not, and it does make the model decide rather than quietly omit a field
// nobody would notice was missing. A notice that does not say which side a party is on gets null.
//
// The enum is PARTY_ROLES itself, not a copy of it. partyEntry uppercases what it is given and then
// THROWS on anything outside that list, so a role the schema permitted and the record rejects would
// fail deposition creation outright -- and until now no role reached it from an extraction at all,
// so nothing had ever exercised that path. Sharing the constant is what keeps the two ends of it
// from drifting apart.
parties:{type:"array",items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},role:{type:["string","null"],enum:[...PARTY_ROLES,null]}},required:["name","role"]}},// barNumber, address and appearanceRole are present in a Texas notice and already modelled in
// speaker_map, but nothing wired that branch into counsel. They are deliberately NOT in
// `required`: a required field invites a value where the document supplies none, and a
// hallucinated bar number on a court record is worse than a blank one the reporter fills in.
// `honorific` is here for the same reason and will almost always be absent -- a notice states
// names, not titles -- so it is reporter-entered by design. See transcript-labels.mjs.
//
// `represents` is an ARRAY because an attorney routinely appears for more than one party, and a
// scalar cannot say so. Two certified transcripts proved the cost: the Thomas appearance page
// reads "HOME DEPOT U.S.A., INC. A/K/A THE HOME DEPOT AND SHAWN HERBER" over Lucia Zhan, and the
// Etminan page names Rodriguez, Koepke and Standing Seam over Christian Ramon -- while both
// canonical records held one party each. The extraction did not mis-read the notices; it had
// nowhere to put the rest. An under-populated array prints a defendant heading that omits a party
// the certified record names, which is a false statement in certified output.
attorneys:{type:"array",items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},firm:{type:"string"},represents:{type:"array",items:{type:"string"},minItems:1},email:{type:"string"},phone:{type:"string"},barNumber:{type:"string"},address:{type:"string"},appearanceRole:{type:"string"},honorific:{type:["string","null"]}},required:["name","firm","represents","email","phone"]}},confidence:{type:"string",enum:["high","medium","low"]},warnings:{type:"array",items:{type:"string"}}},// deponentType is NOT required, and this is the field that proved the rule stated above.
//
// A notice states who is being deposed; it routinely does not state in what capacity. Requiring the
// field left the model no way to say so, and on the Heath Thomas notice it answered "party witness"
// -- while the same extraction raised a review flag saying the capacity was not stated. One record
// asserting a fact and flagging that the fact is unknown is worse than a blank, because only the
// blank asks the question again.
//
// It is omitted rather than nullable because the rest of the setup block reads a missing key and a
// null the same way, and there is no second reader who needs to tell them apart. Where that is not
// true -- parties[].role above -- the field is nullable and required instead.
required:["caseStyle","witness","depositionDate","jurisdiction","court","causeNumber","parties","attorneys","confidence","warnings"]},
    case_id:{type:"string"},prompt_version:{type:"string"},generated_from:{type:"array",items:{type:"string"}},
    deepgram_keyterms:{type:"object",additionalProperties:false,properties:{wire:{type:"array",items:{type:"string"}},terms:{type:"array",maxItems:50,items:{type:"object",additionalProperties:false,properties:{term:{type:"string"},tier:{type:"integer",minimum:1,maximum:6},reason:{type:"string"},source:{type:"string"}},required:["term","tier","reason","source"]}},term_count:{type:"integer"},estimated_tokens:{type:"integer"},budget:{type:"object",additionalProperties:false,properties:{token_ceiling:{type:"integer"},working_target:{type:"integer"},quality_target_range:{type:"array",items:{type:"integer"},minItems:2,maxItems:2},product_cap:{type:"integer"}},required:["token_ceiling","working_target","quality_target_range","product_cap"]},excluded:{type:"array",items:{type:"object",additionalProperties:false,properties:{term:{type:"string"},reason:{type:"string"}},required:["term","reason"]}},coverage_gaps:{type:"object",additionalProperties:false,properties:{note:{type:"string"},documents_that_would_materially_improve_this:{type:"array",items:{type:"string"}}},required:["note","documents_that_would_materially_improve_this"]}},required:["wire","terms","term_count","estimated_tokens","budget","excluded","coverage_gaps"]},
    ufm_registry:{type:"object",additionalProperties:false,properties:{entries:{type:"array",items:{type:"object",additionalProperties:false,properties:{canonical:{type:"string"},category:{type:"string",enum:["person","party","organization","firm","place","medical","pharmaceutical","technical","product","exhibit","procedural","other"]},asr_variants:{type:"array",items:{type:"string"}},rendering_rule:{type:["string","null"]},spoken:{type:"boolean"},in_keyterms:{type:"boolean"},source:{type:"string"},confidence:{type:"string",enum:["high","medium","low"]}},required:["canonical","category","asr_variants","rendering_rule","spoken","in_keyterms","source","confidence"]}},entry_count:{type:"integer"}},required:["entries","entry_count"]},
    caption:{type:"object",additionalProperties:true},collisions:{type:"array",items:{type:"object",additionalProperties:true}},logistics:{type:"object",additionalProperties:true},anomalies:{type:"array",items:{type:"object",additionalProperties:true}},
    speaker_map:{type:"array",items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},speaker_label:{type:"string"},role:{type:"string",enum:["examining_attorney","defending_attorney","witness","reporter","videographer","other"]},party:{type:["string","null"]},firm:{type:["string","null"]},bar_number:{type:["string","null"]},diarization_id:{type:"null"},confidence:{type:"string",enum:["high","medium","low"]},source:{type:"string"},note:{type:["string","null"]}},required:["name","speaker_label","role","party","firm","bar_number","diarization_id","confidence","source","note"]}},
    extraction_report:{type:"object",additionalProperties:false,properties:{documents_used:{type:"array",items:{type:"string"}},documents_missing:{type:"array",items:{type:"string"}},dropped_for_budget:{type:"array",items:{type:"object",additionalProperties:false,properties:{term:{type:"string"},reason:{type:"string"}},required:["term","reason"]}},low_confidence_spellings:{type:"array",items:{type:"string"}},notes:{type:"string"}},required:["documents_used","documents_missing","dropped_for_budget","low_confidence_spellings","notes"]}
  },required:["setup","case_id","prompt_version","generated_from","deepgram_keyterms","ufm_registry","caption","collisions","logistics","anomalies","speaker_map","extraction_report"]}
};
