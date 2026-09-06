// A caption names every party, and on a real case that does not fit one line.
//
// Etminan has one plaintiff and three defendants. Joined onto a single row the defendants ran to 85
// characters on a 63-character page, so the block had no square form at all and CAPTION_ROW_OVERFLOW
// refused the transcript -- correctly, because the alternative was letting the wrapper re-flow the
// row and lose the ")" column. The certified transcript answers this by running the names down the
// left column, and so does this.
//
// The column width is measured, not chosen: certified Etminan page 1, left text at x=134pt and the
// delimiter at x=356pt, 7.11pt per cell at this profile's 10-CPI pitch, so 31 cells.
import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet, captionOverflowFindings } from "../../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../../server/texas-freelance-deposition-profile.mjs";

// The real case, and the one that could not print.
const ETMINAN = Object.freeze([
  { name: "Rocio Laura Elizondo Vargas", role: "Plaintiff" },
  { name: "Leonardo Isaias Rodriguez", role: "Defendant" },
  { name: "Sandy Dean Koepke", role: "Defendant" },
  { name: "Standing Seam & Specialty Company, Inc.", role: "Defendant" },
]);
const ONE_EACH = Object.freeze([
  { name: "Alex Plaintiff", role: "Plaintiff" },
  { name: "Delta Company", role: "Defendant" },
]);

async function pages(parties, { court = "464TH JUDICIAL DISTRICT COURT, HIDALGO COUNTY, TEXAS", operatorExtras = {} } = {}) {
  const record = createCanonicalDepositionRecord({
    court, causeNumber: "C-5722-24-L", witness: "Mohammad Etminan, M.D.", depositionDate: "2026-04-24", parties,
    attorneys: [{ name: "Dennis J. Bentley", firm: "Plaintiff Firm", represents: ["Rocio Laura Elizondo Vargas"], side: "PLAINTIFF" }],
    reporterProfile: { name: "Miah Bardot", licenseNumber: "12129", csrExpiration: "2026-06-30", firmRegistrationNumber: "1", address: "7234 Hovingham", phone: "469 740-9603" },
  });
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED");
  const input = assembleInsertionInput({
    record, template, intake: { counselOfRecord: ["Dennis J. Bentley"] },
    operator: {
      jurisdiction: "texas-state", signatureDisposition: "requested", signatureDispositionBasis: "Stated on the record",
      appearances: record.counsel, courtHeadingLine: "IN THE DISTRICT COURT",
      countyCourtLine: "HIDALGO COUNTY, TEXAS", judicialDistrictLine: "464TH JUDICIAL DISTRICT",
      certification: { chargesResponsibleParty: "Plaintiff" }, timeUsed: { parties: [{ name: "Dennis J. Bentley", minutes: 83 }] },
      ...operatorExtras,
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [], changesAndSignature: { startPage: 41 }, reportersCertification: { startPage: 43 }, entries: [], actualSectionPages: {}, declaredSectionPages: {} } },
  });
  return { input, set: buildTexasInsertionPageSet(input, { setId: "set", depositionId: "DEP-20260901-CAP", generatedAt: "2026-09-01T12:00:00.000Z" }) };
}

const captionRows = set => set.pages.find(page => page.role === "title").lines
  .map(line => line.text).filter(text => text.includes(")"));

test("three defendants run down the column instead of blocking the transcript", async () => {
  const { input, set } = await pages(ETMINAN);
  assert.deepEqual(captionOverflowFindings(input), [], "the caption that could not print must now print");
  const rows = captionRows(set);
  const defendants = rows.slice(rows.findIndex(row => row.startsWith("DEFENDANTS,")) + 1);
  assert.ok(defendants.length >= 2, `the defendants must occupy more than one row: ${JSON.stringify(defendants)}`);
  // Every name is still on the page, and none was dropped to make it fit.
  const printed = defendants.join(" ").replace(/\s*\)\s*/g, " ").replace(/\s+/g, " ");
  for (const name of ["LEONARDO ISAIAS RODRIGUEZ", "SANDY DEAN KOEPKE", "STANDING SEAM & SPECIALTY COMPANY, INC."]) {
    assert.ok(printed.includes(name), `${name} must survive the wrap`);
  }
});

test("every wrapped row keeps the delimiter column", async () => {
  // The whole reason the guard refused rather than wrapping: a caption whose ")" wanders is not a
  // caption. All rows on the page share one column, continuation rows included.
  const { set } = await pages(ETMINAN);
  const columns = new Set(captionRows(set).map(row => row.indexOf(")")));
  assert.equal(columns.size, 1, `the delimiter must sit in one column: ${[...columns].join(", ")}`);
  for (const row of captionRows(set)) {
    assert.ok(row.length <= TEXAS_FREELANCE_DEPOSITION_V1.charactersPerLine, `"${row}" is ${row.length} characters`);
  }
});

test("the court heading sits beside the first row of the name, not beside every one", async () => {
  // The right column states the court once. Repeating it down the continuations would print the
  // court three times on a certified caption.
  const { set } = await pages(ETMINAN);
  const rows = captionRows(set);
  assert.equal(rows.filter(row => row.includes("IN THE DISTRICT COURT")).length, 1);
  assert.equal(rows.filter(row => row.includes("JUDICIAL DISTRICT")).length, 1);
  assert.equal(rows.filter(row => row.includes("HIDALGO COUNTY, TEXAS")).length, 1);
});

test("a caption that already fits is laid out exactly as before", async () => {
  const { input, set } = await pages(ONE_EACH);
  assert.deepEqual(captionOverflowFindings(input), []);
  const rows = captionRows(set);
  assert.equal(rows.filter(row => row.startsWith("ALEX PLAINTIFF")).length, 1, "one party is still one row");
  assert.equal(rows.filter(row => row.startsWith("DELTA COMPANY")).length, 1);
  assert.equal(rows.filter(row => row.startsWith("PLAINTIFF,")).length, 1, "and the singular label is unchanged");
});

test("the column is the profile's measured width, and nothing wider is printed", async () => {
  assert.equal(TEXAS_FREELANCE_DEPOSITION_V1.captionLeftColumn, 31,
    "measured from the certified transcript; changing it changes a certified page");
  assert.equal(TEXAS_FREELANCE_DEPOSITION_V1.authority.captionLeftColumn.authority, "CERTIFIED_SPECIMEN_MEASURED");
  const { set } = await pages(ETMINAN);
  for (const row of captionRows(set)) {
    const left = row.slice(0, row.indexOf(")")).trimEnd();
    assert.ok(left.length <= TEXAS_FREELANCE_DEPOSITION_V1.captionLeftColumn, `"${left}" is ${left.length} wide`);
  }
});

test("one party name too long for the column is refused, not broken in half", async () => {
  // A name split across rows by the wrapper is a name the caption states differently from the
  // pleadings. That is not a formatting question, so the document is refused instead. The refusal
  // here comes from the administrative wrapper rather than from captionOverflowFindings -- a single
  // token wider than the page has no square form and no wrapped form either -- and it names the
  // token, which is what a reporter needs in order to act on it.
  await assert.rejects(
    () => pages([
      { name: "Alex Plaintiff", role: "Plaintiff" },
      { name: "Extraordinarily-Long-Hyphenated-Defendant-Entity-Name-With-No-Spaces", role: "Defendant" },
    ]),
    error => {
      assert.match(error.message, /ADMINISTRATIVE_TOKEN_OVERFLOW/);
      assert.ok(error.message.includes("EXTRAORDINARILY-LONG-HYPHENATED-DEFENDANT-ENTITY-NAME-WITH-NO-SPACES"),
        "the refusal must name what would not fit");
      return true;
    });
});
