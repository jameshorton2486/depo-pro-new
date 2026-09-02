// The reporter's side of it: what the screen shows, and what it does when they answer.
//
// The behaviour that matters is proved in the browser gate, not here. What these hold is the part
// that would otherwise live only inside JSX where nothing can check it -- which fields a reporter
// is owed before accepting somebody's name onto speech, and what happens to the other proposals
// once one has been accepted.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { emptyRangeListMessage, rangeProposalKey, rangeProposalSummary, remainingAfterAcceptance, remainingAfterRejection } from "../app/range-review.mjs";

const CANDIDATES = [
  { id: "witness", label: "Jennifer Baier", defaultRole: "WITNESS" },
  { id: "attorney-2", label: "Karen Alvarado", defaultRole: "DEFENDING_ATTORNEY" },
];
const PROPOSAL = {
  wordId: "job:word:7", endWordId: "job:word:10", speakerIdentity: "witness",
  correctionType: "speaker_assignment", confidenceScore: 0.86, evidenceSource: "transcript",
  reviewStateHash: "hash-a", text: "Yes maam I do", wordCount: 4,
  startTime: 12.5, endTime: 14.1, deepgramSpeakers: [3], currentSpeakerIdentity: null,
};

test("a reporter is shown everything needed to judge a range before accepting it", () => {
  // Accepting one puts a person's name on speech. Each of these is something the reporter would
  // otherwise have to take on trust.
  const shown = rangeProposalSummary(PROPOSAL, CANDIDATES);
  assert.equal(shown.text, "Yes maam I do", "the exact words, not a summary of them");
  assert.equal(shown.wordCount, 4);
  assert.equal(shown.speakerLabel, "Jennifer Baier", "the person, by name");
  assert.equal(shown.speakerRole, "WITNESS");
  assert.equal(shown.startTime, 12.5, "where in the audio to check it");
  assert.equal(shown.endTime, 14.1);
  assert.deepEqual(shown.deepgramSpeakers, [3], "what the machine thought, beside what the model claims");
  assert.equal(shown.confidenceScore, 0.86);
  assert.equal(shown.evidenceSource, "transcript");
  assert.equal(shown.proposalLevel, "RANGE", "and which kind of claim this is");
});

test("an unattributed range says so rather than leaving a blank", () => {
  assert.equal(rangeProposalSummary(PROPOSAL, CANDIDATES).currentSpeakerLabel, null,
    "the component reads this as 'currently unattributed'");
  assert.equal(rangeProposalSummary({ ...PROPOSAL, currentSpeakerIdentity: "attorney-2" }, CANDIDATES).currentSpeakerLabel, "Karen Alvarado",
    "and names the person being replaced when there is one");
});

test("a participant id showing through is left visible rather than dressed up", () => {
  // A friendly placeholder would hide a roster mismatch behind something that reads as deliberate.
  const shown = rangeProposalSummary({ ...PROPOSAL, speakerIdentity: "attorney-9" }, CANDIDATES);
  assert.equal(shown.speakerLabel, "attorney-9");
});

test("accepting one proposal clears the rest, because they were all made against the old state", () => {
  // Every proposal carries the review-state hash of the transcript it was generated against, and
  // accepting one changes that state. The server would refuse the others, correctly. Leaving them
  // on screen offers a row of buttons that all fail.
  assert.deepEqual(remainingAfterAcceptance(), []);
});

test("an empty list says which kind of empty it is", () => {
  // Found in the browser gate rather than here: after accepting one of three proposals the list
  // cleared, and the empty state read "No speaker ranges were proposed." Three had been, and one
  // had just been applied. A screen that reports nothing found when something was is worse than one
  // that reports nothing at all.
  assert.match(emptyRangeListMessage({ accepted: false }), /^No speaker ranges were proposed\.$/);
  const cleared = emptyRangeListMessage({ accepted: true });
  assert.match(cleared, /^Applied\./);
  assert.equal(/No speaker ranges were proposed/.test(cleared), false);
  assert.match(cleared, /Run the check again/, "and says what to do about it");
});

test("rejecting removes one proposal and leaves the others alone", () => {
  const other = { ...PROPOSAL, wordId: "job:word:20", endWordId: "job:word:22" };
  assert.deepEqual(remainingAfterRejection([PROPOSAL, other], PROPOSAL), [other]);
  assert.deepEqual(remainingAfterRejection([PROPOSAL, other], other), [PROPOSAL]);
  assert.equal(rangeProposalKey(PROPOSAL), "job:word:7:job:word:10");
});

test("the Workspace offers Accept and Reject per proposal, and no way to take them in bulk", () => {
  // Source-level, and it proves presence rather than behaviour -- the browser gate is what proves
  // the rest. What it is good for is the absence: a Select All over speaker attributions is a
  // reporter agreeing to claims they did not read, and its absence is easy to lose in a later edit.
  const source = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/correction\/speaker-range-pass/);
  assert.match(source, /\/api\/transcript\/range-proposal\/accept/);
  assert.match(source, />Speaker range proposals \(/, "its own section, named as ranges");
  assert.match(source, /not a whole machine speaker/);
  assert.match(source, />Reject</);
  assert.match(source, /machine speaker /, "the diarization evidence is on the card");

  const section = source.split("Speaker range proposals")[1].split("</section>")[0];
  assert.equal(/checkbox/.test(section), false, "no selection, so nothing can be applied in bulk");
  assert.equal(/Select all|Apply selected/i.test(section), false);
  // And the client never builds the operations. It sends which proposal was accepted; the server
  // plans it. A client that planned its own could not know the transcript had not moved.
  assert.equal(/op:"label"|op:"split"|op: "label"|op: "split"/.test(section), false,
    "the client must not choose overlay operations for an accepted range");
});

test("the whole-cluster proposals keep their own section and their own wording", () => {
  // GLOBAL is not retired by RANGE, and the two must not read alike: one asks the reporter to
  // believe something about a cluster, the other about words they can see.
  const source = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(source, />Speaker and label proposals \(/);
  assert.match(source, /\/api\/transcript\/speaker-suggestions/);
  assert.match(source, /Use this assignment/, "the bucket path is unchanged");
});
