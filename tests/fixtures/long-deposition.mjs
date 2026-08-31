// A deposition at production length, shaped like asr-evidence.json and working.json.
//
// tests/fixtures/etminan-evidence.mjs is 11 segments and 87 words. That is the right size for
// asserting a rule about a paragraph and the wrong size for asserting anything about a
// transcript: the real records this application has produced run 1,061 and 1,970 segments at
// roughly 12,000 and 14,000 words. Nothing in the suite has ever paginated, assembled or
// rendered at that scale, so the 25-line page geometry and the Workspace-to-Word correspondence
// were established on documents three pages long.
//
// This fixture exists to be long. Its text is synthetic -- no deposition testimony is reproduced
// here, and it must never be replaced with any -- but its SHAPE is taken from the real records:
// question-and-answer runs of uneven length, answers long enough to wrap several times at 63
// characters, objections interrupting an examination, a second examiner taking over partway
// through, and the reporter and videographer speaking at the boundaries.
//
// Deterministic by construction. There is no Math.random and no clock: the same import produces
// byte-identical evidence every time, which is what lets the harness assert that two runs of the
// chain yield the same modelHash. A fixture that varied per run could not distinguish a
// non-deterministic renderer from a non-deterministic fixture.
const JOB = "job0000000000000000000000000000000000000000000000000000000000001";

// A 32-bit linear congruential generator, seeded once. Deterministic variety: turn lengths and
// phrasing need to differ across 1,600 turns or every page wraps identically and the pagination
// assertions stop meaning anything, but they must differ the same way on every run.
let seed = 20260831;
const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = list => list[Math.floor(next() * list.length) % list.length];

const SUBJECTS = [
  "the intersection", "the vehicle", "the report you prepared", "your treatment notes",
  "the imaging study", "the billing records", "the conversation with the adjuster",
  "your retention in this matter", "the standard of care", "the follow-up appointment",
  "the emergency room record", "the physical examination you performed",
];
const QUESTION_FORMS = [
  s => `Let me ask you about ${s}.`,
  s => `Do you recall ${s}?`,
  s => `And you reviewed ${s} before forming your opinion, correct?`,
  s => `Is it fair to say you relied on ${s}?`,
  s => `What did you observe about ${s}?`,
  s => `Turning to ${s}, when did you first become aware of it?`,
  s => `You would agree that ${s} is relevant here, wouldn't you?`,
];
const SHORT_ANSWERS = ["Yes.", "No.", "Correct.", "That's right.", "I don't recall.", "I believe so.", "Not that I remember."];
const CLAUSES = [
  "I reviewed the materials that were provided to me by counsel",
  "my opinion is based on the records as well as my own clinical experience",
  "the findings were consistent with what I would expect to see in a case of this kind",
  "I would want to look at the underlying imaging before I committed to that",
  "there was nothing in the chart that suggested a different mechanism of injury",
  "the timing of the complaints matters a great deal to that analysis",
  "I have testified about this subject on a number of prior occasions",
  "the documentation was incomplete in several respects that I noted at the time",
  "that is the sort of determination that would ordinarily be made by the treating physician",
  "I did not personally examine the patient, and I want to be clear about that",
];
const OBJECTIONS = ["Objection. Form.", "Objection, form.", "Objection. Asked and answered.", "Objection to form. You may answer.", "Objection. Calls for speculation."];

// Long answers are the point of the fixture, not decoration. At 63 characters per line an answer
// of six or seven clauses occupies most of a page on its own, which is the only way to exercise
// a paragraph that starts on one page and finishes on the next.
function longAnswer() {
  const count = 4 + Math.floor(next() * 5);
  const parts = [];
  for (let index = 0; index < count; index += 1) parts.push(pick(CLAUSES));
  return `${parts.join(", and ")}.`;
}

let cursor = 0;
let counter = 0;
function words(speaker, text, gap) {
  cursor += gap;
  return text.split(" ").filter(Boolean).map(token => {
    const start = Number(cursor.toFixed(2));
    cursor += 0.27;
    return {
      id: `${JOB}:word:${++counter}`, channel: 0,
      word: token.replace(/[^A-Za-z0-9']/g, "").toLowerCase(), punctuatedWord: token,
      start, end: Number(cursor.toFixed(2)), confidence: 0.96, deepgramSpeaker: speaker, speakerConfidence: 0.9,
    };
  });
}

// Two examiners, so the transcript contains an examination handover rather than one attorney
// asking every question. The second takes over at the two-thirds mark.
const EXAMINER_A = { speaker: 0, role: "QUESTIONING_ATTORNEY", identity: "counsel-alvarez" };
const EXAMINER_B = { speaker: 5, role: "QUESTIONING_ATTORNEY", identity: "counsel-whitfield" };
const WITNESS = { speaker: 1, role: "WITNESS", identity: "witness" };
const DEFENDING = { speaker: 4, role: "DEFENDING_ATTORNEY", identity: "counsel-ramirez" };
const REPORTER = { speaker: 3, role: "COURT_REPORTER", identity: "reporter" };
const VIDEOGRAPHER = { speaker: 2, role: "VIDEOGRAPHER", identity: "videographer" };

const TARGET_TURNS = 1600;
const TURNS = [];
const say = (who, text) => TURNS.push({ ...who, text });

say(VIDEOGRAPHER, "We are on the record. Today's date is August 31, 2026.");
say(REPORTER, "Would counsel please state their appearances for the record.");
say(EXAMINER_A, "Michael Alvarez on behalf of the plaintiff.");
say(DEFENDING, "Elena Ramirez for the defendant.");

while (TURNS.length < TARGET_TURNS) {
  const examiner = TURNS.length < TARGET_TURNS * 0.66 ? EXAMINER_A : EXAMINER_B;
  // The handover is spoken, so the transcript shows the examination changing hands.
  if (examiner === EXAMINER_B && !TURNS.some(turn => turn.identity === "counsel-whitfield")) {
    say(VIDEOGRAPHER, "We are going off the record at 11:42 a.m.");
    say(VIDEOGRAPHER, "We are back on the record at 11:58 a.m.");
    say(EXAMINER_B, "Doctor, my name is Grace Whitfield and I represent the third-party defendant. I have a few questions for you.");
  }
  say(examiner, pick(QUESTION_FORMS)(pick(SUBJECTS)));
  const roll = next();
  if (roll < 0.16) {
    say(DEFENDING, pick(OBJECTIONS));
    say(WITNESS, longAnswer());
  } else if (roll < 0.58) {
    say(WITNESS, pick(SHORT_ANSWERS));
  } else {
    say(WITNESS, longAnswer());
  }
  if (next() < 0.03) say(REPORTER, "I'm sorry, could you repeat the last answer?");
}

say(VIDEOGRAPHER, "This concludes today's deposition. We are off the record at 4:17 p.m.");

const evidenceWords = [];
const segments = TURNS.map((turn, index) => {
  const turnWords = words(turn.speaker, turn.text, index === 0 ? 0 : 1.1);
  evidenceWords.push(...turnWords);
  return {
    id: `${JOB}:segment:${index + 1}`, sourceJobIdentity: JOB, sourceUploadId: "upload-1", sourceOrdinal: 0,
    asrWordIds: turnWords.map(word => word.id), text: turn.text,
    deepgramSpeaker: turn.speaker, speakerIdentity: turn.identity, transcriptRole: turn.role,
    start: turnWords[0].start, end: turnWords.at(-1).end,
  };
});

export const JOB_IDENTITY = JOB;
export const EVIDENCE = Object.freeze({ schemaVersion: "1.1.0", recordType: "CANONICAL_ASR_EVIDENCE", immutable: true, jobIdentity: JOB, words: evidenceWords });
export const WORKING = Object.freeze({
  schemaVersion: "1.1.0", recordType: "WORKING_TRANSCRIPT", derivedFrom: [JOB],
  speakerMap: { status: "reconciled", assignments: [] }, segments,
});
export const SPEAKER_CANDIDATES = Object.freeze([
  { id: "counsel-alvarez", label: "Michael Alvarez", defaultRole: "QUESTIONING_ATTORNEY", honorific: "MR." },
  { id: "counsel-whitfield", label: "Grace Whitfield", defaultRole: "QUESTIONING_ATTORNEY", honorific: "MS." },
  { id: "counsel-ramirez", label: "Elena Ramirez", defaultRole: "DEFENDING_ATTORNEY", honorific: "MS." },
  { id: "witness", label: "Alan Prentice", defaultRole: "WITNESS" },
  { id: "reporter", label: "Sarah Jenkins", defaultRole: "COURT_REPORTER" },
  { id: "videographer", label: "Alex Cruz", defaultRole: "VIDEOGRAPHER" },
]);
export const SCALE = Object.freeze({ segments: segments.length, words: evidenceWords.length });
