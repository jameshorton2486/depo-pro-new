// The comparator that decides whether a rendered transcript page is drawn again.
//
// Measured on the real Etminan deposition: 63 pages, 12,178 word buttons, 30,245 DOM nodes, and one
// render of the tree costing 856ms of blocked main thread -- for a click that only moved the
// selection. memo was already there and never prevented anything, because the container handed every
// page eight fresh arrow handlers and a new Set on every render.
//
// The saving exists because a correction changes less than it appears to: a split on page 46 changed
// twelve pages and left fifty-one byte-identical.
//
// THE DANGEROUS DIRECTION IS "EQUAL". A page wrongly held back shows stale text on a certified
// transcript, which is worse than a slow screen, so most of this file is about the cases that must
// compare unequal. page.id is positional -- `transcript-body-4` names the fourth page, not its
// contents -- so identity is never sufficient.
import assert from "node:assert/strict";
import test from "node:test";
import { pageRenderEqual, samePageContent } from "../app/workspace-page-render.mjs";

const fragment = (id, text, extra = {}) => ({ id, kind:"evidence", role:"testimony", text, sourceWordId:id, audioStart:null, ...extra });
const line = (position, paragraphId, fragments) => ({ position, occupied:Boolean(fragments.length), content:fragments.map(f => f.text).join(" "), paragraphId, fragments });
const page = (pageNumber, lines) => ({ id:`transcript-body-${pageNumber}`, pageNumber, role:"transcript-body", sectionKind:"testimony", editable:true, lines });

const PAGE = page(4, [
  line(1, "p1", [fragment("w1", "Good"), fragment("w2", "afternoon.")]),
  line(2, "p1", [fragment("w3", "Doctor.")]),
  line(3, null, []),
]);
const clone = value => JSON.parse(JSON.stringify(value));

// Stable handlers, as the container must supply them.
const HANDLERS = Object.freeze({
  onActivate(){}, onChange(){}, onSave(){}, onCancel(){}, onSplit(){}, onJoinPrevious(){}, onJoinNext(){}, onPlayAt(){},
});
const PROFILE = { id:"TEXAS_FREELANCE_DEPOSITION_V1", version:"1.0.0" };
const props = (extra = {}) => ({
  page:PAGE, profile:PROFILE, selectedParagraphId:null, selectedWordId:null, activePlaybackWordId:null,
  lowConfidenceWordIds:new Set(), activeEdit:null, ...HANDLERS, ...extra,
});

// --- content ------------------------------------------------------------------------------------

test("a page rebuilt from an identical server response is not drawn again", () => {
  // The case the whole repair rests on. Every page object is new after a refetch, so identity
  // comparison saves nothing; content comparison saves fifty-one pages in sixty-three.
  assert.equal(samePageContent(PAGE, clone(PAGE)), true);
  assert.equal(pageRenderEqual(props(), props({ page:clone(PAGE) })), true);
});

test("any change to what the page prints draws it again", () => {
  const changes = [
    ["a word's text", p => { p.lines[0].fragments[0].text = "Bad"; }],
    ["a word's id", p => { p.lines[0].fragments[0].id = "w9"; }],
    ["a word's kind", p => { p.lines[0].fragments[0].kind = "authored"; }],
    ["a line's paragraph", p => { p.lines[0].paragraphId = "p2"; }],
    ["a line's text", p => { p.lines[1].content = "Something else."; }],
    ["whether a line is occupied", p => { p.lines[2].occupied = true; }],
    ["a line's playable audio", p => { p.lines[0].fragments[0].audioStart = 12.5; }],
    ["the number of words on a line", p => { p.lines[0].fragments.push(fragment("w4", "Sir.")); }],
    ["a line removed", p => { p.lines.pop(); }],
    // Both directions. Walking only the shorter side would report a page that GAINED a line as
    // unchanged, and a split adds a line -- which is the operation this whole repair serves.
    ["a line added", p => { p.lines.push(line(4, "p2", [fragment("w4", "Yes.")])); }],
    ["the page number", p => { p.pageNumber = 5; }],
    ["the page role", p => { p.role = "certification1"; }],
    ["whether the page is editable", p => { p.editable = false; }],
  ];
  for (const [what, mutate] of changes) {
    const changed = clone(PAGE);
    mutate(changed);
    assert.equal(samePageContent(PAGE, changed), false, `${what} must draw the page again`);
    assert.equal(pageRenderEqual(props(), props({ page:changed })), false, what);
  }
});

test("a positional id is not evidence of sameness", () => {
  // transcript-body-4 names the fourth page, not its contents. A split earlier in the deposition
  // rewrites this page while its id stays exactly the same.
  const rewritten = clone(PAGE);
  rewritten.lines[0].fragments[0].text = "Afternoon,";
  assert.equal(rewritten.id, PAGE.id);
  assert.equal(samePageContent(PAGE, rewritten), false);
});

// --- surrounding state --------------------------------------------------------------------------

test("the selection draws only the pages it moved between", () => {
  const elsewhere = props({ selectedParagraphId:"p9" });
  assert.equal(pageRenderEqual(props(), elsewhere), true, "a selection on another page leaves this one alone");
  assert.equal(pageRenderEqual(props(), props({ selectedParagraphId:"p1" })), false, "moving into this page draws it");
  assert.equal(pageRenderEqual(props({ selectedParagraphId:"p1" }), props()), false, "and moving out of it draws it too");
});

test("the selected word draws only the pages it moved between", () => {
  assert.equal(pageRenderEqual(props(), props({ selectedWordId:"elsewhere" })), true);
  assert.equal(pageRenderEqual(props(), props({ selectedWordId:"w2" })), false);
  assert.equal(pageRenderEqual(props({ selectedWordId:"w2" }), props()), false);
});

test("the word being played draws only the pages it moved between", () => {
  assert.equal(pageRenderEqual(props(), props({ activePlaybackWordId:"elsewhere" })), true);
  assert.equal(pageRenderEqual(props(), props({ activePlaybackWordId:"w3" })), false);
});

test("low-confidence marks draw only the pages that carry them", () => {
  const none = props(), here = props({ lowConfidenceWordIds:new Set(["w2"]) });
  assert.equal(pageRenderEqual(none, here), false, "a mark landing on this page draws it");
  assert.equal(pageRenderEqual(here, none), false, "and clearing it draws it again");
  assert.equal(pageRenderEqual(none, props({ lowConfidenceWordIds:new Set(["somewhere-else"]) })), true);
  assert.equal(pageRenderEqual(here, props({ lowConfidenceWordIds:new Set(["w2"]) })), true,
    "an equal set rebuilt each render is not a change");
});

test("the open editor draws its own page and no other", () => {
  const editHere = { paragraphId:"p1", lineKey:"4:1", draft:"Good afternoon.", baseText:"Good afternoon.", caret:0, status:"editing" };
  const editAway = { ...editHere, lineKey:"40:1" };
  assert.equal(pageRenderEqual(props(), props({ activeEdit:editHere })), false, "opening the editor here draws this page");
  assert.equal(pageRenderEqual(props({ activeEdit:editHere }), props()), false, "closing it draws it again");
  assert.equal(pageRenderEqual(props(), props({ activeEdit:editAway })), true, "an editor on page 40 leaves page 4 alone");
  assert.equal(pageRenderEqual(props({ activeEdit:editAway }), props({ activeEdit:{ ...editAway, draft:"typing" } })), true,
    "and typing into it does not draw page 4");
  assert.equal(pageRenderEqual(props({ activeEdit:editHere }), props({ activeEdit:{ ...editHere, draft:"typing" } })), false,
    "while typing into this page's editor does draw this page");
});

// --- the caller's contract ----------------------------------------------------------------------

test("an unstable handler draws the page rather than hiding the caller's defect", () => {
  // This is the defect that made memo useless: eight arrow functions rebuilt inside the map. If the
  // container regresses, the screen goes slow again -- it does not go wrong. A comparator that
  // ignored handler identity would keep pages holding a stale closure over activeEdit, and the
  // editor would save the wrong paragraph text.
  // onSplit left this list when bare Enter stopped splitting: the page component no longer splits
  // at all, and Split here in the tools panel anchors to the selected word instead of a caret.
  for (const key of ["onActivate", "onChange", "onSave", "onCancel", "onJoinPrevious", "onJoinNext", "onPlayAt"]) {
    assert.equal(pageRenderEqual(props(), props({ [key]:() => {} })), false, key);
  }
});

test("a changed layout profile draws every page", () => {
  assert.equal(pageRenderEqual(props(), props({ profile:{ ...PROFILE } })), false);
});

test("nothing is reported equal on a missing page", () => {
  assert.equal(samePageContent(null, PAGE), false);
  assert.equal(samePageContent(PAGE, null), false);
  assert.equal(samePageContent(null, null), false, "two absent pages are not a page that need not be drawn");
});
