// A synthetic stand-in for one Deepgram job, shaped like asr-evidence.json and working.json.
//
// The text is taken from the reporter-verified Etminan transcript, including its disfluencies:
// "Uh, my name is..." and "um" survive because filler_words is on, and a fixture that quietly
// cleaned them would stop testing the thing that matters.
//
// Every word carries an INTEGER deepgramSpeaker. That is deliberate and is the falsifiable
// check for the first live run: if real evidence comes back with speaker:null throughout, the
// NO_DIARIZATION finding fires and the difference between this fixture and reality is visible
// rather than inferred. Deepgram is not being asked for `diarize` -- `diarize_model` is meant
// to be a complete request -- and this fixture is what says so testably.
const JOB = "job0000000000000000000000000000000000000000000000000000000000000";

let cursor = 0;
function words(speaker, text, gap = 0.3) {
  cursor += gap;
  return text.split(" ").map(token => {
    const start = Number(cursor.toFixed(2));
    cursor += 0.28;
    return {
      id:`${JOB}:word:${++words.counter}`, channel:0,
      word:token.replace(/[^A-Za-z0-9']/g, "").toLowerCase(), punctuatedWord:token,
      start, end:Number(cursor.toFixed(2)), confidence:0.97, deepgramSpeaker:speaker, speakerConfidence:0.9,
    };
  });
}
words.counter = 0;

const TURNS = [
  { speaker:2, role:"VIDEOGRAPHER", identity:"videographer", text:"And good afternoon. We are on the record." },
  { speaker:3, role:"COURT_REPORTER", identity:"reporter", text:"Yes. This is Cause Number C-5722-24-L." },
  { speaker:0, role:"QUESTIONING_ATTORNEY", identity:"counsel-bentley", text:"Good afternoon, Doctor. Can you please state your name for the record?" },
  { speaker:1, role:"WITNESS", identity:"witness", text:"Uh, my name is Dr. Mohammad Etminan." },
  { speaker:0, role:"QUESTIONING_ATTORNEY", identity:"counsel-bentley", text:"My understanding is you were hired by the defendants, correct?" },
  { speaker:1, role:"WITNESS", identity:"witness", text:"Yes." },
  { speaker:0, role:"QUESTIONING_ATTORNEY", identity:"counsel-bentley", text:"If you treat patients, um, in your own private practice, why do you get involved in litigation?" },
  { speaker:4, role:"DEFENDING_ATTORNEY", identity:"counsel-ramon", text:"Objection. Form." },
  { speaker:1, role:"WITNESS", identity:"witness", text:"I think I've been doing this for about 10 or 15 years." },
  { speaker:0, role:"QUESTIONING_ATTORNEY", identity:"counsel-bentley", text:"But you are not her treating physician in this case, correct?" },
  { speaker:1, role:"WITNESS", identity:"witness", text:"Correct." },
];

const evidenceWords = [];
const segments = TURNS.map((turn, index) => {
  const turnWords = words(turn.speaker, turn.text, index === 0 ? 0 : 1.2);
  evidenceWords.push(...turnWords);
  return {
    id:`${JOB}:segment:${index + 1}`, sourceJobIdentity:JOB, sourceUploadId:"upload-1", sourceOrdinal:0,
    asrWordIds:turnWords.map(word => word.id), text:turn.text,
    deepgramSpeaker:turn.speaker, speakerIdentity:turn.identity, transcriptRole:turn.role,
    start:turnWords[0].start, end:turnWords.at(-1).end,
  };
});

export const JOB_IDENTITY = JOB;
export const EVIDENCE = Object.freeze({ schemaVersion:"1.1.0", recordType:"CANONICAL_ASR_EVIDENCE", immutable:true, jobIdentity:JOB, words:evidenceWords });
export const WORKING = Object.freeze({
  schemaVersion:"1.1.0", recordType:"WORKING_TRANSCRIPT", derivedFrom:[JOB],
  speakerMap:{ status:"reconciled", assignments:[] }, segments,
});
export const SPEAKER_CANDIDATES = Object.freeze([
  { id:"counsel-bentley", label:"Dennis Bentley", defaultRole:"QUESTIONING_ATTORNEY", honorific:"MR." },
  { id:"counsel-ramon", label:"Chris Ramon", defaultRole:"DEFENDING_ATTORNEY", honorific:"MR." },
  { id:"witness", label:"Mohammad Etminan", defaultRole:"WITNESS" },
  { id:"reporter", label:"Sarah Jenkins", defaultRole:"COURT_REPORTER" },
  { id:"videographer", label:"Alex Cruz", defaultRole:"VIDEOGRAPHER" },
]);
