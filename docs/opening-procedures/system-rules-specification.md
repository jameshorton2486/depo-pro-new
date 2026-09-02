# DepoPro Opening Procedures — System Rules Specification

**Status:** Draft — legal and template authority not independently verified  
**Specification version:** 0.1.0  
**Recorded:** 2026-09-02  
**Scope:** Deposition commencement, appearances, stipulations, oath or affirmation, attestation, and examination commencement

## 1. Authority boundary

This document records product and workflow decisions supplied for implementation. It is not itself legal approval of spoken wording, certification text, or a template. A citation identifies a source to review; it does not establish that the proposed language accurately reflects that source.

No spoken script may be classified as approved or allowed to satisfy a legal-language readiness gate until the exact text, source edition, source location, approving authority, approver, approval date, and content digest are recorded. Unverified language must remain visibly classified as unverified and must fail closed wherever a certified output would rely on it.

## 2. Interface architecture

The existing **Scripts & Oaths** tab remains. It contains two modes:

1. **Interactive Guide** — a six-step sequence for ordinary commencement.
2. **Quick Reference** — independently accessible script cards for non-linear situations, including a late-arriving interpreter.

The guide is a read-aloud and preparation aid. Copying text and recording that an act occurred are separate actions. Neither copying nor completing a guide step writes template prose into the working transcript.

The six guide steps are:

1. Opening the record
2. Preliminary instructions and witness admonitions
3. Verbal stipulations
4. Interpreter oath, when applicable
5. Witness oath or affirmation and attestation
6. Examination commencement

## 3. Script classifications proposed for authority review

| Script | Proposed classification | Cited source requiring verification | Verbatim status proposed |
|---|---|---|---|
| Texas opening | Required in substance | TRCP 199.5(b) | Flexible wording |
| Federal opening | Required in substance | FRCP 30(b)(5)(A) | Flexible wording |
| Preliminary instructions | Customary | Morson's English Guide, cited Rules 120 and 133 | Flexible wording |
| Texas stipulations | Customary agreement of counsel | TRCP 191.1 | Must reflect the actual agreement |
| Federal stipulations | Customary agreement of counsel | FRCP 29 and 30(e) | Must reflect the actual agreement |
| Texas interpreter oath | Proposed prescribed wording | Texas UFM, cited §3.11 / Figure 17 | Exact source text required before approval |
| Federal interpreter oath | Required in substance | FRE 604 | Flexible wording |
| Witness oath | Required in substance | TRE 603, FRE 603, and cited TRCP 203.2(b) | Flexible wording |
| Witness affirmation | Required in substance | Texas Constitution art. I §5 and 1 U.S.C. §1, as cited | Exact legal conclusion and wording require review |

The descriptions above are proposed classifications, not verified legal conclusions.

## 4. Canonical jurisdiction rules

- Jurisdiction is an explicit selection: Texas state or federal.
- Federal matters use the complete canonical court name, district, and division. A generic “United States District Court” value is insufficient for final output.
- Selecting a jurisdiction never silently rewrites extracted court facts.
- A conflict between the selected jurisdiction and canonical caption creates a persistent, high-priority warning during a live proceeding.
- The reporter may continue the live workflow despite the conflict.
- Complete transcript generation and certification remain blocked until the conflict is resolved.

## 5. Stipulation rules

- The application does not infer “So stipulated.”
- Each attorney of record receives an explicit response state: `ACCEPTED`, `REJECTED`, `MODIFIED`, or `UNRESOLVED`.
- No default response is an answer.
- A modified stipulation requires the exact agreed language and attribution supported by the record.
- Modified language is transcript evidence, not template-generated prose. It may reach a Type 3 colloquy paragraph only through recorded audio, shorthand notes, or another authorized transcript-evidence path.
- The preparation record may describe the agreement state but may not create testimony or colloquy.

## 6. Oath and affirmation selection

- Oath and affirmation are separate reporter selections.
- Selecting one does not prove that it was administered.
- The selected wording must have an approved, digest-bound template before Copy or Completed controls are enabled.
- If an approved alternative certificate is unavailable for the facts recorded, certification fails closed.

## 7. Oath attestation record

Attestation describes what occurred; it is separate from script selection and from transcript text.

### 7.1 Live attestation

The reporter records the act through an explicit **Record oath administered** action. The system captures the event time automatically. Required facts are:

- oath or affirmation;
- administering officer identity;
- officer role;
- officer credential, when applicable;
- credential issuing jurisdiction, when applicable;
- time administered;
- witness physical location when the proceeding is remote;
- attestation basis or justification; and
- actor and audit timestamp.

Changing an automatically captured time creates a correction event rather than overwriting history. The correction requires a reason such as shorthand-note reconstruction or audio-timeline correction.

### 7.2 Retrospective attestation

For an existing recording, opening time and oath time are entered manually. Each requires an explicit verification source:

- audio/video timestamp;
- reporter shorthand notes;
- official log sheet; or
- another named source, requiring an explanation.

A retrospective entry is never labeled system-captured.

### 7.3 No contemporaneous click

The proposed workflow permits certification based on the reporter's personal knowledge only after the reporter expressly records:

- a confirming statement that the reporter administered the oath or affirmation directly to the deponent on the record;
- the basis used to verify the witness's identity; and
- the deponent's physical location for a remote proceeding.

This rule remains **pending legal and template review**. It must not unlock a certificate until the applicable certificate wording and authority are approved.

## 8. Administering officer

Supported roles are:

- court reporter / CSR;
- notary;
- judge; and
- other authorized officer.

When someone other than the certifying reporter administered the oath, the system records that person's name, role, credentials, and issuing jurisdiction. The application must not use a “sworn by me” certificate unless the certifying reporter is also the recorded administering officer. Any “sworn by another” certificate variant remains unavailable until its exact template and authority are approved.

## 9. Witness physical location

Remote proceedings require a structured witness location:

- city;
- county;
- state or province;
- country.

For an in-person proceeding these fields are optional unless required by the selected approved template. Free text may be retained as a display detail, but final template interpolation uses structured fields.

## 10. Examination commencement

- The examining attorney is selected from the canonical participant roster by stable identifier.
- The attorney record carries an honorific and preferred transcript name.
- The application never assumes `MR.` or derives gender from a name.
- Missing honorific or preferred transcript identity blocks final examination-heading generation and names the corrective action.
- Examination commencement template text does not become transcript evidence until supported by the recorded proceeding.

## 11. Preview and pagination

- The live monospaced panel is labeled **Illustrative preview — not authoritative pagination**.
- A 1–25 gutter may be shown as a visual aid only.
- The preview does not create page, line, or transcript authority.
- Authoritative pagination is produced only by the shared final DOCX/PDF rendering model.

## 12. JSON and pipeline boundary

Job configuration JSON is an administrative/debugging and pipeline-handoff artifact, not an ordinary reporter-facing export. It may be consumed by controlled document-generation and review stages. It must be schema-versioned, validated, auditable, and free of secrets.

The browser records administrative facts and event evidence. It does not construct transcript pages, certify unsupported facts, or write prepared script text into the transcript.

## 13. Minimum audit-event requirements

Every material write records:

- event identifier;
- deposition identifier;
- schema version;
- event type;
- actor identifier and displayed name;
- event time;
- effective value;
- value source;
- correction reason when replacing a prior assertion; and
- prior-event reference when applicable.

Material events include jurisdiction selection, jurisdiction-conflict acknowledgment, script approval selection, stipulation response, oath selection, oath administration, retrospective attestation, attestation correction, and certification refusal or release.

## 14. Fail-closed rules

The application refuses final compilation when any of the following applies:

- jurisdiction conflicts with the canonical court;
- required script wording is unapproved or stale;
- a rendered script contains an unresolved token;
- stipulation status required by the selected workflow is unresolved;
- the recorded oath facts conflict with the selected certificate;
- another officer administered the oath but no approved matching certificate exists;
- required remote witness location is incomplete;
- examination identity or honorific is unresolved; or
- the prepared text would be the only evidence that an event occurred.

Live recording itself is not blocked by these administrative conflicts. The reporter receives a persistent warning, and the final output remains blocked.

## 15. Model work authorized after specification review

The next model revision should define, at minimum:

- structured jurisdiction and federal court identity;
- structured witness physical location;
- attorney honorific and preferred transcript identity;
- per-attorney stipulation response and modification evidence;
- administering-officer identity, role, credential, and jurisdiction;
- immutable oath-attestation and correction events;
- verification source for retrospective times;
- script authority, approval metadata, and content digest; and
- certification compatibility and refusal findings.

No schema migration is authorized merely by recording this draft. Model implementation begins after the draft's legal-authority matrix and certificate consequences are reviewed and accepted.

## 16. Outstanding authority questions

1. What exact source edition and page or figure supplies each proposed script?
2. Who has authority to approve each exact script for production use?
3. Is the proposed personal-knowledge certification rule valid for every supported proceeding type?
4. Which approved certificate text applies when another officer administered the oath?
5. Is the proposed affirmation substance, including any reference to penalties of perjury, required or merely customary in each jurisdiction?
6. Which location fields are legally required for each remote-deposition authority in scope?

