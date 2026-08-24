# ADR-0022 — The index enumerates the sections it can locate, and does not enumerate examinations

**File:** docs/architecture/adr/ADR-0022-the-index-does-not-enumerate-examinations.md
**Status:** RATIFIED
**Date:** 2026-08-24
**Related:** ADR-0021 (unknown is not the same as intentionally blank); the standing ruling that an
examination boundary is a movable reporter-controlled marker defaulted to the first witness turn

---

## Context

`prepareInsertionRenderingArtifact` blocks on three fields the screen does not send. Two of them —
`index.changesAndSignature.startPage` and `index.reportersCertification.startPage` — are arithmetic
and need no decision. `createRenderingSpec` assembles `[...front, ...body, ...back]` and renumbers
sequentially, `FRONT_ROLES` is always the three pages `title, appearances, index`, and the back
order is fixed per signature disposition. Measured across both dispositions and two body lengths:

| disposition | body | total | title | appearances | index | changes | signature | cert1 |
|---|---|---|---|---|---|---|---|---|
| requested | 0 | 8 | 1 | 2 | 3 | 4 | 5 | 6 |
| requested | 57 | 65 | 1 | 2 | 3 | 61 | 62 | 63 |
| waived | 0 | 5 | 1 | 2 | 3 | — | — | 4 |
| waived | 57 | 62 | 1 | 2 | 3 | — | — | 61 |

So with a body of *N* pages: changes at *N+4*, certification at *N+6* (requested) or *N+4* (waived).
Nothing there is a judgement.

The third field is `index.examinations`, and it is a different kind of problem. It requires an
examiner and a page range per examination. **Nothing in the tree produces it.**
`record.transcript.examinations` is initialised to `[]` with source `TRANSCRIPT_DERIVED` and has no
writer, and no examination-boundary concept exists anywhere in the transcript data.

## Evidence

**The reviewed template says nothing about examinations.** `index -> ../common/index.tmpl` in the
manifest, hash-verified like every other reviewed template. All 25 lines of it:

```
                              INDEX

^index.lines^
```

(22 blank lines follow.) One array caret for the whole index body. No examinations heading, no
examinations caret, no structure of any kind. The reviewed figure delegates the entire body to code
and does not constrain this decision either way.

**The heading is in code, and it already prints bare.** `indexLines()` in `build-pages.mjs` emits
the witness name unconditionally and then indented `Examination by …` lines beneath it. With no
examinations, measured:

```
                              INDEX

Appearances................................ 2

Mohammad Etminan, M.D.
Changes and Signature...................... 61
Reporter's Certificate..................... 63
```

A section heading with nothing under it — the same shape as the `Firm Registration No.` line that
ADR-era work removed from the certification page, relocated from a template into code. This is what
ships today when the data is absent, and it does so silently.

**The certified specimens do enumerate examinations.** `tests/insertion-pages/thomas-regression.test.mjs`
encodes, from a real certified transcript, `{ examiner: "Mr. Nunez", startPage: 5, endPage: 75 }`.
So omitting examinations is a **divergence from the certified figure**, forced by absent source
data. It is not a claim that a Texas index does not list examinations. It demonstrably does.

## Decisions

**D1 — The index enumerates the sections it can locate.** Changes and Signature, and Reporter's
Certificate. It does not enumerate examinations.

**D2 — This is an absence of source data, not an intentional blank.** `index.examinations` must
**not** be added to `INTENTIONAL_BLANKS`. That list means "legitimately absent for this variant",
and these are not absent by design — they are unknown. ADR-0021 is the same distinction in the
other direction: a waived field is answered, an unknown field is not, and collapsing either into
the other is how a certificate ends up asserting something it cannot support.

**D3 — Option one is unavailable, not merely harder.** Detection would mean inventing a boundary
concept in the index that the transcript itself does not have, so the index would assert structure
the record cannot corroborate. The standing ruling puts the examination boundary in a movable
reporter-controlled marker defaulted to the first witness turn, and that marker does not exist yet.

**D4 — Option two is premature for the same reason.** Reporter-entered examinations before the
marker exists creates two independent sources of truth about where an examination starts, with no
way to reconcile them when the marker lands.

**D5 — The omission must be visible.** A certified index that silently omits examinations claims a
completeness it does not have. The page must not present as a complete index of a document it has
only partly indexed.

## Reopening condition (controlling)

**When the examination-boundary marker exists in the transcript, examinations become derivable and
this ruling lapses.** D1 through D5 are a temporary shape pending that marker — not a permanent
judgement that indexes do not list examinations. The specimens say otherwise and this ADR agrees
with them.

## Open, and deliberately not decided here

- **How the omission appears on the page.** The wording of the statement is text on a certified
  document and is the owner's to rule.
- **Whether the witness heading stays.** `indexLines()` prints it unconditionally; today it appears
  with nothing beneath it. The specimen shows the heading exists precisely to carry examinations.

Both were held rather than guessed. Recording D1–D5 does not depend on them.

## Consequences

- `index.examinations` blocks as `UNEXPECTED_BLANK` while it is null, because it is in the reviewed
  field inventory. Stating the omission on the page makes the field non-blank on its own, so the
  honest presentation and the unblocking are the same act with `INTENTIONAL_BLANKS` untouched. That
  is a convenience, not the reason for D2, and it must not become a route around it.
- Nothing is enforced yet. This ADR is a ruling with the presentation unbuilt; there is no test that
  fails if examinations are later enumerated from an invented boundary.
- `INDEX_PAGE_MISMATCH` reconciles `declaredSectionPages` against `actualSectionPages`, which reads
  as the second pass of a two-pass design whose first pass does not exist. The arithmetic in the
  table above is probably that second pass.
