// Every line of the index puts its page reference in the same column.
//
// The three section lines have always done so -- Appearances, Changes and Signature, Reporter's
// Certificate each carried a hand-counted run of dots that happened to land the reference at
// column 44. The examination line carried its own fixed run of eleven, so it landed wherever the
// examiner's name left it: column 54 for one name and elsewhere for the next.
//
// That was invisible while every index held a single examination with one name. Typed labels made
// it obvious -- "Examination by Mr. Michael Alvarez" and "Cross-Examination by Ms. Grace Whitfield"
// disagreed by six characters -- but they did not cause it.
import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { addCanonicalOath } from "../canonical-oath-fixture.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";
import { horizontalOverflowFindings } from "../../server/insertion-pages/page-model.mjs";
import { validateInsertionInput } from "../../server/insertion-pages/validate.mjs";

const WIDTH = 63;
// Where the reference sits. Stated here rather than read from the module under test: a column
// derived from the code being measured would follow it anywhere it moved.
const REFERENCE_COLUMN = 44;

function record() {
  const built = createCanonicalDepositionRecord({
    court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber:"2026-CI-10001",
    witness:"Jordan Example", depositionDate:"2026-08-01", remote:true, remotePlatform:"Zoom",
    parties:[{ name:"Alex Plaintiff", role:"Plaintiff" }, { name:"Delta Company", role:"Defendant" }],
    attorneys:[
      { name:"Pat Counsel", firm:"Plaintiff Firm", address:"100 Main, San Antonio, Texas", phone:"210-555-0101", represents:["Alex Plaintiff"], side:"PLAINTIFF" },
      { name:"Dana Counsel", firm:"Defense Firm", address:"200 Main, San Antonio, Texas", phone:"210-555-0102", represents:["Delta Company"], side:"DEFENDANT" },
    ],
    reporterProfile:{ name:"Riley Reporter", licenseNumber:"1234", csrExpiration:"2027-12-31", company:"Reporter Firm", firmRegistrationNumber:"5678", address:"300 Main, San Antonio, Texas", phone:"210-555-0103" },
  });
  built.deposition.witnessSworn = { value:true, source:"REPORTER_ENTERED", state:"REPORTER_ADDED", confidence:null, citations:[] };
  addCanonicalOath(built);
  built.deposition.remote = { value:true, source:"REPORTER_ENTERED", state:"REPORTER_ADDED", confidence:null, citations:[] };
  built.deposition.remotePlatform = { value:"Zoom", source:"REPORTER_ENTERED", state:"REPORTER_ADDED", confidence:null, citations:[] };
  return built;
}

async function indexPageLines(examinations) {
  const rec = record();
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  const appearances = rec.counsel.map(counsel => ({ ...counsel, participation:{ method:{ value:"zoom" }, detail:{ value:"Zoom" } } }));
  const input = assembleInsertionInput({
    record:rec, template, intake:{ counselOfRecord:["Pat Counsel", "Dana Counsel"] },
    operator:{
      jurisdiction:"texas-state", signatureDisposition:"waived", signatureDispositionBasis:"Stated on the record", appearances,
      courtHeadingLine:"IN THE DISTRICT COURT OF", countyCourtLine:"BEXAR COUNTY, TEXAS", judicialDistrictLine:"45TH JUDICIAL DISTRICT",
      proceedingHeading:"ORAL DEPOSITION OF", witnessLocation:{ physicalAddress:"San Antonio, Texas" },
      titleNarrative:["Jordan Example, produced as a witness and duly sworn,", "was taken remotely by Zoom before Riley Reporter,", "Certified Shorthand Reporter in and for Texas."],
      certification:{ custodialAttorney:"Pat Counsel", charges:"500.00", chargesResponsibleParty:"Plaintiff", serviceDate:"August 14, 2026", certificationDate:"August 14, 2026", furtherCertificationDate:"August 30, 2026" },
      timeUsed:{ totalOnRecordMinutes:120, parties:[{ name:"Pat Counsel", minutes:60 }, { name:"Dana Counsel", minutes:60 }] },
    },
    pagination:{ index:{ appearances:{ startPage:2 }, examinations, changesAndSignature:{ startPage:41 }, reportersCertification:{ startPage:41 }, entries:[], actualSectionPages:{}, declaredSectionPages:{} } },
  });
  const set = buildTexasInsertionPageSet(input, { setId:"s", depositionId:"DEP", generatedAt:"2026-08-29T12:00:00.000Z" });
  const page = set.pages.find(item => item.role === "index");
  return { lines:page.lines.map(line => line.text).filter(text => String(text ?? "").trim()), pages:set.pages, findings:validateInsertionInput(input) };
}

/**
 * Where the page reference begins: after the trailing run of dots and the space following it.
 *
 * Anchored to the end of the line deliberately. Matching the first dot-run-then-space instead found
 * the honorific -- "Mr. Michael Alvarez" contains one -- and reported column 21 for a line whose
 * reference sits at 44, which read as broken alignment in correctly aligned output.
 */
const referenceColumnOf = line => {
  const match = /\.+ (?=\d+(?:-\d+)?$)/.exec(line);
  return match ? match.index + match[0].length : null;
};

const entry = (examinationLabel, examiner, startPage, endPage) => ({ examinationLabel, examiner, startPage, endPage });

test("every index line puts its page reference in the same column", async () => {
  // The case the D4 document actually contains.
  const { lines } = await indexPageLines([
    entry("Examination", "Mr. Michael Alvarez", 4, 137),
    entry("Cross-Examination", "Ms. Grace Whitfield", 138, 210),
  ]);
  const referenced = lines.filter(line => referenceColumnOf(line) !== null);
  assert.ok(referenced.length >= 4, `expected section and examination lines to carry references, saw ${referenced.length}`);
  const columns = new Set(referenced.map(referenceColumnOf));
  assert.deepEqual([...columns], [REFERENCE_COLUMN],
    `references land in columns ${[...columns].join(", ")}: ${referenced.join(" | ")}`);
});

test("the column is the one the certified section lines already used", async () => {
  // Not a number chosen for the examinations. Appearances and the Reporter's Certificate have
  // always landed here, and the examination line is being brought onto their column rather than
  // the other way round -- which is why thomas-regression's certified page is untouched.
  const { lines } = await indexPageLines([entry("Examination", "Mr. Nunez", 5, 75)]);
  for (const line of lines.filter(item => /^(Appearances|Reporter's Certificate)/.test(item)))
    assert.equal(referenceColumnOf(line), REFERENCE_COLUMN, line);
});

test("every examination type aligns when its label fits the column", async () => {
  const { lines } = await indexPageLines([
    entry("Examination", "Mr. Ng", 4, 60),
    entry("Cross-Examination", "Ms. Grace Whitfield", 61, 120),
    entry("Redirect Examination", "Mr. Ng", 121, 170),
    entry("Recross-Examination", "Mr. Ng", 171, 210),
  ]);
  const examinationLines = lines.filter(line => line.includes(" by "));
  assert.equal(examinationLines.length, 4);
  for (const line of examinationLines) assert.equal(referenceColumnOf(line), REFERENCE_COLUMN, line);
  for (const line of lines) assert.ok(line.length <= WIDTH, `${line.length} characters: ${line}`);
});

test("a label too long for the column pushes the reference right rather than truncating a name", async () => {
  // The measured limit: the certified column leaves 41 characters after the two-space indent, and
  // "Recross-Examination by Ms. Grace Whitfield" needs 42. One character over, so it cannot align
  // without either shortening a name on a certified index or moving the column the certified
  // section lines use. It pushes instead, by two columns, and keeps the name whole.
  const { lines } = await indexPageLines([
    entry("Examination", "Mr. Michael Alvarez", 4, 60),
    entry("Recross-Examination", "Ms. Grace Whitfield", 171, 210),
  ]);
  const [fits, pushed] = lines.filter(line => line.includes(" by "));
  assert.equal(referenceColumnOf(fits), REFERENCE_COLUMN);
  assert.equal(referenceColumnOf(pushed), REFERENCE_COLUMN + 2);
  assert.ok(pushed.includes("Ms. Grace Whitfield"), "the name is never shortened to make the column");
  assert.match(pushed, /\.+ \d+-\d+$/, "at least one dot survives between the name and the reference");
  assert.ok(pushed.length <= WIDTH, `${pushed.length} characters: ${pushed}`);
});

test("a short name, a long name, a one-digit page and a three-digit range", async () => {
  const { lines } = await indexPageLines([
    entry("Examination", "Mr. Ng", 4, 9),
    entry("Cross-Examination", "Ms. Whitfield", 10, 210),
  ]);
  const examinationLines = lines.filter(line => line.includes(" by "));
  for (const line of examinationLines) assert.equal(referenceColumnOf(line), REFERENCE_COLUMN, line);
  assert.ok(examinationLines[0].endsWith(" 4-9"), examinationLines[0]);
  assert.ok(examinationLines[1].endsWith(" 10-210"), examinationLines[1]);
});

test("a name too long for one line wraps, and nothing overflows the page", async () => {
  // Measured rather than assumed, and it is not what I expected: the page renderer wraps the entry
  // instead of overflowing it. The name survives whole across two lines and the reference stays
  // with its tail:
  //
  //     Recross-Examination by Ms. Alexandra
  //     Whitfield-Pemberton-Rutherford. 171-210
  //
  // So there is nothing for the overflow guard to refuse. The consequence worth stating is that a
  // wrapped entry's reference is no longer in the shared column -- it cannot be, and truncating a
  // name on a certified index to keep a column would be the worse trade.
  const { lines, pages } = await indexPageLines([
    entry("Recross-Examination", "Ms. Alexandra Whitfield-Pemberton-Rutherford", 171, 210),
  ]);
  assert.deepEqual(horizontalOverflowFindings(pages, { charactersPerLine:WIDTH }), [],
    "the renderer wrapped rather than overflowing, so the guard has nothing to refuse");
  for (const line of lines) assert.ok(line.length <= WIDTH, `${line.length} characters: ${line}`);
  const joined = lines.join(" ");
  assert.ok(joined.includes("Recross-Examination by Ms. Alexandra"), joined);
  assert.ok(joined.includes("Whitfield-Pemberton-Rutherford"), "the name is never shortened");
  assert.ok(joined.includes("171-210"), "and the reference survives the wrap");
});

test("an index with one untyped examination is unchanged", async () => {
  const { lines } = await indexPageLines([{ examiner:"Mr. Nunez", startPage:5, endPage:75 }]);
  const line = lines.find(item => item.includes(" by "));
  assert.ok(line.startsWith("  Examination by Mr. Nunez"), line);
  assert.equal(referenceColumnOf(line), REFERENCE_COLUMN, line);
});
