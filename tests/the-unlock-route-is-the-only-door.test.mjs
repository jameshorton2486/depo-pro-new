// The guard proved in a-protected-record-refuses-an-unattended-write is a function call. This is the
// same guard reached the way an automated qualification actually reaches it: over HTTP, through the
// real routes, against a record on disk. Two true facts on the near side of a boundary prove nothing
// about the far side.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { readDepositionCorrections } from "../server/deposition-store.mjs";
import { PROTECTION_FILE, protectDeposition } from "../server/protected-records.mjs";

const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), "depo-protected-api-"));
process.env.DEPO_PRO_DEPOSITIONS_ROOT = STORAGE;
process.env.PORT = process.env.PORT ?? "3000";

const { server } = await import("../server/local-api.mjs");
const ORIGIN = "http://localhost:3000";

let counter = 0;
function seed() {
  const depositionId = `DEP-20260903-PR${String(++counter).padStart(3, "0")}`;
  const folder = path.join(STORAGE, "reporter", "cause", `witness-${counter}`);
  fs.mkdirSync(path.join(folder, "intake"), { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: depositionId }));
  fs.writeFileSync(path.join(folder, "intake", "canonical-deposition-record.json"), JSON.stringify(
    createCanonicalDepositionRecord({
      court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
      witness: "Jordan Example", depositionDate: "2026-08-01",
      parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }],
      attorneys: [{ name: "Pat Counsel", firm: "Firm", represents: ["Alex Plaintiff"], side: "PLAINTIFF" }],
      reporterProfile: { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31" },
    }), null, 2));
  return { depositionId, folder };
}

const listening = new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
test.before(() => listening);
test.after(() => new Promise((resolve) => server.close(resolve)));

const base = () => `http://127.0.0.1:${server.address().port}`;
const post = (route, body) => fetch(`${base()}${route}`, {
  method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body),
});
const attest = (depositionId, extra = {}) => post("/api/opening/oath-attestation", { depositionId, sworn: true, why: "I administered the oath on the record.", ...extra });
const opening = async (depositionId) => (await fetch(`${base()}/api/opening?depositionId=${encodeURIComponent(depositionId)}`, { headers: { origin: ORIGIN } })).json();

test("a write to a protected record is refused over HTTP, with a status that says why", async () => {
  const s = seed();
  protectDeposition(s.folder, { reason: "Production Trial #1 -- live evidentiary record." });

  const response = await attest(s.depositionId);
  assert.equal(response.status, 423, "Locked: the request is well-formed and refused for the target's state");
  const body = await response.json();
  assert.equal(body.code, "DEPOSITION_PROTECTED");
  assert.match(body.error, /deposition is protected/);
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE }).length, 0, "and nothing was written");
});

test("the screen is told, so the reporter is not left guessing why a save failed", async () => {
  const s = seed();
  assert.equal((await opening(s.depositionId)).protection, null, "absent while unprotected");
  protectDeposition(s.folder, { reason: "Production Trial #1 -- live evidentiary record." });

  const projection = await opening(s.depositionId);
  assert.equal(projection.protection.protected, true);
  assert.equal(projection.protection.unlocked, false);
  assert.match(projection.protection.reason, /Production Trial #1/, "the reason reaches the screen");
});

test("opening it through the route lets the reporter's own write through", async () => {
  const s = seed();
  protectDeposition(s.folder, { reason: "Production Trial #1 -- live evidentiary record." });
  assert.equal((await attest(s.depositionId)).status, 423);

  const unlocked = await post("/api/deposition/unlock-protected", { depositionId: s.depositionId, reason: "Entering the on-record start time." });
  assert.equal(unlocked.status, 200);

  assert.equal((await attest(s.depositionId)).status, 200, "the same request now succeeds");
  const [entry] = readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE });
  assert.match(entry.who, /operator identity not authenticated/i);
  assert.equal((await opening(s.depositionId)).protection.unlocked, true);
});

test("a caller cannot open the record by asserting that it is open", async () => {
  // The unlock is server-side state written by its own route. A request that could carry its own
  // unlock would be a request that could carry its own permission, which is the forgery this whole
  // checkpoint exists to remove -- in a new field.
  const s = seed();
  protectDeposition(s.folder, { reason: "Production Trial #1 -- live evidentiary record." });
  for (const forged of [{ unlocked: true }, { unlockedUntil: "2099-01-01T00:00:00.000Z" }, { protection: { unlocked: true } }]) {
    assert.equal((await attest(s.depositionId, forged)).status, 423, `a request carrying ${JSON.stringify(forged)} was honoured`);
  }
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE }).length, 0);
});

test("opening requires a reason, and the reason is kept", async () => {
  const s = seed();
  protectDeposition(s.folder, { reason: "Production Trial #1 -- live evidentiary record." });
  assert.equal((await post("/api/deposition/unlock-protected", { depositionId: s.depositionId, reason: "  " })).status >= 400, true);

  await post("/api/deposition/unlock-protected", { depositionId: s.depositionId, reason: "Entering the on-record start time." });
  const stored = JSON.parse(fs.readFileSync(path.join(s.folder, PROTECTION_FILE), "utf8"));
  assert.equal(stored.unlocks.length, 1);
  assert.match(stored.unlocks[0].reason, /on-record start time/);
  assert.equal(stored.unlocks[0].origin, "OPENING", "and records the path, not a person");
  assert.equal("who" in stored.unlocks[0], false);
});

test("an unprotected deposition is unaffected, which is most of them", async () => {
  const s = seed();
  assert.equal((await attest(s.depositionId)).status, 200);
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: STORAGE }).length, 1);
});
