# Authorization — O-10, Certificate Refusal on a Recorded Affirmation

Branch: `integration/release-bridge`
Surface: certification page generation
Mitigates F-18. Closes nothing — see §2.

**This is a separate authorization from the Opening Procedures Run Sequencer brief.** That brief authorizes its sections 3 through 9 and puts the certification page out of scope. Nothing here extends it, and nothing there extends this.

**Status: buildable.** There is no precondition.

> **This document was rewritten on 2026-08-29 and is much smaller than its first draft.** That draft required an attestation of the existing library, a migration field with attribution, a backfill, and a library count before anything could be built. It was disproportionate to a latent defect and it is withdrawn. What replaced it is one conditional and one named test. The withdrawn version is in this file's history if the larger problem ever becomes real.

---

## 1. The defect

`templates/insertion-pages/TEXAS_STATE_SIGNATURE_REQUESTED/certification-1.tmpl:13` and its `SIGNATURE_WAIVED` counterpart both emit, as a literal string with no token and no conditional:

> `That the witness, ^deposition.witness^, was duly sworn by the officer`

`witnessOathSelection` has no consumer outside `server/opening-procedures.mjs` and its tests. The value never reaches the renderer. Measured in findings F-18: a throwaway record driven through `createCanonicalDepositionRecord` → `loadTemplateVariant` → `assembleInsertionInput` → `buildTexasInsertionPageSet` twice, once per selection, produced a byte-identical page. A positive control on `proceedingHeading` produced a differing hash, so the null is real.

A reporter who records that the witness affirmed still generates a page stating the witness was sworn, under their name, CSR number and signature.

## 2. Scope, and the gap this deliberately leaves open

**Authorized:** refuse to generate the certification page when `witnessOathSelection === "AFFIRMATION"`.

**Blocks nothing that currently generates.** Findings F-17 records that `affirm` appears in none of the twenty-one specimen files. No deposition in the library is `AFFIRMATION`. There is therefore no attestation to make, no migration field to add, no backfill to run, and no library count to establish.

**`UNRESOLVED` still generates. This is accepted, not overlooked.**

An `UNRESOLVED` deposition produces a certificate with no recorded basis for the oath. That is a gap in the record, not a false statement — and it is exactly what the application has always produced. `AFFIRMATION` is different in kind: the record says the witness did not swear and the certificate says they did. That is the only case that produces a false certificate, and it is the case this closes.

The gap is acceptable here because the application has one user, who is the certifying officer, and who knows whether an oath was administered. It closes properly when approved affirmation wording exists, which is the same event that closes O-10 itself.

**This is a deliberate non-application of findings F-20.** F-20 holds that absence must never grant permission, and `UNRESOLVED` — including the missing-state-file form — is absence. That rule stands, and it still governs any future guard. It is not being applied to this one, on the reasoning above. Recorded here so that the exception is visible rather than looking like the rule was forgotten.

**Not authorized, and not achieved:** correct output for an affirming witness. No approved affirmation certificate wording exists. F-17 records that the UFM publishes none, no figure carries one, and no specimen contains one. This converts a silent false statement into a visible block — an improvement and a worse experience. **Do not mark O-10 closed when this ships.**

## 3. The refusal

Refuse when `witnessOathSelection === "AFFIRMATION"`. Everything else generates as it does today.

**Thread the value to `assembleInsertionInput`. Refuse in `validateInsertionInput`.** The site was checked against the code on 2026-08-29:

1. `assembleInsertionInput` is **pure** — signature `{record, intake, operator, pagination, template, layoutProfile}` at `server/insertion-pages/assemble.mjs:166`, reading nothing from disk. The value must be supplied by the caller.
2. Both production call sites already gate on a shared validator before any page is built: `server/complete-transcript-model.mjs:89-91` throws `COMPLETE_TRANSCRIPT_VALIDATION_BLOCKED`, and `server/insertion-pages/word-service.mjs:69-71` throws `INSERTION_VALIDATION_BLOCKED`. Neither reaches `buildTexasInsertionPageSet` on a blocking finding.
3. `server/insertion-pages/validate.mjs:37` is `blocking(code, target, message, extra)` — the structured shape §4 needs.

**`complete-transcript-model.mjs` calls `assembleInsertionInput` twice**, at lines 88 and 96, because pagination is computed from a first build. The refusal fires on the first pass. Do not assume one call.

Do not refuse at template load. The template is not the thing that is wrong.

If this site is wrong, report why and stop. Do not choose another.

## 4. The refusal must be observable

A certificate that does not generate and does not say why, on a deadline, is how a reporter works around the guard.

The failure must name, in the interface and not only in a log: which deposition, that the recorded oath selection is `AFFIRMATION`, and that no approved affirmation certificate wording exists.

No silent no-op. No empty page. No generated page with the sentence removed.

## 5. Prohibition

**Do not author affirmation certificate wording.** Not as a placeholder, not as a `TODO`, not as a commented-out draft, not as a fixture value that could be copied. No source for it exists. Restated here rather than inherited from the sequencer brief, because that brief does not cover this page.

If the work appears to require affirmation wording to proceed, that is the signal to stop and report, not to draft it.

## 6. Acceptance

One named test, proved by mutation. Delete the guard, show the named test fails, restore it, report the test name alongside the mutation. An aggregate pass count is not evidence the guard exists.

`…/scratchpad/o06-probe.mjs` converts directly — it already builds twice and compares hashes.

| Case | Expected |
|---|---|
| `witnessOathSelection: "OATH"` | generates |
| `witnessOathSelection: "UNRESOLVED"` | generates — see §2 |
| no opening state file at all | generates — see §2 |
| `witnessOathSelection: "AFFIRMATION"` | **refuses** |

Assert the blocking finding's `code` and `target`, not merely that something threw. A refusal that returns a usable object is not a refusal.

Cover **both** call sites, `complete-transcript-model.mjs` and `word-service.mjs`. A guard proved on one path is not proved on the other.

**Keep the positive control.** Retain the `proceedingHeading` probe alongside these cases. A run where every case returns the same result must be distinguishable from a dead harness.

## 7. Reporting

Verify against disk, not against the screen. For each row in §6, report the file and the assertion.

If any measurement returns zero or a suspiciously round number, run a positive control before reporting it.

If you cannot complete an item, say so. Do not report an item as done that you did not observe.
