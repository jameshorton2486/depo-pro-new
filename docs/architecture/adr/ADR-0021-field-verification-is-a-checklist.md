# ADR-0021 — A field verification is a checklist tick, not an attestation

**File:** docs/architecture/adr/ADR-0021-field-verification-is-a-checklist.md
**Status:** RATIFIED
**Date:** 2026-08-24
**Related:** the canonical correction log (`who`/`why` required); `insertion-pages/layout-profile.mjs`
(`verifiedBy` + `verifiedAt` required)

---

## Context

`state.verifiedFields` in `server/opening-procedures.mjs` is a `path -> true` map. `cleanMap`
reduces it to exactly that: keys matching `/^[a-zA-Z0-9_.-]+$/` whose value is literally `true`.
It records no `who` and no per-field `at`. The only timestamp in the file is a document-level
`updatedAt` rewritten on every save, so it cannot say when any particular field was ticked.

Two other places in this codebase model "someone attested to this", and both carry provenance:

| Record | Shape | Enforcement |
|---|---|---|
| Correction log | `path, from, to, who, why, at` | `who` and `why` required; hash-chained |
| Layout profile | `verifiedBy`, `verifiedAt` | not verified unless **both** are set |
| **Opening verification** | **`path -> true`** | **none** |

That contrast makes the bare boolean read as an oversight. It was raised as one, twice.

## Evidence

The question is entirely whether a verification can reach an output a court could be asked to
rest on. It was settled by observing behaviour, not by reading imports.

**1 — Where the value lands.** A save with a uniquely-identifiable key, then every file under the
storage root read back:

| File | Contains the verification |
|---|---|
| `deposition.json` | no — and contains no `verified` at all |
| `intake/canonical-deposition-record.json` | no — and contains no `verified` at all |
| `workflow/opening-procedures.json` | yes |

One file of three. The save created no others.

**2 — Who reads it.** Three production call sites, all in `server/local-api.mjs`, all serving
`GET`/`POST /api/opening`. No other module in the repository reads `getOpeningProjection`,
`readOpeningState`, or the path `opening-procedures.json`.

**3 — Whether the certified render can reach it.** `prepareInsertionRenderingArtifact` resolves the
deposition directory, so `workflow/` is within its reach and the question is not answerable from
the module graph. It was run with the workflow file overwritten by unparseable bytes and with
`readFileSync`, `existsSync`, `fs.readFile` and `fs.promises.readFile` all instrumented. Every file
it touched inside the deposition:

    exists  deposition.json                                (directory resolution)
    sync    deposition.json
    exists  intake/canonical-deposition-record.json
    sync    intake/canonical-deposition-record.json

The workflow file was never opened, and the poison never fired. A control confirmed the poisoned
bytes do throw when parsed, so the instrument would have detected a read.

**4 — Whether the client sends it.** The only caller of the render routes is
`app/InsertionPagesScreen.tsx`, whose request body is `{ depositionId, mode, operator }`. It carries
no opening state. `app/LiveCaptureScreen.tsx` fetches the projection but only renders
`readiness` booleans as screen text.

**Limit of the evidence.** The render threw at `validateInsertionInput` on an incomplete fixture, so
the stages after validation were not observed behaviourally. They are closed structurally instead:
`rendering-spec.mjs`, `build-pages.mjs` and `page-model.mjs` import no filesystem module at all and
are pure over their arguments. The only file access after validation is the literal transcript path
in `word-service.mjs`.

## Decision

**D1 — A verification is a checklist tick.** It is the reporter's own working record of what they
have looked at. It is not a statement that anyone attested to a value, and the bare boolean is the
honest shape for it.

**D2 — No provenance is added.** `verifiedFields` does not gain `who` or `at`. The asymmetry with
the correction log is correct and is not to be raised again as a defect.

**D3 — The reason is reach, not importance.** D1 holds *because* the verification stays inside
`workflow/opening-procedures.json`. It is not an argument that attestations do not need provenance.

## Reopening condition (controlling)

The moment a verification reaches the canonical record, a certified insertion page, a rendered
document, or any other output a court could be asked to rest on, D1 and D2 lapse and the provenance
requirement applies. The shape to adopt then is `layoutProfile`'s — `by` and `at`, not verified
unless both are present — not the correction log's, unless the verification also needs to be
tamper-evident.

Anything that widens reach triggers this: passing opening state into a render request, reading
`workflow/` from `word-service.mjs`, or copying a verification into the canonical record.

## Consequences

- The evidence above is a snapshot of behaviour on 2026-08-24, not a guard. Nothing in the test
  suite fails if a future change carries a verification into a rendered page.
- `deposition.remote`-style completeness aside, no certified output states that a field was
  verified, so there is currently nothing for a court to rely on here in either direction.
- `LiveCaptureScreen` renders `readiness` as the word "Verified". That is screen wording for a
  checklist state and is not an assertion in any artifact, but it is the one place the checklist
  reads like an attestation to a person.
