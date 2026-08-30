import test from "node:test";
import assert from "node:assert/strict";
import { speakerEvidenceBuckets, speakerPrompt, validateSpeakerSuggestions } from "../server/speaker-attribution-pass.mjs";

test("speaker evidence stays separated by source job and accepts reporter checks",()=>{
  const buckets=speakerEvidenceBuckets([
    {sourceJobIdentity:"job-a",deepgramSpeaker:3,text:"Lucia Zahn for the defendant."},
    {sourceJobIdentity:"job-b",deepgramSpeaker:3,text:"A different recording."},
  ]);
  assert.equal(buckets.length,2);
  const prompt=speakerPrompt({candidates:[{id:"attorney-1",defaultRole:"ATTORNEY",label:"Lucia Zahn"}],roles:["ATTORNEY"],buckets,additionalInstructions:"Check recurring phrases."});
  assert.match(prompt,/Check recurring phrases/);
  assert.match(prompt,/do not expand your capabilities/);
});

test("speaker suggestions are proposals and cannot invent identities or buckets",()=>{
  const context={buckets:[{key:"job-a:3",sourceJobIdentity:"job-a",deepgramSpeaker:3}],candidates:[{id:"attorney-1"}],roles:["ATTORNEY"]};
  const valid=validateSpeakerSuggestions({proposals:[{sourceJobIdentity:"job-a",deepgramSpeaker:3,speakerIdentity:"attorney-1",missingParticipantName:null,transcriptRole:"ATTORNEY",confidence:.96,evidence:"The speaker states her name."}]},context);
  assert.equal(valid[0].speakerIdentity,"attorney-1");
  assert.throws(()=>validateSpeakerSuggestions({proposals:[{sourceJobIdentity:"job-a",deepgramSpeaker:3,speakerIdentity:"invented",missingParticipantName:null,transcriptRole:"ATTORNEY",confidence:.96,evidence:"guess"}]},context),/outside the canonical roster/);
});
