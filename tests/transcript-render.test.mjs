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

test("the rendered word carries a styled display alongside its evidence text",()=>{
  // The Workspace renders word.display and seeds its editor from word.text. Both have to be
  // present on every word or one of those reads undefined: the screen would show the raw form
  // while the API reported the styled one, which is the mismatch this test exists to catch.
  const evidence=[{ jobIdentity:"job", words:[
    { id:"job:word:1", punctuatedWord:"04/24/2026,", start:0, end:1, deepgramSpeaker:0 },
    { id:"job:word:2", punctuatedWord:"okay", start:1, end:2, deepgramSpeaker:0 },
  ]}];
  const working={ derivedFrom:["job"], speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"s1", sourceJobIdentity:"job", asrWordIds:["job:word:1","job:word:2"], text:"04/24/2026, okay", deepgramSpeaker:0, start:0, end:2 }] };
  const [paragraph]=renderTranscript({ working, evidence }).paragraphs;
  assert.equal(paragraph.words[0].text,"04/24/2026,");
  assert.equal(paragraph.words[0].display,"April 24, 2026,");
  assert.equal(paragraph.words[0].styled,true);
  // An unstyled word still carries a display, so the consumer never has to branch.
  assert.equal(paragraph.words[1].display,"okay");
  assert.equal(paragraph.words[1].styled,undefined);
});

test("the rendered transcript reports its own content hash",()=>{
  // withTranscriptContentHash writes `transcript_hash`; this field read `transcriptContentHash`
  // and so reported null for every transcript ever rendered. It went unnoticed because nothing
  // displayed it -- and it is the transcript's identity, the value a correction pass invalidates
  // against and the one a reporter would cite for a certified page.
  const evidence=[{ jobIdentity:"job", words:[{ id:"job:word:1", punctuatedWord:"Yes.", start:0, end:1, deepgramSpeaker:0 }] }];
  const working={ derivedFrom:["job"], transcript_hash:"abc123", speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"s1", sourceJobIdentity:"job", asrWordIds:["job:word:1"], text:"Yes.", deepgramSpeaker:0, start:0, end:1 }] };
  const result=renderTranscript({ working, evidence });
  assert.equal(result.transcriptContentHash,"abc123");
  assert.deepEqual(result.derivedFrom,["job"]);
  // A transcript with no hash reports none rather than inventing one.
  assert.equal(renderTranscript({ working:{ ...working, transcript_hash:undefined }, evidence }).transcriptContentHash,null);
});

const threeWords = [{ jobIdentity:"job", words:[
  { id:"job:word:1", punctuatedWord:"hello", start:1, end:1.5, deepgramSpeaker:0 },
  { id:"job:word:2", punctuatedWord:"damn",  start:2, end:2.5, deepgramSpeaker:0 },
  { id:"job:word:3", punctuatedWord:"world", start:3, end:3.5, deepgramSpeaker:0 },
]}];
const oneSegment = {
  derivedFrom:["job"], transcript_hash:"stored", speakerMap:{ status:"unreconciled", assignments:[] },
  segments:[{ id:"job:segment:1", sourceJobIdentity:"job", sourceUploadId:"u", sourceOrdinal:0,
    asrWordIds:["job:word:1","job:word:2","job:word:3"], text:"hello damn world",
    deepgramSpeaker:0, speakerIdentity:null, transcriptRole:null, start:1, end:3.5 }],
};

test("a struck word is struck from the reading, not just from the word list",()=>{
  // A deletion strikes a word without removing it from the record, so words[] keeps it flagged
  // for the Workspace to render struck. paragraph.text is the reading, and it must not contain
  // it. Building the text from the unfiltered word list put it back: the screen looked correct
  // because it renders words[], while every consumer of paragraph.text -- an exporter, chunking
  // for the correction pass, a certified page -- got the struck word again.
  const overlay={ schemaVersion:"1.0.0", recordType:"REPORTER_OVERLAY", depositionId:"DEP", operations:[{ op:"delete", wordId:"job:word:2" }] };
  const [paragraph]=renderTranscript({ working:oneSegment, evidence:threeWords, overlay }).paragraphs;
  assert.equal(paragraph.text,"hello world","the struck word must not be in the reading");
  assert.equal(paragraph.words.length,3,"but it stays in the record");
  assert.equal(paragraph.words[1].deleted,true);
  assert.equal(paragraph.words[1].text,"damn","with its original text intact");
});

test("the rendered hash observes a reporter edit; the stored hash does not",()=>{
  // transcript_hash covers working.json alone, which is correct for what it names -- the overlay
  // lives beside it and is applied at render. That leaves nothing identifying what was actually
  // read, and a correction pass invalidating against transcript_hash would treat an edited
  // transcript as unedited. renderedContentHash is that identity; nothing on disk changes.
  const clean=renderTranscript({ working:oneSegment, evidence:threeWords });
  const edited=renderTranscript({ working:oneSegment, evidence:threeWords,
    overlay:{ schemaVersion:"1.0.0", recordType:"REPORTER_OVERLAY", depositionId:"DEP", operations:[{ op:"delete", wordId:"job:word:2" }] } });
  assert.equal(clean.transcriptContentHash,"stored");
  assert.equal(edited.transcriptContentHash,"stored","the stored projection hash is unchanged by an edit");
  assert.notEqual(clean.renderedContentHash,edited.renderedContentHash,"the rendered hash must change");
  assert.match(clean.renderedContentHash,/^[0-9a-f]{64}$/);
});

test("a paragraph carries the job it came from",()=>{
  // speakerBuckets keys the speaker map by (job, speaker) and had to recover the job by
  // splitting an id string. A format change there would silently collapse every bucket back to
  // speaker index and merge unrelated people into one row.
  const [paragraph]=renderTranscript({ working:oneSegment, evidence:threeWords }).paragraphs;
  assert.equal(paragraph.sourceJobIdentity,"job");
});

test("the job identity comes from the segment, not from the shape of its id",()=>{
  // The previous test passes whether the value is carried or re-derived, because both agree
  // while ids look like "job:segment:1". The risk is a segment id that does not encode the job:
  // the parse then returns the wrong thing and every speaker bucket silently merges. Asserted
  // with an id whose prefix is not the job identity, so only the carried value can be right.
  const evidence=[{ jobIdentity:"job", words:[{ id:"w1", punctuatedWord:"Yes.", start:0, end:1, deepgramSpeaker:0 }] }];
  const working={ derivedFrom:["job"], speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"a-segment-id-that-encodes-nothing", sourceJobIdentity:"job", sourceUploadId:"u", sourceOrdinal:0,
      asrWordIds:["w1"], text:"Yes.", deepgramSpeaker:0, speakerIdentity:null, transcriptRole:null, start:0, end:1 }] };
  const [paragraph]=renderTranscript({ working, evidence }).paragraphs;
  assert.equal(paragraph.sourceJobIdentity,"job","the carried value, not the id prefix");
  assert.notEqual(paragraph.sourceJobIdentity,"a-segment-id-that-encodes-nothing");
});

test("choosing Ms. is reported, not silent",()=>{
  // The ruling converts every spoken "miss" to "Ms." That is right, and it is also the one rule
  // here that chooses between forms a certified record distinguishes -- Miss, Ms. and Mrs. --
  // where the recording does not settle which was said. HONORIFIC_MISSING exists to make exactly
  // that visible for a speaker label; a silent conversion in the body would remove the same
  // signal. The conversion still happens; the reporter gets a list.
  const evidence=[{ jobIdentity:"job", words:[
    { id:"job:word:1", punctuatedWord:"miss", start:1, end:1.5, deepgramSpeaker:0 },
    { id:"job:word:2", punctuatedWord:"Vargas", start:2, end:2.5, deepgramSpeaker:0 },
  ]}];
  const working={ derivedFrom:["job"], speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"job:segment:1", sourceJobIdentity:"job", sourceUploadId:"u", sourceOrdinal:0,
      asrWordIds:["job:word:1","job:word:2"], text:"miss Vargas", deepgramSpeaker:0, speakerIdentity:null, transcriptRole:null, start:1, end:2.5 }] };
  const result=renderTranscript({ working, evidence });
  assert.equal(result.paragraphs[0].text,"Ms. Vargas","the conversion still happens");
  const finding=result.findings.find(item => item.code === "HONORIFIC_ASSUMED");
  assert.ok(finding,"and it is reported");
  assert.equal(finding.count,1);
  assert.deepEqual(finding.wordIds,["job:word:1"]);
  assert.match(finding.message,/Miss, Ms\. and Mrs\./);
});

test("a word Deepgram already wrote as Ms. is not reported as a choice",()=>{
  // 32 of ETM01's 53 rendered "Ms." were already "Ms." in the ASR; only 21 are conversions. A
  // finding that counted the rendered form rather than the change would overstate by half.
  const evidence=[{ jobIdentity:"job", words:[
    { id:"job:word:1", punctuatedWord:"Ms.", start:1, end:1.5, deepgramSpeaker:0 },
    { id:"job:word:2", punctuatedWord:"Vargas", start:2, end:2.5, deepgramSpeaker:0 },
  ]}];
  const working={ derivedFrom:["job"], speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"job:segment:1", sourceJobIdentity:"job", sourceUploadId:"u", sourceOrdinal:0,
      asrWordIds:["job:word:1","job:word:2"], text:"Ms. Vargas", deepgramSpeaker:0, speakerIdentity:null, transcriptRole:null, start:1, end:2.5 }] };
  const result=renderTranscript({ working, evidence });
  assert.equal(result.findings.some(item => item.code === "HONORIFIC_ASSUMED"),false,"nothing was chosen, so nothing is reported");
});
