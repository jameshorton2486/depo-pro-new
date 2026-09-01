// The caption names the parties, and until now nothing could tell Depo-Pro who they were.
//
// writeDepositionParties has existed and been tested since party wiring landed, and no route and no
// screen ever called it. Manual intake collects parties when a deposition is created, so a
// deposition made from an existing recording -- which is how both real depositions in this
// repository were made -- reached finalization with an empty parties list, an UNEXPECTED_BLANK on
// caption.plaintiffs and caption.defendants, and nowhere in the application to put a name.
//
// These tests cover the read side that makes an editor possible, and the round trip an editor
// performs. They do not cover the button: this repository has no client test harness, which is why
// the screen was driven in a browser before the checkpoint was accepted.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { readDepositionParties, writeDepositionParties } from "../server/deposition-store.mjs";

const ID = "DEP-20260901-PE001";

function store(parties = []) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-parties-editor-"));
  const directory = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  const record = createCanonicalDepositionRecord({
    court: "464TH JUDICIAL DISTRICT COURT, HIDALGO COUNTY, TEXAS", causeNumber: "C-5722-24-L",
    witness: "Jordan Example", depositionDate: "2026-04-24", parties,
  });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: ID }));
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify(record));
  return { storageRoot, directory };
}

const onDisk = ({ directory }) =>
  JSON.parse(fs.readFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), "utf8")).parties;
const valueOf = entry => entry && typeof entry === "object" && "value" in entry ? entry.value : entry;

test("a deposition with no parties can be given them", () => {
  const s = store();
  assert.deepEqual(readDepositionParties(null, { depositionId: ID, storageRoot: s.storageRoot }).parties, [],
    "the empty case is the one that mattered -- it is how both real depositions arrived");

  writeDepositionParties(null, {
    depositionId: ID, storageRoot: s.storageRoot,
    parties: [
      { name: "Rocio Laura Elizondo Vargas", role: "PLAINTIFF" },
      { name: "Leonardo Isaias Rodriguez", role: "DEFENDANT" },
    ],
  });

  const written = onDisk(s);
  assert.equal(written.length, 2);
  assert.deepEqual(written.map(entry => valueOf(entry.name)), ["Rocio Laura Elizondo Vargas", "Leonardo Isaias Rodriguez"]);
  assert.deepEqual(written.map(entry => valueOf(entry.role)), ["PLAINTIFF", "DEFENDANT"]);
  for (const entry of written) {
    assert.equal(entry.name.source, "REPORTER_ENTERED", "a party the reporter typed is the reporter's answer, never the Notice's");
  }
});

test("the read shape is what the write takes back", () => {
  // The contract that lets a screen amend one party and send the rest unchanged. If these drift, an
  // editor round trip empties whatever the read forgot -- the defect the Counsel Editor had.
  const s = store([{ name: "Rocio Laura Elizondo Vargas", role: "Plaintiff" }]);
  const { parties } = readDepositionParties(null, { depositionId: ID, storageRoot: s.storageRoot });
  writeDepositionParties(null, { depositionId: ID, storageRoot: s.storageRoot, parties });
  const after = onDisk(s);
  assert.equal(valueOf(after[0].name), "Rocio Laura Elizondo Vargas");
  assert.equal(valueOf(after[0].role), "PLAINTIFF");
  assert.equal(after[0].id, onDisk(s)[0].id);
});

test("ids survive the round trip, so nothing is renumbered by position", () => {
  const s = store([{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }]);
  const before = onDisk(s).map(entry => entry.id);
  const { parties } = readDepositionParties(null, { depositionId: ID, storageRoot: s.storageRoot });
  assert.deepEqual(parties.map(row => row.id), before, "the read must hand the ids out");
  // Remove the first party, exactly as the editor's Remove button does.
  writeDepositionParties(null, { depositionId: ID, storageRoot: s.storageRoot, parties: parties.slice(1) });
  const after = onDisk(s);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before[1], "the surviving party keeps its own id rather than inheriting party-1");
  assert.equal(valueOf(after[0].name), "Delta Company");
});

test("a role the caption cannot print is refused rather than coerced", () => {
  const s = store();
  assert.throws(() => writeDepositionParties(null, {
    depositionId: ID, storageRoot: s.storageRoot, parties: [{ name: "Alex Plaintiff", role: "Complainant" }],
  }), /Unsupported party role/);
  assert.throws(() => writeDepositionParties(null, {
    depositionId: ID, storageRoot: s.storageRoot, parties: [{ name: "   ", role: "PLAINTIFF" }],
  }), /requires a name/);
  assert.deepEqual(onDisk(s), [], "a refused write leaves the record alone");
});

test("the caption name is kept when the reporter gives one and not invented when they do not", () => {
  const s = store();
  writeDepositionParties(null, {
    depositionId: ID, storageRoot: s.storageRoot,
    parties: [
      { name: "Standing Seam & Specialty Company, Inc.", role: "DEFENDANT", captionDisplayName: "STANDING SEAM & SPECIALTY COMPANY, INC." },
      { name: "Sandy Dean Koepke", role: "DEFENDANT" },
    ],
  });
  const [styled, plain] = onDisk(s);
  assert.equal(valueOf(styled.captionDisplayName), "STANDING SEAM & SPECIALTY COMPANY, INC.");
  assert.equal(valueOf(plain.captionDisplayName), "Sandy Dean Koepke",
    "with nothing supplied the caption falls back to the name, which is a copy rather than a guess");

  // And it survives an edit that never mentioned it. This is the case the fallback hides: a caption
  // name that differs from the party name reverts to the party name on the next save if the read
  // shape forgets to hand it back, and every save after that looks successful.
  const { parties } = readDepositionParties(null, { depositionId: ID, storageRoot: s.storageRoot });
  writeDepositionParties(null, {
    depositionId: ID, storageRoot: s.storageRoot,
    parties: parties.map(row => ({ ...row, role: "DEFENDANT" })),
  });
  assert.equal(valueOf(onDisk(s)[0].captionDisplayName), "STANDING SEAM & SPECIALTY COMPANY, INC.",
    "the reporter's caption wording must not revert to the party name");
});
