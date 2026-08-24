import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveOpeningState } from "../server/opening-procedures.mjs";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { prepareInsertionRenderingArtifact } from "../server/insertion-pages/word-service.mjs";

// The reopening condition in ADR-0021, enforced.
//
// A field verification is a `path -> true` map with no who and no per-field at. That is honest
// only because the value never leaves workflow/opening-procedures.json -- the correction log and
// layout-profile.mjs both require provenance precisely because they do reach a certified output.
// The ADR wrote the condition down; nothing failed if a later change broke it.
//
// This is that guard, and it is behavioural on purpose. A grep of the source for "verifiedFields"
// would be built from the same rule it grades, and would pass while a verification travelled into
// a page through some value the grep did not know to look for. So a real verification goes in, a
// real certification page comes out, and the question asked of the output is whether it is in
// there anywhere.
//
// It cannot be settled from the module graph either: prepareInsertionRenderingArtifact resolves
// the deposition directory, so workflow/ is within its reach.
let counter = 0;
const nextId = () => `DEP-20260824-VG${String(++counter).padStart(3, "0")}`;
const SENTINEL = "VERIFICATION.SENTINEL.QZX7RVK9"; // matches the key charset cleanMap accepts

function scratch(t, { witness = "Mohammad Etminan, M.D." } = {}) {
  const depositionId = nextId();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-guard-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(folder, "intake"), { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: depositionId }));
  fs.writeFileSync(
    path.join(folder, "intake", "canonical-deposition-record.json"),
    JSON.stringify(
      createCanonicalDepositionRecord({
        court: "In the 285th Judicial District Court",
        causeNumber: "2024-CI-11223",
        caseStyle: "Mohammad Etminan, M.D. v. Baptist Health System",
        witness,
        depositionDate: "2026-04-24",
        location: "7234 Hovingham, San Antonio, Texas 78257",
        remote: true,
        remotePlatform: "Zoom",
        attorneys: [{ name: "Ann Counsel", firm: "Counsel LLP", represents: "Plaintiff", appeared: true, participation: { method: "remote-video" } }],
        reporterProfile: {
          name: "Miah Bardot", licenseNumber: "12129", csrState: "Texas", csrExpiration: "2027-06-30",
          address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603",
          firmRegistrationWaiver: "Certifies under an individual Texas CSR; no firm registration applies.",
        },
      }),
      null,
      2,
    ),
  );
  return { depositionId, storageRoot, folder, workflowFile: path.join(folder, "workflow", "opening-procedures.json") };
}

const verify = (s) =>
  saveOpeningState(null, {
    depositionId: s.depositionId,
    storageRoot: s.storageRoot,
    state: { verifiedFields: { [SENTINEL]: true, "case.caseStyle": true }, verifiedParticipants: {} },
  });

// firmName and firmRegistrationNumber arrive through operator.reporter, which bypasses the store.
// That is a fixture device and not an endorsement. reporter-store-drops-firm-registration holds
// the rule that no stored profile can carry a registration number, and it names this override as
// deliberately uncovered because the app never populates it. It is used here only because a waived
// reporter cannot presently clear UNEXPECTED_BLANK, and this guard needs a render that completes.
const render = (s) =>
  prepareInsertionRenderingArtifact(
    null,
    s.depositionId,
    {
      mode: "standalone",
      operator: {
        jurisdiction: "texas-state",
        signatureDisposition: "requested",
        signatureDispositionBasis: "Requested on the record.",
        reporter: { firmName: "Bardot Reporting", firmRegistrationNumber: "7788" },
        // Supplied for the same reason pagination is: these two certificate fields now reach the
        // guard and nothing collects them yet. Not what this file is about.
        certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff",
          certificationDate: "August 14, 2026", returnStatus: "August 28, 2026", furtherCertificationDate: "August 30, 2026" },
      },
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

function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

const carrying = (root) =>
  filesUnder(root)
    .filter((file) => fs.readFileSync(file, "utf8").includes(SENTINEL))
    .map((file) => path.relative(root, file).split(path.sep).join("/"));

test("a verification is written to the workflow file and to nothing else", (t) => {
  const s = scratch(t);
  verify(s);
  assert.deepEqual(carrying(s.storageRoot), ["reporter/cause/witness/workflow/opening-procedures.json"],
    "the verification must exist in exactly one place; another file carrying it is a widening of its reach");
  for (const rel of ["deposition.json", "intake/canonical-deposition-record.json"]) {
    assert.ok(!/verified/i.test(fs.readFileSync(path.join(s.folder, rel), "utf8")),
      `${rel} must not state that anything was verified`);
  }
});

test("the certified render never opens the workflow file", async (t) => {
  const s = scratch(t);
  verify(s);
  // Poisoned, so a read that parses it fails loudly instead of succeeding in silence.
  fs.writeFileSync(s.workflowFile, "{{{ NOT JSON -- ADR-0021 says the render must not read this }}}");
  assert.throws(() => JSON.parse(fs.readFileSync(s.workflowFile, "utf8")),
    "control: the poison must be unparseable, or its never firing would mean nothing");

  const reads = [];
  const real = { readFileSync: fs.readFileSync, existsSync: fs.existsSync, readFile: fs.readFile, promise: fs.promises.readFile };
  fs.readFileSync = (target, ...rest) => { reads.push(String(target)); return real.readFileSync(target, ...rest); };
  fs.existsSync = (target, ...rest) => { reads.push(String(target)); return real.existsSync(target, ...rest); };
  fs.readFile = (target, ...rest) => { reads.push(String(target)); return real.readFile(target, ...rest); };
  fs.promises.readFile = (target, ...rest) => { reads.push(String(target)); return real.promise(target, ...rest); };
  try {
    await render(s);
  } finally {
    fs.readFileSync = real.readFileSync;
    fs.existsSync = real.existsSync;
    fs.readFile = real.readFile;
    fs.promises.readFile = real.promise;
  }

  assert.ok(reads.some((read) => read.includes("canonical-deposition-record.json")),
    "control: the instrument must see the read the render certainly makes, or it is measuring nothing");
  assert.deepEqual(reads.filter((read) => read.includes("opening-procedures.json")), [],
    "the render opened the workflow file, so a verification can now reach a certified page: ADR-0021 has reopened and verifications need who and at");
});

test("no verification appears in the rendered certification pages", async (t) => {
  const s = scratch(t);
  verify(s);
  const rendered = await render(s);
  for (const [name, part] of [["pageSet", rendered.pageSet], ["renderingSpec", rendered.renderingSpec], ["workspaceDocument", rendered.workspaceDocument]]) {
    const blob = JSON.stringify(part);
    assert.ok(!blob.includes(SENTINEL), `${name} carries a field verification onto a certified page`);
    assert.ok(!/verifiedFields|verifiedParticipants/.test(blob), `${name} carries the verification map`);
  }
  // And the spec the render writes to disk, which outlives the call.
  assert.deepEqual(carrying(s.storageRoot), ["reporter/cause/witness/workflow/opening-procedures.json"],
    "the render wrote the verification into an artifact of its own");
});

test("the search finds a value that does reach the page, so the absences above mean something", async (t) => {
  // The outside signal. Every assertion above is a negative, and a negative proves nothing if the
  // instrument cannot produce a positive. The same marker goes somewhere that genuinely does reach
  // a certification page and the identical search must find it. If this fails, the three tests
  // above are worthless rather than reassuring.
  //
  // The witness name, not the case style: the caption decomposes the style rather than printing it
  // whole, so a marker placed there never lands and this control failed for a reason that had
  // nothing to do with what it is guarding. The witness prints verbatim.
  const s = scratch(t, { witness: `${SENTINEL} Etminan, M.D.` });
  const rendered = await render(s);
  assert.ok(JSON.stringify(rendered.pageSet).includes(SENTINEL),
    "a value that does reach the page must be found by the same search that reports the verification absent");
});
