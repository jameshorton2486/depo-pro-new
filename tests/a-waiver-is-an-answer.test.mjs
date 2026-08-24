import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { prepareInsertionRenderingArtifact } from "../server/insertion-pages/word-service.mjs";

// A waived field is a third state, and the certified rendering path now says so.
//
// Before this, isBlank collapsed "absent because waived" into "absent". validateCredentials
// already knew the difference -- it accepts reporter.firmRegistration as satisfying the
// certificate requirement -- but validateFields did not, so clearing the specific gate merely
// handed the same field to UNEXPECTED_BLANK. Recording a waiver left a reporter exactly as
// blocked as ignoring the requirement, and the configuration that rendered cleanly was firm name
// plus registration number: the one the reporter store forbids by whitelist.
//
// The reporter this application is for is a solo Texas CSR with no firm and a recorded waiver, so
// the certified rendering path did not complete for the only person who uses it.
//
// What is deliberately unchanged: the whitelist still drops firmRegistrationNumber, the reviewed
// templates are untouched, and a waiver puts nothing on the page. The specimens print no firm
// line for this reporter and neither does this.
let counter = 0;
const nextId = () => `DEP-20260824-WV${String(++counter).padStart(3, "0")}`;
const WAIVER = "Certifies under an individual Texas CSR; no firm registration applies.";

function scratch(t, { reporter = {}, court = "In the 285th Judicial District Court" } = {}) {
  const depositionId = nextId();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-waiver-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(folder, "intake"), { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: depositionId }));
  fs.writeFileSync(
    path.join(folder, "intake", "canonical-deposition-record.json"),
    JSON.stringify(
      createCanonicalDepositionRecord({
        court,
        causeNumber: "2024-CI-11223",
        caseStyle: "Mohammad Etminan, M.D. v. Baptist Health System",
        witness: "Mohammad Etminan, M.D.",
        depositionDate: "2026-04-24",
        location: "7234 Hovingham, San Antonio, Texas 78257",
        remote: true,
        remotePlatform: "Zoom",
        attorneys: [{ name: "Ann Counsel", firm: "Counsel LLP", represents: "Plaintiff", appeared: true, participation: { method: "remote-video" } }],
        reporterProfile: {
          name: "Miah Bardot", licenseNumber: "12129", csrState: "Texas", csrExpiration: "2027-06-30",
          address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603",
          ...reporter,
        },
      }),
      null,
      2,
    ),
  );
  return { depositionId, storageRoot, folder };
}

// pagination is supplied because the screen does not send it yet and the route blocks on index.*
// without it. That is a separate blocker on the same path and is not what this file is about.
const render = (s, operatorExtra = {}) =>
  prepareInsertionRenderingArtifact(
    null,
    s.depositionId,
    {
      mode: "standalone",
      operator: { jurisdiction: "texas-state", signatureDisposition: "requested", signatureDispositionBasis: "Requested on the record.", ...operatorExtra },
      pagination: {
        index: {
          entries: [], actualSectionPages: {}, declaredSectionPages: {},
          examinations: [{ label: "Examination by Ms. Counsel", startPage: 4 }],
          changesAndSignature: { startPage: 60 },
          reportersCertification: { startPage: 62 },
        },
      },
    },
    { storageRoot: s.storageRoot },
  );

const blockedBy = async (s, operatorExtra = {}) => {
  try {
    await render(s, operatorExtra);
    return [];
  } catch (error) {
    const match = /INSERTION_VALIDATION_BLOCKED: (.*)$/.exec(error.message);
    if (!match) throw error;
    return match[1].split(", ");
  }
};

test("a solo reporter with a recorded waiver can produce a certification page", async (t) => {
  // The workflow this unblocks, asserted through the route the screen calls rather than through
  // the validator alone. No firm, waiver recorded: the reporter this application exists for.
  const s = scratch(t, { reporter: { firmRegistrationWaiver: WAIVER } });
  const rendered = await render(s);
  assert.ok(rendered.pageSet, "the certification pages were produced");
  assert.deepEqual(rendered.findings.filter((finding) => finding.severity === "blocking"), [],
    "a reporter who has answered the firm requirement must not be blocked by it");
});

test("without a waiver the requirement is still unanswered and still blocks", async (t) => {
  // The control on the rule. If waived simply meant "never mind", this would pass too, and the
  // certificate requirement would have been deleted rather than answered.
  const s = scratch(t);
  const blockers = await blockedBy(s);
  assert.ok(blockers.some((code) => code.startsWith("CERT_FIRM_REGISTRATION_UNRESOLVED")),
    `an unanswered firm requirement must still block; got ${JSON.stringify(blockers)}`);
  assert.ok(blockers.some((code) => code === "UNEXPECTED_BLANK:reporter.firmName"),
    "and the firm name is still unanswered too");
});

test("an empty or blank waiver is not a waiver", async (t) => {
  // A waiver is the reason, not a flag. "Not applicable" with nothing to say why is a state a
  // certificate could not defend, and it must not unlock the render.
  for (const blank of ["", "   ", null]) {
    const s = scratch(t, { reporter: { firmRegistrationWaiver: blank } });
    const blockers = await blockedBy(s);
    assert.ok(blockers.length > 0, `${JSON.stringify(blank)} must not waive anything`);
  }
});

test("a waiver object with no reason does not waive, even built directly", async (t) => {
  // assemble builds firmRegistration through waiverFrom, which already refuses a blank reason by
  // returning null -- so the reason check inside waivedFields is unreachable by that path, and a
  // mutation deleting it passed every test above. operator.reporter.firmRegistration is the path
  // that reaches it: a caller can hand over the object directly, and { applicable:false } with
  // nothing to say why must not unlock a certificate.
  const s = scratch(t);
  const blockers = await blockedBy(s, { reporter: { firmRegistration: { applicable: false, reason: "   " } } });
  assert.ok(blockers.length > 0, "an unexplained waiver is not a waiver");
  // And the same object with a reason does waive, so the refusal tracks the reason and not the shape.
  const cleared = await blockedBy(s, { reporter: { firmRegistration: { applicable: false, reason: WAIVER } } });
  assert.deepEqual(cleared, [], "a stated reason is what makes it an answer");
});

test("a waiver puts nothing on the certified page", async (t) => {
  // The requirement is answered in the record, not on the document. Three certified specimens
  // carry no firm line for this reporter, and a waiver must not become the thing that adds one --
  // neither a label with nothing after it nor the reason itself.
  const s = scratch(t, { reporter: { firmRegistrationWaiver: WAIVER } });
  const blob = JSON.stringify((await render(s)).pageSet);
  assert.ok(!blob.includes("Firm Registration"), "the firm registration line is omitted, not blanked");
  assert.ok(!blob.includes(WAIVER), "the waiver reason is not printed on the certificate");
  assert.ok(!/\^[a-z][a-zA-Z0-9_.-]*\^/.test(blob), "and no template placeholder survives onto the page");
});

test("the waiver answers the firm fields and nothing else", async (t) => {
  // Scope. A recorded waiver must not become a general amnesty for blank fields, so an unrelated
  // blank still blocks with the waiver in place.
  const s = scratch(t, { reporter: { firmRegistrationWaiver: WAIVER }, court: "" });
  const blockers = await blockedBy(s);
  assert.deepEqual(blockers, ["UNEXPECTED_BLANK:caption.court"],
    "an unrelated blank must still block, and only it");
});
