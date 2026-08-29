# Authorization — O-10, Certificate Refusal on Unattested Oath Basis

Branch: `integration/release-bridge`
Surface: certification page generation
Closes: nothing. Mitigates F-18. See §2.

**This is a separate authorization from the Opening Procedures Run Sequencer brief.** That brief authorizes its sections 3 through 9 and puts the certification page out of scope. Nothing here extends it, and nothing there extends this. A builder holding both documents is authorized for the union of what each states, not for anything that sits between them.

**Status: not yet buildable.** The precondition in §3 is unmet. Do not begin.

---

## 1. The defect

`templates/insertion-pages/TEXAS_STATE_SIGNATURE_REQUESTED/certification-1.tmpl:13` and its `SIGNATURE_WAIVED` counterpart both emit, as a literal string with no token and no conditional:

> `That the witness, ^deposition.witness^, was duly sworn by the officer`

`witnessOathSelection` has no consumer outside `server/opening-procedures.mjs` and its tests. The value never reaches the renderer. Measured in findings F-18: a throwaway record driven through `createCanonicalDepositionRecord` → `loadTemplateVariant` → `assembleInsertionInput` → `buildTexasInsertionPageSet` twice, once per selection, produced a byte-identical page. A positive control on `proceedingHeading` produced a differing hash, so the null is real.

A reporter who records that the witness affirmed still generates a page stating the witness was sworn, under their name, CSR number and signature.

## 2. What this authorizes, and what it does not

**Authorized:** refusing to generate the certification page when the record does not affirmatively state that an oath was administered.

**Not authorized, and not achieved by this work:** correct output for an affirming witness. No approved affirmation certificate wording exists. Findings F-17 records that the UFM publishes none, no figure carries one, and no specimen contains one.

This change converts a silent false statement into a visible block. That is an improvement and a worse experience. **Do not mark O-10 closed when this ships.** It remains open until approved affirmation wording exists.

## 3. Precondition — attestation comes first, and it is not builder work

The refusal blocks certificate generation for every existing deposition until each carries an affirmative oath basis. Shipping it before the library is attested takes the working library offline.

The migration field asserts, for a specific deposition, that an oath was administered in a room. That is an attestation under a CSR number. **A builder cannot make it, and must not write a script that populates the field by inference, by defaulting, or by reading any existing value.** Findings F-12 supports `OATH` for the three specimens and nothing supports it for any other deposition.

Order:

1. James determines the library count and how many depositions he personally reported. Depositions reported by another officer cannot be attested by James and need a separate disposition decided before this proceeds.
2. James makes the attestations.
3. A builder implements the mechanism that records them (§5) and the refusal (§4).
4. The refusal ships.

Steps 3 and 4 are what this document authorizes. Steps 1 and 2 are not, and this document does not become buildable until they are done.

## 4. The rule and the refusal layer

**The rule, adopted as findings F-20.** Generate only when the record affirmatively states an oath was administered. Two ways to satisfy it:

- `witnessOathSelection === "OATH"`, or
- an `oathAttestation` record per §5, with non-empty `who` and `at`.

Everything else refuses. That includes `AFFIRMATION`, `UNRESOLVED`, a missing field, and a missing state file.

**Absence never grants permission.** A safe path must not trigger on a file not existing. In a local-first application with user-visible folders under `%USERPROFILE%\depos`, absence is the cheapest state for the world to produce and the least trustworthy thing to permit on. A proposal that keyed generation on `blankState` returning was considered and rejected for this reason; it distinguished saved from not-saved and reasoned about age from it, which would permit a deposition taken next month where the reporter never opened the screen.

**Refusal layer.** Refuse before any page is built, so no partial artifact exists on disk or in memory.

> **AMENDED 2026-08-29, after reading the code. The expected site was one layer off.**
>
> The draft named `assembleInsertionInput` as the expected refusal site, correctly noting the value has to be threaded there in any case. Threading is right. Refusing there is not.
>
> **Thread to `assembleInsertionInput`. Refuse in `validateInsertionInput`.**
>
> Three facts settle it:
>
> 1. **`assembleInsertionInput` is pure.** Its signature is `{record, intake, operator, pagination, template, layoutProfile}` (`server/insertion-pages/assemble.mjs:166`) and it reads nothing from disk. The attestation must therefore be supplied by the caller. This is a property to keep, not work around: a caller that fails to thread the value produces absence, and absence refuses. F-20 falls out of the architecture rather than being enforced against it.
> 2. **Both production call sites already gate on a shared validator, before any page is built.** `server/complete-transcript-model.mjs:89-91` runs `validateInsertionInput`, filters `severity === "blocking"`, and throws `COMPLETE_TRANSCRIPT_VALIDATION_BLOCKED` before reaching `buildTexasInsertionPageSet` at line 91. `server/insertion-pages/word-service.mjs:69-71` does the same and throws `INSERTION_VALIDATION_BLOCKED` before its build at line 75. A blocking finding refuses both paths, and §4's "before any page is built" is already satisfied by the existing structure.
> 3. **The validator's finding shape is exactly what §6 requires.** `server/insertion-pages/validate.mjs:37` — `blocking(code, target, message, extra)`. Code, target and message give the interface the deposition, the state found and what would satisfy it, structured. A bare `throw` from inside assembly gives a string that a UI has to parse.
>
> **Note the two-pass call.** `complete-transcript-model.mjs` calls `assembleInsertionInput` twice, at lines 88 and 96, because pagination is computed from a first build. The refusal fires on the first pass. Do not assume a single call.
>
> If this is also wrong, report why and stop. Do not choose a third site.

Do not refuse at template load. The template is not the thing that is wrong.

## 5. The migration field

```
oathAttestation: {
  basis: "OATH" | "AFFIRMATION",
  who,      // user id of the certifying officer making the attestation
  at,       // ISO timestamp
  source    // free text: how the attestor knows. Non-empty.
}
```

- `who` and `at` are required and refused when missing or empty. No defaulting, no `?? ""`, no current-user fallback. This matches the correction log rule already in force.
- `who` must be an officer on the deposition. The attestor cannot be the builder, and cannot be a service account.
- `basis: "AFFIRMATION"` still refuses generation under §2. The field records what happened; it does not unblock output that has no approved wording.

> **AMENDED 2026-08-29 — field names checked against the rule this cites.**
>
> The draft used `when`. The correction log uses **`at`**: `server/canonical-corrections.mjs:94` writes `{path, from, to, who, why, at}`, and line 76 refuses an empty `who` with "A correction to ${path} requires who made it." `at` is used above so the shape actually matches the rule §5 invokes. There is a second precedent at `server/complete-transcript-assembly.mjs:101`, `ASSEMBLY_PROVENANCE_WHO`.
>
> **One naming collision to resolve before building.** `server/canonical-corrections.mjs:105` documents the correction log's fields as: `why` carries where it came from, `source` carries *who put it there*. This note uses `source` for *how the attestor knows*, which is closer to the correction log's `why`. Two records in the same codebase would then use `source` for different things. Decide which name this field takes; do not let a builder pick.

## 6. The refusal must be observable

A certificate that does not generate and does not say why, on a deadline, is how a reporter works around the guard.

The failure must name, in the interface and not only in a log:

- which deposition
- what state was found (`AFFIRMATION`, `UNRESOLVED`, no attestation, no state file)
- what would satisfy it

No silent no-op. No empty page. No generated page with the sentence removed.

## 7. Prohibition

**Do not author affirmation certificate wording.** Not as a placeholder, not as a `TODO`, not as a commented-out draft, not as a fixture value that could be copied. No source for it exists. Restated here rather than inherited from the sequencer brief, because that brief does not cover this page.

If the work appears to require affirmation wording to proceed, that is the signal to stop and report, not to draft it.

## 8. Acceptance

One named test, proved by mutation. Delete the guard, show the named test fails, restore it, report the test name alongside the mutation. An aggregate pass count is not evidence the guard exists.

`…/scratchpad/o06-probe.mjs` converts directly. It already builds twice and compares hashes; the regression test is the same shape with the assertion inverted.

| Case | Expected |
|---|---|
| `witnessOathSelection: "OATH"` | generates |
| valid `oathAttestation` with `basis: "OATH"` | generates |
| `witnessOathSelection: "AFFIRMATION"` | refuses |
| `witnessOathSelection: "UNRESOLVED"`, no attestation | refuses |
| no opening state file at all | refuses |
| `oathAttestation` with empty `who` | refuses |
| `oathAttestation` with empty `at` | refuses |

Assert the returned value, not merely that nothing threw. A refusal that returns a usable object is not a refusal.

Given the §4 amendment, assert the **blocking finding** — its `code` and `target` — and not only that an error was raised. Both call sites must be covered: `complete-transcript-model.mjs` and `word-service.mjs`. A guard proved on one path is not proved on the other.

**Keep the positive control.** Retain the `proceedingHeading` probe alongside these cases. A future run where every case returns the same result must be distinguishable from a dead harness.

## 9. Reporting

Verify against disk, not against the screen. For each row in §8, report the file and the assertion.

If any measurement returns zero or a suspiciously round number, run a positive control before reporting it.

If you cannot complete an item, say so. Do not report an item as done that you did not observe.
