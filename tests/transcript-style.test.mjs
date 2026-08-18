import assert from "node:assert/strict";
import test from "node:test";
import { joinStyled, styleWord, styleWords } from "../server/transcript-style.mjs";

// Every expectation below is a measurement of Dr_Etminan_Transcript.docx -- the transcript a
// scopist and the court reporter verified -- against what Deepgram emitted for the same audio.
// The counts in the comments are from that document, not from a style manual.

test("a slashed date becomes a written one",()=>{
  // 17 slashed dates in the ASR; the specimen contains none and four written ones.
  assert.equal(styleWord("04/24/2026,"),"April 24, 2026,");
  assert.equal(styleWord("09/15/2023."),"September 15, 2023.");
  assert.equal(styleWord("11/16/2023"),"November 16, 2023");
});

test("an impossible date is left exactly as it was",()=>{
  // 13/40/2026 is not a date, and a rule that guessed at one would put a fabricated day on a
  // court record. Leaving it visibly wrong is the reporter's cue to listen to that passage.
  assert.equal(styleWord("13/40/2026"),"13/40/2026");
  assert.equal(styleWord("00/12/2026"),"00/12/2026");
});

test("a time loses its leading zero and gains its periods, once",()=>{
  // The specimen's three times are 1:27 p.m. and 2:50 p.m. The trailing full stop is absorbed
  // rather than doubled; every other mark still rides along.
  assert.equal(styleWord("01:27PM."),"1:27 p.m.");
  assert.equal(styleWord("01:27PM?"),"1:27 p.m.?");
  assert.equal(styleWord("2:50PM"),"2:50 p.m.");
  assert.equal(styleWord("13:00PM"),"13:00PM");
});

test("the degree is punctuated and the title is abbreviated only before a name",()=>{
  // 24 written "Dr." in the specimen, every one before a personal name, against 37 spelled-out
  // vocatives. "Good afternoon, doctor." must survive untouched.
  assert.equal(styleWord("MD."),"M.D.");
  assert.equal(styleWord("Doctor.",{ next:"Etminan," }),"Dr.");
  assert.equal(styleWord("Doctor.",{ next:"Lee" }),"Dr.");
  assert.equal(styleWord("doctor.",{ next:"Can" }),"doctor.");
  assert.equal(styleWord("doctor,",{ next:"you're" }),"doctor,");
});

test("small numbers are written out, and exhibit numbers are not",()=>{
  // 18 of the specimen's 19 bare digits follow "Exhibit"; the nineteenth is "6 o'clock".
  assert.equal(styleWord("2",{ previous:"have", next:"offices" }),"two");
  assert.equal(styleWord("1",{ previous:"and", next:"in" }),"one");
  assert.equal(styleWord("1",{ previous:"Exhibit", next:"marked" }),"1");
  assert.equal(styleWord("4,",{ previous:"Exhibit", next:"what's" }),"4,");
  assert.equal(styleWord("6",{ previous:"wasn't", next:"o'clock" }),"6");
  // 10 and above stay as digits: the specimen writes "70 to 100 surgeries" and "10 or 15 years".
  assert.equal(styleWord("70",{ previous:"about", next:"to" }),"70");
  assert.equal(styleWord("2001."),"2001.");
});

test("ordinals are written out except as a day of the month",()=>{
  // The specimen's only surviving ordinal digit is in "February 1st, 2024".
  assert.equal(styleWord("1st",{ previous:"the", next:"of" }),"first");
  assert.equal(styleWord("2nd,",{ previous:"the", next:"time" }),"second,");
  assert.equal(styleWord("1st,",{ previous:"February", next:"2024" }),"1st,");
});

test("a word the reporter has corrected is never restyled",()=>{
  // An explicit correction outranks a convention. If the reporter typed "2" they meant "2", and
  // a style rule quietly overriding that would make their own edit un-keepable.
  const words=[{ id:"w1", text:"2", edited:true },{ id:"w2", text:"2", authored:true },{ id:"w3", text:"2", deleted:true },{ id:"w4", text:"2" }];
  assert.deepEqual(styleWords(words).map(word=>word.display),["2","2","2","two"]);
  assert.deepEqual(styleWords(words).map(word=>Boolean(word.styled)),[false,false,false,true]);
});

test("styling is a projection: the evidence text and the word id both survive",()=>{
  // The screen may read "April 24, 2026" while the record still holds what Deepgram heard.
  const [word]=styleWords([{ id:"job:word:7", text:"04/24/2026," }]);
  assert.equal(word.id,"job:word:7");
  assert.equal(word.text,"04/24/2026,");
  assert.equal(word.display,"April 24, 2026,");
});

test("one token in, one token out, so word addressing survives",()=>{
  // split, label, replace and the correction pass all address words by id. A rule that turned
  // one word into two would leave the extra one unaddressable.
  const words=[{ id:"a", text:"04/24/2026," },{ id:"b", text:"2" },{ id:"c", text:"MD." }];
  assert.deepEqual(styleWords(words).map(word=>word.id),["a","b","c"]);
});

test("sentences are separated by two spaces and words by one",()=>{
  assert.equal(joinStyled(styleWords([{text:"Yes."},{text:"This"},{text:"is"},{text:"2"},{text:"offices."},{text:"Okay"}])),
    "Yes.  This is two offices.  Okay");
});

test("the opening line reaches the specimen's form except where the audio is needed",()=>{
  // The certified line is:
  //   "And good afternoon.  We are on the record.  Today's date is April 24, 2026, and the time
  //    is now 1:27 p.m.  This is the beginning of the deposition of Dr. Mohammad Etminan, M.D."
  // Style rules close the date, the time, the title and the degree. They do not close "And",
  // which the ASR never heard -- and nothing in this module ever should.
  const asr="Good afternoon. We are on the record. Today's date is 04/24/2026, and the time is now 01:27PM. This is the beginning of the deposition of Doctor. Mohammad Etminan, MD.";
  const styled=joinStyled(styleWords(asr.split(" ").map((text,index)=>({ id:`w${index}`, text }))));
  assert.match(styled,/Today's date is April 24, 2026,/);
  assert.match(styled,/the time is now 1:27 p\.m\./);
  assert.match(styled,/of Dr\. Mohammad Etminan, M\.D\./);
  assert.equal(styled.startsWith("Good afternoon."),true,"a missing word is not a style problem and must not be invented");
});

test("a title's period does not open a new sentence",()=>{
  // "of Dr. Mohammad Etminan, M.D.  Will the court reporter" -- one space inside the name, two
  // after the degree that ends the sentence.
  assert.equal(joinStyled(styleWords([{text:"of"},{text:"Doctor."},{text:"Mohammad"},{text:"Etminan,"},{text:"MD."},{text:"Will"}])),
    "of Dr. Mohammad Etminan, M.D.  Will");
});

test("an abbreviation keeps punctuation that is not its own full stop",()=>{
  assert.equal(styleWord("MD.,"),"M.D.,");
  assert.equal(styleWord("MD.?"),"M.D.?");
});

test("a capitalised vocative Doctor is still not a title",()=>{
  // Deepgram capitalises at a sentence start, so "Doctor, would you please raise your right
  // hand" arrives with the same capital D as "Doctor. Lee". What separates them is the next
  // word: a title is followed by a name. Without that check this becomes "Dr.," which is both
  // the wrong form and a lost comma.
  assert.equal(styleWord("Doctor,",{ next:"would" }),"Doctor,");
  assert.equal(styleWord("Doctor.",{ next:"can" }),"Doctor.");
  assert.equal(styleWord("Doctor",{ next:"" }),"Doctor");
});
