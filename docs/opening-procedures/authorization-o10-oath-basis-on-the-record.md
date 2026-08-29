# Authorization — O-10, the oath basis on the canonical record

Branch: cut from `main`
Surface: `deposition.witnessSworn`, the correction log, and certification page generation
Mitigates F-18. Closes nothing — see §2.
Replaces `authorization-o10-certificate-refusal.md`, withdrawn under F-22.

**Status: buildable.** Phase 1 has no precondition. Phase 2 does, and is not authorized here.

---

## 1. Why this shape

The withdrawn authorization threaded `witnessOathSelection` out of `workflow/opening-procedures.json`
into the render path. That violates ADR-0021: workflow values are permitted to carry no `who` and no
`at` **on the condition that they never influence certified output**. It was built, merged locally,
failed `tests/verification-never-reaches-a-certified-page.test.mjs`, and was reverted. See F-22.

The correction is not to make the workflow value more careful. It is to put the fact somewhere that
is already allowed to reach a certified page, and the record is that place.

**Two things already exist, and this design is mostly the discovery that they do.**

`server/canonical-deposition-record.mjs:178` already declares the field:

```
witnessSworn: missing("REPORTER_ENTERED")
```

It is read nowhere and written nowhere. It has been sitting there, correctly sourced and correctly
declared MISSING, waiting for exactly this.

`server/canonical-corrections.mjs` already enforces the attribution ADR-0021 demands. A correction
requires `who`, `why` and `at`, refuses a `from` that does not match what the record holds, refuses a
change that changes nothing, and IDs each entry by content hash. `deposition-store.mjs:443` applies
and persists it atomically alongside the log.

So there is no new field, no new write path, no new attribution mechanism, and **no new boundary
crossing** — `assembleInsertionInput` already receives `record`.

## 2. Scope

**Authorized, phase 1:** record the oath basis on `deposition.witnessSworn` through the correction
log, and refuse to generate the certification page when it holds `false`.

**Not authorized, and not achieved:** correct output for an affirming witness. No approved
affirmation certificate wording exists — F-17. This converts a silent false statement into a visible
block. **Do not mark O-10 closed when this ships.**

**Phase 2, explicitly not authorized here:** refusing when `witnessSworn` is MISSING. That requires
the existing library to be attested first (O-11), which requires the library count and a disposition
for depositions reported by another officer. It is a separate authorization.

## 2a. What phase 1 leaves open, stated as a state rather than as a phase

Phase 1 closes exactly one case: **the reporter attested that the witness did not swear.** That is
the only case in which the record contradicts the certificate.

It leaves open the case where **nobody has said** — `witnessSworn` MISSING — and that is the common
state, not the rare one. A certificate generated then asserts the witness was duly sworn on no
recorded basis at all. That is not a false statement, and it is what this application has always
produced, but it is a gap and phase 1 does not narrow it.

**So F-18 is mitigated, not closed, and not only because affirmation wording is missing.** It is
also open because the ordinary path still produces an unattested certificate. Both reasons are
recorded in F-20's amendment, so that the exception is visible where the rule lives rather than only
in this document's phase split.

## 2b. Two fields now describe the same fact, and only one of them is attributed

`witnessOathSelection` in `workflow/opening-procedures.json` is a workflow value: no `who`, no `at`,
and under ADR-0021 it may never influence certified output. `deposition.witnessSworn` on the
canonical record is an attested fact carrying `who`, `why` and `at`. They can disagree, and the
disagreement is legitimate.

The case worth naming, because it will happen and will look like a bug:

> A reporter sets the Opening selector to **Affirmation** and never attests. The record then holds
> an unattributed `AFFIRMATION` in the workflow file and a **MISSING** `witnessSworn`. **The
> certificate generates**, stating the witness was duly sworn.

That is correct under phase 1 and it is not a defect. The workflow value is the reporter's working
note; the certificate rests only on what was attested. An interface that made the certificate
respond to the selector would be the reverted design again.

It is also the strongest argument for phase 2, and the reason phase 2 is a separate authorization
rather than a nice-to-have.

## 3. The field, and what its three states mean

| `witnessSworn` | Means | Certification page |
|---|---|---|
| `value: true`, `state: REPORTER_ADDED` | The reporter attested an oath was administered | generates |
| `value: false`, `state: REPORTER_ADDED` | The reporter attested the witness did **not** swear | **refuses** |
| `state: MISSING` | Nobody has said | generates — phase 1 only, see §2 |

`applyCorrection` was checked against the `false` case before this was written:
`present` is true for a boolean `false`, so the field lands as
`{value: false, source: "REPORTER_ENTERED", state: "REPORTER_ADDED"}` rather than collapsing back to
MISSING. The primitive already distinguishes "answered false" from "unanswered", which is the
distinction the whole design rests on. **Do not change that behaviour to make anything here easier.**

## 4. Writing it

The Opening screen's oath selection stays where it is. It is a workflow value and remains one.

When the reporter records the oath basis, the application additionally writes a correction:

```
path: "deposition.witnessSworn"
from: null                     // the field is MISSING until first attested
to:   true | false
who:  the certifying officer
why:  non-empty, and it must say what the attestation rests on
at:   ISO 8601
```

Three constraints, and none of them is negotiable:

- **`who` is the certifying officer, never a service account and never the builder.** The existing
  validator refuses an empty `who`; it cannot tell a wrong one from a right one, so this is a
  design constraint rather than a check the code makes for you.
- **No defaulting.** No `?? ""`, no current-user fallback, no inferring `true` because a deposition
  looks ordinary. F-20: absence must never become permission by way of a default.
- **The workflow value does not write this by itself.** A reporter changing the selector is not an
  attestation. The attestation is a distinct act with its own `why`, and the interface must make it
  one.

## 5. Reading it

`assembleInsertionInput` already receives `record`. Lift the field the way `signatureDispositionBasis`
is lifted, so the validator asserts on a named field rather than reaching down a path.

Refuse in `validateInsertionInput`, as a `blocking(code, target, message)` finding. Both production
call sites already gate on it before any page is built — `complete-transcript-model.mjs:89` and
`word-service.mjs:69`. Note that `complete-transcript-model.mjs` assembles **twice**, at lines 88 and
96, because pagination comes from a first build; the refusal fires on the first pass.

Do not refuse at template load. Do not read the workflow file from anywhere in this path.

## 6. The refusal must be observable

Name, in the interface and not only in a log: which deposition, that the record attests the witness
was not sworn, and that no approved affirmation wording exists. No silent no-op, no empty page, no
generated page with the sentence removed.

## 7. Prohibition

**Do not author affirmation certificate wording.** Not as a placeholder, a `TODO`, a commented draft,
or a fixture value that could be copied. No source for it exists in any direction examined — F-17. If
the work appears to require it, stop and report.

**Do not read `workflow/opening-procedures.json` from the render path.** That is what was reverted.

## 8. Acceptance

One named test, proved by mutation: delete the guard, show the named test fails, restore it, report
the test name beside the mutation. An aggregate pass count is not evidence a guard exists.

| Case | Expected |
|---|---|
| `witnessSworn` `true` | generates |
| `witnessSworn` MISSING | generates — phase 1 |
| `witnessSworn` `false` | **refuses**, with the blocking finding's `code` and `target` asserted |
| correction with empty `who` | refused by the existing validator |
| correction with empty `why` | refused by the existing validator |
| correction with stale `from` | refused by the existing validator |

**A second named test, for the constraint in §4 that carries the design.**

*Changing the Opening selector must not write an attestation.* If a dropdown change ever satisfies
`witnessSworn`, the design reverts to what ADR-0021 forbids — with attribution attached to an act
the reporter did not intend as an attestation, which is worse than no attribution because it looks
like provenance. A paragraph in §4 does not survive a refactor. Assert it:

- change `witnessOathSelection` through the ordinary save path
- assert `deposition.witnessSworn` is still MISSING
- assert the correction log has gained no entry

**Required, and this is the one that matters most:**
`tests/verification-never-reaches-a-certified-page.test.mjs` **must pass**, all four cases. It is the
guard that caught the previous attempt. Report its result explicitly; do not fold it into a total.

**And prove it still catches the crossing.** That test passing proves nothing on its own — it also
passed for months while nothing crossed. Deliberately reintroduce the violation: add a
`readOpeningState` call to the render path, show
`the certified render never opens the workflow file` **fails by name**, then remove it and show it
passes. Report the mutation beside the test name.

This is the inverse of an ordinary mutation proof. Elsewhere the guard is deleted to show the test
fails; here the violation is introduced to show the guard fires. The evidence that it will catch the
next attempt is that it caught a deliberate one.

**Keep a positive control.** Retain a case that changes a field the renderer does read, so that a run
where every case returns the same result is distinguishable from a dead harness. F-21.

Cover **both** call sites. A guard proved on one path is not proved on the other.

## 9. Reporting

Verify against disk, not against the screen. For each row, report the file and the assertion. If any
measurement returns zero or a suspiciously round number, run a positive control before reporting it.
If you cannot complete an item, say so.
