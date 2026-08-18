import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { ELEMENT } from "../server/transcript-labels.mjs";
import { indexEvidenceWords, renderTranscript } from "../server/transcript-render.mjs";

const render = (overrides = {}) => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", ...overrides });
const codes = result => result.findings.map(finding => finding.code);

test("the fixture renders clean",()=>{
  const result = render();
  assert.deepEqual(codes(result),[],`unexpected findings: ${JSON.stringify(result.findings)}`);
  assert.ok(result.paragraphs.length > 0);
});

test("every evidence word is rendered exactly once",()=>{
  // The invariant the whole editing model rests on. Splitting and relabelling must never lose
  // or duplicate a Deepgram word, so the render has to start from a state where the counts
  // agree -- otherwise a later diff cannot tell an editing bug from a pre-existing one.
  const result = render();
  const rendered = result.paragraphs.flatMap(paragraph => paragraph.words.map(word => word.id));
  assert.equal(rendered.length, EVIDENCE.words.length);
  assert.equal(new Set(rendered).size, rendered.length, "no word may appear twice");
  assert.deepEqual([...rendered].sort(), EVIDENCE.words.map(word => word.id).sort());
  assert.equal(result.counts.words, result.counts.evidenceWords);
});

test("paragraphs carry transcript labels, not role enums",()=>{
  const result = render();
  const shape = result.paragraphs.map(paragraph => [paragraph.elementType, paragraph.label]);
  assert.deepEqual(shape[0],[ELEMENT.COLLOQUY,"THE VIDEOGRAPHER:"]);
  assert.deepEqual(shape[1],[ELEMENT.COLLOQUY,"THE REPORTER:"]);
  assert.deepEqual(shape[2],[ELEMENT.QUESTION,"Q."]);
  assert.deepEqual(shape[3],[ELEMENT.ANSWER,"A."]);
  assert.equal(result.paragraphs.some(paragraph => /ATTORNEY|WITNESS_|_/.test(String(paragraph.label))),false,"no role enum may reach a label");
});

test("an objection becomes colloquy and the next question resumes with a by-line",()=>{
  const result = render();
  const objection = result.paragraphs.findIndex(paragraph => paragraph.label === "MR. RAMON:");
  assert.ok(objection > 0,"the objection must be labelled under opposing counsel");
  const resumed = result.paragraphs.slice(objection + 1).find(paragraph => paragraph.elementType === ELEMENT.QUESTION);
  assert.equal(resumed.byLine,"(BY MR. BENTLEY)");
});

test("each paragraph seeks to a measured word time, not a derived segment boundary",()=>{
  const result = render();
  for (const paragraph of result.paragraphs) {
    assert.ok(Number.isFinite(paragraph.start),`${paragraph.id} has no seek target`);
    assert.equal(paragraph.start, paragraph.words[0].start, "start must be the first word's own measured time");
    assert.ok(paragraph.end >= paragraph.start);
  }
  const starts = result.paragraphs.map(paragraph => paragraph.start);
  assert.deepEqual(starts,[...starts].sort((a,b)=>a-b),"paragraphs must be in playable order");
});

test("the seek target is the first rendered word, not the segment's own start",()=>{
  // In unsplit data these agree, so the preference is invisible -- a mutation replacing the
  // word time with `paragraph.start` survived the rest of this file. It stops agreeing the
  // moment a paragraph does not begin where its segment does, which is exactly what splitting
  // at a word boundary produces in step 5: the second half keeps the segment's start while its
  // first word is seconds later. Seeking to the segment there replays audio the reporter has
  // already heard and reads as broken sync.
  const [first, ...rest] = WORKING.segments;
  const tail = first.asrWordIds.slice(3);
  const wordStart = EVIDENCE.words.find(word => word.id === tail[0]).start;
  const working = { ...WORKING, segments:[{ ...first, asrWordIds:tail, start:first.start }, ...rest] };
  const result = renderTranscript({ working, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley" });
  assert.notEqual(wordStart, first.start, "the fixture must actually separate the two, or this proves nothing");
  assert.equal(result.paragraphs[0].start, wordStart);
});

test("words are individually addressable, which is what makes a split exact",()=>{
  // To split at "Yes." the UI turns a text selection into a word id. That is only exact if
  // each word is its own object; a text string would force character-offset arithmetic that
  // drifts the moment punctuation or spacing is normalised for display.
  const result = render();
  const answer = result.paragraphs.find(paragraph => paragraph.text.startsWith("Uh, my name"));
  assert.ok(answer.words.length >= 5);
  for (const word of answer.words) {
    assert.match(word.id,/^job[0-9a-f]+:word:\d+$/);
    assert.equal(typeof word.text,"string");
    assert.ok(Number.isFinite(word.start) && Number.isFinite(word.end));
  }
  assert.equal(answer.words[0].text,"Uh,","disfluencies must survive to the reader; filler_words is on for this reason");
});

test("a word missing from evidence is reported, not silently dropped",()=>{
  const working = { ...WORKING, segments:WORKING.segments.map((segment, index) => index === 0 ? { ...segment, asrWordIds:[...segment.asrWordIds,"job0000000000000000000000000000000000000000000000000000000000000:word:99999"] } : segment) };
  const result = render({ working });
  assert.ok(codes(result).includes("WORD_NOT_IN_EVIDENCE"));
  assert.equal(result.paragraphs[0].words.some(word => word.id.endsWith(":99999")),false);
});

test("a word claimed by two segments is reported once and rendered once",()=>{
  const stolen = WORKING.segments[0].asrWordIds[0];
  const working = { ...WORKING, segments:WORKING.segments.map((segment, index) => index === 1 ? { ...segment, asrWordIds:[stolen,...segment.asrWordIds] } : segment) };
  const result = render({ working });
  assert.ok(codes(result).includes("WORD_RENDERED_TWICE"));
  const rendered = result.paragraphs.flatMap(paragraph => paragraph.words.map(word => word.id));
  assert.equal(rendered.filter(id => id === stolen).length,1);
});

test("evidence that no segment claims is surfaced",()=>{
  // Silence here would show the reporter a transcript that is quietly missing testimony.
  const working = { ...WORKING, segments:WORKING.segments.slice(0, -1) };
  const result = render({ working });
  const finding = result.findings.find(item => item.code === "EVIDENCE_NOT_RENDERED");
  assert.ok(finding);
  assert.equal(finding.count, WORKING.segments.at(-1).asrWordIds.length);
});

test("a transcript with no speaker numbers is called out",()=>{
  // The falsifiable check for the first live Deepgram run. The fixture carries integer speaker
  // values throughout; if real evidence comes back with speaker:null on every word, this fires
  // and the diarization question is answered by measurement instead of by reading docs.
  const flat = { ...EVIDENCE, words:EVIDENCE.words.map(word => ({ ...word, deepgramSpeaker:null })) };
  const result = render({ evidence:[flat] });
  assert.equal(result.diarized,false);
  assert.ok(codes(result).includes("NO_DIARIZATION"));
  assert.equal(render().diarized,true,"the fixture itself must be diarized, or the check proves nothing");
});

test("duplicate word ids across evidence documents are reported",()=>{
  const result = render({ evidence:[EVIDENCE, EVIDENCE] });
  assert.ok(codes(result).includes("DUPLICATE_WORD_ID"));
});

test("indexEvidenceWords keeps the first occurrence and names the collisions",()=>{
  const { words, duplicates } = indexEvidenceWords([{ words:[{ id:"a", word:"first" }] },{ words:[{ id:"a", word:"second" }] }]);
  assert.equal(words.get("a").word,"first");
  assert.deepEqual(duplicates,["a"]);
});

test("an empty transcript renders rather than throwing",()=>{
  const result = renderTranscript({ working:{ segments:[] }, evidence:[], speakerCandidates:[] });
  assert.deepEqual(result.paragraphs,[]);
  assert.deepEqual(codes(result),[]);
  assert.equal(result.counts.words,0);
});

test("a missing honorific reaches the reader as a finding",()=>{
  const result = render({ speakerCandidates:SPEAKER_CANDIDATES.map(candidate => candidate.id === "counsel-ramon" ? { ...candidate, honorific:undefined } : candidate) });
  assert.ok(codes(result).includes("HONORIFIC_MISSING"));
  assert.ok(result.paragraphs.some(paragraph => paragraph.label === "RAMON:"),"the label degrades to the surname rather than guessing a title");
});

test("evidence from a superseded job is not part of this transcript's store",()=>{
  // DEP-20260815-ETM01 held two completed jobs for one audio. After the working transcript was
  // collapsed onto one of them, the other job's 12,185 words were still being indexed, and every
  // one of them reported as evidence that appears in no paragraph.
  const kept="jobA", dropped="jobB";
  const evidence=[
    { jobIdentity:kept, words:[{ id:`${kept}:word:1`, punctuatedWord:"Yes.", start:0, end:1, deepgramSpeaker:0 }] },
    { jobIdentity:dropped, words:[{ id:`${dropped}:word:1`, punctuatedWord:"Yes.", start:0, end:1, deepgramSpeaker:0 }] },
  ];
  const working={ derivedFrom:[kept], speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"s1", sourceJobIdentity:kept, asrWordIds:[`${kept}:word:1`], text:"Yes.", deepgramSpeaker:0, start:0, end:1 }] };
  const result=renderTranscript({ working, evidence });
  assert.equal(result.counts.evidenceWords,1,"only the derived job's words are in the store");
  assert.equal(result.findings.some(finding=>finding.code==="EVIDENCE_NOT_RENDERED"),false);
});

test("a transcript that does not say what it derives from keeps every document",()=>{
  // Failing open is deliberate. Narrowing on an absent derivedFrom would empty the store and
  // render nothing, which is a worse answer than showing the reader more than they asked for.
  const evidence=[
    { jobIdentity:"jobA", words:[{ id:"jobA:word:1", punctuatedWord:"Yes.", start:0, end:1, deepgramSpeaker:0 }] },
    { jobIdentity:"jobB", words:[{ id:"jobB:word:1", punctuatedWord:"No.", start:0, end:1, deepgramSpeaker:0 }] },
  ];
  const working={ speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"s1", sourceJobIdentity:"jobA", asrWordIds:["jobA:word:1"], text:"Yes.", deepgramSpeaker:0, start:0, end:1 }] };
  const result=renderTranscript({ working, evidence });
  assert.equal(result.counts.evidenceWords,2);
  assert.equal(result.findings.find(finding=>finding.code==="EVIDENCE_NOT_RENDERED")?.count,1);
});
