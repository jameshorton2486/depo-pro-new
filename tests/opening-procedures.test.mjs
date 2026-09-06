import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDepositionAudio, createDeposition, depositionDirectory as storedDepositionDirectory } from "../server/deposition-store.mjs";
import {
  getOpeningProjection,
  readOpeningState,
  recordOathAttestation,
  recordInterpreterAttestation,
  recordClosingAttestation,
  recordStipulationResponse,
  saveOpeningState,
} from "../server/opening-procedures.mjs";
import { readCanonicalOpeningRecord } from "../server/canonical-opening-events.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-opening-")),
    storageRoot = path.join(root, "depos");
  const deposition = createDeposition(
    root,
    {
      deposition: {
        id: "DEP-20260821-OPEN1",
        caseStyle: "Smith v. Jones",
        causeNumber: "2026-CV-1",
        witness: "Alex Smith",
        depositionDate: "2026-08-21",
        courtReporterName: "Miah Bardot",
        canonicalSeed: {
          extractedFields: [
            "caseStyle",
            "causeNumber",
            "witness",
            "court",
            "county",
            "attorneys",
          ],
          court: "District Court",
          county: "Travis",
          scheduledStart: "09:00",
          location: "Austin",
          attorneys: [
            {
              name: "Dennis Bentley",
              firm: "Bentley Law",
              represents: ["Plaintiff"],
              appearanceRole: "QUESTIONING_ATTORNEY",
              actualAppearance: true,
            },
          ],
        },
      },
      artifacts: {
        notice: {
          name: "notice.pdf",
          base64: Buffer.from("notice").toString("base64"),
        },
      },
    },
    { storageRoot },
  );
  return { root, storageRoot, deposition };
}

test("canonical values hydrate without becoming verified", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const projection = getOpeningProjection(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  const caseStyle = projection.fields.find(
    (item) => item.path === "case.caseStyle",
  );
  assert.equal(caseStyle.value, "Smith v. Jones");
  assert.equal(caseStyle.source, "NOD_EXTRACTED");
  assert.equal(caseStyle.verified, false);
  assert.equal(projection.state.recordType, "DEPOSITION_OPENING_WORKFLOW");
});

test("protected opening acts are promoted to the canonical append-only ledger", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  saveOpeningState(value.root, { depositionId:value.deposition.id, storageRoot:value.storageRoot, state:{interpreterDisposition:"REQUIRED"} });
  recordInterpreterAttestation(value.root, { depositionId:value.deposition.id, storageRoot:value.storageRoot, actor:"server test channel", input:{spokenText:"Do you swear or affirm to interpret accurately?",response:"Yes",occurredAt:"2026-08-21T14:01:00Z",basis:"Audible response",sourceAnchor:"media 00:01:00"} });
  recordClosingAttestation(value.root, { depositionId:value.deposition.id, storageRoot:value.storageRoot, actor:"server test channel", input:{spokenText:"This deposition is complete.",occurredAt:"2026-08-21T16:00:00Z",basis:"Recorded closing announcement",sourceAnchor:"media 02:00:00"} });
  const ledger = readCanonicalOpeningRecord(value.root, { depositionId:value.deposition.id, storageRoot:value.storageRoot });
  assert.equal(ledger.interpreterAdministrations.length, 1);
  assert.equal(ledger.closingAttestations.length, 1);
  assert.equal(ledger.auditEvents.length, 2);
  assert.equal(ledger.closingAttestations[0].sourceAnchor, "media 02:00:00");
});

test("verification, applicability, oath selection and completed-on-record survive reopen", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const original = readOpeningState(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  saveOpeningState(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    state: {
      ...original,
      verifiedFields: { "case.caseStyle": true },
      verifiedParticipants: { "attorney-1": true },
      interpreterDisposition: "NOT_APPLICABLE",
      witnessOathSelection: "AFFIRMATION",
      examiningAttorneyId: "attorney-1",
      scripts: {
        ...original.scripts,
        opening: {
          completedOnRecord: true,
          note: "Read after recording began.",
        },
      },
    },
  });
  const reopened = getOpeningProjection(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  assert.equal(
    reopened.fields.find((item) => item.path === "case.caseStyle").verified,
    true,
  );
  assert.equal(reopened.participants[0].verified, true);
  assert.equal(reopened.state.interpreterDisposition, "NOT_APPLICABLE");
  assert.equal(reopened.state.witnessOathSelection, "AFFIRMATION");
  assert.equal(
    reopened.scripts.find((item) => item.id === "opening").completedOnRecord,
    true,
  );
  assert.equal(
    reopened.scripts.find((item) => item.id === "interpreterOath").applicable,
    false,
  );
  assert.equal(reopened.readiness.interpreterOath, true);
  assert.equal(reopened.state.witnessOathSelection, "AFFIRMATION");
  assert.equal(reopened.readiness.witnessOath, true);
  assert.equal(reopened.readiness.examination, true);
});

test("script rendering warns on missing tokens and never mutates canonical evidence", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const canonicalFile = path.join(
      value.storageRoot,
      ...value.deposition.storagePath.split("/"),
      "intake",
      "canonical-deposition-record.json",
    ),
    before = fs.readFileSync(canonicalFile, "utf8");
  const projection = getOpeningProjection(value.root, {
      depositionId: value.deposition.id,
      storageRoot: value.storageRoot,
    }),
    opening = projection.scripts.find((item) => item.id === "opening");
  assert.ok(opening.missing.includes("ACTUAL TIME"));
  assert.match(opening.text, /\[ACTUAL TIME\]/);
  saveOpeningState(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    state: { ...projection.state, witnessOathSelection: "OATH" },
  });
  assert.equal(fs.readFileSync(canonicalFile, "utf8"), before);
  assert.equal(
    fs.existsSync(
      path.join(
        value.storageRoot,
        ...value.deposition.storagePath.split("/"),
        "transcript",
        "working.json",
      ),
    ),
    false,
  );
});

test("Not Applicable is not Missing and readiness never becomes a recording gate", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const state = readOpeningState(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  saveOpeningState(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    state: { ...state, interpreterDisposition: "NOT_APPLICABLE" },
  });
  const projection = getOpeningProjection(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  assert.equal(projection.readiness.interpreterOath, true);
  assert.ok(projection.completeCount < projection.totalCount);
  assert.equal("recordingBlocked" in projection, false);
});

test("stipulation responses are per attorney, require exact modified text, and append audit events", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  assert.throws(
    () =>
      recordStipulationResponse(value.root, {
        depositionId: value.deposition.id,
        storageRoot: value.storageRoot,
        participantId: "attorney-1",
        status: "MODIFIED",
        modifiedText: "",
      }),
    /exact stipulation wording/,
  );
  recordStipulationResponse(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    participantId: "attorney-1",
    status: "MODIFIED",
    topic: "signature_review",
    modifiedText: "Signature review will be completed in ten days.",
    evidenceAnchor: "Media 00:03:18",
    actor: { id: "operator", name: "Local operator", authenticated: false },
  });
  const state = readOpeningState(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  assert.equal(state.stipulations["attorney-1"].status, "MODIFIED");
  assert.equal(
    state.stipulations["attorney-1"].modifiedText,
    "Signature review will be completed in ten days.",
  );
  assert.equal(state.auditEvents.at(-1).type, "STIPULATION_RESPONSE_RECORDED");
  assert.equal(state.stipulationEvents.at(-1).topic, "signature_review");
});

test("retrospective oath attestation records structured authority and never claims system capture", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const proof = {
    spokenText: "Do you solemnly swear that the testimony will be the truth?",
    response: "Yes",
  };
  const depositionDirectory = storedDepositionDirectory(value.root, value.deposition.id, { storageRoot: value.storageRoot });
  const mediaRelativePath = "audio/prerecorded-proof.wav";
  fs.mkdirSync(path.join(depositionDirectory, "audio"), { recursive: true });
  fs.writeFileSync(path.join(depositionDirectory, mediaRelativePath), "media-proof");
  appendDepositionAudio(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    entries: [{ uploadId: "uploaded-proof-1", path: mediaRelativePath, name: "prerecorded-proof.wav" }],
  });
  assert.throws(
    () =>
      recordOathAttestation(value.root, {
        depositionId: value.deposition.id,
        storageRoot: value.storageRoot,
        input: {
          ...proof,
          mode: "RETROSPECTIVE",
          selection: "OATH",
          officerRole: "COURT_REPORTER",
          officerName: "Miah Bardot",
          occurredAt: "2026-08-21T09:02",
          justification: "Heard in the recording.",
        },
      }),
    /source used/,
  );
  const record = recordOathAttestation(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    input: {
      ...proof,
      mode: "RETROSPECTIVE",
      selection: "OATH",
      officerRole: "COURT_REPORTER",
      officerName: "Miah Bardot",
      occurredAt: "2026-08-21T09:02",
      verificationSource: "AUDIO_VIDEO_TIMESTAMP",
      sourceAnchor: "uploaded-proof-1@134",
      justification: "Oath begins at media timestamp 00:02:14.",
    },
    actor: { id: "operator", name: "Local operator", authenticated: false },
  });
  assert.equal(record.verificationSource, "AUDIO_VIDEO_TIMESTAMP");
  assert.equal(record.mode, "RETROSPECTIVE");
  assert.equal(record.resolvedMediaAnchor.uploadId, "uploaded-proof-1");
  assert.equal(record.resolvedMediaAnchor.seconds, 134);
  assert.equal(getOpeningProjection(value.root, { depositionId: value.deposition.id, storageRoot: value.storageRoot }).mediaSources[0].uploadId, "uploaded-proof-1");
  const state = readOpeningState(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  assert.equal(state.oathAttestation.id, record.id);
  assert.equal(state.auditEvents.at(-1).type, "OATH_ATTESTATION_RECORDED");
});

test("another administering officer requires credentials and corrections preserve prior event identity", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const base = {
    mode: "LIVE",
    selection: "OATH",
    spokenText: "Do you solemnly swear that the testimony will be the truth?",
    response: "Yes",
    officerRole: "NOTARY",
    officerName: "Jordan Notary",
    justification: "Observed directly on the record.",
  };
  assert.throws(
    () =>
      recordOathAttestation(value.root, {
        depositionId: value.deposition.id,
        storageRoot: value.storageRoot,
        input: base,
      }),
    /Credentials and issuing jurisdiction/,
  );
  const first = recordOathAttestation(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    input: {
      ...base,
      officerCredential: "Notary 123",
      officerJurisdiction: "Texas",
    },
  });
  assert.throws(
    () =>
      recordOathAttestation(value.root, {
        depositionId: value.deposition.id,
        storageRoot: value.storageRoot,
        input: {
          ...base,
          officerCredential: "Notary 123",
          officerJurisdiction: "Texas",
          occurredAt: "2026-08-21T09:05:00.000Z",
        },
      }),
    /Explain why/,
  );
  recordOathAttestation(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
    input: {
      ...base,
      officerCredential: "Notary 123",
      officerJurisdiction: "Texas",
      occurredAt: "2026-08-21T09:05:00.000Z",
      correctionReason: "Corrected from shorthand notes.",
    },
  });
  const state = readOpeningState(value.root, {
      depositionId: value.deposition.id,
      storageRoot: value.storageRoot,
    }),
    last = state.auditEvents.at(-1);
  assert.equal(last.type, "OATH_ATTESTATION_CORRECTED");
  assert.equal(last.priorAttestationId, first.id);
});

test("a jurisdiction conflict warns without becoming a live-recording gate", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const canonicalFile = path.join(
      value.storageRoot,
      ...value.deposition.storagePath.split("/"),
      "intake",
      "canonical-deposition-record.json",
    ),
    canonical = JSON.parse(fs.readFileSync(canonicalFile, "utf8"));
  canonical.case.jurisdictionType = {
    value: "federal",
    source: "REPORTER_ENTERED",
    state: "REPORTER_ADDED",
  };
  canonical.case.court = {
    value: "407th Judicial District Court, Bexar County, Texas",
    source: "REPORTER_ENTERED",
    state: "REPORTER_ADDED",
  };
  fs.writeFileSync(canonicalFile, JSON.stringify(canonical, null, 2));
  const projection = getOpeningProjection(value.root, {
    depositionId: value.deposition.id,
    storageRoot: value.storageRoot,
  });
  assert.equal(
    projection.jurisdictionConflict.code,
    "OPENING_JURISDICTION_CONFLICT",
  );
  assert.equal("recordingBlocked" in projection, false);
});
