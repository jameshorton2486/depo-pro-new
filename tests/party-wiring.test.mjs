import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { writeDepositionCounsel, writeDepositionParties } from "../server/deposition-store.mjs";
import { getSpeakerCandidates, reconcileSpeakerMap } from "../server/transcription-jobs.mjs";

const DEPOSITION = "DEP-20260814-ABCDE";

function depositionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-party-"));
  const storageRoot = path.join(root, "depos");
  const directory = path.join(storageRoot, "reporter", "cause", "deposition");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: DEPOSITION }));
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"),
    JSON.stringify(createCanonicalDepositionRecord({ witness: "Heath Thomas", attorneys: [], parties: [] })));
  writeDepositionCounsel(null, { depositionId: DEPOSITION, storageRoot, counsel: [
    { name: "Steven A. Nunez", appearanceRole: "QUESTIONING_ATTORNEY", actualAppearance: true },
    { name: "Lucia D. Zhan", appearanceRole: "DEFENDING_ATTORNEY", actualAppearance: true },
    { name: "Karen M. Alvarado", actualAppearance: false },
  ] });
  return { root, storageRoot, directory };
}

const written = value => JSON.parse(fs.readFileSync(path.join(value.directory, "intake", "canonical-deposition-record.json"), "utf8"));

const THOMAS_PARTIES = [
  { name: "Delia Garza", role: "PLAINTIFF", entityType: "PERSON" },
  { name: "Home Depot U.S.A., Inc.", role: "DEFENDANT", entityType: "ORGANIZATION",
    aliases: [{ qualifier: "a/k/a", name: "The Home Depot" }],
    captionDisplayName: "Home Depot U.S.A., Inc. a/k/a The Home Depot" },
  { name: "Shawn Herber", role: "DEFENDANT", entityType: "PERSON" },
];

test("a party is never a speaker candidate",()=>{
  // The rule this file exists for. A party is a fact about the lawsuit; a speaker candidate is a
  // fact about who was in the room. If party status implied eligibility, a speaker map could
  // attribute testimony to someone who was never deposed -- or to a corporation, which cannot
  // speak at all. Asserted as a before-and-after because "the list looks right" is not the claim;
  // the claim is that writing parties changed nothing about it.
  const value = depositionFixture();
  try {
    const before = getSpeakerCandidates(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot }).candidates;
    writeDepositionParties(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, parties: THOMAS_PARTIES });
    const after = getSpeakerCandidates(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot }).candidates;

    assert.deepEqual(after, before, "writing parties must not change the speaker candidates at all");
    const labels = new Set(after.map(candidate => candidate.label));
    for (const party of THOMAS_PARTIES) assert.equal(labels.has(party.name), false, `${party.name} is a party, not a speaker`);
    assert.equal(labels.has("Karen M. Alvarado"), false, "and counsel who did not appear stay excluded");
    assert.deepEqual([...labels], ["Heath Thomas", "Court Reporter", "Steven A. Nunez", "Lucia D. Zhan"]);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a party identity is refused by speaker reconciliation",()=>{
  // Defence in depth: even if an interface offered a party as a speaker, the write path refuses it.
  // reconcileSpeakerMap accepts only identities the canonical record contains as participants.
  const value = depositionFixture();
  try {
    writeDepositionParties(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, parties: THOMAS_PARTIES });
    const allowed = new Set(getSpeakerCandidates(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot }).candidates.map(candidate => candidate.id));
    const working = { segments: [{ id: "job:segment:1", sourceJobIdentity: "job", deepgramSpeaker: 0, asrWordIds: ["job:word:1"] }], speakerMap: { assignments: [] } };
    assert.throws(
      () => reconcileSpeakerMap(working, [{ sourceJobIdentity: "job", deepgramSpeaker: 0, speakerIdentity: "party-1", transcriptRole: "WITNESS" }], { allowedSpeakerIdentities: allowed }),
      /not present in the Canonical Deposition Data Record/,
    );
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("writing parties touches parties and nothing else",()=>{
  // Narrowness is the safety property, the same one writeDepositionCounsel holds: a party entry
  // cannot orphan a word id or invalidate a transcript hash, and must not be able to reach
  // anything that could.
  const value = depositionFixture();
  try {
    const before = written(value);
    writeDepositionParties(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, parties: THOMAS_PARTIES });
    const after = written(value);
    for (const key of Object.keys(before)) {
      if (key === "parties") continue;
      assert.deepEqual(after[key], before[key], `${key} must be untouched by a party write`);
    }
    assert.deepEqual(after.counsel.map(entry => entry.fullName.value), ["Steven A. Nunez", "Lucia D. Zhan", "Karen M. Alvarado"]);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("party provenance records who supplied the name, and what was derived",()=>{
  const value = depositionFixture();
  try {
    writeDepositionParties(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, parties: [
      { ...THOMAS_PARTIES[0], citations: ["case.caseStyle", "transcript segment:45"] },
    ] });
    const [party] = written(value).parties;
    assert.equal(party.name.source, "REPORTER_ENTERED");
    assert.equal(party.name.state, "REPORTER_ADDED");
    assert.deepEqual(party.name.citations, ["case.caseStyle", "transcript segment:45"]);
    // normalizedName is computed from the name by a rule, so it is never attributed to a person.
    assert.equal(party.normalizedName.source, "SYSTEM_GENERATED");
    assert.equal(party.normalizedName.state, "DERIVED");
    assert.equal(party.normalizedName.value, "delia garza");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("an unsupported role or entity type is refused rather than coerced",()=>{
  const value = depositionFixture();
  try {
    const write = parties => () => writeDepositionParties(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, parties });
    assert.throws(write([{ name: "Delia Garza", role: "COMPLAINANT" }]), /Unsupported party role/);
    assert.throws(write([{ name: "Home Depot", entityType: "COMPANY" }]), /Unsupported party entity type/);
    assert.throws(write([{ name: "  " }]), /requires a name/);
    assert.throws(write([{ id: "party-1", name: "A" }, { id: "party-1", name: "B" }]), /appears more than once/);
    assert.deepEqual(written(value).parties, [], "a refused write leaves the record alone");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("the caption keeps the a/k/a rather than flattening it",()=>{
  // "a/k/a" and "d/b/a" are legal claims of different kinds; a caption that collapses them
  // misstates the style of the case.
  const value = depositionFixture();
  try {
    writeDepositionParties(null, { depositionId: DEPOSITION, storageRoot: value.storageRoot, parties: THOMAS_PARTIES });
    const parties = written(value).parties;
    const read = field => field && typeof field === "object" && "value" in field ? field.value : field;
    const defendants = parties.filter(party => /defendant/i.test(read(party.role))).map(party => read(party.captionDisplayName) || read(party.name));
    assert.deepEqual(defendants, ["Home Depot U.S.A., Inc. a/k/a The Home Depot", "Shawn Herber"]);
    const [alias] = parties[1].aliases;
    assert.equal(alias.qualifier.value, "a/k/a");
    assert.equal(alias.name.value, "The Home Depot");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
