// The boundary this suite could not previously reach: extraction -> reporter review ->
// createDeposition -> the two files that land on disk.
//
// Everything about the master deposition data record was unit-tested and none of it was reached.
// `canonicalInputFromMaster` derived provenance honestly and then lost, because createDeposition
// spreads `canonicalSeed` after it and the page was still computing a second, competing list there.
// A test that calls the projection directly cannot see that. Only one that reads the persisted
// files can, so that is what these do.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeposition } from "../server/deposition-store.mjs";
import { masterDataFromExtraction } from "../server/master-deposition-data.mjs";
import { reviewedMasterData, triState } from "../app/master-data-review.mjs";
import { manualIntakeAnalysis } from "../app/manual-intake.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";

// What the extractor read out of a Notice: a court, a county, a cause number, and a remote
// deposition. `confidence` and `sourceDocument` are what make these cells evidentiary.
const EXTRACTION = {
  setup:{ caseStyle:"Baier v. DTK Facility Services, LLC", causeNumber:"2025CI06118", witness:"Jennifer Baier",
    depositionDate:"May 4, 2026", deponentType:"Fact witness", parties:["Jennifer Baier"],
    attorneys:[{ name:"Ruben J. Olvera", firm:"Farmer, House, Osuna & Olvera", represents:["Defendant"] }], confidence:"high" },
  caption:{ court:"407th Judicial District Court", county:"Bexar" },
  logistics:{ remote:true, remote_platform:"Zoom", start_time:"09:30", videotaped:true },
};

const extracted = () => masterDataFromExtraction(EXTRACTION, { sourceDocument:"Jennifer_Baier_NOD.pdf" });

/** The form as the setup screen submits it: every control present, seeded with the extraction. */
function submitted(overrides = {}) {
  const master = extracted();
  const data = new FormData();
  const fields = {
    caseStyle:master.case.caseStyle.value, causeNumber:master.case.causeNumber.value,
    witness:master.deposition.witness.value, deponentType:master.deposition.representativeCapacity.value,
    depositionDate:"2026-05-04",
    canonicalCourt:master.case.court.value, canonicalDistrict:"", canonicalDivision:"", canonicalCounty:master.case.county.value,
    canonicalScheduledStart:"09:30", canonicalTimeZone:"", canonicalLocation:"", canonicalRemotePlatform:"Zoom",
    canonicalRemote:"true", canonicalVideotaped:"true", canonicalInterpreted:"", canonicalCorporateRepresentative:"",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value ?? ""));
  return { data, masterData:reviewedMasterData(master, data) };
}

/** Creates the deposition the way page.tsx posts it, and hands back both persisted files. */
function persist(t, { masterData, data }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-boundary-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const storageRoot = path.join(root, "depos");
  const record = createDeposition(root, {
    deposition:{
      id:"DEP-20260504-BND01", caseStyle:String(data.get("caseStyle")), witness:String(data.get("witness")),
      causeNumber:String(data.get("causeNumber")), depositionDate:String(data.get("depositionDate")),
      deponentType:String(data.get("deponentType")), courtReporterId:"RPT-1", courtReporterName:"Miah Bardot",
      masterData,
      canonicalSeed:{
        court:String(data.get("canonicalCourt") || ""), district:String(data.get("canonicalDistrict") || ""),
        division:String(data.get("canonicalDivision") || ""), county:String(data.get("canonicalCounty") || ""),
        scheduledStart:String(data.get("canonicalScheduledStart") || ""), timeZone:String(data.get("canonicalTimeZone") || ""),
        location:String(data.get("canonicalLocation") || ""), remotePlatform:String(data.get("canonicalRemotePlatform") || ""),
        remote:triState(data, "canonicalRemote"), videotaped:triState(data, "canonicalVideotaped"),
        interpreted:triState(data, "canonicalInterpreted"), corporateRepresentative:triState(data, "canonicalCorporateRepresentative"),
      },
    },
    artifacts:{ notice:{ name:"Jennifer_Baier_NOD.pdf", base64:Buffer.from("notice").toString("base64") } },
  }, { storageRoot });
  const directory = path.join(storageRoot, ...record.storagePath.split("/"));
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, "intake", name), "utf8"));
  return { canonical:read("canonical-deposition-record.json"), intake:read("intake.json") };
}

test("the persisted record claims the Notice only for cells the reporter left as the Notice wrote them", t => {
  // The reporter corrects the cause number -- the extraction misread the last digit -- and leaves
  // the court alone.
  const { canonical, intake } = persist(t, submitted({ causeNumber:"2025CI06119" }));

  assert.equal(canonical.case.court.value, "407th Judicial District Court");
  assert.equal(canonical.case.court.source, "NOD_EXTRACTED",
    "an untouched extracted value is what the document said, and the record should say so");

  assert.equal(canonical.case.causeNumber.value, "2025CI06119");
  assert.equal(canonical.case.causeNumber.source, "REPORTER_ENTERED",
    "the reporter replaced this value; attributing it to the Notice states that a document said something it did not");

  // The master record is the only list. If canonicalSeed regains an extractedFields of its own it
  // wins the spread in createDeposition, and this pair inverts.
  assert.equal(intake.masterData.case.causeNumber.status, "CONFIRMED");
  assert.equal(intake.masterData.case.causeNumber.sourceType, "REPORTER");
  assert.equal(intake.masterData.case.court.status, "EXTRACTED");
  assert.equal(intake.masterData.case.court.sourceDocument, "Jennifer_Baier_NOD.pdf",
    "an untouched cell keeps the citation back to the document, which is what makes it evidence");
});

test("clearing a tri-state to Not stated leaves both files saying the question is unanswered", t => {
  // The Notice noticed a remote deposition. The reporter does not yet know how it will be taken and
  // selects "Not stated". Neither file may go on asserting that it is remote.
  const { canonical, intake } = persist(t, submitted({ canonicalRemote:"" }));

  assert.equal(canonical.deposition.remote.state, "MISSING");
  assert.equal(canonical.deposition.remote.value, null);
  assert.equal(intake.masterData.deposition.remote.status, "MISSING");
  assert.equal(intake.masterData.deposition.remote.value, null,
    "the master record kept the Notice's answer while the canonical record recorded none: one deposition, one fact, two files, two answers");
  assert.equal(intake.masterData.deposition.remote.sourceType, null,
    "nothing may be named as the source of an answer that was withdrawn");

  // A tri-state answered "No" is an answer, and must survive as one.
  const no = persist(t, submitted({ canonicalRemote:"false" }));
  assert.equal(no.canonical.deposition.remote.value, false);
  assert.equal(no.canonical.deposition.remote.state, "EXTRACTED");
  assert.equal(no.intake.masterData.deposition.remote.value, false);
  assert.equal(no.intake.masterData.deposition.remote.status, "CONFIRMED");
});

test("interpreted and corporate representative can be answered and reach the persisted record", t => {
  // Both controls were hidden inputs that could not be filled in; nothing the reporter did could
  // record either fact.
  const { canonical, intake } = persist(t, submitted({ canonicalInterpreted:"true", canonicalCorporateRepresentative:"false" }));
  assert.equal(canonical.deposition.interpreted.value, true);
  assert.equal(canonical.deposition.corporateRepresentative.value, false);
  assert.equal(intake.masterData.deposition.interpreted.status, "CONFIRMED");
  assert.equal(intake.masterData.deposition.corporateRepresentative.value, false);
});

test("a manually entered deposition claims nothing from a Notice, even with one on file", t => {
  // manualIntakeAnalysis builds every cell CONFIRMED/REPORTER, so canonicalInputFromMaster finds no
  // EXTRACTED cell and no key may name the document. The notice artifact below is deliberate: the
  // guard has to hold when a Notice exists, not only when its absence makes the point for it.
  const analysis = manualIntakeAnalysis({
    caseStyle:"Rivera v. Northgate", causeNumber:"2026-CV-9", witness:"Jordan Rivera",
    depositionDate:"2026-09-01", deponentType:"Fact witness",
    parties:[{ name:"Jordan Rivera", role:"Plaintiff" }], attorneys:[{ name:"Pablo E. Rivera", firm:"RHC" }],
  });
  const data = new FormData();
  for (const [key, value] of Object.entries({ caseStyle:"Rivera v. Northgate", causeNumber:"2026-CV-9",
    witness:"Jordan Rivera", deponentType:"Fact witness", depositionDate:"2026-09-01" })) data.set(key, value);

  const { canonical, intake } = persist(t, { data, masterData:reviewedMasterData(analysis.masterData, data) });
  const sources = [canonical.case.caseStyle, canonical.case.causeNumber, canonical.deposition.witness,
    ...canonical.parties.map(party => party.name), ...canonical.counsel.map(counsel => counsel.fullName)];
  for (const cell of sources) assert.notEqual(cell.source, "NOD_EXTRACTED");

  // And it invents nothing on the reporter's behalf: jurisdiction and proceeding type were seeded
  // "Texas" and "ORAL_DEPOSITION" and confirmed as though a person had entered them.
  assert.equal(intake.masterData.case.jurisdiction.status, "MISSING");
  assert.equal(intake.masterData.case.jurisdiction.sourceType, null);
  assert.equal(intake.masterData.deposition.proceedingType.status, "MISSING");
  assert.equal(intake.masterData.counsel[0].represents.status, "MISSING",
    "an empty represents array read as truthy and was confirmed as a fact about who counsel appeared for");
});

// ---- The side counsel appears for, all the way to the printed appearance page ----------------
//
// `side` is the one counsel field a Notice never states, so nothing extracts it and the master
// record has to carry the reporter's own answer instead. It did not: masterDataFromExtraction built
// no cell for it, canonicalInputFromMaster had none to pass on, and buildTexasInsertionPageSet threw
// APPEARANCE_SIDE_MISSING. Every deposition created through the master path was unable to print an
// appearance page at all, which is the first thing standing between this record and UFM output.

/** The reporter answering the side on each counsel row, as the counsel editor records it. */
const answerSides = (masterData, sides) => ({ ...masterData,
  counsel:masterData.counsel.map((row, index) => sides[index] === undefined ? row
    : { ...row, side:{ value:sides[index], status:"CONFIRMED", sourceType:"REPORTER", sourceDocument:null, citation:null, confidence:null } }) });

async function appearancePage(canonical) {
  const input = assembleInsertionInput({
    record:canonical, template:await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED"),
    operator:{ jurisdiction:"texas-state", signatureDisposition:"waived", signatureDispositionBasis:"On the record",
      reporter:{ name:"Miah Bardot", licenseNumber:"1234", company:"SA Legal Solutions", firmRegistrationNumber:"5678", address:"San Antonio, Texas", phone:"210-555-0100" },
      courtHeadingLine:"IN THE DISTRICT COURT OF", countyCourtLine:"BEXAR COUNTY, TEXAS", judicialDistrictLine:"407TH JUDICIAL DISTRICT",
      proceedingHeading:"ORAL AND VIDEOTAPED DEPOSITION OF", witnessLocation:{ physicalAddress:"Via Zoom" },
      titleNarrative:["JENNIFER BAIER, produced as a witness and duly sworn,"] },
    pagination:{ index:{ appearances:{ startPage:2 }, examinations:[{ examiner:"Ruben J. Olvera", startPage:5, endPage:88 }],
      reportersCertification:{ startPage:89 }, entries:[], actualSectionPages:{}, declaredSectionPages:{} } },
  });
  const set = buildTexasInsertionPageSet(input, { setId:"sides", depositionId:"DEP-20260504-BND01", generatedAt:"2026-08-29T00:00:00.000Z" });
  return set.pages.find(page => page.role === "appearances");
}

test("the side the reporter answered survives to the printed appearance page", async t => {
  const { data, masterData } = submitted();
  const { canonical, intake } = persist(t, { data, masterData:answerSides(masterData, ["DEFENDANT"]) });

  assert.equal(intake.masterData.counsel[0].side.value, "DEFENDANT");
  assert.equal(intake.masterData.counsel[0].side.sourceType, "REPORTER",
    "no Notice states which side counsel appears for, so none may be cited for it");
  assert.equal(canonical.counsel[0].side.value, "DEFENDANT",
    "the master record dropped this field entirely, so the canonical record never received it");
  assert.equal(canonical.counsel[0].side.source, "REPORTER_ENTERED");

  const page = await appearancePage(canonical);
  assert.ok(page.lines.some(line => line.text.includes("FOR THE DEFENDANT")),
    "the appearance page prints the side, which is the whole reason the record carries it");
  assert.ok(page.lines.some(line => line.text.includes("Ruben J. Olvera")));
});

test("counsel whose side nobody answered stops the page rather than guessing one", async t => {
  const { data, masterData } = submitted();
  const { canonical } = persist(t, { data, masterData });
  assert.equal(canonical.counsel[0].side.state, "MISSING", "the Notice did not state it and nobody has been asked yet");
  await assert.rejects(() => appearancePage(canonical), /APPEARANCE_SIDE_MISSING/,
    "a side nobody recorded must refuse, not print a guess after FOR");
});

test("a manually entered side reaches the appearance page from the form the reporter typed it on", async t => {
  // The path the answer actually travels. The test above sets the cell directly, so it covers the
  // projection but not the record building it -- deleting the cell from masterDataFromExtraction and
  // from manualIntakeAnalysis left that test green.
  const analysis = manualIntakeAnalysis({
    caseStyle:"Baier v. DTK Facility Services, LLC", causeNumber:"2025CI06119", witness:"Jennifer Baier",
    depositionDate:"2026-05-04", deponentType:"Fact witness",
    attorneys:[{ name:"Ruben J. Olvera", firm:"Farmer, House, Osuna & Olvera", represents:"DTK Facility Services, LLC", side:"DEFENDANT" }],
  });
  assert.equal(analysis.masterData.counsel[0].side.value, "DEFENDANT",
    "the manual form collects the side; the master record has to carry it");

  const data = new FormData();
  for (const [key, value] of Object.entries({ caseStyle:"Baier v. DTK Facility Services, LLC", causeNumber:"2025CI06119",
    witness:"Jennifer Baier", deponentType:"Fact witness", depositionDate:"2026-05-04" })) data.set(key, value);
  const { canonical } = persist(t, { data, masterData:reviewedMasterData(analysis.masterData, data) });

  const page = await appearancePage(canonical);
  assert.ok(page.lines.some(line => line.text.includes("FOR THE DEFENDANT")));
});

test("an extraction supplies no side, because no Notice states one", () => {
  // The cell exists and is empty rather than absent: a missing cell and an unanswered question read
  // the same downstream, and only one of them can be answered later.
  const counsel = extracted().counsel[0];
  assert.equal(counsel.side.status, "MISSING");
  assert.equal(counsel.side.sourceType, null, "no document may be cited for a field no document states");
});
