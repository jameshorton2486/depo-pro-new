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
  // Separated by ordinary words on purpose. Four adjacent digits would be suppressed by the
  // split-number guard instead, and the test would pass or fail for a reason that has nothing
  // to do with who touched the word.
  const words=[{ id:"w1", text:"2", edited:true },{ id:"w2", text:"of" },{ id:"w3", text:"2", authored:true },{ id:"w4", text:"or" },{ id:"w5", text:"2", deleted:true },{ id:"w6", text:"and" },{ id:"w7", text:"2" }];
  assert.deepEqual(styleWords(words).map(word=>word.display),["2","of","2","or","2","and","two"]);
  assert.deepEqual(styleWords(words).map(word=>Boolean(word.styled)),[false,false,false,false,false,false,true]);
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

test("an exhibit reference is capitalised, the common noun is not",()=>{
  // The specimen capitalises all 18 of its exhibit references; Deepgram emits all nine of
  // ETM01's lowercase. The following digit is what separates a named exhibit from the noun.
  assert.equal(styleWord("exhibit",{ next:"1" }),"Exhibit");
  assert.equal(styleWord("exhibit",{ next:"4." }),"Exhibit");
  assert.equal(styleWord("exhibit,",{ next:"9" }),"Exhibit,");
  assert.equal(styleWord("exhibit",{ next:"you" }),"exhibit");
  assert.equal(styleWord("exhibit",{ next:"" }),"exhibit");
});

test("capitalising the exhibit still leaves its number a digit",()=>{
  // The two rules meet on the same pair and must not fight: "exhibit 1" becomes "Exhibit 1",
  // never "Exhibit one". The number rule reads the raw previous word, so it is unaffected by
  // the capitalisation applied to that same word.
  assert.equal(joinStyled(styleWords([{text:"exhibit"},{text:"1"},{text:"marked"}])),"Exhibit 1 marked");
  assert.equal(joinStyled(styleWords([{text:"exhibit"},{text:"4."},{text:"What's"}])),"Exhibit 4.  What's");
});

test("a digit standing next to another number is left alone",()=>{
  // Deepgram splits numeric expressions across tokens. Spelling out the orphan turned "4 64th"
  // into "four 64th" where the certified transcript writes "464th", and "c 5 6, c 6 7" into
  // "c five six, c six seven" where it writes C5-, C6-, C7. Vertebral levels, in a spine-injury
  // deposition, reading as prose. Joining them back is out of reach; corrupting them is not.
  assert.equal(styleWord("4",{ previous:"court,", next:"64th" }),"4");
  assert.equal(styleWord("5",{ previous:"c", next:"6" }),"5");
  assert.equal(styleWord("6",{ previous:"5", next:"7" }),"6");
  assert.equal(styleWord("1",{ previous:"5", next:"level" }),"1");
  // The crash date, split three ways.
  assert.equal(styleWord("9",{ previous:"accent", next:"15" }),"9");
});

test("the neighbour is checked on both sides",()=>{
  // "4 64th" carries the orphan first and "5 6" carries it second. Looking only forward would
  // catch the first digit of a pair and spell the second.
  assert.equal(styleWord("6",{ previous:"5", next:"disc" }),"6","a preceding number must suppress");
  assert.equal(styleWord("5",{ previous:"c", next:"6" }),"5","a following number must suppress");
});

test("one second survives, which is where the number and ordinal rules meet",()=>{
  // "1 2nd" is Deepgram hearing "one second", and the specimen writes "One second, doctor."
  // spelled out. A single-digit ordinal spells to a word, so a digit beside it belongs to a
  // phrase rather than to a split numeral -- the one case the neighbour rule must not swallow.
  assert.equal(styleWord("1",{ previous:"Give", next:"2nd" }),"one");
  assert.equal(styleWord("2nd",{ previous:"1", next:"doctor." }),"second");
  assert.equal(joinStyled(styleWords([{text:"Give"},{text:"1"},{text:"2nd."},{text:"According"}])),
    "Give one second.  According");
});

test("a quantity beside an ordinary word is still written out",()=>{
  // The guard must not disable the rule it qualifies.
  assert.equal(styleWord("2",{ previous:"have", next:"offices" }),"two");
  assert.equal(styleWord("1",{ previous:"and", next:"in" }),"one");
});

test("a vocative Doctor with a comma is neither abbreviated nor stripped of its comma",()=>{
  // "Doctor, I'm gonna show you" is the examiner addressing the witness. The capitalised-next
  // test admitted it, because "I'm" is capitalised mid-sentence, and the conversion dropped the
  // comma on the way out -- a title invented and punctuation lost in one word.
  assert.equal(styleWord("Doctor,",{ next:"I'm" }),"Doctor,");
  assert.equal(styleWord("Doctor,",{ next:"Lee" }),"Doctor,");
});

test("a title keeps converting whether or not the ASR punctuated it",()=>{
  // 21 of ETM01's capital "Doctor" carry a period or nothing and precede a name.
  assert.equal(styleWord("Doctor.",{ next:"Lee" }),"Dr.");
  assert.equal(styleWord("Doctor",{ next:"Kenley," }),"Dr.");
});

test("no style rule loses punctuation the word arrived with",()=>{
  // The class of defect, not the instance: a rule that rebuilds a word from parts can drop the
  // tail. Every form below carries a comma in and must carry one out.
  for (const [text, next] of [["MD.,",""],["mister,","Heath"],["01:27PM,",""],["04/24/2026,",""],["2,","offices"],["1st,","of"],["exhibit,","9"]]) {
    assert.match(styleWord(text,{ next }),/,$/,`${text} lost its comma`);
  }
});

test("mister before a name becomes Mr., in either case",()=>{
  // 22 across both depositions, every one before a personal name. Case-insensitive because
  // "mister" is not an ordinary noun the way "doctor" is -- there is no vocative to protect.
  assert.equal(styleWord("mister",{ next:"Heath" }),"Mr.");
  assert.equal(styleWord("Mister",{ next:"Nunez," }),"Mr.");
  assert.equal(styleWord("mister",{ next:"Thomas." }),"Mr.");
  assert.equal(styleWord("mister",{ next:"you" }),"mister","without a name following it is not a title");
});


const line = text => joinStyled(styleWords(text.split(" ").map((word,index)=>({ id:`w${index}`, text:word }))));

test("an exhibit number survives however the question phrases it",()=>{
  // ETM01 says "exhibit 1"; the Thomas deposition says "exhibit number 2", "exhibit number, uh,
  // 2?" and "exhibit number, I believe, 3". Reading only the previous word spelled six of them
  // out, against a specimen that writes Exhibit 1 through 9 as digits and never spells one.
  assert.match(line("as plaintiff's exhibit number 2. I"),/exhibit number 2\./);
  assert.match(line("on exhibit number, uh, 2? I"),/exhibit number, uh, 2\?/);
  assert.match(line("exhibit number, I believe, 3 today"),/exhibit number, I believe, 3 today/);
});

test("the exhibit lookback cannot reach an unrelated number",()=>{
  // Only the first number after "exhibit" is the exhibit's, so a later quantity is still written
  // out. A sentence boundary ends the reach entirely, and four words is the limit.
  assert.match(line("exhibit 5, this window, 2 panes"),/Exhibit 5, this window, two panes/);
  assert.match(line("Okay. Do you see 3 there"),/Do you see three there/);
  assert.match(line("exhibit number was the one we saw 4 times"),/saw four times/);
});

test("a sentence ending at the word 'exhibit' ends the lookback with it",()=>{
  // "marked as an exhibit. Do you see 3 pages" is a new sentence, and its 3 is a quantity. The
  // check has to run before the word is matched, or "exhibit." claims the next sentence's number.
  assert.match(line("marked as an exhibit. Do you see 3 pages"),/see three pages/);
  assert.match(line("exhibit 4. Okay. Do you have 2 copies"),/have two copies/);
});

test("miss before a name becomes Ms., by ruling",()=>{
  // Morson's Rule 208, ruled by the reporter: the marriage-neutral honorific is the standard
  // form regardless of what the ASR heard. This replaces an earlier refusal to convert, which
  // was correct while the question was open -- Miss, Ms. and Mrs. are distinct in a certified
  // record and nothing in the data settled it. It is settled now.
  assert.equal(styleWord("miss",{ next:"Vargas" }),"Ms.");
  assert.equal(styleWord("Miss",{ next:"Vargas" }),"Ms.");
  assert.equal(styleWord("miss",{ next:"Garza?" }),"Ms.");
});

test("the verb 'miss' is still a verb",()=>{
  // The condition that keeps the rule from reaching ordinary speech: a title precedes a name.
  // "I miss based on the records" and "did you miss, was it" must survive untouched.
  assert.equal(styleWord("miss",{ next:"based" }),"miss");
  assert.equal(styleWord("miss,",{ next:"was" }),"miss,");
  assert.equal(styleWord("miss",{ next:"" }),"miss");
});

test("a colloquial affirmation is never normalised",()=>{
  // Morson's Rule 4: "Yeah." is a dictionary-recognised expression and is what the witness said.
  // No rule here may turn it into "Yes.", and this asserts the class rather than the instance --
  // spoken affirmations pass through whatever else the styling does to the line.
  for (const spoken of ["Yeah.","Yeah","Uh-huh.","Huh-uh.","Nope.","Yep.","Okay.","Mm-hmm."]) {
    assert.equal(styleWord(spoken,{ previous:"happen?", next:"I" }),spoken,`${spoken} must survive verbatim`);
  }
  assert.equal(joinStyled(styleWords([{text:"happen?"},{text:"Yeah."},{text:"I"},{text:"think"}])),"happen?  Yeah.  I think");
});

test("an honorific takes one space, a sentence end takes two",()=>{
  // Morson's Rules 1 and 16 for the sentence terminal, and the corpus guardrail for honorifics:
  // "Dr. Lee" and "Ms. Vargas" are one space, "Objection.  Form." is two.
  assert.equal(joinStyled(styleWords([{text:"from"},{text:"Doctor"},{text:"Lee,"},{text:"Ms."},{text:"Vargas"}])),"from Dr. Lee, Ms. Vargas");
  assert.equal(joinStyled(styleWords([{text:"Objection."},{text:"Form."}])),"Objection.  Form.");
  assert.equal(joinStyled(styleWords([{text:"symptoms."},{text:"Correct?"}])),"symptoms.  Correct?");
  assert.equal(joinStyled(styleWords([{text:"mouth."},{text:"My"},{text:"role"}])),"mouth.  My role");
});

test("a percentage is written out",()=>{
  // The specimen writes "100 percent" four times and "60 percent" once, and contains no % sign
  // anywhere; the ASR emits "100%". Both sides of the comparison demand it.
  assert.equal(styleWord("100%"),"100 percent");
  assert.equal(styleWord("10%?"),"10 percent?");
  assert.equal(styleWord("7.5%"),"7.5 percent");
});

test("a whole-dollar sum gains its cents, and nothing else changes",()=>{
  // The specimen writes 750.00, 875.00, 250.00. Only sums missing cents are completed: a figure
  // that already carries them is untouched, and no sum is rounded or altered.
  assert.equal(styleWord("$750"),"$750.00");
  assert.equal(styleWord("$1,250"),"$1,250.00");
  assert.equal(styleWord("$7.50"),"$7.50","a sum with cents is already correct");
  assert.equal(styleWord("$4,875."),"$4,875.00.","the sentence's full stop is not the sum's");
  assert.equal(styleWord("1,000"),"1,000","a bare number is not money");
});
