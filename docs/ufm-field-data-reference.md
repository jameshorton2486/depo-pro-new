# UFM insertion-page audit and field reference

Audited against the executable repository on 2026-08-31. This document describes the current
Texas insertion-page path, not a proposed mail merge and not the OneDrive-adjacent copy.

## Outcome

The title, appearance, index, changes/signature, and certification pages are projections of one
Canonical Deposition Data Record. Reporter-attested certificate answers and workflow-produced
dates have separate writers and provenance. A required field that would leave a certified clause
incomplete blocks generation; the renderer is no longer allowed to delete the line and close the
surrounding prose around the omission.

## Certified workflow fields

| Template field | Canonical field | Writer | Provenance | Required when |
| --- | --- | --- | --- | --- |
| `cert.submissionDate` | `signature.submittedToWitnessDate` | certificate workflow | `WORKFLOW_DERIVED` | signature requested |
| `cert.returnDeadline` | `signature.dueDate` | certificate workflow | `WORKFLOW_DERIVED` | signature requested |
| `cert.serviceDate` | `certification.serviceDate` | certificate workflow | `WORKFLOW_DERIVED` | every Texas certificate |
| `cert.returnStatus` | `signature.returnedDate` | reporter certificate form | `REPORTER_ENTERED` | signature requested |
| `cert.certificationDate` | `certification.certificationDate` | reporter certificate form | `REPORTER_ENTERED` | every Texas certificate |
| `cert.furtherCertificationDate` | `certification.furtherCertificationDate` | reporter certificate form | `REPORTER_ENTERED` | signature requested |

The workflow API accepts strict `YYYY-MM-DD` calendar dates. Certified output projects every ISO
date in the table, the deposition date, and the CSR expiration date as `Month D, YYYY`. Legacy
non-ISO values remain visible rather than being silently guessed or discarded.

## Fail-closed rules implemented

1. `cert.submissionDate`, `cert.returnDeadline`, and `cert.serviceDate` are no longer intentional
   blanks. If an applicable event is missing, `UNEXPECTED_BLANK` blocks the document.
2. The New/Certification screen loads and saves the three workflow dates separately from the
   reporter's certificate answers, so their provenance cannot be conflated.
3. Caption rows that cannot preserve the UFM delimiter column within 63 characters produce a
   blocking `CAPTION_ROW_OVERFLOW`. They are not passed to the generic prose wrapper, which used
   to collapse the caption's alignment.
4. The complete-transcript model, insertion-page preview, standalone Word output, and full Word
   output share the same page builder and therefore the same checks.

## Rendering behavior verified

- Normal captions keep one aligned `)` column.
- Excess-width captions are refused and identify both affected page roles.
- Requested certificates may expand across more than one physical 25-line page when the complete
  reviewed prose and populated dates require it.
- Every produced page retains 25 numbered positions and a 63-character content limit.
- A production-length qualification fixture (1,602 segments, 45,007 words) completed through
  DOCX generation with the shared geometry intact.

## Remaining limitations

- Federal insertion-page variants remain unavailable and fail closed. This change does not claim
  that Texas UFM pages are appropriate for a federal deposition.
- An overlong caption is blocked rather than automatically redesigned. A future implementation
  may add a reviewed multi-line caption layout, but it must preserve the delimiter column and be
  qualified against the source figures before replacing the block.
- The workflow screen records one date for the combined source clause stating that the certificate
  was served on all parties and filed with the clerk. The UI labels that combined event explicitly;
  it does not independently model recipient-by-recipient service evidence.

## Verification

Focused UFM and workflow tests pass. The full suite reports 1,060 passing, 11 skipped, and one
environmental failure when the development API already owns `127.0.0.1:4317`; that isolation test
passes only when no server is bound to the port. Type checking, lint, and build are run separately
so this port condition cannot short-circuit them.
