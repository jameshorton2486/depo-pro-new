// The endpoint behind the Opening screen's attestation control, exercised as a real request.
//
// Eight tests in this suite check routes by reading local-api.mjs as text and asserting on source
// strings. local-api's own comment says why that is a poor instrument: it proves a literal is
// present, not that the route behaves. This one issues an HTTP request and reads the record off
// disk afterwards.
//
// The env has to be set before local-api is imported, because it resolves the storage root at
// module load. Hence the dynamic import below.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { readDepositionCorrections } from "../server/deposition-store.mjs";

const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), "depo-attest-api-"));
process.env.DEPO_PRO_DEPOSITIONS_ROOT = STORAGE;
process.env.PORT = process.env.PORT ?? "3000";

const { server } = await import("../server/local-api.mjs");
const ORIGIN = "http://localhost:3000";

let counter = 0;
function seed({ reporter = true } = {}) {
  const depositionId = `DEP-20260829-AE${String(++counter).padStart(3, "0")}`;
  const folder = path.join(STORAGE, "reporter", "cause", `witness-${counter}`);
  fs.mkdirSync(path.join(folder, "intake"), { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: depositionId }));
  fs.writeFileSync(path.join(folder, "intake", "canonical-deposition-record.json"), JSON.stringify(
    createCanonicalDepositionRecord({
      court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
      witness: "Jordan Example", depositionDate: "2026-08-01",
      parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }],
      attorneys: [{ name: "Pat Counsel", firm: "Firm", represents: ["Alex Plaintiff"], side: "PLAINTIFF" }],
      reporterProfile: reporter ? { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31" } : {},
    }), null, 2));
  return { depositionId, folder };
}

const listening = new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
test.before(() => listening);
test.after(() => new Promise((resolve) => server.close(resolve)));

const base = () => `http://127.0.0.1:${server.address().port}`;
const post = (body) => fetch(`${base()}/api/opening/oath-attestation`, {
  method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body),
});

test("the endpoint records the attestation and returns the refreshed projection", async () => {
  const s = seed();
  const response = await post({ depositionId: s.depositionId, sworn: false, why: "The witness declined to swear and affirmed on the record." });
  assert.equal(response.status, 200);
  const projection = await response.json();
  assert.equal(projection.canonical.deposition.witnessSworn.value, false, "the projection shows the attested fact");
  assert.equal(projection.canonical.deposition.witnessSworn.state, "REPORTER_ADDED");

  const record = JSON.parse(fs.readFileSync(path.join(s.folder, "intake", "canonical-deposition-record.json"), "utf8"));
  assert.equal(record.deposition.witnessSworn.value, false, "and disk agrees with the screen");
});

test("the server records the provable channel, not the assigned reporter or request", async () => {
  const s = seed();
  await post({ depositionId: s.depositionId, sworn: true, why: "I administered the oath on the record.", who: "Somebody Else" });
  const [entry] = readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE });
  assert.equal(entry.who, "DepoPro local opening screen (operator identity not authenticated)");
  assert.doesNotMatch(entry.who, /Somebody Else/, "a client-supplied attestor is ignored, because it would be forgeable");
  assert.doesNotMatch(entry.who, /Riley Reporter|CSR 1234/, "assignment is not proof of who performed the request");
  assert.ok(entry.why.trim() && !Number.isNaN(Date.parse(entry.at)), "why and at are recorded");
});

test("an attestation with no reason is refused, and nothing is written", async () => {
  const s = seed();
  const response = await post({ depositionId: s.depositionId, sworn: true, why: "   " });
  assert.equal(response.status >= 400, true, "the request fails");
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE }).length, 0, "and the log is untouched");
});

test("a deposition with no reporter on its record cannot attest", async () => {
  const s = seed({ reporter: false });
  const response = await post({ depositionId: s.depositionId, sworn: true, why: "I administered the oath." });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /no deposition officer/i, "and it says why, rather than failing silently");
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE }).length, 0);
});
