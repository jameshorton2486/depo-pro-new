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

test("the entry records the path it came through, and names nobody", async () => {
  // This route used to build "Riley Reporter, Texas CSR 1234" by reading the deposition's own
  // reporter. That was safer than trusting the client -- and still wrong, because reading a name off
  // a record does not establish that the person it names is the one who acted. It is how a real
  // correction to Production Trial #1 came to be signed by a reporter who never made it.
  const s = seed();
  await post({ depositionId: s.depositionId, sworn: true, why: "I administered the oath on the record.", who: "Somebody Else" });
  const [entry] = readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE });
  assert.equal(entry.origin, "OPENING");
  assert.equal("who" in entry, false, "no author, forged or resolved");
  assert.equal(JSON.stringify(entry).includes("Somebody Else"), false, "a client-supplied attestor reaches nothing");
  assert.equal(JSON.stringify(entry).includes("Riley Reporter"), false, "and neither does the one on the record");
  assert.ok(entry.why.trim() && !Number.isNaN(Date.parse(entry.at)), "why and at are recorded");
});

test("origin is fixed by the route, not accepted from the request", async () => {
  // The whole point of replacing `who` is that provenance is established where the code runs. A
  // client-settable origin would be the same forgery in a new field, so the route names its own.
  const s = seed();
  await post({ depositionId: s.depositionId, sworn: true, why: "I administered the oath on the record.", origin: "AUTOMATION" });
  const [entry] = readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE });
  assert.equal(entry.origin, "OPENING", "the request's origin is not consulted");
  assert.equal(JSON.stringify(entry).includes("AUTOMATION"), false);

  // The behavioural check above cannot see a route that forwards an origin the call site ignores.
  // That is inert today and one edit away from forgery, so the wiring is asserted directly -- the
  // same instrument this repo already uses for the honorific route's `who`.
  const api = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  assert.equal(/attestWitnessSworn\([^)]*origin:/.test(api), false, "the route hands the store no origin to honour");
});

test("an attestation with no reason is refused, and nothing is written", async () => {
  const s = seed();
  const response = await post({ depositionId: s.depositionId, sworn: true, why: "   " });
  assert.equal(response.status >= 400, true, "the request fails");
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE }).length, 0, "and the log is untouched");
});

test("a deposition with no reporter on its record can still attest", async () => {
  // This used to be refused, with "nobody to attribute an oath attestation to". The refusal existed
  // only to source the attestor name, and it made an unrelated setup step block a fact about the
  // WITNESS: whether they were sworn is true or false regardless of whose profile is filled in.
  //
  // NOTHING IS LOOSENED WHERE A MISSING REPORTER ACTUALLY MATTERS. That requirement belongs to
  // certification and is owned there per field, measured against a full Texas state template:
  //
  //   no reporter profile   -> 6 blocking, incl. UNEXPECTED_BLANK reporter.name, reporter.csrNumber
  //                            and CERT_FIRM_REGISTRATION_UNRESOLVED
  //   name removed alone    -> UNEXPECTED_BLANK fieldValues.reporter.name
  //   CSR number alone      -> UNEXPECTED_BLANK fieldValues.reporter.csrNumber
  //   full profile          -> no reporter finding
  //
  // Each field isolates: removing exactly one adds exactly one blocking finding. So the guard is
  // real, it is granular, and it is not this route's. Re-adding a reporter precondition here would
  // duplicate it in the one layer that has no business asserting it -- an append to a log.
  const s = seed({ reporter: false });
  const response = await post({ depositionId: s.depositionId, sworn: true, why: "I administered the oath." });
  assert.equal(response.status, 200);
  const [entry] = readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE });
  assert.equal(entry.origin, "OPENING");
  assert.equal(entry.to, true);
});
