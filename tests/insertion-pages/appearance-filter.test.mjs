// The appearance page states who appeared. Counsel of record who did not appear were reaching it,
// which is a false statement in certified work product.
//
// Asserted against the text of two certified transcripts, not against the filter's own output. A
// check built from the same rule as the code it checks proves only that the code is consistent
// with itself.
//
//   Etminan p.2   FOR THE PLAINTIFF:  ROCIO LAURA ELIZONDO VARGAS,
//                      Dennis J. Bentley
//                      MARCO CRAWFORD LAW, PLLC          <- firm prints, Crawford does not
//   Thomas  p.2   FOR THE PLAINTIFF:  DELIA GARZA
//                      Steven A. Nunez
//                      BRAIN AND SPINE PERSONAL          <- no Cukjati, no Cukjati Law Firm
//                 FOR THE DEFENDANT:  ... AND SHAWN HERBER
//                      Lucia D. Zhan
//                      BROTHERS, ALVARADO, PIAZZA & COZORT, P.C.   <- prints via Zhan, not Alvarado
import assert from "node:assert/strict";
import test from "node:test";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";

// The page model is { line, text, fields } objects, not flat strings.
const appearanceText = pages =>
  (pages.pages.find(page => page.role === "appearances")?.lines ?? []).map(line => line.text.trim());

const attorney = (name, firm, represents, actualAppearance) => ({ id:name, fullName:name, firm, represents, actualAppearance, side:"PLAINTIFF" });
const assemble = (counsel, participants) => assembleInsertionInput({
  record:{ counsel, parties:[], participants }, intake:{}, operator:{}, pagination:{}, template:{},
});
const names = assembled => assembled.appearances.map(item => item.name);
const firms = assembled => assembled.appearances.map(item => item.firm);

test("Etminan: the non-appearing attorney is absent, his firm is not", () => {
  const assembled = assemble([
    attorney("Dennis J. Bentley", "Marco Crawford Law, PLLC", ["Rocio Laura Elizondo Vargas"], true),
    attorney("Christian R. Ramon", "Vidaurri, Rodriguez & Reyna, LLC", ["Leonardo Isaias Rodriguez"], true),
    attorney("Marco A. Crawford", "Marco Crawford Law, PLLC", ["Rocio Laura Elizondo Vargas"], false),
  ]);
  assert.deepEqual(names(assembled), ["Dennis J. Bentley", "Christian R. Ramon"]);
  assert.ok(firms(assembled).includes("Marco Crawford Law, PLLC"),
    "the certified page carries MARCO CRAWFORD LAW, PLLC through Bentley");
});

test("Thomas: a firm with nobody present disappears entirely", () => {
  const assembled = assemble([
    attorney("Steven A. Nunez", "Brain and Spine Personal Injury Lawyers of San Antonio, PLLC", ["Delia Garza"], true),
    attorney("Lucia D. Zhan", "Brothers, Alvarado, Piazza & Cozort, P.C.", ["Home Depot U.S.A., Inc.", "Shawn Herber"], true),
    attorney("Karen M. Alvarado", "Brothers, Alvarado, Piazza & Cozort, P.C.", ["Home Depot U.S.A., Inc."], false),
    attorney("Jacob D. Cukjati", "Cukjati Law Firm, PLLC", ["Delia Garza"], false),
    attorney("Curtis L. Cukjati", "Cukjati Law Firm, PLLC", ["Delia Garza"], false),
  ]);
  assert.deepEqual(names(assembled), ["Steven A. Nunez", "Lucia D. Zhan"]);
  assert.ok(!firms(assembled).includes("Cukjati Law Firm, PLLC"),
    "nobody from Cukjati Law Firm appeared, and the certified page does not name it");
  assert.ok(firms(assembled).includes("Brothers, Alvarado, Piazza & Cozort, P.C."),
    "Alvarado's firm still prints, through Zhan who appeared");
});

test("counsel whose attendance was never recorded is not dropped", () => {
  // missing() is not false. "Not yet entered" must not read as "did not appear".
  const assembled = assemble([attorney("Pat Counsel", "Firm", ["A Party"], undefined)]);
  assert.deepEqual(names(assembled), ["Pat Counsel"]);
});

async function renderedPages(counsel, participants, videotaped = false) {
  const { buildTexasInsertionPageSet } = await import("../../server/insertion-pages/build-pages.mjs");
  const { loadTemplateVariant } = await import("../../server/insertion-pages/templates.mjs");
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED");
  const assembled = assembleInsertionInput({
    record:{ counsel, parties:[], participants, case:{}, deposition:{ videotaped } }, intake:{}, template, pagination:{},
    operator:{ jurisdiction:"texas-state", signatureDisposition:"requested", signatureDispositionBasis:"Stated on the record" },
  });
  return buildTexasInsertionPageSet(assembled, { setId:"s", depositionId:"d", generatedAt:"2026-08-19T00:00:00Z", certificateOnly: true });
}

test("ALSO PRESENT prints even when nobody was", async () => {
  // Thomas renders "THE VIDEOGRAPHER:  NONE". Suppressing the block would leave a reader unable
  // to tell "no videographer" from "not recorded". Asserted on the rendered page, not the input.
  const zhan = attorney("Lucia D. Zhan", "Brothers, Alvarado", ["Home Depot U.S.A., Inc."], true);
  const none = appearanceText(await renderedPages([zhan], { videographers:[], otherAttendees:[] }));
  assert.ok(none.some(line => line.includes("ALSO PRESENT:")));
  assert.ok(none.some(line => /THE VIDEOGRAPHER:\s+NONE/.test(line)), "Thomas prints NONE rather than omitting the line");

  const named = appearanceText(await renderedPages([zhan], { videographers:[{ fullName:{ value:"Sam Woody" } }], otherAttendees:[] }));
  assert.ok(named.some(line => /THE VIDEOGRAPHER:\s+Sam Woody/.test(line)), "Etminan names the videographer");
});

test("an absent field is omitted, not rendered as a blank line", async () => {
  // Nunez prints on the Thomas page with no phone and no email at all.
  const base = { id:"a", fullName:"Steven A. Nunez", represents:["Delia Garza"], actualAppearance:true, side:"PLAINTIFF" };
  const without = appearanceText(await renderedPages([base], { videographers:[], otherAttendees:[] }));
  const withFirm = appearanceText(await renderedPages([{ ...base, firm:"Brain and Spine Personal" }], { videographers:[], otherAttendees:[] }));

  // Positive control first: the assertion can see a firm when there is one.
  assert.ok(withFirm.includes("Brain and Spine Personal"), "the extractor must find a firm that is present");

  const nameAt = without.findIndex(line => line.includes("Steven A. Nunez"));
  assert.ok(nameAt >= 0);
  assert.notEqual(without[nameAt + 1], "", "a missing firm must produce no line at all, not an empty one");
});

test("a videotaped deposition never fabricates a NONE videographer", async () => {
  const zhan = attorney("Lucia D. Zhan", "Brothers, Alvarado", ["Home Depot U.S.A., Inc."], true);
  const text = appearanceText(await renderedPages([zhan], { videographers:[], otherAttendees:[] }, true));
  assert.ok(!text.some(line => /THE VIDEOGRAPHER:\s+NONE/.test(line)));
});

test("the ALSO PRESENT heading is not printed with nothing under it", async () => {
  // Once NONE stopped being printed for a deposition nobody had answered the question about, the
  // heading was left standing alone -- a category named on a certified page with no answer beneath
  // it, which is the same defect as the omitted labels above. No specimen shows that state.
  const zhan = attorney("Lucia D. Zhan", "Brothers, Alvarado", ["Home Depot U.S.A., Inc."], true);
  const unstated = appearanceText(await renderedPages([zhan], { videographers:[], otherAttendees:[] }, null));
  // null, not undefined: renderedPages defaults an omitted argument to false, which is an answer.
  assert.ok(!unstated.includes("ALSO PRESENT:"),
    "nothing is known to be present, so the page says nothing rather than opening an empty heading");

  // It still prints whenever it has something to carry -- the specimens all do.
  const stated = appearanceText(await renderedPages([zhan], { videographers:[], otherAttendees:[] }, false));
  assert.ok(stated.includes("ALSO PRESENT:"));
  assert.ok(stated.some(line => /THE VIDEOGRAPHER:\s+NONE/.test(line)), "an answered question is still answered");
});
