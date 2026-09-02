import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  depositionDirectory,
  readDepositionCorrections,
} from "./deposition-store.mjs";
import { captionJurisdiction } from "./insertion-pages/variants.mjs";
import { appendCanonicalOpeningEvent, readCanonicalOpeningRecord } from "./canonical-opening-events.mjs";

export const OPENING_STATE_VERSION = "2.0.0";
export const OPENING_AUTHORITY_VERSION =
  "texas-federal-opening-governance-1.0.0";
export const OPENING_AUTHORITY_VERIFIED_DATE = "2026-09-02";
export const OPENING_STEPS = Object.freeze([
  "caption",
  "openingDetails",
  "appearances",
  "instructions",
  "interpreterOath",
  "witnessOath",
  "examination",
]);
export const OPENING_WORKFLOW_STAGES = Object.freeze([
  "DRAFT",
  "PRE_RECORD_VALIDATED",
  "ON_RECORD_IDENTIFICATION_COMPLETE",
  "APPEARANCES_COMPLETE",
  "INTERPRETER_COMPLETE",
  "WITNESS_SWORN_OR_AFFIRMED",
  "EXAMINATION_STARTED",
]);

// Every script says whether its wording has been reviewed, in the same vocabulary the insertion
// page templates use: available plus reviewStatus, with expectedSource naming where the reviewed
// text has to come from. A script that is not reviewed is a loud stub, exactly as the federal
// certification variants are -- present, named, and unusable until someone supplies the text.
//
// The two oaths are the ones that are not reviewed, and they are the ones this matters for. An oath
// is the record of how a witness was sworn. A step that reports ready is a step a reporter relies
// on mid-proceeding, so a placeholder that counts toward readiness can put unapproved language into
// that record.
const SCRIPT_DEFINITIONS = Object.freeze({
  opening: {
    title: "Opening the Record",
    classification: "APPROVED_REPORTER_TEMPLATE",
    available: true,
    reviewStatus: "reviewed",
    expectedSource: null,
    whenToUse:
      "After recording begins and the proceeding is ready to be identified.",
    template:
      "We are on the record at [ACTUAL TIME] on [DATE] for the deposition of [DEPONENT] in [CASE STYLE], Cause Number [CAUSE NUMBER].",
  },
  instructions: {
    title: "Preliminary Instructions / Witness Admonitions",
    classification: "APPROVED_REPORTER_TEMPLATE",
    available: true,
    reviewStatus: "reviewed",
    expectedSource: null,
    whenToUse:
      "Before testimony, when the reporter's approved practice calls for these instructions.",
    template:
      "Please answer aloud, allow each question to finish, and pause when an objection is made so the record remains clear.",
  },
  stipulations: {
    title: "Verbal Stipulations",
    classification: "SOURCE-REQUIRED CUSTOMARY PRACTICE",
    available: false,
    reviewStatus: "source-required",
    expectedSource:
      "Reporter- or firm-approved wording plus each present attorney's actual response.",
    whenToUse:
      "Before the oath when counsel elect to place stipulations on the record.",
    template: "[STIPULATION WORDING — APPROVED REPORTER TEXT REQUIRED]",
  },
  interpreterOath: {
    title: "Interpreter Oath",
    classification: "UNVERIFIED",
    available: false,
    reviewStatus: "source-required",
    expectedSource:
      "An interpreter oath in the approved wording for the jurisdiction this deposition is taken in.",
    whenToUse:
      "Only when an interpreter is participating. Confirm the approved jurisdiction-specific wording before use.",
    template:
      "[INTERPRETER OATH — APPROVED JURISDICTION-SPECIFIC TEXT REQUIRED]",
  },
  witnessOath: {
    title: "Witness Oath / Affirmation",
    classification: "UNVERIFIED",
    available: false,
    reviewStatus: "source-required",
    expectedSource:
      "A witness oath and an affirmation in the approved wording for the jurisdiction this deposition is taken in.",
    whenToUse:
      "Before testimony. Select and confirm the approved jurisdiction-specific oath or affirmation.",
    template:
      "[WITNESS OATH OR AFFIRMATION — APPROVED JURISDICTION-SPECIFIC TEXT REQUIRED]",
  },
  examination: {
    title: "Examination Commencement",
    classification: "APPLICATION_POLICY",
    available: true,
    reviewStatus: "reviewed",
    expectedSource: null,
    whenToUse: "When the first examining attorney begins questioning.",
    template:
      "Examination by [EXAMINING ATTORNEY] begins. Capture the transition; transcript headings and by-lines remain renderer-owned.",
  },
  closing: {
    title:"Closing the Record",classification:"CONDITIONAL",available:true,reviewStatus:"reviewed",expectedSource:null,
    whenToUse:"At the conclusion of testimony, before the final recording stop.",
    template:"The deposition is complete at [ACTUAL END TIME]. Any closing stipulations must be stated by counsel and recorded as discrete events.",
  },
});

function jurisdictionScripts(canonical, state) {
  const federal =
    envelope(canonical.case?.jurisdictionType).value === "federal";
  const affirmation = state.witnessOathSelection === "AFFIRMATION";
  const authority = {
    authorityVersion: OPENING_AUTHORITY_VERSION,
    verifiedDate: OPENING_AUTHORITY_VERIFIED_DATE,
  };
  return {
    ...SCRIPT_DEFINITIONS,
    opening: {
      title: federal
        ? "Opening the Federal Record"
        : "Opening the Texas Record",
      classification: federal
        ? "REQUIRED — FRCP 30(b)(5)(A)"
        : "CUSTOMARY — APPROVED TEXAS RECORD-MAKING PRACTICE",
      available: true,
      reviewStatus: "reviewed",
      expectedSource: federal
        ? "Federal Rule of Civil Procedure 30(b)(5)(A)"
        : "Depo-Pro-New Texas/Federal Opening Governance 1.0.0; oath duty arises under Texas Rule 199.5(b)",
      whenToUse:
        "After recording begins, before appearances and the oath or affirmation.",
      template: federal
        ? "We are on the record. I am [REPORTER], and my business address is [BUSINESS ADDRESS]. Today is [DATE], and the time is [ACTUAL TIME]. This is the oral deposition of [DEPONENT] in [CASE STYLE], pending in [COURT], Civil Action Number [CAUSE NUMBER]. This deposition is being taken at [PLACE]. For the identity of all persons present, please state your full name, whom you represent or your role, and your current location, beginning with the noticing attorney."
        : "We are on the record. Today is [DATE], and the time is [ACTUAL TIME]. This is the oral deposition of [DEPONENT] in [CASE STYLE], pending in [COURT], Cause Number [CAUSE NUMBER]. This deposition is being taken at [PLACE]. I am [REPORTER], and I am serving as the deposition officer. Counsel, beginning with the noticing attorney, please state your name, the party you represent, and your location. After counsel, each other person present should identify themselves and their role.",
      ...authority,
    },
    interpreterOath: federal
      ? {
          title: "Federal Interpreter Oath / Affirmation",
          classification: "REQUIRED_IN_SUBSTANCE",
          available: true,
          reviewStatus: "reviewed",
          expectedSource:
            "Federal Rule of Evidence 604; approved substance-equivalent wording in Depo-Pro-New Texas/Federal Opening Governance 1.0.0.",
          whenToUse:
            "Only when an interpreter is participating, after qualification and before interpreted testimony.",
          template:
            "[INTERPRETER], do you solemnly swear or affirm that you will make a true and accurate interpretation of the questions and answers from English to [LANGUAGE] and from [LANGUAGE] to English, to the best of your skill and ability?",
          ...authority,
        }
      : {
          title: "Texas Interpreter Oath / Affirmation",
          classification: "TEXAS UFM SUGGESTED OATH",
          available: true,
          reviewStatus: "reviewed",
          expectedSource: "Texas Judicial Branch Uniform Format Manual §3.11",
          whenToUse: "Only when an interpreter is participating.",
          template:
            "[INTERPRETER], do you solemnly swear or affirm that the interpretation you will give in this deposition will be from English to [LANGUAGE] and from [LANGUAGE] to English to the best of your ability?",
          ...authority,
        },
    witnessOath: {
      title: affirmation ? "Witness Affirmation" : "Witness Oath",
      classification: "REQUIRED_IN_SUBSTANCE",
      available: true,
      reviewStatus: "reviewed",
      expectedSource: federal
        ? "Federal Rules of Civil Procedure 30(b)(5)(A) and Evidence 603; approved substance-equivalent wording in governance 1.0.0."
        : "Texas Rule of Civil Procedure 199.5(b); approved substance-equivalent wording in governance 1.0.0.",
      whenToUse:
        "Before testimony, after offering the witness a neutral oath-or-affirmation choice.",
      template: affirmation
        ? "Do you solemnly affirm that the testimony you are about to give will be the truth, the whole truth, and nothing but the truth?"
        : "Do you solemnly swear that the testimony you are about to give will be the truth, the whole truth, and nothing but the truth, so help you God?",
      ...authority,
    },
    closing:{title:federal?"Federal Completion Statement":"Texas Closing Statement",classification:federal?"REQUIRED — FRCP 30(b)(5)(C)":"CUSTOMARY — RECORD ONLY WHAT OCCURRED",available:true,reviewStatus:"reviewed",expectedSource:federal?"Federal Rule of Civil Procedure 30(b)(5)(C)":"Approved reporter practice; no substantive stipulation is presumed.",whenToUse:"At the end of testimony. Counsel, not the reporter, supplies any custody, exhibit, signature, or other stipulation.",template:federal?"The deposition of [DEPONENT] is complete at [ACTUAL END TIME]. Counsel, please state any stipulations concerning custody of the transcript or recording, exhibits, or other pertinent matters. If none are stated, the record will reflect that no closing stipulations were made.":"The deposition of [DEPONENT] is concluded at [ACTUAL END TIME]. Any closing agreements stated by counsel will be recorded exactly as made.",...authority},
  };
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`,
    descriptor = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}
const envelope = (value) =>
  value && typeof value === "object" && "value" in value
    ? value
    : { value: null, source: "REPORTER_ENTERED", state: "MISSING" };
const valueAt = (record, pathText) =>
  pathText.split(".").reduce((value, key) => value?.[key], record);
const workflowFile = (root, depositionId, storageRoot) =>
  path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "workflow",
    "opening-procedures.json",
  );
const canonicalFile = (root, depositionId, storageRoot) =>
  path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "intake",
    "canonical-deposition-record.json",
  );

function blankState(depositionId) {
  return {
    schemaVersion: OPENING_STATE_VERSION,
    recordType: "DEPOSITION_OPENING_WORKFLOW",
    depositionId,
    verifiedFields: {},
    verifiedParticipants: {},
    scripts: Object.fromEntries(
      Object.keys(SCRIPT_DEFINITIONS).map((id) => [
        id,
        { completedOnRecord: false, note: "" },
      ]),
    ),
    interpreterDisposition: "UNRESOLVED",
    interpreterLanguage: null,
    witnessOathSelection: "UNRESOLVED",
    examiningAttorneyId: null,
    guideMode: "INTERACTIVE",
    currentGuideStep: 0,
    stipulations: {},
    stipulationEvents: [],
    interpreterAttestation: null,
    oathAttestation: null,
    closingAttestation: null,
    auditEvents: [],
    updatedAt: null,
  };
}

function readCanonical(root, depositionId, storageRoot) {
  const file = canonicalFile(root, depositionId, storageRoot);
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const missingField = (source = "REPORTER_ENTERED") => ({
    value: null,
    source,
    state: "MISSING",
  });
  const additions = {
    witnessLocationCity: "REPORTER_ENTERED",
    witnessLocationCounty: "REPORTER_ENTERED",
    witnessLocationState: "REPORTER_ENTERED",
    witnessLocationCountry: "REPORTER_ENTERED",
    officerLocation: "REPORTER_ENTERED",
    remoteAuthoritySource: "REPORTER_ENTERED",
    identityVerificationMethod: "REPORTER_ENTERED",
    canSeeWitness: "REPORTER_ENTERED",
    canHearWitness: "REPORTER_ENTERED",
  };
  let changed = false;
  record.deposition ??= {};
  record.reporter ??= {};
  for (const [key, source] of Object.entries(additions))
    if (!record.deposition[key]) {
      record.deposition[key] = missingField(source);
      changed = true;
    }
  if (!record.reporter.authorityBasis) {
    record.reporter.authorityBasis = missingField();
    changed = true;
  }
  if (changed) atomicJson(file, record);
  return record;
}

export function readOpeningState(root, { depositionId, storageRoot } = {}) {
  const file = workflowFile(root, depositionId, storageRoot);
  if (!fs.existsSync(file)) return blankState(depositionId);
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...blankState(depositionId),
    ...stored,
    stipulations:
      stored.stipulations && typeof stored.stipulations === "object"
        ? stored.stipulations
        : {},
    stipulationEvents: Array.isArray(stored.stipulationEvents)
      ? stored.stipulationEvents
      : [],
    auditEvents: Array.isArray(stored.auditEvents) ? stored.auditEvents : [],
  };
}

// A verification is a checklist tick, not an attestation: no `who` and no per-field `at`. That is
// deliberate and ADR-0021 records why -- it holds only because the value never leaves
// workflow/opening-procedures.json. The correction log and layout-profile.mjs both require
// provenance because they do reach a certified output; this does not.
//
// Before carrying a verification anywhere else -- into the canonical record, a render request, or
// an insertion page -- read ADR-0021's reopening condition. Widening its reach is what obliges it
// to grow `by` and `at`.
//
// WHAT IT STORES IS THE VALUE THAT WAS CONFIRMED, not the fact that something was.
//
// The reporter confirms a fact and may then correct it. A boolean would still read `true` beside a
// value nobody ever confirmed -- and clearing it would mean writing two files, the canonical record
// and this one, with no way to make the pair atomic. A failure between them leaves a changed fact
// carrying confirmation of its predecessor, which is the exact state a certified record must not
// reach.
//
// Storing the confirmed value removes the problem rather than guarding it. Confirmation becomes a
// comparison against what the record holds now, so there is nothing to keep in step and nothing to
// go stale. Editing a fact reopens its confirmation because the two no longer match, not because
// anything went and cleared a flag.
const CONFIRMED_PREFIX = "value:";
export const confirmationToken = (value) =>
  `${CONFIRMED_PREFIX}${crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
    .slice(0, 16)}`;

/**
 * Legacy ticks say only that something was confirmed, never which value.
 *
 * They are honoured against the value the record holds NOW, unless the correction log shows that
 * path has been changed since -- in which case the confirmed value is genuinely unknowable and the
 * honest reading is that it needs confirming again. Inventing provenance for a certified record is
 * worse than asking for one more click.
 */
function cleanMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        /^[a-zA-Z0-9_.-]+$/.test(key) &&
        (item === true ||
          (typeof item === "string" && item.startsWith(CONFIRMED_PREFIX))),
    ),
  );
}

/**
 * Confirms, or unconfirms, one displayed fact.
 *
 * The VALUE is read here rather than accepted, for the same reason `from` is read on a correction:
 * a screen the reporter has been looking at for a while may be describing a value the record no
 * longer holds, and confirming that would record agreement with something nobody is looking at.
 *
 * Unconfirming removes the entry rather than storing a falsehood. There is no such thing as a
 * confirmed absence here -- either a value was confirmed or none was.
 */
export function confirmOpeningField(
  root,
  { depositionId, path: fieldPath, confirmed, storageRoot } = {},
) {
  const target = String(fieldPath ?? "").trim();
  if (!FIELD_ROWS.some(([known]) => known === target))
    throw new Error(`${target} is not a fact this screen shows.`);
  const canonical = readCanonical(root, depositionId, storageRoot);
  const current = readOpeningState(root, { depositionId, storageRoot });
  const verifiedFields = { ...current.verifiedFields };
  if (confirmed === true)
    verifiedFields[target] = confirmationToken(
      envelope(valueAt(canonical, target)).value,
    );
  else delete verifiedFields[target];
  return saveOpeningState(root, {
    depositionId,
    storageRoot,
    state: { ...current, verifiedFields },
  });
}

export function confirmOpeningFields(
  root,
  { depositionId, paths, confirmed, storageRoot } = {},
) {
  const targets = Array.isArray(paths)
    ? [...new Set(paths.map((item) => String(item ?? "").trim()))]
    : [];
  if (!targets.length)
    throw new Error("Choose at least one displayed fact to confirm.");
  const unknown = targets.filter(
    (target) => !FIELD_ROWS.some(([known]) => known === target),
  );
  if (unknown.length)
    throw new Error(`${unknown.join(", ")} is not a fact this screen shows.`);
  const canonical = readCanonical(root, depositionId, storageRoot);
  const current = readOpeningState(root, { depositionId, storageRoot });
  const verifiedFields = { ...current.verifiedFields };
  for (const target of targets) {
    const item = envelope(valueAt(canonical, target));
    if (confirmed === true) {
      if (item.value === null || item.value === undefined || item.value === "")
        throw new Error(`${target} is missing and cannot be confirmed.`);
      verifiedFields[target] = confirmationToken(item.value);
    } else delete verifiedFields[target];
  }
  return saveOpeningState(root, {
    depositionId,
    storageRoot,
    state: { ...current, verifiedFields },
  });
}

const participantConfirmationValue = (item) => ({
  name: envelope(item?.fullName).value,
  role: envelope(item?.appearanceRole).value,
  firm: envelope(item?.firm).value,
  represents: envelope(item?.represents).value,
  actualAppearance: envelope(item?.actualAppearance).value,
  remoteAppearance: envelope(item?.remoteAppearance).value,
});

export function confirmOpeningParticipant(
  root,
  { depositionId, participantId, confirmed, storageRoot } = {},
) {
  const canonical = readCanonical(root, depositionId, storageRoot);
  const all = [
    ...(canonical.counsel || []),
    ...(canonical.participants?.interpreters || []),
    ...(canonical.participants?.videographers || []),
    ...(canonical.participants?.otherAttendees || []),
  ];
  const participant = all.find((item) => item.id === participantId);
  if (!participant)
    throw new Error("That participant is not in the canonical roster.");
  const current = readOpeningState(root, { depositionId, storageRoot });
  const verifiedParticipants = { ...current.verifiedParticipants };
  if (confirmed === true)
    verifiedParticipants[participantId] = confirmationToken(
      participantConfirmationValue(participant),
    );
  else delete verifiedParticipants[participantId];
  return saveOpeningState(root, {
    depositionId,
    storageRoot,
    state: { ...current, verifiedParticipants },
  });
}

export function saveOpeningState(
  root,
  { depositionId, state, storageRoot } = {},
) {
  readCanonical(root, depositionId, storageRoot);
  const current = readOpeningState(root, { depositionId, storageRoot }),
    input = state && typeof state === "object" ? state : {};
  const scripts = { ...current.scripts };
  for (const id of Object.keys(SCRIPT_DEFINITIONS)) {
    const supplied = input.scripts?.[id];
    if (supplied)
      scripts[id] = {
        completedOnRecord: supplied.completedOnRecord === true,
        note: String(supplied.note || "").slice(0, 2000),
      };
  }
  const interpreterDisposition = [
    "UNRESOLVED",
    "REQUIRED",
    "NOT_APPLICABLE",
  ].includes(input.interpreterDisposition)
    ? input.interpreterDisposition
    : current.interpreterDisposition;
  const witnessOathSelection = ["UNRESOLVED", "OATH", "AFFIRMATION"].includes(
    input.witnessOathSelection,
  )
    ? input.witnessOathSelection
    : current.witnessOathSelection;
  const guideMode = ["INTERACTIVE", "QUICK_REFERENCE"].includes(input.guideMode)
    ? input.guideMode
    : current.guideMode;
  const currentGuideStep = Number.isInteger(input.currentGuideStep)
    ? Math.max(0, Math.min(6, input.currentGuideStep))
    : current.currentGuideStep;
  // Attestations are never accepted by this generic workflow-save route. They are recorded only
  // through the protected server-attributed endpoint and promoted to the canonical opening ledger.
  const interpreterAttestation = current.interpreterAttestation;
  const next = {
    ...current,
    schemaVersion: OPENING_STATE_VERSION,
    verifiedFields: cleanMap(input.verifiedFields ?? current.verifiedFields),
    verifiedParticipants: cleanMap(
      input.verifiedParticipants ?? current.verifiedParticipants,
    ),
    scripts,
    interpreterDisposition,
    interpreterLanguage:
      input.interpreterLanguage === null
        ? null
        : String(input.interpreterLanguage ?? current.interpreterLanguage ?? "")
            .trim()
            .slice(0, 80) || null,
    interpreterAttestation,
    witnessOathSelection,
    examiningAttorneyId:
      input.examiningAttorneyId === null
        ? null
        : String(
            input.examiningAttorneyId ?? current.examiningAttorneyId ?? "",
          ).slice(0, 200) || null,
    guideMode,
    currentGuideStep,
    updatedAt: new Date().toISOString(),
  };
  atomicJson(workflowFile(root, depositionId, storageRoot), next);
  return next;
}

const cleanText = (value, limit = 300) =>
  String(value ?? "")
    .trim()
    .slice(0, limit);
const actorRecord = (actor) =>
  typeof actor === "string"
    ? {
        id: "local-opening-screen",
        name: cleanText(actor, 200),
        authenticated: false,
      }
    : {
        id: cleanText(actor?.id, 160) || "local-operator",
        name: cleanText(actor?.name, 160) || "Local DepoPro operator",
        authenticated: actor?.authenticated === true,
      };
const event = (type, actor, payload) => ({
  id: crypto.randomUUID(),
  type,
  at: new Date().toISOString(),
  actor: actorRecord(actor),
  ...payload,
});

export function recordStipulationResponse(
  root,
  {
    depositionId,
    storageRoot,
    participantId,
    status,
    modifiedText,
    topic = "other",
    evidenceAnchor = "",
    actor,
  } = {},
) {
  if (!["ACCEPTED", "REJECTED", "MODIFIED", "UNRESOLVED"].includes(status))
    throw new Error("Choose Accepted, Rejected, Modified, or Unresolved.");
  const canonical = readCanonical(root, depositionId, storageRoot),
    counsel = (canonical.counsel || []).find(
      (item) => item.id === participantId,
    );
  if (!counsel)
    throw new Error(
      "Stipulations may be recorded only for an attorney in the canonical roster.",
    );
  const text = cleanText(modifiedText, 8000);
  const allowedTopics = [
    "remote_oath",
    "signature_review",
    "custody",
    "exhibits",
    "objections",
    "other",
  ];
  if (!allowedTopics.includes(topic))
    throw new Error("Choose a recognized stipulation topic.");
  const anchor = cleanText(evidenceAnchor, 500);
  if (["ACCEPTED", "MODIFIED"].includes(status) && !text)
    throw new Error(
      "Enter the exact stipulation wording before recording assent.",
    );
  if (["ACCEPTED", "REJECTED", "MODIFIED"].includes(status) && !anchor)
    throw new Error("Record the media or transcript source for this response.");
  const current = readOpeningState(root, { depositionId, storageRoot }),
    entry = {
      participantId,
      status,
      topic,
      proposedText: ["ACCEPTED", "MODIFIED"].includes(status) ? text : null,
      modifiedText: status === "MODIFIED" ? text : null,
      evidenceAnchor: anchor || null,
      recordedAt: new Date().toISOString(),
      recordedBy: actorRecord(actor),
    };
  const next = {
    ...current,
    schemaVersion: OPENING_STATE_VERSION,
    stipulations: { ...current.stipulations, [participantId]: entry, [`${topic}:${participantId}`]: entry },
    stipulationEvents: [...current.stipulationEvents, entry],
    auditEvents: [
      ...current.auditEvents,
      event("STIPULATION_RESPONSE_RECORDED", actor, {
        participantId,
        status,
        topic,
        proposedText: entry.proposedText,
        modifiedText: entry.modifiedText,
        evidenceAnchor: entry.evidenceAnchor,
      }),
    ],
    updatedAt: entry.recordedAt,
  };
  const canonicalEvent = appendCanonicalOpeningEvent(root, {
    depositionId, storageRoot, kind: "STIPULATION_RESPONSE", actor: actorRecord(actor).name,
    payload: { ...entry, counselName: envelope(counsel.fullName).value },
  });
  entry.canonicalEventId = canonicalEvent.id;
  atomicJson(workflowFile(root, depositionId, storageRoot), next);
  return next;
}

export function recordOathAttestation(
  root,
  { depositionId, storageRoot, input, actor } = {},
) {
  const canonical = readCanonical(root, depositionId, storageRoot),
    depositionRecord = JSON.parse(
      fs.readFileSync(
        path.join(
          depositionDirectory(root, depositionId, { storageRoot }),
          "deposition.json",
        ),
        "utf8",
      ),
    );
  const mode = input?.mode === "RETROSPECTIVE" ? "RETROSPECTIVE" : "LIVE",
    selection = input?.selection;
  if (!["OATH", "AFFIRMATION"].includes(selection))
    throw new Error("Choose whether an oath or affirmation was administered.");
  const officerRole = cleanText(input?.officerRole, 60),
    officerName = cleanText(input?.officerName, 200),
    officerCredential = cleanText(input?.officerCredential, 200),
    officerJurisdiction = cleanText(input?.officerJurisdiction, 160);
  if (
    !["COURT_REPORTER", "NOTARY", "JUDGE", "OTHER_AUTHORIZED_OFFICER"].includes(
      officerRole,
    )
  )
    throw new Error("Choose the administering officer's role.");
  if (!officerName) throw new Error("Enter the administering officer's name.");
  if (
    officerRole !== "COURT_REPORTER" &&
    (!officerCredential || !officerJurisdiction)
  )
    throw new Error(
      "Credentials and issuing jurisdiction are required when another officer administered the oath.",
    );
  const source = cleanText(input?.verificationSource, 80),
    correctionReason = cleanText(input?.correctionReason, 1000),
    justification = cleanText(input?.justification, 3000),
    spokenText = cleanText(input?.spokenText, 4000),
    response = cleanText(input?.response, 1000);
  if (!justification) throw new Error("Record the basis for the attestation.");
  if (!spokenText || !response)
    throw new Error(
      "Record the exact oath or affirmation text and the witness's response.",
    );
  if (mode === "RETROSPECTIVE" && !source)
    throw new Error(
      "Choose the source used to verify the prerecorded oath time.",
    );
  const rawSourceAnchor = cleanText(input?.sourceAnchor, 300);
  if (mode === "RETROSPECTIVE" && !rawSourceAnchor)
    throw new Error("Enter the evidence location used to verify the prerecorded oath.");
  let resolvedMediaAnchor = null;
  if (mode === "RETROSPECTIVE" && source === "AUDIO_VIDEO_TIMESTAMP") {
    const match = /^([^@]+)@(\d+(?:\.\d+)?)$/.exec(rawSourceAnchor);
    if (!match)
      throw new Error("Use an uploaded-media anchor in the form upload-id@seconds.");
    const media = (depositionRecord.audio ?? []).find(
      (item) => item.uploadId === match[1],
    );
    if (!media)
      throw new Error("The evidence anchor does not identify media uploaded to this deposition.");
    resolvedMediaAnchor = {
      uploadId: media.uploadId,
      seconds: Number(match[2]),
      sha256: media.sha256,
      path: media.path,
      name: media.name,
    };
  }
  const location = {
    city: cleanText(input?.location?.city, 120),
    county: cleanText(input?.location?.county, 120),
    state: cleanText(input?.location?.state, 120),
    country: cleanText(input?.location?.country, 120),
  };
  const remote = envelope(canonical.deposition?.remote).value === true;
  if (remote && Object.values(location).some((value) => !value))
    throw new Error(
      "City, county, state, and country are required for a remote witness location.",
    );
  const occurredAt =
    cleanText(input?.occurredAt, 80) ||
    (mode === "LIVE" ? new Date().toISOString() : "");
  if (!occurredAt)
    throw new Error("Enter the time the oath or affirmation was administered.");
  const current = readOpeningState(root, { depositionId, storageRoot });
  if (
    current.oathAttestation &&
    occurredAt !== current.oathAttestation.occurredAt &&
    !correctionReason
  )
    throw new Error("Explain why the recorded oath time is being corrected.");
  const record = {
    id: crypto.randomUUID(),
    schemaVersion: "2.0.0",
    mode,
    selection,
    spokenText,
    response,
    responseStatus: "AUDIBLE_ASSENT_RECORDED",
    occurredAt,
    verificationSource: mode === "RETROSPECTIVE" ? source : "SYSTEM_CLOCK",
    officer: {
      role: officerRole,
      name: officerName,
      credential: officerCredential || null,
      issuingJurisdiction: officerJurisdiction || null,
      authorityBasis: cleanText(input?.officerAuthorityBasis, 1000) || null,
    },
    witnessLocation: location,
    sourceAnchor: rawSourceAnchor || null,
    resolvedMediaAnchor,
    justification,
    correctionReason: correctionReason || null,
    authorityVersion: OPENING_AUTHORITY_VERSION,
    recordedAt: new Date().toISOString(),
    recordedBy: actorRecord(actor),
    creationMode: depositionRecord.creationMode ?? "existing_recording",
  };
  const canonicalEvent = appendCanonicalOpeningEvent(root, {
    depositionId, storageRoot, kind: "OATH_ADMINISTRATION", actor: actorRecord(actor).name, payload: record,
  });
  record.canonicalEventId = canonicalEvent.id;
  const next = {
    ...current,
    schemaVersion: OPENING_STATE_VERSION,
    oathAttestation: record,
    auditEvents: [
      ...current.auditEvents,
      event(
        current.oathAttestation
          ? "OATH_ATTESTATION_CORRECTED"
          : "OATH_ATTESTATION_RECORDED",
        actor,
        {
          attestationId: record.id,
          priorAttestationId: current.oathAttestation?.id ?? null,
          selection,
          occurredAt,
        },
      ),
    ],
    updatedAt: record.recordedAt,
  };
  atomicJson(workflowFile(root, depositionId, storageRoot), next);
  return record;
}

export function recordInterpreterAttestation(root, { depositionId, storageRoot, input, actor } = {}) {
  const spokenText = cleanText(input?.spokenText, 4000), response = cleanText(input?.response, 1000),
    occurredAt = cleanText(input?.occurredAt, 80) || new Date().toISOString(), basis = cleanText(input?.basis, 2000),
    sourceAnchor = cleanText(input?.sourceAnchor, 500), correctionReason = cleanText(input?.correctionReason, 1000);
  if (!spokenText || !response || !basis || !sourceAnchor) throw new Error("Record the interpreter oath text, response, evidentiary basis, and source anchor.");
  const current = readOpeningState(root, { depositionId, storageRoot });
  if (current.interpreterDisposition !== "REQUIRED") throw new Error("An interpreter attestation may be recorded only when an interpreter is required.");
  if (current.interpreterAttestation && !correctionReason) throw new Error("Explain why the interpreter attestation is being corrected.");
  const record = { id: crypto.randomUUID(), spokenText, response, occurredAt, basis, sourceAnchor, correctionReason: correctionReason || null, priorAttestationId: current.interpreterAttestation?.id ?? null, authorityVersion: OPENING_AUTHORITY_VERSION, recordedAt: new Date().toISOString(), recordedBy: actorRecord(actor) };
  const canonicalEvent = appendCanonicalOpeningEvent(root, { depositionId, storageRoot, kind: "INTERPRETER_ADMINISTRATION", actor: actorRecord(actor).name, payload: record });
  record.canonicalEventId = canonicalEvent.id;
  const next = { ...current, interpreterAttestation: record, auditEvents: [...current.auditEvents, event(current.interpreterAttestation ? "INTERPRETER_ATTESTATION_CORRECTED" : "INTERPRETER_ATTESTATION_RECORDED", actor, { attestationId: record.id, priorAttestationId: record.priorAttestationId, canonicalEventId: canonicalEvent.id, correctionReason: record.correctionReason })], updatedAt: record.recordedAt };
  atomicJson(workflowFile(root, depositionId, storageRoot), next);
  return record;
}

export function recordClosingAttestation(root, { depositionId, storageRoot, input, actor } = {}) {
  const spokenText = cleanText(input?.spokenText, 4000), occurredAt = cleanText(input?.occurredAt, 80) || new Date().toISOString(),
    sourceAnchor = cleanText(input?.sourceAnchor, 500), basis = cleanText(input?.basis, 2000);
  if (!spokenText || !basis || !sourceAnchor) throw new Error("Record the exact closing statement, its evidentiary basis, and a source anchor.");
  const current = readOpeningState(root, { depositionId, storageRoot });
  const record = { id: crypto.randomUUID(), spokenText, occurredAt, sourceAnchor, basis, authorityVersion: OPENING_AUTHORITY_VERSION, recordedAt: new Date().toISOString(), recordedBy: actorRecord(actor) };
  const canonicalEvent = appendCanonicalOpeningEvent(root, { depositionId, storageRoot, kind: "CLOSING_ATTESTATION", actor: actorRecord(actor).name, payload: record });
  record.canonicalEventId = canonicalEvent.id;
  const next = { ...current, closingAttestation: record, auditEvents: [...current.auditEvents, event("CLOSING_ATTESTATION_RECORDED", actor, { attestationId: record.id, canonicalEventId: canonicalEvent.id })], updatedAt: record.recordedAt };
  atomicJson(workflowFile(root, depositionId, storageRoot), next);
  return record;
}

const FIELD_ROWS = Object.freeze([
  ["case.caseStyle", "Case style"],
  ["case.causeNumber", "Cause number"],
  ["case.court", "Court"],
  ["case.county", "County & state"],
  ["case.jurisdictionType", "Jurisdiction"],
  ["deposition.witness", "Deponent"],
  ["deposition.depositionDate", "Deposition date"],
  ["deposition.scheduledStart", "Scheduled start"],
  ["deposition.actualStart", "Actual start"],
  ["deposition.location", "Location"],
  ["deposition.remote", "Remote proceeding"],
  ["deposition.remotePlatform", "Remote platform"],
  ["deposition.witnessLocationCity", "Witness city"],
  ["deposition.witnessLocationCounty", "Witness county"],
  ["deposition.witnessLocationState", "Witness state"],
  ["deposition.witnessLocationCountry", "Witness country"],
  ["deposition.officerLocation", "Officer physical location"],
  ["deposition.remoteAuthoritySource", "Remote oath authority source"],
  ["deposition.identityVerificationMethod", "Witness identity verification"],
  ["deposition.canSeeWitness", "Officer can see witness"],
  ["deposition.canHearWitness", "Officer can hear witness"],
  ["reporter.fullName", "Court reporter"],
  ["reporter.csrNumber", "CSR license number"],
  ["reporter.csrExpiration", "CSR expiration date"],
  ["reporter.firmRegistrationNumber", "Firm registration no."],
  ["reporter.address", "Business address"],
  ["reporter.authorityBasis", "Officer authority basis"],
  ["deposition.reportingMethod", "Reporting method"],
]);

export const PRE_RECORD_GROUPS = Object.freeze([
  {
    id: "caseCourt",
    title: "Case & Court",
    description: "Case style, court, venue, and jurisdiction",
    paths: [
      "case.caseStyle",
      "case.causeNumber",
      "case.court",
      "case.county",
      "case.jurisdictionType",
    ],
  },
  {
    id: "deponent",
    title: "Deponent",
    description: "Witness identity",
    paths: ["deposition.witness"],
  },
  {
    id: "proceedings",
    title: "Proceedings",
    description: "Date, scheduled time, location, and deposition method",
    paths: [
      "deposition.depositionDate",
      "deposition.scheduledStart",
      "deposition.location",
      "deposition.remote",
      "deposition.remotePlatform",
    ],
  },
  {
    id: "officer",
    title: "Officer Info",
    description: "Reporter credentials and reporting method",
    paths: [
      "reporter.fullName",
      "reporter.csrNumber",
      "reporter.csrExpiration",
      "reporter.firmRegistrationNumber",
      "deposition.reportingMethod",
    ],
  },
]);

/**
 * The displayed facts a reporter may correct, and the ones they may not.
 *
 * Everything here is a fact about THIS deposition and belongs to it. Each correction goes through
 * the canonical correction log, which keeps the old value, the new one, who changed it, when, and
 * why -- the same path an honorific and an oath attestation already take. There is one correction
 * mechanism and this is it.
 *
 * `reporter.*` is deliberately absent. Those values are a SNAPSHOT taken from the reporter profile
 * when the deposition was created, and nothing re-reads the profile afterwards. Editing them here
 * would make one deposition disagree with the profile it came from, silently, and editing the
 * profile would not reach a deposition already recorded. Which of those is the fact a certificate
 * rests on is a question this checkpoint has not answered, so it is not offered.
 *
 * `deposition.actualStart` IS here. It was created as TRANSCRIPT_DERIVED and nothing has ever
 * written it, while openingDetails readiness requires it -- so no deposition could ever complete
 * that step. A required fact with no way to become known is not a requirement, it is a dead end.
 * It is reporter-entered now. The recording says "the time is 9:31 a.m." and AI may one day propose
 * that, but a proposal is not authority for an administrative fact on a certified record.
 */
export const EDITABLE_PATHS = new Set([
  "case.caseStyle",
  "case.causeNumber",
  "case.court",
  "case.county",
  "case.jurisdictionType",
  "deposition.witness",
  "deposition.depositionDate",
  "deposition.scheduledStart",
  "deposition.actualStart",
  "deposition.location",
  "deposition.remote",
  "deposition.remotePlatform",
  "deposition.witnessLocationCity",
  "deposition.witnessLocationCounty",
  "deposition.witnessLocationState",
  "deposition.witnessLocationCountry",
  "deposition.officerLocation",
  "deposition.remoteAuthoritySource",
  "deposition.identityVerificationMethod",
  "deposition.canSeeWitness",
  "deposition.canHearWitness",
  "reporter.address",
  "reporter.authorityBasis",
  "deposition.reportingMethod",
]);

function tokenValues(canonical, state) {
  const get = (pathText) => envelope(valueAt(canonical, pathText)).value;
  const examiner = canonical.counsel?.find(
    (item) => item.id === state.examiningAttorneyId,
  );
  return {
    "ACTUAL TIME": get("deposition.actualStart"),
    DATE: get("deposition.depositionDate"),
    DEPONENT: get("deposition.witness"),
    "CASE STYLE": get("case.caseStyle"),
    "CAUSE NUMBER": get("case.causeNumber"),
    COURT: get("case.court"),
    COUNTY: get("case.county"),
    REPORTER: get("reporter.fullName"),
    "BUSINESS ADDRESS": get("reporter.address"),
    PLACE: get("deposition.location"),
    INTERPRETER: envelope(
      canonical.participants?.interpreters?.find(
        (item) => envelope(item.actualAppearance).value !== false,
      )?.fullName,
    ).value,
    LANGUAGE: state.interpreterLanguage ?? null,
    "EXAMINING ATTORNEY": envelope(examiner?.fullName).value,
    "ACTUAL END TIME": get("deposition.actualEnd"),
  };
}

function renderScript(definition, tokens) {
  const missing = [];
  const text = definition.template.replace(/\[([^\]]+)\]/g, (_match, name) => {
    const value = tokens[name];
    if (value === null || value === undefined || value === "") {
      missing.push(name);
      return `[${name}]`;
    }
    return String(value);
  });
  return { text, missing };
}

export function getOpeningProjection(
  root,
  { depositionId, storageRoot, scriptDefinitions = null } = {},
) {
  const canonical = readCanonical(root, depositionId, storageRoot),
    state = readOpeningState(root, { depositionId, storageRoot }),
    tokens = tokenValues(canonical, state);
  const canonicalOpening = readCanonicalOpeningRecord(root, { depositionId, storageRoot });
  const depositionRecord = JSON.parse(
    fs.readFileSync(
      path.join(
        depositionDirectory(root, depositionId, { storageRoot }),
        "deposition.json",
      ),
      "utf8",
    ),
  );
  scriptDefinitions =
    scriptDefinitions ?? jurisdictionScripts(canonical, state);
  // Confirmation is a comparison, not a flag: the tick stores the value that was confirmed, and a
  // fact matches it or it does not. A legacy `true` is honoured against what the record holds now
  // unless the correction log shows the path has moved since, because then the confirmed value is
  // unknowable and inventing one is worse than asking for another click.
  const correctedPaths = new Set(
    readDepositionCorrections(root, depositionId, { storageRoot }).map(
      (entry) => entry.path,
    ),
  );
  const fields = FIELD_ROWS.map(([pathText, label]) => {
    const item = envelope(valueAt(canonical, pathText));
    const tick = state.verifiedFields[pathText];
    const verified =
      tick === true
        ? !correctedPaths.has(pathText)
        : tick === confirmationToken(item.value);
    return {
      path: pathText,
      label,
      ...item,
      verified,
      editable: EDITABLE_PATHS.has(pathText),
    };
  });
  const remote = envelope(canonical.deposition?.remote).value === true,
    federal = envelope(canonical.case?.jurisdictionType).value === "federal";
  const conditionalPaths = {
    proceedings: remote
      ? [
          "deposition.witnessLocationCity",
          "deposition.witnessLocationCounty",
          "deposition.witnessLocationState",
          "deposition.witnessLocationCountry",
          "deposition.officerLocation",
          "deposition.remoteAuthoritySource",
          "deposition.identityVerificationMethod",
          "deposition.canSeeWitness",
          "deposition.canHearWitness",
        ]
      : [],
    officer: [
      "reporter.authorityBasis",
      ...(federal ? ["reporter.address"] : []),
    ],
  };
  const preRecordGroups = PRE_RECORD_GROUPS.map((definition) => {
    const paths = [
      ...definition.paths,
      ...(conditionalPaths[definition.id] ?? []),
    ];
    const groupFields = paths
      .map((pathText) => fields.find((field) => field.path === pathText))
      .filter(Boolean);
    const missingCount = groupFields.filter(
      (field) =>
        field.value === null || field.value === undefined || field.value === "",
    ).length;
    const confirmedCount = groupFields.filter((field) => field.verified).length;
    return {
      ...definition,
      paths,
      confirmedCount,
      totalCount: groupFields.length,
      missingCount,
      ready: missingCount === 0 && confirmedCount === groupFields.length,
    };
  });
  const participants = [
    ...(canonical.counsel || []).map((item) => ({
      source: item,
      id: item.id,
      type: "COUNSEL",
      name: envelope(item.fullName),
      role: envelope(item.appearanceRole),
      firm: envelope(item.firm),
      represents: envelope(item.represents),
      actualAppearance: envelope(item.actualAppearance),
      remoteAppearance: envelope(item.remoteAppearance),
    })),
    ...(canonical.participants?.interpreters || []).map((item) => ({
      source: item,
      id: item.id,
      type: "INTERPRETER",
      name: envelope(item.fullName),
      actualAppearance: envelope(item.actualAppearance),
      remoteAppearance: envelope(item.remoteAppearance),
    })),
    ...(canonical.participants?.videographers || []).map((item) => ({
      source: item,
      id: item.id,
      type: "VIDEOGRAPHER",
      name: envelope(item.fullName),
      actualAppearance: envelope(item.actualAppearance),
      remoteAppearance: envelope(item.remoteAppearance),
    })),
    ...(canonical.participants?.otherAttendees || []).map((item) => ({
      source: item,
      id: item.id,
      type: "OTHER",
      name: envelope(item.fullName),
      actualAppearance: envelope(item.actualAppearance),
      remoteAppearance: envelope(item.remoteAppearance),
    })),
  ].map((item) => {
    const tick = state.verifiedParticipants[item.id];
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      role: item.role,
      firm: item.firm,
      represents: item.represents,
      actualAppearance: item.actualAppearance,
      remoteAppearance: item.remoteAppearance,
      verified:
        tick === true ||
        tick === confirmationToken(participantConfirmationValue(item.source)),
    };
  });
  const scripts = Object.entries(scriptDefinitions).map(([id, definition]) => ({
    id,
    ...definition,
    ...renderScript(definition, tokens),
    ...state.scripts[id],
      applicable:(id !== "interpreterOath" || state.interpreterDisposition !== "NOT_APPLICABLE"),
  }));
  const rawJurisdiction = envelope(canonical.case?.jurisdictionType).value;
  const selectedJurisdiction = /federal/i.test(String(rawJurisdiction ?? ""))
    ? "federal"
    : /texas|state/i.test(String(rawJurisdiction ?? ""))
      ? "texas-state"
      : rawJurisdiction;
  const captionText = [
    envelope(canonical.case?.court).value,
    envelope(canonical.case?.district).value,
    envelope(canonical.case?.division).value,
    envelope(canonical.case?.county).value,
  ]
    .filter(Boolean)
    .join(" ");
  const detectedJurisdiction = captionJurisdiction(captionText);
  const jurisdictionConflict =
    selectedJurisdiction &&
    detectedJurisdiction &&
    detectedJurisdiction !== selectedJurisdiction
      ? {
          code: "OPENING_JURISDICTION_CONFLICT",
          selected: selectedJurisdiction,
          detected: detectedJurisdiction,
          message: `The canonical caption indicates ${detectedJurisdiction}, but ${selectedJurisdiction} is selected. Live work may continue; final compilation remains blocked until this is resolved.`,
        }
      : null;
  const groupReady = (id) =>
    preRecordGroups.find((group) => group.id === id)?.ready === true;
  // One rule for every script-backed step: the wording must be reviewed, and every token in it must
  // have a value. A script whose reviewStatus is not "reviewed" can never report ready, however the
  // reporter answers the question beside it -- selecting oath or affirmation is a choice about which
  // text to use, not evidence that the text exists.
  //
  // Before this, witnessOath reported ready on the selection alone, so the screen could reach 7/7
  // with the words a witness would actually be sworn on still reading
  // "[WITNESS OATH OR AFFIRMATION -- APPROVED JURISDICTION-SPECIFIC TEXT REQUIRED]".
  const scriptReady = (id) => {
    const item = scripts.find((entry) => entry.id === id);
    return (
      Boolean(item?.available) &&
      item.reviewStatus === "reviewed" &&
      item.missing.length === 0
    );
  };
  const readiness = {
    caption: groupReady("caseCourt") && groupReady("deponent"),
    openingDetails: groupReady("proceedings") && groupReady("officer"),
    appearances:
      participants.length > 0 && participants.every((item) => item.verified),
    instructions: scriptReady("instructions"),
    interpreterOath:
      state.interpreterDisposition === "NOT_APPLICABLE" ||
      (state.interpreterDisposition === "REQUIRED" &&
        scriptReady("interpreterOath")),
    witnessOath:
      state.witnessOathSelection !== "UNRESOLVED" && scriptReady("witnessOath"),
    examination: Boolean(state.examiningAttorneyId),
  };
  const preRecordValidated =
    readiness.caption && readiness.openingDetails && !jurisdictionConflict;
  const openingCompleted =
    preRecordValidated && state.scripts.opening?.completedOnRecord === true;
  const appearancesCompleted = openingCompleted && readiness.appearances;
  const interpreterCompleted =
    appearancesCompleted &&
    readiness.interpreterOath &&
    (state.interpreterDisposition === "NOT_APPLICABLE" ||
      (state.scripts.interpreterOath?.completedOnRecord === true &&
        Boolean(state.interpreterAttestation)));
  const witnessSworn =
    interpreterCompleted &&
    readiness.witnessOath &&
    Boolean(state.oathAttestation);
  const examinationStarted =
    witnessSworn &&
    readiness.examination &&
    state.scripts.examination?.completedOnRecord === true;
  const workflowStage = examinationStarted
    ? "EXAMINATION_STARTED"
    : witnessSworn
      ? "WITNESS_SWORN_OR_AFFIRMED"
      : interpreterCompleted
        ? "INTERPRETER_COMPLETE"
        : appearancesCompleted
          ? "APPEARANCES_COMPLETE"
          : openingCompleted
            ? "ON_RECORD_IDENTIFICATION_COMPLETE"
            : preRecordValidated
              ? "PRE_RECORD_VALIDATED"
              : "DRAFT";
  const blockers = [];
  if (!readiness.caption)
    blockers.push({
      code: "PRE_RECORD_CAPTION",
      message: "Confirm the case, court, jurisdiction, and deponent facts.",
    });
  if (!readiness.openingDetails)
    blockers.push({
      code: "PRE_RECORD_DETAILS",
      message:
        "Complete and confirm the proceeding and deposition-officer facts.",
    });
  if (jurisdictionConflict)
    blockers.push({
      code: jurisdictionConflict.code,
      message: jurisdictionConflict.message,
    });
  if (!readiness.appearances)
    blockers.push({
      code: "APPEARANCES",
      message: "Resolve and confirm every participant's attendance and role.",
    });
  if (!readiness.interpreterOath)
    blockers.push({
      code: "INTERPRETER",
      message:
        "Resolve whether an interpreter is required and complete the approved oath text when applicable.",
    });
  if (!readiness.witnessOath || !state.oathAttestation)
    blockers.push({
      code: "WITNESS_OATH",
      message:
        "Select the approved oath or affirmation and record the separate administration attestation.",
    });
  if (!readiness.examination)
    blockers.push({
      code: "EXAMINER",
      message: "Select the first examining attorney.",
    });
  return {
    depositionId,
    creationMode: depositionRecord.creationMode ?? "existing_recording",
    canonical,
    canonicalOpening,
    mediaSources: (depositionRecord.audio ?? []).map((item) => ({
      uploadId: item.uploadId,
      name: item.name,
      sha256: item.sha256,
    })),
    state,
    fields,
    preRecordGroups,
    participants,
    scripts,
    jurisdictionConflict,
    readiness,
    workflowStage,
    blockers,
    canStartRecording: preRecordValidated,
    canStartExamination: witnessSworn && readiness.examination,
    completeCount: OPENING_STEPS.filter((id) => readiness[id]).length,
    totalCount: OPENING_STEPS.length,
  };
}
