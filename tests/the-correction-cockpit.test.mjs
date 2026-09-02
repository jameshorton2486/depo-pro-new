// What the correction panel decides, checked away from the markup.
//
// The Workspace has no client test harness here, so a decision left inside the component is a
// decision nothing checks. These hold the ones that can be wrong: who the reporter may attribute a
// paragraph to, which structural actions apply, and what the review worklist contains.
//
// The design they encode comes from the Production Trial #1 diagnostic. AI points at the work; the
// reporter's own controls do it. Accepting proposals one at a time cost a 195-second re-analysis
// each, about 580 times slower than correcting the same locations by hand, so REVIEW is a worklist
// rather than an acceptance queue.
import assert from "node:assert/strict";
import test from "node:test";
import { paragraphLocation, proposalScopeDescription, reviewCategories, reviewStep, selectedParagraphSummary, speakerActions, speakerReviewLocations, structureActions } from "../app/transcript-tools.mjs";

const CANDIDATES = [
  { id: "reporter", label: "Miah Bardot", defaultRole: "COURT_REPORTER" },
  { id: "attorney-1", label: "Ruben J. Olvera", defaultRole: "QUESTIONING_ATTORNEY" },
  { id: "witness", label: "Jennifer Baier", defaultRole: "WITNESS" },
  { id: "attorney-2", label: "Pablo E. Rivera", defaultRole: "DEFENDING_ATTORNEY" },
];
const PARAGRAPH = {
  id: "paragraph:job:word:10", speakerIdentity: "witness", transcriptRole: "WITNESS", label: "A.",
  elementType: "ANSWER", deepgramSpeaker: 2, start: 312.5, end: 317.25,
  asrWordIds: ["job:word:10", "job:word:11", "job:word:12"],
  words: [
    { id: "job:word:10", text: "Uh,", confidence: 0.98 },
    { id: "job:word:11", text: "good", confidence: 0.4, lowConfidence: true },
    { id: "job:word:12", text: "morning.", confidence: 0.91 },
  ],
};
const PAGES = [{ pageNumber: 23, lines: [{ position: 7, paragraphId: "paragraph:job:word:10" }] }];

// --- who the reporter may say spoke ---------------------------------------------------------

test("the speaker list is built from the record, never from a list of names", () => {
  const actions = speakerActions({ candidates: CANDIDATES, labels: {}, examinerIdentity: "attorney-1" });
  const people = actions.filter(item => item.kind === "person");
  assert.deepEqual(people.map(item => item.speakerIdentity), ["witness", "attorney-1", "attorney-2", "reporter"],
    "witness and examiner first, because in a deposition they speak most");
  assert.deepEqual(people.map(item => item.label), ["Jennifer Baier", "Ruben J. Olvera", "Pablo E. Rivera", "Miah Bardot"]);
  // The examiner is found by identity, not by role name. Trial #1's roster says EXAMINING_ATTORNEY
  // where the overlay vocabulary says QUESTIONING_ATTORNEY, and ranking on the string put the
  // examining attorney below the court reporter in the panel he is used from most.
  const realWorld = speakerActions({
    candidates: [
      { id: "reporter", label: "Miah Bardot", defaultRole: "COURT_REPORTER" },
      { id: "attorney-2", label: "Pablo E. Rivera", defaultRole: "DEFENDING_ATTORNEY" },
      { id: "witness", label: "Jennifer Baier", defaultRole: "WITNESS" },
      { id: "attorney-1", label: "Ruben J. Olvera", defaultRole: "EXAMINING_ATTORNEY" },
    ],
    examinerIdentity: "attorney-1",
  }).filter(item => item.kind === "person");
  assert.deepEqual(realWorld.map(item => item.speakerIdentity), ["witness", "attorney-1", "attorney-2", "reporter"]);
  assert.equal(people.find(item => item.speakerIdentity === "attorney-1").examiner, true);
  // Every action carries the role the record gives that person; nothing here decides a role.
  for (const person of people) assert.equal(person.transcriptRole, CANDIDATES.find(c => c.id === person.speakerIdentity).defaultRole);
  // An empty roster produces no people, rather than defaults.
  assert.deepEqual(speakerActions({ candidates: [] }).filter(item => item.kind === "person"), []);
});

test("a procedural role with nobody holding it is offered truthfully, and creates no person", () => {
  // Trial #1: the videographer opens the deposition, states the time, and goes on and off the
  // record, and is never named -- not in the recording and not in the Notice. Forced to choose from
  // a roster that did not contain them, the RANGE pass proposed the COURT REPORTER at 0.95 for the
  // videographer's own script. Offering the role is what closes that.
  const videographer = speakerActions({ candidates: CANDIDATES }).find(item => item.role === "VIDEOGRAPHER");
  assert.ok(videographer, "offered, because nobody on this roster is the videographer");
  assert.equal(videographer.label, "Videographer");
  assert.equal(videographer.note, "name not established", "said plainly, not as a placeholder for a name that is coming");
  assert.equal(videographer.speakerIdentity, null, "no canonical identity, so no person reaches the certificate");
  assert.equal(videographer.transcriptRole, "VIDEOGRAPHER");
});

test("a procedural role somebody already holds is not offered twice", () => {
  const withVideographer = [...CANDIDATES, { id: "videographer-1", label: "Dana Reyes", defaultRole: "VIDEOGRAPHER" }];
  const actions = speakerActions({ candidates: withVideographer });
  assert.equal(actions.filter(item => item.role === "VIDEOGRAPHER").length, 1);
  assert.equal(actions.find(item => item.role === "VIDEOGRAPHER").speakerIdentity, "videographer-1",
    "the named person, not the anonymous role");
});

test("Other never creates a participant on its own", () => {
  const other = speakerActions({ candidates: CANDIDATES }).at(-1);
  assert.equal(other.kind, "other");
  assert.equal(other.speakerIdentity, null);
  assert.equal(other.transcriptRole, null);
});

test("no speaker action asserts a designation", () => {
  // Q. and A. are derived from who spoke plus the examination state. An action that carried one
  // would be the panel deciding something the transcript model decides.
  for (const action of speakerActions({ candidates: CANDIDATES, examinerIdentity: "attorney-1" })) {
    assert.equal("elementType" in action, false);
    assert.equal("label" in action && ["Q.", "A."].includes(action.label), false, `${action.label} is a designation, not a speaker`);
  }
});

// --- what the reporter is looking at ------------------------------------------------------------

test("the selected paragraph reads as a place in the record, not as a data structure", () => {
  const shown = selectedParagraphSummary({ paragraph: PARAGRAPH, pages: PAGES, labels: { witness: "THE WITNESS" }, saveState: "saved" });
  assert.deepEqual(shown.location, { page: 23, line: 7 }, "where a reporter would say it is");
  assert.equal(shown.start, 312.5);
  assert.equal(shown.end, 317.25);
  assert.equal(shown.speakerLabel, "THE WITNESS");
  assert.equal(shown.designation, "A.", "reported, because it is derived");
  assert.equal(shown.playable, true);
  assert.equal(shown.saveState, "saved");
  // Diagnostics exist but are not in the reporter's way.
  assert.equal(shown.details.deepgramSpeaker, 2);
  assert.equal(shown.details.lowConfidenceWords, 1);
  assert.ok(Math.abs(shown.details.averageConfidence - 0.7633) < 0.001);
});

test("a paragraph with no measured audio is not offered for playback", () => {
  const shown = selectedParagraphSummary({ paragraph: { ...PARAGRAPH, start: null, end: null }, pages: PAGES });
  assert.equal(shown.playable, false);
});

test("a paragraph that is not on a page yet reports no location rather than a wrong one", () => {
  assert.equal(paragraphLocation({ paragraphId: "paragraph:absent", pages: PAGES }), null);
  assert.equal(selectedParagraphSummary({ paragraph: PARAGRAPH, pages: [] }).location, null);
});

test("an unattributed paragraph says so rather than naming a diarization cluster", () => {
  const shown = selectedParagraphSummary({ paragraph: { ...PARAGRAPH, speakerIdentity: null, label: null }, pages: PAGES });
  assert.equal(shown.speakerLabel, null, "the component reads this as 'no speaker recorded'");
  assert.equal(shown.details.deepgramSpeaker, 2, "the cluster is a diagnostic, not a speaker");
});

// --- which structural actions apply -------------------------------------------------------------

test("an action that cannot mean anything here is not offered as though it could", () => {
  const first = structureActions({ paragraph: PARAGRAPH, index: 0, total: 10, selectedWordId: "job:word:11" });
  const byKey = key => first.find(item => item.key === key);
  assert.equal(byKey("join-previous").available, false, "nothing precedes the first paragraph");
  assert.equal(byKey("join-next").available, true);
  assert.equal(byKey("split").available, true, "a word after the first is selected");
  assert.equal(byKey("mark").available, true, "marking always applies");
  for (const action of first) if (!action.available) assert.ok(action.unavailable, `${action.key} must say why not`);
});

test("splitting needs a word, and never the first one", () => {
  const at = wordId => structureActions({ paragraph: PARAGRAPH, index: 3, total: 10, selectedWordId: wordId }).find(item => item.key === "split");
  assert.equal(at(null).available, false);
  assert.equal(at("job:word:10").available, false, "splitting before the first word leaves an empty head");
  assert.equal(at("job:word:12").available, true);
  assert.equal(at("job:word:99").available, false, "a word from another paragraph is not a split point here");
});

test("with nothing selected there are no structural actions at all", () => {
  assert.deepEqual(structureActions({ paragraph: null }), []);
});

// --- the worklist -------------------------------------------------------------------------------

test("review counts outstanding work, and a finished category disappears", () => {
  const categories = reviewCategories({
    speakerLocations: [{ paragraphId: "a" }, { paragraphId: "b" }],
    lowConfidenceWords: [{ id: "w1" }],
    wordCorrections: [], markedWords: [], unlabelledParagraphs: [{ id: "p" }],
  });
  assert.deepEqual(categories.map(item => [item.key, item.count]), [["speaker", 2], ["unlabelled", 1], ["low-confidence", 1]]);
  assert.equal(categories.some(item => item.key === "word"), false, "an empty category is not offered for navigation");
  assert.deepEqual(reviewCategories({}), [], "a transcript with no outstanding work shows no worklist");
});

test("speaker review is counted in places to visit, not in proposals", () => {
  // Trial #1 produced 173 proposals sitting in 62 printed paragraphs. A reporter visits paragraphs,
  // and listing every proposal would send them back to the same one repeatedly.
  const paragraphs = [
    { id: "p1", asrWordIds: ["w1", "w2", "w3"] },
    { id: "p2", asrWordIds: ["w4"] },
  ];
  const locations = speakerReviewLocations({ paragraphs, proposals: [
    { wordId: "w1", speakerIdentity: "witness" },
    { wordId: "w3", speakerIdentity: "witness" },
    { wordId: "w4", speakerIdentity: "attorney-2" },
    { wordId: "gone", speakerIdentity: "witness" },
  ] });
  assert.equal(locations.length, 2, "three proposals in two paragraphs, plus one whose word is gone");
  assert.deepEqual(locations.map(item => item.paragraphId), ["p1", "p2"]);
  assert.equal(locations[0].proposals.length, 2);
  assert.deepEqual(locations[0].reasons, ["witness"], "one name, not repeated per proposal");
});

test("Previous and Next work a list rather than reading a book", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(reviewStep({ items, index: -1, direction: 1 }), { index: 0, item: items[0] });
  assert.deepEqual(reviewStep({ items, index: 0, direction: 1 }), { index: 1, item: items[1] });
  assert.deepEqual(reviewStep({ items, index: 2, direction: 1 }), { index: 0, item: items[0] }, "wraps rather than dead-ending");
  assert.deepEqual(reviewStep({ items, index: 0, direction: -1 }), { index: 2, item: items[2] });
  assert.deepEqual(reviewStep({ items: [], index: -1, direction: 1 }), { index: -1, item: null });
});

// --- what the reporter is being asked to believe ----------------------------------------------

test("a reporter can tell a whole-speaker suggestion from a short-portion one", () => {
  const labels = { witness: "THE WITNESS" };
  const range = proposalScopeDescription({ proposalLevel: "RANGE", speakerIdentity: "witness" }, { labels });
  assert.equal(range.scope, "range");
  assert.match(range.headline, /short portion/);
  assert.match(range.detail, /only these words/);

  const global = proposalScopeDescription({ deepgramSpeaker: 6, speakerIdentity: "witness" }, { labels });
  assert.equal(global.scope, "global");
  assert.match(global.detail, /every paragraph/);
  assert.notEqual(global.headline, range.headline, "the two must not read alike");
  // And neither says "diarization cluster" at the reporter.
  for (const shown of [range, global]) {
    assert.equal(/diarization|cluster|reviewStateHash|overlay/i.test(shown.headline + shown.detail), false);
  }
});
