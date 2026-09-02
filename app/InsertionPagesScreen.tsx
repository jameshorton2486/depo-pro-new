"use client";

import { useEffect, useState } from "react";

import { LOCAL_API_BASE_URL as API } from "./api-client";

type Finding = {
  code: string;
  target: string;
  severity: "blocking" | "warning";
  message: string;
};
type RenderedLine = { line: number; text: string };
type RenderedPage = {
  id: string;
  role: string;
  pageNumber?: number | null;
  lines: RenderedLine[];
};
type RenderingSpec = { sha256?: string; pages?: RenderedPage[] };
type Preview = {
  variant: string;
  findings: Finding[];
  renderingSpec: RenderingSpec;
  workspaceDocument?: unknown;
};
type Artifact = {
  outputPath: string;
  bytes: number;
  mode: string;
  variant: string;
  findings: Finding[];
  pageSetSha256: string;
  renderingSpecSha256: string;
  renderingSpecPath: string;
};
type Deposition = {
  id: string;
  caseStyle: string;
  witness: string;
  depositionDate: string;
  courtReporterName: string;
};
type AttorneyTime = { name: string; minutes: string };
type CatalogVariant = {
  variant: string;
  available: boolean;
  reviewStatus: string;
  roles: string[];
  sourceFigures: number[];
  blockedBy: string[];
  approval?: { state?: string } | null;
};

const JURISDICTIONS = [
  { value: "texas-state", label: "Texas state court" },
  { value: "federal", label: "Federal court" },
] as const;

const signatureChoices = (jurisdiction: string) =>
  jurisdiction === "texas-state"
    ? [
        {
          value: "requested",
          label: "Present for examination and signature",
          hint: "Texas Rule 203.1 default unless the witness and all parties waived or another rule exception applies.",
        },
        {
          value: "waived",
          label: "Presentment waived or excepted",
          hint: "Record the waiver by the witness and all parties, or the specific Rule 203.1 exception.",
        },
      ]
    : [
        {
          value: "requested",
          label: "Rule 30(e) review requested",
          hint: "The deponent or a party requested review before the deposition was completed.",
        },
        {
          value: "waived",
          label: "No Rule 30(e) review requested",
          hint: "No timely request was made; silence is not recorded as an affirmative waiver.",
        },
      ];

// The certificate facts only a reporter can supply. Labelled with the sentence each one completes,
// because a reporter answering "charges billed to" needs to know it prints inside "charges to the
// ___ for preparing the original deposition transcript".
//
// Reporter-attested certificate facts stay separate from the workflow event dates below. That
// keeps the provenance honest: typing a certificate answer cannot masquerade as a system event.
const CERTIFICATE_FIELDS = [
  {
    key: "custodialAttorney",
    label: "Custodial attorney",
    clause: "The original deposition was delivered to ___",
    requestedOnly: false,
  },
  {
    key: "officerCharges",
    label: "Deposition officer's charges (amount only)",
    clause: "That $___ is the deposition officer's charges",
    requestedOnly: false,
  },
  {
    key: "chargesResponsibleParty",
    label: "Charges billed to",
    clause: "charges to the ___ for preparing the original transcript",
    requestedOnly: false,
  },
  {
    key: "certificationDate",
    label: "Certification date",
    clause: "Certified to by me this ___ (certificate page)",
    requestedOnly: false,
    inputType: "date",
  },
  {
    key: "returnedDate",
    label: "Transcript returned on",
    clause: "returned to the deposition officer on ___",
    requestedOnly: true,
    inputType: "date",
  },
  {
    key: "furtherCertificationDate",
    label: "Further certification date",
    clause:
      "Certified to by me this ___ (Rule 203 page, after return and service)",
    requestedOnly: true,
    inputType: "date",
  },
] as const;

type CertificateKey = (typeof CERTIFICATE_FIELDS)[number]["key"];
const EMPTY_CERTIFICATE = Object.fromEntries(
  CERTIFICATE_FIELDS.map((item) => [item.key, ""]),
) as Record<CertificateKey, string>;
type CertificateWorkflow = {
  submissionDate: string;
  returnDeadline: string;
  serviceDate: string;
};
const EMPTY_WORKFLOW: CertificateWorkflow = {
  submissionDate: "",
  returnDeadline: "",
  serviceDate: "",
};
function dateInputValue(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? ""
    : `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

export default function InsertionPagesScreen({
  deposition,
  onBack,
}: {
  deposition: Deposition;
  onBack: () => void;
}) {
  const [jurisdiction, setJurisdiction] = useState<string>("texas-state");
  const [signatureDisposition, setSignatureDisposition] = useState<string>("");
  const [basis, setBasis] = useState("");
  const [mode, setMode] = useState<"standalone" | "full">("standalone");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [certificate, setCertificate] =
    useState<Record<CertificateKey, string>>(EMPTY_CERTIFICATE);
  const [certificateWorkflow, setCertificateWorkflow] =
    useState<CertificateWorkflow>(EMPTY_WORKFLOW);
  const [attorneyTime, setAttorneyTime] = useState<AttorneyTime[]>([]);
  const [videographers, setVideographers] = useState<
    Array<{ id?: string; fullName: string }>
  >([]);
  const [catalog, setCatalog] = useState<CatalogVariant[]>([]);
  // What is already on the record, before the reporter can overwrite it.
  //
  // This screen used to start at EMPTY_CERTIFICATE and never read. runPreview posts the whole
  // certificate, and the route rewrites every field it owns -- so Preview on a form that always
  // looked blank erased certificate values already stored, silently, on certified content. The
  // route is right: a merge-only save would mean a value entered by mistake could never be
  // cleared. The screen was wrong to overwrite what it had never shown.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [
          certResponse,
          workflowResponse,
          timeResponse,
          videographerResponse,
          catalogResponse,
        ] = await Promise.all([
          fetch(
            `${API}/api/deposition/certification?depositionId=${encodeURIComponent(deposition.id)}`,
          ),
          fetch(
            `${API}/api/deposition/certificate-workflow?depositionId=${encodeURIComponent(deposition.id)}`,
          ),
          fetch(
            `${API}/api/deposition/attorney-time?depositionId=${encodeURIComponent(deposition.id)}`,
          ),
          fetch(
            `${API}/api/deposition/videographers?depositionId=${encodeURIComponent(deposition.id)}`,
          ),
          fetch(`${API}/api/insertion-pages/catalog`),
        ]);
        if (cancelled) return;
        if (certResponse.ok) {
          const body = (await certResponse.json()) as {
            certification?: Partial<Record<CertificateKey, string>>;
          };
          if (body.certification)
            setCertificate((current) => ({
              ...current,
              ...body.certification,
              certificationDate: dateInputValue(
                body.certification?.certificationDate ?? "",
              ),
              returnedDate: dateInputValue(
                body.certification?.returnedDate ?? "",
              ),
              furtherCertificationDate: dateInputValue(
                body.certification?.furtherCertificationDate ?? "",
              ),
            }));
        }
        if (workflowResponse.ok) {
          const body = (await workflowResponse.json()) as {
            workflow?: Partial<CertificateWorkflow>;
          };
          if (body.workflow)
            setCertificateWorkflow((current) => ({
              ...current,
              ...body.workflow,
            }));
        }
        if (timeResponse.ok) {
          const body = (await timeResponse.json()) as {
            attorneyTime?: Array<{ name: string; minutes: number | null }>;
          };
          setAttorneyTime(
            (body.attorneyTime ?? []).map((item) => ({
              name: item.name,
              minutes: item.minutes == null ? "" : String(item.minutes),
            })),
          );
        }
        if (videographerResponse.ok)
          setVideographers(
            (
              (await videographerResponse.json()) as {
                videographers?: Array<{ id?: string; fullName: string }>;
              }
            ).videographers ?? [],
          );
        if (catalogResponse.ok)
          setCatalog(
            ((await catalogResponse.json()) as { variants?: CatalogVariant[] })
              .variants ?? [],
          );
      } catch {
        /* an unreachable API leaves the form as it was; Preview still refuses on its own findings */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deposition.id]);
  const [message, setMessage] = useState(
    "Choose the jurisdiction and signature disposition to preview the certification pages.",
  );

  const findings = artifact?.findings ?? preview?.findings ?? [];
  const blocking = findings.filter(
    (finding) => finding.severity === "blocking",
  );
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const ready = Boolean(jurisdiction && signatureDisposition && basis.trim());

  function request() {
    return {
      depositionId: deposition.id,
      mode,
      operator: {
        jurisdiction,
        signatureDisposition,
        signatureDispositionBasis: basis.trim() || null,
      },
    };
  }

  async function post(path: string, payload: unknown = request()) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        body.error || `Request failed with status ${response.status}.`,
      );
    return body;
  }

  async function runPreview() {
    setBusy(true);
    setArtifact(null);
    setMessage("Assembling the certification pages…");
    try {
      // Saved first, and to the record rather than into the render request: the certificate values
      // have to arrive carrying REPORTER_ENTERED provenance, and a field left alone is recorded
      // MISSING rather than as an empty string somebody could mistake for an answer.
      await post("/api/deposition/certification", {
        depositionId: deposition.id,
        certification: certificate,
      });
      await post("/api/deposition/certificate-workflow", {
        depositionId: deposition.id,
        workflow: certificateWorkflow,
      });
      await post("/api/deposition/attorney-time", {
        depositionId: deposition.id,
        attorneyTime: attorneyTime.map((item) => ({
          name: item.name,
          minutes: item.minutes,
        })),
      });
      // A row the reporter added and never filled in is not a videographer. The store refuses a
      // nameless one -- correctly -- so sending it unfiltered made Add videographer followed by
      // Preview fail outright, with the only remedy being to find and remove the empty row.
      await post("/api/deposition/videographers", {
        depositionId: deposition.id,
        videographers: videographers.filter((person) => person.fullName.trim()),
      });
      const body = (await post(
        "/api/insertion-pages/rendering-spec",
      )) as Preview;
      setPreview(body);
      const stops = (body.findings ?? []).filter(
        (finding) => finding.severity === "blocking",
      );
      setMessage(
        stops.length
          ? `${stops.length} blocking issue${stops.length === 1 ? "" : "s"} must be resolved before a document can be produced.`
          : `Ready to generate. Variant ${body.variant}.`,
      );
    } catch (error) {
      setPreview(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "The certification pages could not be assembled.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setMessage("Rendering the certification pages…");
    try {
      const body = (await post("/api/insertion-pages/docx")) as Artifact;
      setArtifact(body);
      setMessage(`Word document written to ${body.outputPath}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The Word document could not be rendered.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="insertion-screen">
      <div className="insertion-heading">
        <span className="eyebrow">CERTIFICATION PAGES</span>
        <h1>Insertion pages</h1>
        <p>
          {deposition.caseStyle} · {deposition.witness} ·{" "}
          {deposition.depositionDate}
        </p>
        <button type="button" className="secondary-button" onClick={onBack}>
          Back to deposition
        </button>
      </div>

      <section className="insertion-card">
        <h2>Certification variant</h2>
        <p className="insertion-help">
          The variant is chosen by jurisdiction and signature disposition only.
          Reporter credentials, location, and prior matters never participate in
          that selection.
        </p>

        <fieldset className="insertion-field">
          <legend>Jurisdiction</legend>
          {JURISDICTIONS.map((item) => (
            <label key={item.value} className="insertion-option">
              <input
                type="radio"
                name="jurisdiction"
                value={item.value}
                checked={jurisdiction === item.value}
                onChange={() => {
                  setJurisdiction(item.value);
                  setSignatureDisposition("");
                  setBasis("");
                  setPreview(null);
                  setArtifact(null);
                }}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="insertion-field">
          <legend>Time used by each examining party</legend>
          <p className="insertion-help">
            Enter whole minutes. These entries populate the certified time-used
            statement in the order shown.
          </p>
          {attorneyTime.map((item, index) => (
            <div className="insertion-time-row" key={index}>
              <input
                aria-label={`Party ${index + 1} name`}
                type="text"
                value={item.name}
                placeholder="Attorney or party"
                onChange={(event) =>
                  setAttorneyTime((current) =>
                    current.map((entry, row) =>
                      row === index
                        ? { ...entry, name: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <input
                aria-label={`Party ${index + 1} minutes`}
                type="number"
                min="0"
                step="1"
                value={item.minutes}
                placeholder="Minutes"
                onChange={(event) =>
                  setAttorneyTime((current) =>
                    current.map((entry, row) =>
                      row === index
                        ? { ...entry, minutes: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setAttorneyTime((current) =>
                    current.filter((_, row) => row !== index),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setAttorneyTime((current) => [
                ...current,
                { name: "", minutes: "" },
              ])
            }
          >
            Add party time
          </button>
        </fieldset>

        <fieldset className="insertion-field">
          <legend>Videographers appearing</legend>
          <p className="insertion-help">
            Required when the canonical record says the deposition was
            videotaped.
          </p>
          {videographers.map((person, index) => (
            <div className="insertion-time-row" key={person.id ?? index}>
              <input
                aria-label={`Videographer ${index + 1} name`}
                type="text"
                value={person.fullName}
                placeholder="Full name"
                onChange={(event) =>
                  setVideographers((current) =>
                    current.map((entry, row) =>
                      row === index
                        ? { ...entry, fullName: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <span />
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setVideographers((current) =>
                    current.filter((_, row) => row !== index),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setVideographers((current) => [...current, { fullName: "" }])
            }
          >
            Add videographer
          </button>
        </fieldset>

        <fieldset className="insertion-field">
          <legend>Signature disposition</legend>
          {signatureChoices(jurisdiction).map((item) => (
            <label key={item.value} className="insertion-option">
              <input
                type="radio"
                name="disposition"
                value={item.value}
                checked={signatureDisposition === item.value}
                onChange={() => {
                  setSignatureDisposition(item.value);
                  setPreview(null);
                  setArtifact(null);
                }}
              />
              <span>
                {item.label}
                <small>{item.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="insertion-field">
          <span>How the disposition was established</span>
          <input
            type="text"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
            placeholder="Stated on the record"
          />
          <small>
            {jurisdiction === "texas-state"
              ? "Identify the on-record waiver or Rule 203.1 exception; Texas presentment is otherwise the default."
              : "Identify who requested review and where it appears in the record, or state that no timely request was made."}
          </small>
        </label>

        <fieldset className="insertion-field">
          <legend>Reporter&apos;s certificate</legend>
          {CERTIFICATE_FIELDS.filter(
            (item) =>
              !item.requestedOnly || signatureDisposition === "requested",
          ).map((item) => (
            <label key={item.key} className="insertion-field">
              <span>{item.label}</span>
              <input
                type={"inputType" in item ? item.inputType : "text"}
                value={certificate[item.key]}
                onChange={(event) => {
                  setCertificate((current) => ({
                    ...current,
                    [item.key]: event.target.value,
                  }));
                  setPreview(null);
                  setArtifact(null);
                }}
              />
              <small>{item.clause}</small>
            </label>
          ))}
          <p className="insertion-message">
            Left blank, each of these blocks the certificate rather than
            printing a sentence with nothing after it.
          </p>
        </fieldset>

        <fieldset className="insertion-field">
          <legend>Certificate workflow events</legend>
          <p className="insertion-help">
            Record these only after the corresponding workflow event occurred.
            They are stored as workflow-derived facts and print in the
            certificate&apos;s date format.
          </p>
          {signatureDisposition === "requested" && (
            <>
              <label className="insertion-field">
                <span>Transcript submitted to witness or attorney</span>
                <input
                  type="date"
                  value={certificateWorkflow.submissionDate}
                  onChange={(event) => {
                    setCertificateWorkflow((current) => ({
                      ...current,
                      submissionDate: event.target.value,
                    }));
                    setPreview(null);
                    setArtifact(null);
                  }}
                />
                <small>
                  Completes “submitted on ___ to the witness or attorney.”
                </small>
              </label>
              <label className="insertion-field">
                <span>Witness return deadline</span>
                <input
                  type="date"
                  value={certificateWorkflow.returnDeadline}
                  onChange={(event) => {
                    setCertificateWorkflow((current) => ({
                      ...current,
                      returnDeadline: event.target.value,
                    }));
                    setPreview(null);
                    setArtifact(null);
                  }}
                />
                <small>Completes “returned to me by ___.”</small>
              </label>
            </>
          )}
          <label className="insertion-field">
            <span>Certificate served and filed</span>
            <input
              type="date"
              value={certificateWorkflow.serviceDate}
              onChange={(event) => {
                setCertificateWorkflow((current) => ({
                  ...current,
                  serviceDate: event.target.value,
                }));
                setPreview(null);
                setArtifact(null);
              }}
            />
            <small>
              Record the date the certificate was served on the parties and
              filed with the clerk.
            </small>
          </label>
          <p className="insertion-message">
            An applicable event left blank blocks generation; the renderer no
            longer deletes the clause and certifies around it.
          </p>
        </fieldset>

        <fieldset className="insertion-field">
          <legend>Document</legend>
          <label className="insertion-option">
            <input
              type="radio"
              name="mode"
              value="standalone"
              checked={mode === "standalone"}
              onChange={() => {
                setMode("standalone");
                setArtifact(null);
              }}
            />
            <span>
              Certification pages only
              <small>Produces the insertion pages as their own document.</small>
            </span>
          </label>
          <label className="insertion-option">
            <input
              type="radio"
              name="mode"
              value="full"
              checked={mode === "full"}
              onChange={() => {
                setMode("full");
                setArtifact(null);
              }}
            />
            <span>
              Transcript with certification pages
              <small>
                Uses the complete transcript prepared in the Workspace so its
                page numbers remain authoritative.
              </small>
            </span>
          </label>
        </fieldset>

        <div className="insertion-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!ready || busy}
            onClick={runPreview}
          >
            {busy && !artifact ? "Working…" : "Preview certification pages"}
          </button>
          <button
            type="button"
            className="audio-save-button"
            disabled={!preview || blocking.length > 0 || busy}
            onClick={generate}
          >
            Generate certification pages
          </button>
          {/* This screen has no transcript behind it and therefore no authoritative pagination, so
              what it produces carries no index. The full document is generated in the Workspace,
              from the complete-transcript model that owns the page numbers -- this hands the
              reporter there rather than rendering a second, thinner document that looks like one. */}
          <button
            type="button"
            className="secondary-button"
            onClick={onBack}
            title="The full transcript is generated in the Workspace, where the page numbering is authoritative."
          >
            Full transcript: generate in the Workspace
          </button>
        </div>
        <p className="insertion-message">{message}</p>
      </section>

      {preview && (
        <section className="insertion-card">
          <h2>Assembled</h2>
          <dl className="insertion-facts">
            <div>
              <dt>Variant</dt>
              <dd>{preview.variant}</dd>
            </div>
            <div>
              <dt>Pages</dt>
              <dd>{preview.renderingSpec?.pages?.length ?? 0}</dd>
            </div>
            <div>
              <dt>Rendering spec</dt>
              <dd className="insertion-hash">
                {preview.renderingSpec?.sha256 ?? "—"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {preview?.renderingSpec.pages && (
        <section className="insertion-card">
          <h2>Page preview</h2>
          <p className="insertion-help">
            This is the exact shared 25-line rendering model used for Word
            output.
          </p>
          <div className="insertion-page-grid">
            {preview.renderingSpec.pages.map((page) => (
              <article className="insertion-page" key={page.id}>
                <header>
                  {page.role.replaceAll("-", " ")}{" "}
                  {page.pageNumber ? `· page ${page.pageNumber}` : ""}
                </header>
                <ol>
                  {page.lines.map((line) => (
                    <li key={line.line}>
                      <span>{line.text || "\u00a0"}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      )}

      {catalog.length > 0 && (
        <section className="insertion-card">
          <h2>UFM template catalog</h2>
          <p className="insertion-help">
            Each variant contains several coordinated page templates.
            Availability is fail-closed when source figures or approval are
            missing.
          </p>
          <div className="insertion-catalog">
            {catalog.map((item) => (
              <article key={item.variant}>
                <h3>{item.variant.replaceAll("_", " ")}</h3>
                <p>
                  <strong>{item.available ? "Available" : "Blocked"}</strong> ·{" "}
                  {item.reviewStatus} · approval{" "}
                  {item.approval?.state ?? "not recorded"}
                </p>
                <p>
                  {item.roles.length
                    ? item.roles.join(", ")
                    : "No renderable page roles installed."}
                </p>
                {item.sourceFigures.length > 0 && (
                  <p>Source figures: {item.sourceFigures.join(", ")}</p>
                )}
                {item.blockedBy.length > 0 && (
                  <ul>
                    {item.blockedBy.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {blocking.length > 0 && (
        <section className="insertion-card insertion-blocking">
          <h2>Blocking — no document will be produced</h2>
          <ul>
            {blocking.map((finding) => (
              <li key={`${finding.code}:${finding.target}`}>
                <strong>{finding.code}</strong> <span>{finding.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="insertion-card insertion-warning">
          <h2>Review before certifying</h2>
          <ul>
            {warnings.map((finding) => (
              <li key={`${finding.code}:${finding.target}`}>
                <strong>{finding.code}</strong> <span>{finding.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {artifact && (
        <section className="insertion-card">
          <h2>Document produced</h2>
          <dl className="insertion-facts">
            <div>
              <dt>File</dt>
              <dd>{artifact.outputPath}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{artifact.bytes.toLocaleString()} bytes</dd>
            </div>
            <div>
              <dt>Variant</dt>
              <dd>{artifact.variant}</dd>
            </div>
            <div>
              <dt>Page set</dt>
              <dd className="insertion-hash">{artifact.pageSetSha256}</dd>
            </div>
            <div>
              <dt>Rendering spec</dt>
              <dd className="insertion-hash">{artifact.renderingSpecSha256}</dd>
            </div>
          </dl>
          <p className="insertion-help">
            Both hashes identify exactly this document. Regenerating from the
            same canonical record and the same variant reproduces them.
          </p>
        </section>
      )}
    </main>
  );
}
