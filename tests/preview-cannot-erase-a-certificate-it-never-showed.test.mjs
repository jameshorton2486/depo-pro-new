// Preview erased certification values that were already on the record.
//
// InsertionPagesScreen initialised its certificate state to EMPTY_CERTIFICATE and never read what
// was stored. runPreview posts that whole object to /api/deposition/certification, and
// writeDepositionCertification rewrites every field it owns -- so a blank field in the form became
// MISSING on the record. The screen always looked blank, which made "click Preview" the ordinary
// thing to do and silent data loss the result, on certified content, reachable by a reporter doing
// exactly what the screen invited.
//
// The route is not the defect and is deliberately unchanged. A merge-only save would mean a value
// entered by mistake could never be cleared, which turns a display bug into a permanent one. The
// obligation is on the caller: show what you are about to overwrite. That contract is pinned here
// so the next screen to call this route inherits it written down rather than assumed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readDepositionCertification, writeDepositionCertification } from "../server/deposition-store.mjs";

const ID = "DEP-20260828-CERT1";
const STORED = {
  custodialAttorney: "Rufus Q. Pemberton-Stack",
  officerCharges: "$1,240.00",
  chargesResponsibleParty: "Brazos Ridge Defense Group",
  certificationDate: "2026-08-28",
};

function throwawayDeposition() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-cert-"));
  const directory = path.join(root, "store", "reporter_x", "cause", "witness_2026-08-28");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ schemaVersion: "1.0.0", id: ID }));
  const missing = () => ({ value: null, source: "REPORTER_ENTERED", state: "MISSING", confidence: null, citations: [] });
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify({
    schemaVersion: "1.0.0", certification: {}, signature: { returnedDate: missing() },
  }));
  return { root, storageRoot: path.join(root, "store") };
}

test("a stored certificate reads back as the strings the form has to show", () => {
  const { root, storageRoot } = throwawayDeposition();
  writeDepositionCertification(root, { depositionId: ID, storageRoot, certification: STORED });
  const { certification } = readDepositionCertification(root, { depositionId: ID, storageRoot });
  for (const [key, expected] of Object.entries(STORED)) assert.equal(certification[key], expected, `${key} must come back for the form to show`);
  // MISSING reads as "", which is what an empty control holds -- and "" written back becomes
  // MISSING again, so an untouched form round-trips to the record it started from.
  assert.equal(certification.furtherCertificationDate, "");
});

test("saving a form that was loaded first does not blank a stored value", () => {
  const { root, storageRoot } = throwawayDeposition();
  writeDepositionCertification(root, { depositionId: ID, storageRoot, certification: STORED });
  // Exactly what the screen now does: read, then post back what it holds without the reporter
  // touching anything. Before the read existed this posted EMPTY_CERTIFICATE and erased all four.
  const loaded = readDepositionCertification(root, { depositionId: ID, storageRoot }).certification;
  writeDepositionCertification(root, { depositionId: ID, storageRoot, certification: loaded });
  const after = readDepositionCertification(root, { depositionId: ID, storageRoot }).certification;
  for (const [key, expected] of Object.entries(STORED)) assert.equal(after[key], expected, `${key} was erased by a save that never showed it`);
});

test("the route still clears a value the reporter deliberately empties", () => {
  const { root, storageRoot } = throwawayDeposition();
  writeDepositionCertification(root, { depositionId: ID, storageRoot, certification: STORED });
  writeDepositionCertification(root, { depositionId: ID, storageRoot, certification: { ...STORED, officerCharges: "" } });
  const after = readDepositionCertification(root, { depositionId: ID, storageRoot }).certification;
  // The reason the route is not the thing being fixed: a merge-only save could never do this.
  assert.equal(after.officerCharges, "");
  assert.equal(after.custodialAttorney, STORED.custodialAttorney, "clearing one field must not disturb the others");
});

test("the certification screen loads the stored certificate before it can overwrite it", () => {
  const source = fs.readFileSync(new URL("../app/InsertionPagesScreen.tsx", import.meta.url), "utf8");
  assert.match(source, /api\/deposition\/certification\?depositionId=/, "the screen must read what it is about to overwrite");
  assert.match(source, /setCertificate\(\(current\)\s*=>\s*\(\{\s*\.\.\.current,\s*\.\.\.body\.certification,/);
});
