import assert from "node:assert/strict";
import test from "node:test";
import { tabbedLine, TABS, TAB_STOPS, ELEMENT, LAYOUT, LINE_WIDTH, buildSpeakerLabels, centerColumn, labelParagraphs } from "../server/transcript-labels.mjs";

const CANDIDATES = [
  { id:"counsel-bentley", label:"Dennis Bentley", defaultRole:"QUESTIONING_ATTORNEY", honorific:"MR." },
  { id:"counsel-ramon", label:"Chris Ramon", defaultRole:"DEFENDING_ATTORNEY", honorific:"MR." },
  { id:"witness", label:"Mohammad Etminan", defaultRole:"WITNESS" },
  { id:"reporter", label:"Sarah Jenkins", defaultRole:"COURT_REPORTER" },
  { id:"videographer", label:"Alex Cruz", defaultRole:"VIDEOGRAPHER" },
];
const { labels } = buildSpeakerLabels(CANDIDATES);
const say = (speakerIdentity, transcriptRole, text = "words") => ({ speakerIdentity, transcriptRole, text });
const run = paragraphs => labelParagraphs(paragraphs, { labels, examinerIdentity:"counsel-bentley" });
const shape = result => result.map(p => [p.elementType, p.label, p.byLine]);

test("attorney labels are honorific plus surname, uppercased",()=>{
  assert.equal(labels["counsel-bentley"],"MR. BENTLEY");
  assert.equal(labels["counsel-ramon"],"MR. RAMON");
});

test("role-fixed speakers use their standard labels",()=>{
  assert.equal(labels.reporter,"THE REPORTER");
  assert.equal(labels.videographer,"THE VIDEOGRAPHER");
  assert.equal(labels.witness,"THE WITNESS");
});

test("a missing honorific is reported, never guessed",()=>{
  // "MR." cannot be derived from "Dennis" without guessing at a title on a court record, and a
  // wrong guess is worse than a visible gap. The label degrades to the surname and says so.
  const { labels:partial, findings } = buildSpeakerLabels([{ id:"x", label:"Dana Alvarez", defaultRole:"QUESTIONING_ATTORNEY" }]);
  assert.equal(partial.x,"ALVAREZ");
  assert.equal(findings.length,1);
  assert.equal(findings[0].code,"HONORIFIC_MISSING");
  assert.equal(/\bMR\.|\bMS\.|\bMRS\./.test(partial.x),false,"no honorific may appear in a label that had none recorded");
});

test("an explicit display label overrides derivation entirely",()=>{
  const { labels:explicit, findings } = buildSpeakerLabels([{ id:"x", label:"Maria de la Cruz", defaultRole:"QUESTIONING_ATTORNEY", displayLabel:"Ms. de la Cruz" }]);
  assert.equal(explicit.x,"MS. DE LA CRUZ","a compound surname must be settable, since last-token extraction gets it wrong");
  assert.deepEqual(findings,[]);
});

test("examiner questions and witness answers become Q. and A.",()=>{
  assert.deepEqual(shape(run([
    say("counsel-bentley","QUESTIONING_ATTORNEY"),
    say("witness","WITNESS"),
    say("counsel-bentley","QUESTIONING_ATTORNEY"),
    say("witness","WITNESS"),
  ])),[
    [ELEMENT.QUESTION,"Q.",null],
    [ELEMENT.ANSWER,"A.",null],
    [ELEMENT.QUESTION,"Q.",null],
    [ELEMENT.ANSWER,"A.",null],
  ]);
});

test("opposing counsel becomes colloquy under their own name",()=>{
  assert.deepEqual(shape(run([
    say("counsel-bentley","QUESTIONING_ATTORNEY"),
    say("counsel-ramon","DEFENDING_ATTORNEY","Objection.  Form."),
  ])).at(-1),[ELEMENT.COLLOQUY,"MR. RAMON:",null]);
});

test("a question resuming after colloquy carries an inline by-line",()=>{
  // The specimen has 21 inline (BY MR. BENTLEY) against one standalone BY MR. BENTLEY:, with a
  // single examiner throughout -- so this fires on resumption after colloquy, not on examiner
  // change. Objection, then the examiner picks the question back up.
  const result = run([
    say("counsel-bentley","QUESTIONING_ATTORNEY"),
    say("counsel-ramon","DEFENDING_ATTORNEY","Objection.  Form."),
    say("counsel-bentley","QUESTIONING_ATTORNEY"),
  ]);
  assert.deepEqual(shape(result).at(-1),[ELEMENT.QUESTION,"Q.","(BY MR. BENTLEY)"]);
});

test("consecutive questions and answers carry no by-line",()=>{
  const result = run([
    say("counsel-bentley","QUESTIONING_ATTORNEY"),
    say("witness","WITNESS"),
    say("counsel-bentley","QUESTIONING_ATTORNEY"),
  ]);
  assert.equal(result.at(-1).byLine,null,"a by-line on every question would put 501 of them in this transcript");
  assert.equal(result[0].byLine,null,"the first question opens the examination and needs no resumption");
});

test("the witness speaking outside an answer is THE WITNESS:, not A.",()=>{
  // Both appear in the specimen. An answer follows a question; anything else the witness says
  // -- to the reporter, about an exhibit -- is colloquy under their label.
  const result = run([
    say("videographer","VIDEOGRAPHER","We are going off the record."),
    say("witness","WITNESS","May I see that exhibit?"),
  ]);
  assert.deepEqual(shape(result),[
    [ELEMENT.COLLOQUY,"THE VIDEOGRAPHER:",null],
    [ELEMENT.COLLOQUY,"THE WITNESS:",null],
  ]);
});

test("with no examiner set, the first questioning attorney becomes one",()=>{
  const result = labelParagraphs([say("counsel-bentley","QUESTIONING_ATTORNEY"), say("witness","WITNESS")], { labels });
  assert.deepEqual(shape(result),[[ELEMENT.QUESTION,"Q.",null],[ELEMENT.ANSWER,"A.",null]]);
});

test("an unassigned speaker is flagged rather than labelled blank",()=>{
  const result = labelParagraphs([{ speakerIdentity:null, transcriptRole:null, text:"unknown" }], { labels });
  assert.equal(result[0].elementType,ELEMENT.COLLOQUY);
  assert.equal(result[0].label,null);
  assert.equal(result[0].unlabeledSpeaker,true);
});

test("measured layout coordinates",()=>{
  // Straight from the XPS print image: token col 5, text col 10, runover flush at col 0, across
  // all 501 Q./A. paragraphs with zero variance.
  assert.deepEqual(LAYOUT[ELEMENT.QUESTION],{ tokenCol:5, textCol:10, wrapCol:0, centered:false });
  assert.deepEqual(LAYOUT[ELEMENT.ANSWER],LAYOUT[ELEMENT.QUESTION]);
  // Not measured, ruled. The specimen is inconsistent here -- attorney labels at col 5 (28x)
  // against THE VIDEOGRAPHER:/THE REPORTER: at col 15 (7x) -- and the reporter ruled all
  // colloquy to col 15. The 28 are defects under that ruling and a diff must keep showing them.
  assert.equal(LAYOUT[ELEMENT.COLLOQUY].tokenCol,15);
  assert.equal(LAYOUT[ELEMENT.NEW_PARAGRAPH].textCol,5);
  assert.equal(LAYOUT[ELEMENT.BY_LINE].textCol,0);
  assert.equal(LAYOUT[ELEMENT.PARENTHETICAL_INDENTED].textCol,15);
  assert.equal(LAYOUT[ELEMENT.PARENTHETICAL_CENTERED].centered,true);
  assert.equal(LAYOUT[ELEMENT.HEADING].centered,true);
  for (const element of Object.values(ELEMENT)) assert.equal(LAYOUT[element].wrapCol,0,`${element} runover must return flush left`);
});

test("centered parentheticals compute their column from the string, not a constant",()=>{
  // This is the correction that matters. Nine identical "(Exhibit N marked)" are 18 characters
  // and land at column 22 every time, which reads as a rule and is arithmetic. A hardcoded 22
  // is one column off for a tenth exhibit and badly wrong for anything else.
  assert.equal(LINE_WIDTH,62);
  assert.equal(centerColumn("(Exhibit 1 marked)"),22);
  assert.equal(centerColumn("(Exhibit 10 marked)"),21,"a two-digit exhibit shifts by one; a constant 22 would not");
  assert.equal(centerColumn("(Deposition concluded at 2:50 p.m.)"),13);
  assert.equal(centerColumn("EXAMINATION"),25);
  assert.equal(centerColumn("x".repeat(80)),0,"a string wider than the line clamps at zero rather than going negative");
});

test("Q. and A. carry one tab before the token and one after",()=>{
  // Measured and unanimous: 503 paragraphs of the certified Etminan transcript carry exactly
  // two literal tabs on a question or an answer, one either side of the token. This is the half
  // of the tab model the specimen settles rather than the reporter.
  const question = tabbedLine(ELEMENT.QUESTION, { token:"Q.", text:"Good afternoon, Doctor." });
  assert.equal(question.line, "\tQ.\tGood afternoon, Doctor.");
  assert.equal(question.leadingTabs, 1);
  assert.equal(question.tabsAfterToken, 1);
  assert.equal(tabbedLine(ELEMENT.ANSWER, { token:"A.", text:"Yes." }).line, "\tA.\tYes.");
});

test("colloquy begins at the third stop",()=>{
  // The reporter's instruction, and it resolves an inconsistency the specimen cannot: 33 of its
  // colloquy paragraphs use a 0.5-inch first-line indent and 7 use three literal tabs. Three
  // tabs is the form CaseCATalyst receives.
  assert.equal(tabbedLine(ELEMENT.COLLOQUY, { text:"MR. BENTLEY:  Objection." }).line, "\t\t\tMR. BENTLEY:  Objection.");
  assert.equal(tabbedLine(ELEMENT.NEW_PARAGRAPH, { text:"And then he left." }).line, "\t\t\tAnd then he left.");
});

test("an exhibit line takes one tab to the centre stop",()=>{
  // The specimen centres these with paragraph justification and no tabs at all. Justification
  // does not survive into a CAT system the way a tab does, so the line carries one tab and the
  // stop it lands on is centred.
  const exhibit = tabbedLine(ELEMENT.PARENTHETICAL_CENTERED, { text:"(Exhibit 1 marked)" });
  assert.equal(exhibit.line, "\t(Exhibit 1 marked)");
  assert.equal(exhibit.leadingTabs, 1);
  assert.equal(exhibit.toCentreStop, true, "the single tab must resolve against the centre stop, not a left one");
});

test("a BY-line stays at the margin",()=>{
  // Not one of the "other paragraphs" that indent: it names who resumes questioning and is set
  // flush left, which is also how the specimen encodes it.
  assert.equal(tabbedLine(ELEMENT.BY_LINE, { text:"BY MR. BENTLEY:" }).line, "BY MR. BENTLEY:");
});

test("every tab reaches a defined stop",()=>{
  // The specimen's two four-tab parentheticals exhaust its three left stops, so the fourth
  // resolved against the word processor's default grid and printed at different columns in
  // different contexts. No element here emits more tabs than there are stops to receive them.
  assert.equal(TAB_STOPS.leftInches.length, 3);
  for (const [element, spec] of Object.entries(TABS)) {
    const total = spec.leadingTabs + spec.tabsAfterToken;
    const available = spec.toCentreStop ? 1 : TAB_STOPS.leftInches.length;
    assert.ok(total <= available, `${element} emits ${total} tabs against ${available} stops`);
  }
});

test("the ruler is the specimen's own",()=>{
  // 720, 1440 and 2160 twips are 0.5, 1.0 and 1.5 inches, read from the specimen's paragraph
  // properties. 4320 is 3.0 inches: the PHYSICAL PAGE centre, ruled by the reporter. With a
  // 1.25-inch left margin the paper centres 3.0 from the margin and the text block centres at
  // 3.10 -- one character apart, and the page was chosen.
  assert.deepEqual(TAB_STOPS.twips.left, [720, 1440, 2160]);
  assert.equal(TAB_STOPS.twips.centre, 4320);
  assert.deepEqual(TAB_STOPS.leftInches, [0.5, 1.0, 1.5]);
  assert.equal(TAB_STOPS.centreInches, 3.0);
});

test("colloquy sits at column 15, against the specimen and on purpose",()=>{
  // The reporter ruled that all colloquy takes three tabs. The certified transcript places
  // attorney labels at column 5 in 28 places; under this ruling those are defects, not the
  // standard, and a diff of exported output against that transcript must show 28 mismatches
  // here. This assertion is what stops someone reconciling them back.
  assert.equal(LAYOUT[ELEMENT.COLLOQUY].tokenCol, 15, "colloquy is at the third stop, not the first");
  assert.equal(tabbedLine(ELEMENT.COLLOQUY, { text:"MR. BENTLEY:  Objection." }).leadingTabs, 3);
});

test("the centre stop is the page centre, not the text-block centre",()=>{
  // 3.0 inches from a 1.25-inch margin is the middle of the paper; the text block centres at
  // 3.10. One character apart, and the reporter chose the page. centerColumn computes the
  // text-block centre and must not be used to position an exported line.
  assert.equal(TAB_STOPS.centreInches, 3.0);
  assert.equal(TAB_STOPS.twips.centre, 4320);
  assert.notEqual(TAB_STOPS.twips.centre, 4680, "4680 is 3.25in, the text-block centre");
});
