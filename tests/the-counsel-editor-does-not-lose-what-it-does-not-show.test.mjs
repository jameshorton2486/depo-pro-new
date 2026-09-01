// Amending one fact about an attorney must not delete the others.
//
// readDepositionCounsel exists so a screen editing one attorney can send the rest back unchanged.
// It returned nine fields; counsel entries carry fourteen. The five it omitted -- bar number,
// address, fax, phone, email -- are the ones the certified APPEARANCES page prints. So recording a
// side through the Counsel Editor, the only screen that offers it, silently emptied the address and
// phone of every attorney on the deposition, and the save reported success.
//
// This is measured against a real round trip rather than asserted from reading the code: read what
// the screen reads, send back exactly that, and compare the record with itself.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { readDepositionCounsel, writeDepositionCounsel } from "../server/deposition-store.mjs";

const ID = "DEP-20260901-CE001";
const ATTORNEY = Object.freeze({
  name: "Dana Counsel", honorific: "MS.", barNumber: "24079654", firm: "Defense Firm",
  address: "202 N. 10th Avenue, Edinburg, Texas 78541", phone: "956-381-6602", fax: "956-381-0725",
  email: "dana@defensefirm.example", represents: ["Delta Company"], appearanceRole: "DEFENDING_ATTORNEY",
});
// The five the read shape used to drop. Named here rather than derived, so widening the record
// without widening the read shape fails this test instead of quietly passing it.
const PRINTED_ON_THE_APPEARANCE_PAGE = ["barNumber", "address", "fax", "phone", "email"];

function store() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-counsel-editor-"));
  const directory = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  const record = createCanonicalDepositionRecord({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-1",
    witness: "Jordan Example", depositionDate: "2026-09-18", attorneys: [ATTORNEY],
  });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: ID }));
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify(record));
  return { storageRoot, directory };
}

const counselOnDisk = ({ directory }) =>
  JSON.parse(fs.readFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), "utf8")).counsel;
const valueOf = entry => entry && typeof entry === "object" && "value" in entry ? entry.value : entry;

test("recording a side keeps every fact the editor never showed", () => {
  const s = store();
  const before = counselOnDisk(s)[0];
  for (const key of PRINTED_ON_THE_APPEARANCE_PAGE) {
    assert.equal(valueOf(before[key]), ATTORNEY[key], `the fixture must actually carry ${key}`);
  }

  // Exactly what the Counsel Editor does: read, set one field, send the whole list back.
  const { counsel } = readDepositionCounsel(null, { depositionId: ID, storageRoot: s.storageRoot });
  writeDepositionCounsel(null, {
    depositionId: ID, storageRoot: s.storageRoot,
    counsel: counsel.map(row => ({ ...row, side: "DEFENDANT" })),
  });

  const after = counselOnDisk(s)[0];
  assert.equal(valueOf(after.side), "DEFENDANT", "the side the reporter chose must be recorded");
  for (const key of PRINTED_ON_THE_APPEARANCE_PAGE) {
    assert.equal(valueOf(after[key]), ATTORNEY[key], `${key} must survive an edit that never mentioned it`);
  }
  assert.equal(after.id, before.id, "and the id must not move, or every speaker mapping points at nothing");
});

test("the read shape offers every field the write can carry", () => {
  // The contract that keeps the two in step: anything a counsel entry holds and a screen may need
  // has to come back out, or the next round trip empties it.
  const s = store();
  const [row] = readDepositionCounsel(null, { depositionId: ID, storageRoot: s.storageRoot }).counsel;
  for (const key of PRINTED_ON_THE_APPEARANCE_PAGE) {
    assert.ok(key in row, `readDepositionCounsel must return ${key}`);
    assert.equal(row[key], ATTORNEY[key], key);
  }
});

test("a field the reporter clears reads as missing, not as a recorded blank", () => {
  // Clearing a field is a real action and must not read as a stated value. The state carries that:
  // MISSING, whatever the empty value looks like. That the value is "" rather than null is the
  // pre-existing behaviour of every string field on this endpoint -- honorific and firm have always
  // round-tripped that way -- and is left alone here rather than changed on the way past.
  const s = store();
  const { counsel } = readDepositionCounsel(null, { depositionId: ID, storageRoot: s.storageRoot });
  writeDepositionCounsel(null, {
    depositionId: ID, storageRoot: s.storageRoot,
    counsel: counsel.map(row => ({ ...row, barNumber: "", address: "" })),
  });
  const after = counselOnDisk(s)[0];
  for (const key of ["barNumber", "address"]) {
    assert.equal(after[key].state, "MISSING", `${key} cleared by the reporter must not read as recorded`);
    assert.ok(!valueOf(after[key]), `${key} must hold no usable value`);
  }
  // And clearing one field is still not licence to lose the others.
  assert.equal(valueOf(after.phone), ATTORNEY.phone);
  assert.equal(valueOf(after.email), ATTORNEY.email);
});
