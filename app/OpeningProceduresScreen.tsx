"use client";

import { useEffect, useState } from "react";

// The origin every other screen already uses. This file hard-coded 4317 -- the default the API
// falls back to when LOCAL_API_PORT is unset -- so on any machine that sets a port, Opening
// Procedures fetched a closed socket and rendered "Failed to fetch" while the rest of the
// application worked. Nothing else in app/ builds an origin of its own.
import { LOCAL_API_BASE_URL as API } from "./api-client";
type Envelope = { value: unknown; source: string; state: string };
type Field = Envelope & {
  path: string;
  label: string;
  verified: boolean;
  editable: boolean;
};
type PreRecordGroup = {
  id: string;
  title: string;
  description: string;
  paths: string[];
  confirmedCount: number;
  totalCount: number;
  missingCount: number;
  ready: boolean;
};
type Participant = {
  id: string;
  type: string;
  name: Envelope;
  role?: Envelope;
  firm?: Envelope;
  represents?: Envelope;
  actualAppearance?: Envelope;
  remoteAppearance?: Envelope;
  verified: boolean;
};
type Script = {
  id: string;
  title: string;
  classification: string;
  whenToUse: string;
  text: string;
  missing: string[];
  completedOnRecord: boolean;
  note: string;
  applicable: boolean;
  expectedSource?: string | null;
  available?: boolean;
  reviewStatus?: string;
};
type StipulationResponse = {
  participantId: string;
  topic: string;
  status: "ACCEPTED" | "REJECTED" | "MODIFIED" | "UNRESOLVED";
  proposedText?: string | null;
  modifiedText: string | null;
  evidenceAnchor?: string | null;
  recordedAt: string;
};
type OathAttestation = {
  id: string;
  mode: "LIVE" | "RETROSPECTIVE";
  selection: "OATH" | "AFFIRMATION";
  spokenText: string;
  response: string;
  occurredAt: string;
  verificationSource: string;
  officer: {
    role: string;
    name: string;
    credential: string | null;
    issuingJurisdiction: string | null;
  };
  witnessLocation: {
    city: string;
    county: string;
    state: string;
    country: string;
  };
  justification: string;
  recordedAt: string;
};
type InterpreterAttestation = {
  id: string;
  spokenText: string;
  response: string;
  occurredAt: string;
  basis: string;
  sourceAnchor?: string | null;
  recordedAt: string;
};
type OpeningState = {
  verifiedFields: Record<string, boolean | string>;
  verifiedParticipants: Record<string, boolean | string>;
  scripts: Record<string, { completedOnRecord: boolean; note: string }>;
  interpreterDisposition: string;
  interpreterLanguage: string | null;
  interpreterAttestation:
    | InterpreterAttestation
    | {
        spokenText: string;
        response: string;
        occurredAt: string;
        basis: string;
      }
    | null;
  witnessOathSelection: string;
  examiningAttorneyId: string | null;
  guideMode: "INTERACTIVE" | "QUICK_REFERENCE";
  currentGuideStep: number;
  stipulations: Record<string, StipulationResponse>;
  stipulationEvents: StipulationResponse[];
  oathAttestation: OathAttestation | null;
  closingAttestation?: { id: string; spokenText: string; occurredAt: string; sourceAnchor: string; basis: string; recordedAt: string } | null;
};
type Envelope2 = Envelope | undefined;
type Canonical = {
  case?: {
    caseStyle?: Envelope2;
    causeNumber?: Envelope2;
    court?: Envelope2;
    county?: Envelope2;
    jurisdictionType?: Envelope2;
  };
  deposition?: { witnessSworn?: Envelope2 };
  reporter?: { fullName?: Envelope2; csrNumber?: Envelope2 };
};
type Projection = {
  depositionId: string;
  creationMode: "live" | "existing_recording";
  canonical?: Canonical;
  mediaSources?: { uploadId: string; name: string; sha256: string }[];
  state: OpeningState;
  fields: Field[];
  preRecordGroups: PreRecordGroup[];
  participants: Participant[];
  scripts: Script[];
  jurisdictionConflict?: { code: string; message: string } | null;
  readiness: Record<string, boolean>;
  workflowStage: string;
  blockers: { code: string; message: string }[];
  canStartRecording: boolean;
  canStartExamination: boolean;
  completeCount: number;
  totalCount: number;
  protection?: {
    protected: boolean;
    reason: string | null;
    unlocked: boolean;
    unlockedUntil: string | null;
    msRemaining: number;
    unlockCount: number;
  } | null;
};

const value = (item?: Envelope) =>
  item?.value === null || item?.value === undefined || item?.value === ""
    ? "Missing"
    : Array.isArray(item.value)
      ? item.value.join(", ")
      : String(item.value);
const status = (item: Envelope, verified: boolean) =>
  verified
    ? "Verified"
    : !item.state || item.state === "MISSING"
      ? "Missing"
      : item.source === "NOD_EXTRACTED"
        ? "Extracted"
        : item.state.replaceAll("_", " ").toLowerCase();
const displayValue = (item: Field) =>
  typeof item.value === "boolean" ? (item.value ? "Yes" : "No") : value(item);
const sourceLabel = (source?: string) =>
  source ? source.replaceAll("_", " ").toLowerCase() : "source not recorded";
const STIPULATION_TOPICS = [
  ["remote_oath", "Remote oath"], ["signature_review", "Signature review"],
  ["custody", "Custody"], ["exhibits", "Exhibits"], ["objections", "Objections"], ["other", "Other"],
] as const;

export default function OpeningProceduresScreen({
  deposition,
  onBack,
  onContinue,
}: {
  deposition: { id: string; caseStyle: string; witness: string };
  onBack: () => void;
  onContinue: () => void;
}) {
  const [projection, setProjection] = useState<Projection | null>(null),
    [tab, setTab] = useState<"verify" | "appearances" | "scripts">("verify"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [expandAll, setExpandAll] = useState(false),
    [editing, setEditing] = useState<{
      path: string;
      label: string;
      to: string;
      why: string;
    } | null>(null),
    [attendanceReason, setAttendanceReason] = useState<Record<string, string>>(
      {},
    ),
    [stipulationDrafts, setStipulationDrafts] = useState<
      Record<string, string>
    >({}),
    [stipulationMeta, setStipulationMeta] = useState<
      Record<string, { topic: string; evidenceAnchor: string }>
    >({}),
    [interpreterProof, setInterpreterProof] = useState({
      spokenText: "",
      response: "",
      occurredAt: "",
      basis: "",
      sourceAnchor: "",
      correctionReason: "",
    }),
    [closingProof, setClosingProof] = useState({ spokenText: "", occurredAt: "", sourceAnchor: "", basis: "" }),
    [unlockWhy, setUnlockWhy] = useState(""),
    [attestation, setAttestation] = useState({
      officerRole: "COURT_REPORTER",
      officerName: "",
      officerCredential: "",
      officerJurisdiction: "",
      officerAuthorityBasis: "",
      occurredAt: "",
      verificationSource: "",
      sourceAnchor: "",
      spokenText: "",
      response: "",
      city: "",
      county: "",
      state: "",
      country: "",
      justification: "",
      correctionReason: "",
    });
  useEffect(() => {
    let current = true;
    fetch(
      `${API}/api/opening?depositionId=${encodeURIComponent(deposition.id)}`,
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (current) setProjection(body);
      })
      .catch(
        (reason) =>
          current &&
          setError(
            reason instanceof Error
              ? reason.message
              : "Opening procedures could not be loaded.",
          ),
      );
    return () => {
      current = false;
    };
  }, [deposition.id]);
  async function save(state: OpeningState) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/opening`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ depositionId: deposition.id, state }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setProjection(body);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Opening procedures could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function unlockProtectedRecord() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/deposition/unlock-protected`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ depositionId: deposition.id, reason: unlockWhy }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const refreshed = await fetch(
        `${API}/api/opening?depositionId=${encodeURIComponent(deposition.id)}`,
      );
      const next = await refreshed.json();
      if (!refreshed.ok) throw new Error(next.error);
      setProjection(next);
      setUnlockWhy("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "This record could not be opened for editing.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function recordStructuredAttestation() {
    if (!projection) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/opening/oath-attestation`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            depositionId: deposition.id,
            attestation: {
              mode:
                projection.creationMode === "live" ? "LIVE" : "RETROSPECTIVE",
              selection: state.witnessOathSelection,
              spokenText: attestation.spokenText,
              response: attestation.response,
              officerRole: attestation.officerRole,
              officerName:
                attestation.officerName ||
                String(projection.canonical?.reporter?.fullName?.value || ""),
              officerCredential: attestation.officerCredential,
              officerJurisdiction: attestation.officerJurisdiction,
              officerAuthorityBasis: attestation.officerAuthorityBasis,
              occurredAt: attestation.occurredAt,
              verificationSource: attestation.verificationSource,
              sourceAnchor: attestation.sourceAnchor,
              location: {
                city: attestation.city,
                county: attestation.county,
                state: attestation.state,
                country: attestation.country,
              },
              justification: attestation.justification,
              correctionReason: attestation.correctionReason,
            },
          }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setProjection(body);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The structured oath attestation could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function recordStipulation(
    participantId: string,
    topic: string,
    status: StipulationResponse["status"],
  ) {
    const draftKey = `${topic}:${participantId}`;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/opening/stipulation-response`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            depositionId: deposition.id,
            participantId,
            status,
            modifiedText: stipulationDrafts[draftKey] || "",
            topic,
            evidenceAnchor:
              stipulationMeta[draftKey]?.evidenceAnchor || "",
          }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setProjection(body);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The stipulation response could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function recordProtectedAttestation(kind: "interpreter" | "closing", proof: typeof interpreterProof | typeof closingProof) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/api/opening/${kind}-attestation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositionId: deposition.id, attestation: proof }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setProjection(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : `The ${kind} attestation could not be recorded.`); }
    finally { setBusy(false); }
  }
  if (!projection)
    return (
      <main className="opening-shell">
        <section className="opening-card">
          <button className="back-button" onClick={onBack}>
            ← Back to Workspace
          </button>
          <h1>Deposition Opening Procedures</h1>
          <p>{error || "Loading the canonical deposition record…"}</p>
        </section>
      </main>
    );
  const state = projection.state;
  async function verifyGroup(group: PreRecordGroup, checked: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/opening/confirm-fields`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          depositionId: deposition.id,
          paths: group.paths,
          confirmed: checked,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setProjection(payload);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The section confirmation could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function correctField(path: string, to: unknown, why: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/opening/field-correction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depositionId: deposition.id, path, to, why }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setProjection(payload);
      setEditing(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The correction could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verifyParticipant(id: string, checked: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/opening/confirm-participant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          depositionId: deposition.id,
          participantId: id,
          confirmed: checked,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setProjection(payload);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The participant confirmation could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function setAttendance(
    id: string,
    attendance: "IN_PERSON" | "REMOTE" | "ABSENT",
  ) {
    const why = String(attendanceReason[id] || "").trim();
    if (!why) {
      setError("Enter the basis for the attendance change first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${API}/api/opening/participant-attendance`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            depositionId: deposition.id,
            participantId: id,
            attendance,
            why,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setProjection(payload);
      setAttendanceReason((current) => ({ ...current, [id]: "" }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Attendance could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  const updateScript = (
    id: string,
    change: Partial<{ completedOnRecord: boolean; note: string }>,
  ) =>
    save({
      ...state,
      scripts: { ...state.scripts, [id]: { ...state.scripts[id], ...change } },
    });
  return (
    <main className="opening-shell">
      {projection.protection?.protected && (
        <section
          className={`opening-protection ${projection.protection.unlocked ? "open" : "closed"}`}
        >
          <div>
            <strong>
              {projection.protection.unlocked
                ? "Temporarily open for canonical editing"
                : "This canonical record is protected"}
            </strong>
            <p>
              {projection.protection.reason ||
                "Its canonical facts and correction history are closed to unattended writes."}
            </p>
          </div>
          {!projection.protection.unlocked && (
            <div className="opening-protection-unlock">
              <label>
                Why are you opening it?
                <input
                  value={unlockWhy}
                  disabled={busy}
                  onChange={(event) => setUnlockWhy(event.target.value)}
                  placeholder="Entering a verified on-record fact"
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || !unlockWhy.trim()}
                onClick={() => void unlockProtectedRecord()}
              >
                Open for 15 minutes
              </button>
            </div>
          )}
        </section>
      )}
      <header className="opening-header">
        <div>
          <span className="eyebrow">OPEN DEPOSITION</span>
          <h1>Deposition Opening Procedures</h1>
          <p>
            {deposition.caseStyle} · {deposition.witness}
          </p>
        </div>
        <div className="opening-progress">
          <strong>
            {projection.completeCount}/{projection.totalCount}
          </strong>
          <span>Opening readiness</span>
        </div>
      </header>
      <section className="opening-card">
        <div
          className="opening-tabs"
          role="tablist"
          aria-label="Opening procedure sections"
        >
          <button
            className={tab === "verify" ? "active" : ""}
            onClick={() => setTab("verify")}
          >
            Pre-Record Verification
          </button>
          <button
            className={tab === "appearances" ? "active" : ""}
            onClick={() => setTab("appearances")}
          >
            Appearances
          </button>
          <button
            className={tab === "scripts" ? "active" : ""}
            onClick={() => setTab("scripts")}
          >
            Scripts &amp; Oaths
          </button>
        </div>
        {error && (
          <p className="analysis-error" role="alert">
            {error}
          </p>
        )}
        {projection.jurisdictionConflict && (
          <div className="opening-jurisdiction-conflict" role="alert">
            <strong>Jurisdiction conflict</strong>
            <span>{projection.jurisdictionConflict.message}</span>
          </div>
        )}
        {tab === "verify" && (
          <section className="opening-section">
            <div className="opening-section-heading">
              <div>
                <h2>Pre-Record Verification</h2>
                <p>
                  Review the four sections before going on the record. Extracted
                  does not mean confirmed.
                </p>
              </div>
              <span className="opening-section-total">
                {
                  projection.preRecordGroups.filter((group) => group.ready)
                    .length
                }
                /4 sections confirmed
              </span>
            </div>
            <div className="opening-review-groups">
              {projection.preRecordGroups.map((group, index) => {
                const groupFields = projection.fields.filter((field) =>
                  group.paths.includes(field.path),
                );
                return (
                  <section className="opening-review-group" key={group.id}>
                    <header>
                      <div className="opening-group-title">
                        <span aria-hidden="true">
                          {["⚖", "●", "◷", "◇"][index]}
                        </span>
                        <div>
                          <h3>{group.title}</h3>
                          <p>{group.description}</p>
                        </div>
                      </div>
                      <span
                        className={`opening-group-count ${group.ready ? "ready" : ""}`}
                      >
                        {group.confirmedCount}/{group.totalCount}
                      </span>
                    </header>
                    <div className="opening-field-list">
                      {groupFields.map((item) => (
                        <div
                          className={`opening-field ${item.state === "MISSING" ? "missing" : ""} ${item.verified ? "confirmed" : ""}`}
                          key={item.path}
                        >
                          <div className="opening-fact">
                            <strong>{item.label}</strong>
                            <b>{displayValue(item)}</b>
                            <small>
                              {status(item, item.verified)} ·{" "}
                              {sourceLabel(item.source)}
                            </small>
                          </div>
                          <div className="opening-fact-actions">
                            {item.editable && (
                              <button
                                type="button"
                                className="opening-edit"
                                disabled={busy}
                                onClick={() =>
                                  setEditing(
                                    editing?.path === item.path
                                      ? null
                                      : {
                                          path: item.path,
                                          label: item.label,
                                          to:
                                            item.value === null ||
                                            item.value === undefined
                                              ? ""
                                              : String(item.value),
                                          why: "",
                                        },
                                  )
                                }
                              >
                                {editing?.path === item.path
                                  ? "Cancel"
                                  : "Edit"}
                              </button>
                            )}
                            {item.verified && (
                              <span
                                className="opening-field-check"
                                aria-label="Confirmed"
                              >
                                ✓
                              </span>
                            )}
                          </div>
                          {editing?.path === item.path && (
                            <form
                              className="opening-edit-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void correctField(
                                  item.path,
                                  typeof item.value === "boolean"
                                    ? editing.to === "true"
                                    : editing.to.trim(),
                                  editing.why.trim(),
                                );
                              }}
                            >
                              {item.path === "case.jurisdictionType" ? (
                                <label>
                                  {item.label}
                                  <select
                                    value={editing.to}
                                    onChange={(event) =>
                                      setEditing({
                                        ...editing,
                                        to: event.target.value,
                                      })
                                    }
                                  >
                                    <option value="">Select…</option>
                                    <option value="texas-state">
                                      Texas state court
                                    </option>
                                    <option value="federal">
                                      Federal court
                                    </option>
                                  </select>
                                </label>
                              ) : item.path === "deposition.reportingMethod" ? (
                                <label>
                                  {item.label}
                                  <select
                                    value={editing.to}
                                    onChange={(event) =>
                                      setEditing({
                                        ...editing,
                                        to: event.target.value,
                                      })
                                    }
                                  >
                                    <option value="">Select…</option>
                                    <option value="Machine shorthand">
                                      Machine shorthand
                                    </option>
                                    <option value="Voice writing">
                                      Voice writing
                                    </option>
                                    <option value="Digital reporting">
                                      Digital reporting
                                    </option>
                                  </select>
                                </label>
                              ) : typeof item.value === "boolean" ? (
                                <label>
                                  {item.label}
                                  <select
                                    value={editing.to}
                                    onChange={(event) =>
                                      setEditing({
                                        ...editing,
                                        to: event.target.value,
                                      })
                                    }
                                  >
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                  </select>
                                </label>
                              ) : (
                                <label>
                                  {item.label}
                                  <input
                                    value={editing.to}
                                    onChange={(event) =>
                                      setEditing({
                                        ...editing,
                                        to: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                              )}
                              <label>
                                Basis for correction
                                <input
                                  value={editing.why}
                                  onChange={(event) =>
                                    setEditing({
                                      ...editing,
                                      why: event.target.value,
                                    })
                                  }
                                  placeholder="For example: Notice of Deposition or stated on the record."
                                />
                              </label>
                              <button
                                type="submit"
                                className="secondary-button"
                                disabled={
                                  busy ||
                                  !editing.to.trim() ||
                                  !editing.why.trim()
                                }
                              >
                                Record correction
                              </button>
                              <p className="opening-when">
                                The prior value, correction, reporter identity,
                                time, and basis are retained.
                              </p>
                            </form>
                          )}
                        </div>
                      ))}
                    </div>
                    <footer>
                      {group.missingCount > 0 ? (
                        <span className="opening-group-warning">
                          {group.missingCount} missing value
                          {group.missingCount === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span>
                          {group.ready
                            ? "Section confirmed"
                            : "All required values are present"}
                        </span>
                      )}
                      <button
                        type="button"
                        className={
                          group.ready ? "secondary-button" : "primary-button"
                        }
                        disabled={busy || group.missingCount > 0}
                        onClick={() => void verifyGroup(group, !group.ready)}
                      >
                        {group.ready ? "Reopen section" : "Confirm section"}
                      </button>
                    </footer>
                  </section>
                );
              })}
            </div>
            {(() => {
              const actual = projection.fields.find(
                (field) => field.path === "deposition.actualStart",
              )!;
              const manual = projection.creationMode === "existing_recording";
              return (
                <aside className="opening-live-fact opening-actual-start">
                  <div>
                    <strong>Actual start</strong>
                    <span>{displayValue(actual)}</span>
                    <small>
                      {actual.source === "SYSTEM_CAPTURED"
                        ? "Captured automatically when the first live recording started"
                        : manual
                          ? "Enter the time stated in the recording"
                          : "Will populate when the first live recording starts"}
                    </small>
                  </div>
                  {manual ? (
                    <div className="opening-actual-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setEditing(
                            editing?.path === actual.path
                              ? null
                              : {
                                  path: actual.path,
                                  label: actual.label,
                                  to:
                                    actual.value === null ||
                                    actual.value === undefined
                                      ? ""
                                      : String(actual.value),
                                  why: "",
                                },
                          )
                        }
                      >
                        {editing?.path === actual.path
                          ? "Cancel"
                          : "Enter actual start"}
                      </button>
                      {editing?.path === actual.path && (
                        <form
                          className="opening-edit-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void correctField(
                              actual.path,
                              editing.to.trim(),
                              editing.why.trim(),
                            );
                          }}
                        >
                          <label>
                            Actual start time
                            <input
                              type="time"
                              value={editing.to}
                              onChange={(event) =>
                                setEditing({
                                  ...editing,
                                  to: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Source / basis
                            <input
                              value={editing.why}
                              onChange={(event) =>
                                setEditing({
                                  ...editing,
                                  why: event.target.value,
                                })
                              }
                              placeholder="For example: stated at 00:01:39 in recording"
                            />
                          </label>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={
                              busy || !editing.to.trim() || !editing.why.trim()
                            }
                          >
                            Record actual start
                          </button>
                        </form>
                      )}
                    </div>
                  ) : (
                    <p>
                      Automatic capture uses the machine clock and preserves the
                      capture event timestamp in the correction history.
                    </p>
                  )}
                </aside>
              );
            })()}
          </section>
        )}
        {tab === "appearances" &&
          (() => {
            const caseRecord = projection.canonical?.case;
            const jurisdiction =
              value(caseRecord?.jurisdictionType) === "texas-state"
                ? "Texas state court"
                : value(caseRecord?.jurisdictionType) === "federal"
                  ? "Federal court"
                  : value(caseRecord?.jurisdictionType);
            const confirmedPresent = projection.participants.filter(
              (item) => item.verified && item.actualAppearance?.value === true,
            );
            const counsel = confirmedPresent.filter(
                (item) => item.type === "COUNSEL",
              ),
              others = confirmedPresent.filter(
                (item) => item.type !== "COUNSEL",
              );
            const attendance = (item: Participant) =>
              item.actualAppearance?.value === false
                ? "Absent"
                : item.actualAppearance?.value !== true
                  ? "Attendance unresolved"
                  : item.remoteAppearance?.value === true
                    ? "Remote"
                    : item.remoteAppearance?.value === false
                      ? "In person"
                      : "Present · method unresolved";
            const previewName = (item: Participant) =>
              `${value(item.name).toUpperCase()}${item.remoteAppearance?.value === true ? " (Via remote)" : ""}`;
            return (
              <section className="opening-section">
                <div className="opening-section-heading">
                  <div>
                    <h2>Participant Verification</h2>
                    <p>
                      Confirm the roster facts already recorded. Only confirmed,
                      present participants appear in the preview.
                    </p>
                  </div>
                  <span className="opening-section-total">
                    {
                      projection.participants.filter((item) => item.verified)
                        .length
                    }
                    /{projection.participants.length} roster entries confirmed
                  </span>
                </div>
                <div className="appearances-layout">
                  <div className="appearances-control">
                    <div className="appearance-jurisdiction">
                      <span aria-hidden="true">◎</span>
                      <div>
                        <strong>Governing jurisdiction</strong>
                        <small>
                          Controls terminology and certification templates
                        </small>
                      </div>
                      <b>{jurisdiction}</b>
                    </div>
                    <div className="appearance-case">
                      <h3>Case information</h3>
                      <dl>
                        <div>
                          <dt>Case style</dt>
                          <dd>{value(caseRecord?.caseStyle)}</dd>
                        </div>
                        <div>
                          <dt>
                            {value(caseRecord?.jurisdictionType) === "federal"
                              ? "Civil action number"
                              : "Cause number"}
                          </dt>
                          <dd>{value(caseRecord?.causeNumber)}</dd>
                        </div>
                        <div>
                          <dt>Venue</dt>
                          <dd>
                            {[
                              value(caseRecord?.court),
                              value(caseRecord?.county),
                            ]
                              .filter((item) => item !== "Missing")
                              .join(", ") || "Missing"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="appearance-roster-heading">
                      <div>
                        <h3>Canonical participant roster</h3>
                        <p>
                          Set attendance here, then confirm the exact roster
                          details shown.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={onBack}
                      >
                        Edit names and roles in Workspace
                      </button>
                    </div>
                    {projection.participants.length ? (
                      <div className="appearance-roster">
                        {projection.participants.map((item) => (
                          <article
                            className={`${item.verified ? "verified" : ""} ${item.actualAppearance?.value === false ? "absent" : ""}`}
                            key={item.id}
                          >
                            <header>
                              <div>
                                <span
                                  className="appearance-person-icon"
                                  aria-hidden="true"
                                >
                                  {item.type === "VIDEOGRAPHER"
                                    ? "▣"
                                    : item.type === "INTERPRETER"
                                      ? "◎"
                                      : "♙"}
                                </span>
                                <div>
                                  <h4>{value(item.name)}</h4>
                                  <p>
                                    {item.type
                                      .replaceAll("_", " ")
                                      .toLowerCase()}
                                    {value(item.firm) !== "Missing"
                                      ? ` · ${value(item.firm)}`
                                      : ""}
                                  </p>
                                </div>
                              </div>
                              <span
                                className={`appearance-status ${item.actualAppearance?.value === false ? "absent" : ""}`}
                              >
                                {attendance(item)}
                              </span>
                            </header>
                            {value(item.represents) !== "Missing" && (
                              <p className="appearance-represents">
                                Represents{" "}
                                <strong>{value(item.represents)}</strong>
                              </p>
                            )}
                            <div
                              className="appearance-mode"
                              aria-label={`Recorded attendance for ${value(item.name)}`}
                            >
                              <button
                                type="button"
                                disabled={busy}
                                className={
                                  item.actualAppearance?.value === true &&
                                  item.remoteAppearance?.value !== true
                                    ? "selected"
                                    : ""
                                }
                                onClick={() =>
                                  void setAttendance(item.id, "IN_PERSON")
                                }
                              >
                                ⌖ In person
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                className={
                                  item.actualAppearance?.value === true &&
                                  item.remoteAppearance?.value === true
                                    ? "selected"
                                    : ""
                                }
                                onClick={() =>
                                  void setAttendance(item.id, "REMOTE")
                                }
                              >
                                ▭ Remote
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                className={
                                  item.actualAppearance?.value === false
                                    ? "selected"
                                    : ""
                                }
                                onClick={() =>
                                  void setAttendance(item.id, "ABSENT")
                                }
                              >
                                × Absent
                              </button>
                            </div>
                            <label className="appearance-basis">
                              Basis for attendance
                              <input
                                value={attendanceReason[item.id] || ""}
                                onChange={(event) =>
                                  setAttendanceReason((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                                placeholder="For example: present on Zoom roll call"
                              />
                            </label>
                            <label className="appearance-confirm">
                              <input
                                type="checkbox"
                                checked={item.verified}
                                disabled={busy}
                                onChange={(event) =>
                                  void verifyParticipant(
                                    item.id,
                                    event.target.checked,
                                  )
                                }
                              />
                              {item.verified
                                ? "Roster details confirmed"
                                : "Confirm roster details"}
                            </label>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="opening-warning">
                        No participants are recorded in the canonical record.
                        Return to Workspace to add the roster.
                      </p>
                    )}
                  </div>
                  <aside className="appearance-preview">
                    <header>
                      <div>
                        <h3>Live Transcript Preview</h3>
                        <p>Appearances page · confirmed participants</p>
                      </div>
                      <span>Auto-updating</span>
                    </header>
                    <div className="transcript-sheet">
                      <div className="transcript-caption">
                        <strong>
                          {value(caseRecord?.caseStyle).toUpperCase()}
                        </strong>
                        <span>{value(caseRecord?.causeNumber)}</span>
                        <span>
                          {[value(caseRecord?.court), value(caseRecord?.county)]
                            .filter((item) => item !== "Missing")
                            .join(", ")
                            .toUpperCase()}
                        </span>
                      </div>
                      <hr />
                      <h4>APPEARANCES</h4>
                      {counsel.length ? (
                        counsel.map((item) => (
                          <div className="transcript-appearance" key={item.id}>
                            <strong>{previewName(item)}</strong>
                            <span>
                              {value(item.role) !== "Missing"
                                ? value(item.role)
                                    .replaceAll("_", " ")
                                    .toUpperCase()
                                : "ATTORNEY"}
                            </span>
                            {value(item.represents) !== "Missing" && (
                              <span>
                                FOR {value(item.represents).toUpperCase()}
                              </span>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="transcript-empty">
                          No confirmed, present attorneys yet.
                        </p>
                      )}
                      {others.length > 0 && (
                        <>
                          <h4>ALSO PRESENT</h4>
                          {others.map((item) => (
                            <div className="transcript-other" key={item.id}>
                              <span>{previewName(item)}</span>
                              <span>{item.type}</span>
                            </div>
                          ))}
                        </>
                      )}
                      <footer>
                        <span>
                          C.S.R. No.{" "}
                          {value(projection.canonical?.reporter?.csrNumber)}
                        </span>
                        <span>Page 2</span>
                      </footer>
                    </div>
                  </aside>
                </div>
                <p className="opening-when">
                  Audit trail: changes made here identify the DepoPro local
                  opening screen and explicitly state that operator identity is
                  not authenticated. They are never attributed to the assigned
                  CSR merely because that reporter is on the deposition.
                </p>
              </section>
            );
          })()}
        {tab === "scripts" &&
          (() => {
            const steps = [
                { title: "Opening the record", ids: ["opening"] },
                { title: "Preliminary instructions", ids: ["instructions"] },
                { title: "Verbal stipulations", ids: ["stipulations"] },
                { title: "Interpreter oath", ids: ["interpreterOath"] },
                { title: "Witness oath & attestation", ids: ["witnessOath"] },
                    { title: "Examination commencement", ids: ["examination"] },
                    { title: "Close the record", ids: ["closing"] },
                  ],
                  step = Math.max(0, Math.min(6, state.currentGuideStep || 0)),
              interactive = state.guideMode !== "QUICK_REFERENCE",
              visible = projection.scripts.filter(
                (item) =>
                  item.applicable &&
                  (!interactive || steps[step].ids.includes(item.id)),
              );
            return (
              <section className="opening-section">
                <div className="opening-section-heading">
                  <div>
                    <h2>Scripts &amp; Oaths</h2>
                    <p>
                      Read-aloud preparation only. Text enters the transcript
                      solely through recorded evidence.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => setExpandAll((value) => !value)}
                  >
                    {expandAll ? "Collapse all" : "Expand all for reading"}
                  </button>
                </div>
                <div className="opening-guide-modes">
                  <button
                    className={interactive ? "active" : ""}
                    onClick={() =>
                      void save({ ...state, guideMode: "INTERACTIVE" })
                    }
                  >
                    Interactive Guide
                  </button>
                  <button
                    className={!interactive ? "active" : ""}
                    onClick={() =>
                      void save({ ...state, guideMode: "QUICK_REFERENCE" })
                    }
                  >
                    Quick Reference
                  </button>
                </div>
                {interactive && (
                  <nav
                    className="opening-guide-steps"
                    aria-label="Opening guide steps"
                  >
                    {steps.map((item, index) => (
                      <button
                        key={item.title}
                        className={index === step ? "active" : ""}
                        onClick={() =>
                          void save({ ...state, currentGuideStep: index })
                        }
                      >
                        <span>{index + 1}</span>
                        {item.title}
                      </button>
                    ))}
                  </nav>
                )}
                <div className="opening-controls">
                  <label>
                    Interpreter
                    <select
                      value={state.interpreterDisposition}
                      disabled={busy}
                      onChange={(event) =>
                        void save({
                          ...state,
                          interpreterDisposition: event.target.value,
                        })
                      }
                    >
                      <option value="UNRESOLVED">Unresolved</option>
                      <option value="REQUIRED">Required</option>
                      <option value="NOT_APPLICABLE">Not applicable</option>
                    </select>
                  </label>
                  {state.interpreterDisposition === "REQUIRED" && (
                    <label>
                      Interpreted language
                      <input
                        value={state.interpreterLanguage || ""}
                        disabled={busy}
                        onChange={(event) =>
                          void save({
                            ...state,
                            interpreterLanguage: event.target.value || null,
                          })
                        }
                        placeholder="Spanish"
                      />
                    </label>
                  )}
                  <label>
                    Witness oath selection
                    <select
                      value={state.witnessOathSelection}
                      disabled={busy}
                      onChange={(event) =>
                        void save({
                          ...state,
                          witnessOathSelection: event.target.value,
                        })
                      }
                    >
                      <option value="UNRESOLVED">Unresolved</option>
                      <option value="OATH">Oath</option>
                      <option value="AFFIRMATION">Affirmation</option>
                    </select>
                  </label>
                  <label>
                    First examining attorney
                    <select
                      value={state.examiningAttorneyId || ""}
                      disabled={busy}
                      onChange={(event) =>
                        void save({
                          ...state,
                          examiningAttorneyId: event.target.value || null,
                        })
                      }
                    >
                      <option value="">Unresolved</option>
                      {projection.participants
                        .filter((item) => item.type === "COUNSEL")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {value(item.name)}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                {(!interactive || step === 2) && (
                  <section className="opening-audit-card">
                    <h3>Attorney stipulation responses</h3>
                    <p>
                      No response is assumed. Modified wording must reflect what
                      was actually stated and remains outside the transcript
                      until supported by evidence.
                    </p>
                    <div className="stipulation-matrix">
                      {STIPULATION_TOPICS.map(([topic, label]) => (
                        <section key={topic} className="stipulation-topic">
                          <h4>{label}</h4>
                          {projection.participants.filter((item) => item.type === "COUNSEL" && item.actualAppearance?.value === true).map((item) => {
                            const key = `${topic}:${item.id}`, saved = state.stipulations[key];
                            return <div className="stipulation-row" key={key}>
                              <strong>{value(item.name)}</strong>
                              <textarea value={stipulationDrafts[key] ?? saved?.proposedText ?? saved?.modifiedText ?? ""} onChange={(event) => setStipulationDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder="Exact proposed or modified wording" />
                              <input value={stipulationMeta[key]?.evidenceAnchor ?? saved?.evidenceAnchor ?? ""} onChange={(event) => setStipulationMeta((current) => ({ ...current, [key]: { topic, evidenceAnchor: event.target.value } }))} placeholder="Media/transcript source" />
                              <select value={saved?.status || "UNRESOLVED"} disabled={busy} onChange={(event) => void recordStipulation(item.id, topic, event.target.value as StipulationResponse["status"])}>
                                <option value="UNRESOLVED">Unresolved</option><option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected</option><option value="MODIFIED">Modified</option>
                              </select>
                            </div>;
                          })}
                        </section>
                      ))}
                    </div>
                  </section>
                )}
                {(!interactive || step === 3) &&
                  state.interpreterDisposition === "REQUIRED" && (
                    <section className="opening-audit-card">
                      <h3>Interpreter oath attestation</h3>
                      <p>
                        Qualification and oath proof are stored separately from
                        the witness oath.
                      </p>
                      {state.interpreterAttestation && (
                        <p className="attestation-recorded">
                          <strong>Recorded:</strong> interpreter response “
                          {state.interpreterAttestation.response}” at{" "}
                          {state.interpreterAttestation.occurredAt}.
                        </p>
                      )}
                      <div className="attestation-grid">
                        <label className="wide">
                          Exact oath or affirmation spoken
                          <textarea
                            value={interpreterProof.spokenText}
                            onChange={(event) =>
                              setInterpreterProof({
                                ...interpreterProof,
                                spokenText: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Interpreter response
                          <input
                            value={interpreterProof.response}
                            onChange={(event) =>
                              setInterpreterProof({
                                ...interpreterProof,
                                response: event.target.value,
                              })
                            }
                            placeholder="Yes"
                          />
                        </label>
                        <label>
                          Time administered
                          <input
                            type="datetime-local"
                            value={interpreterProof.occurredAt}
                            onChange={(event) =>
                              setInterpreterProof({
                                ...interpreterProof,
                                occurredAt: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="wide">
                          Evidence / qualification basis
                          <textarea
                            value={interpreterProof.basis}
                            onChange={(event) =>
                              setInterpreterProof({
                                ...interpreterProof,
                                basis: event.target.value,
                              })
                            }
                            placeholder="Recorded response and qualification source"
                          />
                        </label>
                        <label className="wide">
                          Media or transcript source
                          <input value={interpreterProof.sourceAnchor} onChange={(event) => setInterpreterProof({ ...interpreterProof, sourceAnchor: event.target.value })} placeholder="For example: media 00:01:42" />
                        </label>
                        {state.interpreterAttestation && <label className="wide">Reason for correction<textarea value={interpreterProof.correctionReason} onChange={(event) => setInterpreterProof({ ...interpreterProof, correctionReason: event.target.value })} /></label>}
                      </div>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={
                          busy ||
                          !interpreterProof.spokenText.trim() ||
                          !interpreterProof.response.trim() ||
                          !interpreterProof.basis.trim() ||
                          !interpreterProof.sourceAnchor.trim() ||
                          (Boolean(state.interpreterAttestation) && !interpreterProof.correctionReason.trim())
                        }
                        onClick={() => void recordProtectedAttestation("interpreter", interpreterProof)}
                      >
                        Record interpreter attestation
                      </button>
                    </section>
                  )}
                {(!interactive || step === 4) && (
                  <section className="opening-audit-card">
                    <h3>Oath attestation audit record</h3>
                    <p>
                      Separate from selecting or copying oath text. Live entries
                      use the system clock; prerecorded entries require a
                      verification source.
                    </p>
                    {state.oathAttestation && (
                      <p className="attestation-recorded">
                        <strong>Recorded:</strong>{" "}
                        {state.oathAttestation.selection.toLowerCase()}{" "}
                        administered by {state.oathAttestation.officer.name} at{" "}
                        {state.oathAttestation.occurredAt}. A correction creates
                        another audit event.
                      </p>
                    )}
                    <div className="attestation-grid">
                      <label>
                        Administering officer role
                        <select
                          value={attestation.officerRole}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              officerRole: event.target.value,
                            })
                          }
                        >
                          <option value="COURT_REPORTER">
                            Court reporter / CSR
                          </option>
                          <option value="NOTARY">Notary</option>
                          <option value="JUDGE">Judge</option>
                          <option value="OTHER_AUTHORIZED_OFFICER">
                            Other authorized officer
                          </option>
                        </select>
                      </label>
                      <label>
                        Officer name
                        <input
                          value={attestation.officerName}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              officerName: event.target.value,
                            })
                          }
                          placeholder={String(
                            projection.canonical?.reporter?.fullName?.value ||
                              "Reporter name",
                          )}
                        />
                      </label>
                      {attestation.officerRole !== "COURT_REPORTER" && (
                        <>
                          <label>
                            Credential
                            <input
                              value={attestation.officerCredential}
                              onChange={(event) =>
                                setAttestation({
                                  ...attestation,
                                  officerCredential: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Issuing jurisdiction
                            <input
                              value={attestation.officerJurisdiction}
                              onChange={(event) =>
                                setAttestation({
                                  ...attestation,
                                  officerJurisdiction: event.target.value,
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                      <label>
                        Time administered
                        <input
                          type="datetime-local"
                          value={attestation.occurredAt}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              occurredAt: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="wide">
                        Exact oath or affirmation spoken
                        <textarea
                          value={attestation.spokenText}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              spokenText: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Witness response
                        <input
                          value={attestation.response}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              response: event.target.value,
                            })
                          }
                          placeholder="Yes"
                        />
                      </label>
                      <label>
                        Officer authority basis
                        <input
                          value={attestation.officerAuthorityBasis}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              officerAuthorityBasis: event.target.value,
                            })
                          }
                          placeholder="Credential, rule, order, or stipulation"
                        />
                      </label>
                      {projection.creationMode === "existing_recording" && (
                        <label>
                          Verification source
                          <select
                            value={attestation.verificationSource}
                            onChange={(event) =>
                              setAttestation({
                                ...attestation,
                                verificationSource: event.target.value,
                              })
                            }
                          >
                            <option value="">Choose…</option>
                            <option value="AUDIO_VIDEO_TIMESTAMP">
                              Audio/video timestamp
                            </option>
                            <option value="REPORTER_SHORTHAND_NOTES">
                              Reporter shorthand notes
                            </option>
                            <option value="OFFICIAL_LOG_SHEET">
                              Official log sheet
                            </option>
                            <option value="OTHER">
                              Other documented source
                            </option>
                          </select>
                        </label>
                      )}
                      <label>
                        Source anchor
                        <input
                          value={attestation.sourceAnchor}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              sourceAnchor: event.target.value,
                            })
                          }
                          placeholder={attestation.verificationSource === "AUDIO_VIDEO_TIMESTAMP" ? "upload-id@seconds" : "Exhibit, shorthand note, or transcript page/line"}
                        />
                        {attestation.verificationSource === "AUDIO_VIDEO_TIMESTAMP" && (
                          <small className="field-help">
                            Uploaded media: {(projection.mediaSources ?? []).length
                              ? projection.mediaSources!.map((item) => `${item.name} (${item.uploadId})`).join(", ")
                              : "none attached"}. Enter its upload ID, @, then seconds.
                          </small>
                        )}
                      </label>
                      <label>
                        Witness city
                        <input
                          value={attestation.city}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              city: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Witness county
                        <input
                          value={attestation.county}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              county: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Witness state
                        <input
                          value={attestation.state}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              state: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Witness country
                        <input
                          value={attestation.country}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              country: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="wide">
                        Basis / justification
                        <textarea
                          value={attestation.justification}
                          onChange={(event) =>
                            setAttestation({
                              ...attestation,
                              justification: event.target.value,
                            })
                          }
                        />
                      </label>
                      {state.oathAttestation && (
                        <label className="wide">
                          Reason for correction
                          <textarea
                            value={attestation.correctionReason}
                            onChange={(event) =>
                              setAttestation({
                                ...attestation,
                                correctionReason: event.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        busy ||
                        state.witnessOathSelection === "UNRESOLVED" ||
                        !attestation.spokenText.trim() ||
                        !attestation.response.trim() ||
                        !attestation.justification.trim() ||
                        (projection.creationMode === "existing_recording" &&
                          (!attestation.verificationSource || !attestation.sourceAnchor.trim())) ||
                        (Boolean(state.oathAttestation) && !attestation.correctionReason.trim())
                      }
                      onClick={() => void recordStructuredAttestation()}
                    >
                      {state.oathAttestation
                        ? "Record corrected attestation"
                        : "Record oath administration"}
                    </button>
                  </section>
                )}
                {(!interactive || step === 6) && (
                  <section className="opening-audit-card">
                    <h3>Closing-the-record attestation</h3>
                    <p>Record the exact closing statement separately from the reading aid. A source anchor and evidentiary basis are required.</p>
                    {state.closingAttestation && <p className="attestation-recorded"><strong>Recorded:</strong> closing statement at {state.closingAttestation.occurredAt}.</p>}
                    <div className="attestation-grid">
                      <label className="wide">Exact closing statement<textarea value={closingProof.spokenText} onChange={(event) => setClosingProof({ ...closingProof, spokenText: event.target.value })} /></label>
                      <label>Time completed<input type="datetime-local" value={closingProof.occurredAt} onChange={(event) => setClosingProof({ ...closingProof, occurredAt: event.target.value })} /></label>
                      <label>Media or transcript source<input value={closingProof.sourceAnchor} onChange={(event) => setClosingProof({ ...closingProof, sourceAnchor: event.target.value })} placeholder="For example: media 01:14:22" /></label>
                      <label className="wide">Basis / verification note<textarea value={closingProof.basis} onChange={(event) => setClosingProof({ ...closingProof, basis: event.target.value })} /></label>
                    </div>
                    <button type="button" className="primary-button" disabled={busy || !closingProof.spokenText.trim() || !closingProof.sourceAnchor.trim() || !closingProof.basis.trim()} onClick={() => void recordProtectedAttestation("closing", closingProof)}>Record closing attestation</button>
                  </section>
                )}
                <div className="opening-scripts">
                  {visible.map((item) => (
                    <details
                      key={item.id}
                      open={expandAll || interactive || undefined}
                    >
                      <summary>
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {item.classification
                              .replaceAll("_", " ")
                              .toLowerCase()}
                          </small>
                        </span>
                        <b>
                          {item.completedOnRecord
                            ? "Completed on record"
                            : item.available === false
                              ? "Source required"
                              : item.missing.length
                                ? "Needs information"
                                : "Ready"}
                        </b>
                      </summary>
                      <p className="opening-when">{item.whenToUse}</p>
                      {item.expectedSource && (
                        <p className="opening-when">
                          <strong>Authority:</strong> {item.expectedSource}
                        </p>
                      )}
                      {item.missing.length > 0 && (
                        <p className="opening-warning">
                          Missing: {item.missing.join(", ")}
                        </p>
                      )}
                      <blockquote>{item.text}</blockquote>
                      <div className="opening-script-actions">
                        <button
                          type="button"
                          disabled={item.available === false}
                          onClick={() =>
                            void navigator.clipboard.writeText(item.text)
                          }
                        >
                          Copy spoken text
                        </button>
                        <label>
                          <input
                            type="checkbox"
                            checked={item.completedOnRecord}
                            disabled={busy || item.available === false}
                            onChange={(event) =>
                              void updateScript(item.id, {
                                completedOnRecord: event.target.checked,
                              })
                            }
                          />{" "}
                          Completed on record
                        </label>
                      </div>
                      <label className="opening-note">
                        Reporter note
                        <textarea
                          defaultValue={item.note}
                          onBlur={(event) => {
                            if (event.target.value !== item.note)
                              void updateScript(item.id, {
                                note: event.target.value,
                              });
                          }}
                          placeholder="Optional operational note; not transcript testimony."
                        />
                      </label>
                    </details>
                  ))}
                </div>
                {interactive && (
                  <div className="opening-guide-nav">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={step === 0 || busy}
                      onClick={() =>
                        void save({ ...state, currentGuideStep: step - 1 })
                      }
                    >
                      Previous
                    </button>
                          <span>Step {step + 1} of 7</span>
                    <button
                      type="button"
                      className="primary-button"
                            disabled={step === 6 || busy}
                      onClick={() =>
                        void save({ ...state, currentGuideStep: step + 1 })
                      }
                    >
                      Next step
                    </button>
                  </div>
                )}
              </section>
            );
          })()}
        <aside className="opening-workflow-status" aria-live="polite">
          <div>
            <strong>
              {projection.workflowStage.replaceAll("_", " ").toLowerCase()}
            </strong>
            <span>
              {projection.canStartExamination
                ? "Ready to begin examination on the record"
                : projection.creationMode === "live" &&
                    projection.canStartRecording
                  ? "Pre-record checks complete; recording may begin"
                  : "Resolve the listed items before advancing"}
            </span>
          </div>
          {projection.blockers.length > 0 && (
            <details>
              <summary>
                {projection.blockers.length} unresolved requirement
                {projection.blockers.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {projection.blockers.map((item) => (
                  <li key={item.code}>{item.message}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>
        <footer className="opening-footer">
          <button className="secondary-button" onClick={onBack}>
            Back to Workspace
          </button>
          <div>
            <span>
              {projection.completeCount === projection.totalCount
                ? "Opening readiness complete"
                : `${projection.totalCount - projection.completeCount} readiness item${projection.totalCount - projection.completeCount === 1 ? "" : "s"} unresolved`}
            </span>
            <button
              className="primary-button"
              disabled={
                projection.creationMode === "live" &&
                !projection.canStartRecording
              }
              title={
                projection.creationMode === "live" &&
                !projection.canStartRecording
                  ? "Complete the pre-record requirements first"
                  : undefined
              }
              onClick={onContinue}
            >
              {projection.creationMode === "live"
                ? "Continue to Live Recording"
                : "Continue to Transcript Workspace"}
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
