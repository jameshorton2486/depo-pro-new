# Builder Brief — Opening Procedures Run Sequencer

Branch: `integration/release-bridge`
Surface: Opening → Scripts & Oaths tab
Authorization: this brief authorizes the changes described in sections 3 through 9 only.

Give this whole file to the builder. Do not paraphrase it into a shorter instruction.

---

## 1. Read before writing code

Do not open an editor until you have done all four:

1. Confirm the working tree by content, not by process path. Write a marker file into the tree you believe is live, load the app, and confirm the marker is served. A junctioned `node_modules` defeats process-path lookup, and an old downloaded snapshot on a OneDrive-adjacent path has been selected by mistake before.
2. Restart the Node server after any server-side edit. Vite hot-reloads client modules. Node does not. A correct screen can be running against stale server code.
3. Inventory the placeholder tokens already in use across template records and the renderer. Produce the list before changing anything. Known existing tokens include `[ACTUAL TIME]` and `[EXAMINING ATTORNEY]`.
4. Report what you found in steps 1 and 3 and stop. Wait for approval before section 3.

## 2. Scope boundary

**In scope:** the Scripts & Oaths tab, the deposition record fields listed in section 4, and the oath-administration link to the certification page in section 8.

**Out of scope. Do not touch:** Workspace, live capture, the live Deepgram path, Print preview, Compare transcripts, export, correction pipeline, speaker mapping, `asr-evidence.json`, `working.json`.

**Do not author or edit template text.** You are building the machinery that displays and records approved text. The text itself arrives through a separate human review path. If a template record has no approved text, the correct behavior is refusal, not a plausible default.

## 3. Structure: three phases replacing five stacked sections

The five sections currently on the tab (Opening the Record, Preliminary Instructions / Witness Admonitions, Interpreter Oath, Witness Oath / Affirmation, Examination Commencement) are replaced by a three-phase flow on the same tab.

**Phase 1 — Resolve.** Four selectors, alone on screen. Nothing below them renders. The advance control is disabled until all four hold a value other than Unresolved.

| Selector | Values |
|---|---|
| Modality | In person, Remote, Hybrid |
| Interpreter | Required, Not applicable |
| Witness oath selection | Oath, Affirmation |
| First examining attorney | (from the deposition's counsel array) |

Modality is new. The other three exist and keep their current data paths.

**Phase 2 — Run.** One step on screen at a time. Large type. The read-aloud text is the dominant element. Controls, in this order of visual weight:

- Primary, full width: **Read — advance.** Records a completion entry for the step and moves to the next.
- Secondary, small: **Not performed.** Opens a required free-text reason. Records a skip entry. This is the only other way past a step.
- The existing Copy button and Reporter note field carry over per step.

There is no per-step checkbox. Advancing is the record.

**Phase 3 — Close.** One confirmation control. It writes a single opening-completion record containing the per-step entries from Phase 2. It does not write a single boolean asserting the whole opening occurred.

## 4. Data model

Add to the deposition record:

```
modality: "IN_PERSON" | "REMOTE" | "HYBRID"

officers: [
  {
    id,
    name,
    role: "CSR" | "DIGITAL_REPORTER",
    certificationNumber | null,
    notaryCommission | null
  }
]

openingRun: {
  startedAt,
  closedAt | null,
  steps: [
    {
      stepId,
      outcome: "PERFORMED" | "SKIPPED",
      at,                    // ISO timestamp, set at advance
      skipReason | null,     // required and non-empty when SKIPPED
      administeredByOfficerIds: [id] | null,  // oath steps only
      textRevisionId,        // the template revision actually displayed
      who                    // acting user id
    }
  ]
}
```

`textRevisionId` is required. It is what makes the run record provable later: it says which text was on screen, not merely which step ran.

`officers` is an array because a CSR and a digital reporter may both staff a deposition. Do not model a single reporter identity.

## 5. Sequence assembly

The step list is derived from Phase 1 values. It is computed, never hand-ordered in a component.

Base sequence:

1. `OPENING_RECORD`
2. `REMOTE_ACKNOWLEDGMENT` — present only when modality is REMOTE or HYBRID
3. `INTERPRETER_OATH` — present only when Interpreter is Required
4. `WITNESS_ADMONITIONS`
5. `WITNESS_OATH` or `WITNESS_AFFIRMATION` — exactly one, never both
6. `EXAMINATION_COMMENCEMENT`

Two hard rules, each of which gets a named test in section 9:

- **Interpreter before admonitions.** When `INTERPRETER_OATH` is present, it must precede `WITNESS_ADMONITIONS` in the assembled list. The admonitions have to be interpreted, so the interpreter must already be sworn.
- **Conditional merge.** When `INTERPRETER_OATH` is absent, `OPENING_RECORD` and `WITNESS_ADMONITIONS` render as a single panel with one advance control. When it is present, they render as two separate steps with the interpreter oath between them.

The merge in the second rule is presentational only. Two step entries are always written to `openingRun.steps`, with their own timestamps, in both cases. A deposition where the admonitions were skipped must not produce a record saying they were given.

Absent steps are absent. They do not render greyed out, and they do not count toward the readiness total. The current behavior, where an inapplicable interpreter oath shows "Needs information" and counts against the unresolved count, is what trains the reporter to ignore that counter.

## 6. Refusal on unresolved text

A step whose displayed text still contains an unfilled placeholder must refuse to advance.

The current screen shows `[WITNESS OATH OR AFFIRMATION — APPROVED JURISDICTION-SPECIFIC TEXT REQUIRED]` alongside a live Copy button and an enabled checkbox. A reporter can currently mark a bracketed placeholder as read on the record. Close this.

- Advance is disabled while any token in the rendered text is unresolved.
- The disabled state names the specific missing token.
- Copy is also disabled for that step. Copying placeholder text to a clipboard is how it reaches a record.
- A step whose template record is not `reviewStatus: "approved"` refuses the same way, with a different message.

`Not performed` remains available. Refusal blocks false completion, not the reporter.

### Why this refuses — read before implementing

The evidentiary case for this section rests on **the certification page**, which the application generates, and not on the transcript.

`templates/insertion-pages/TEXAS_STATE_SIGNATURE_REQUESTED/certification-1.tmpl` and its `SIGNATURE_WAIVED` counterpart both emit, as a literal string:

> `That the witness, ^deposition.witness^, was duly sworn by the officer`

That sentence goes out under the reporter's name, CSR number, expiration date and firm registration. Measurement has confirmed it is emitted regardless of what the reporter recorded — see findings F-18, which drove a throwaway record through `buildTexasInsertionPageSet` twice and got a byte-identical page, with a positive control proving the probe detects change.

**Do not justify this section by the transcript.** An earlier draft of the findings argued that a skipped oath step causes the renderer to emit a false setup line or a false `(The witness was sworn)` notation. That is wrong as a matter of fact about this codebase: **no code emits a setup line or any §3.16(a) notation.** The transcript body is typed, dictated, or carried in from an earlier tool. `server/transcript-labels.mjs` positions parentheticals that already exist and authors none.

The rule, recorded as findings F-19: an argument that this application produces a false assertion must name a generated artifact. The certification page is one. The transcript body is not.

## 7. Time capture

`[ACTUAL TIME]` stops being a typed value.

- While a step containing the token is on screen, the token position renders the current local time, updating each second.
- On advance, the displayed value freezes and is written to that step's `at` field and into the step's recorded text.
- The reporter can override the frozen value afterward through the existing correction path, which requires `who` and `when`. It is not silently editable.

## 8. Oath administration and the certificate

Steps `INTERPRETER_OATH`, `WITNESS_OATH`, and `WITNESS_AFFIRMATION` present an officer selector drawn from `officers`. It accepts one or more. Advance is blocked until at least one is selected.

The certification page must name the officer or officers recorded in `administeredByOfficerIds` for the witness oath step. It must not derive that name from a general reporter field on the deposition.

If the certification page currently derives the swearing officer from a single reporter identity, report that before changing it. A certificate that attributes the oath to the wrong officer is incorrect certified output and may need its own fix ahead of this work.

## 9. Acceptance

Every guard below gets a named test. Prove each one by deleting the guard and showing that the named test fails, then restoring it. Report the test name alongside the mutation. Aggregate pass counts are not evidence that a guard exists.

| # | Guard | Proof |
|---|---|---|
| 1 | Placeholder text blocks advance | Named test fails when the check is removed |
| 2 | Unapproved template blocks advance | Named test fails when the check is removed |
| 3 | Interpreter oath precedes admonitions | Named test fails when the ordering rule is removed |
| 4 | Interpreter Not applicable removes the step from the list and the readiness count | Assert on the returned list, not on absence of a thrown error |
| 5 | Oath and affirmation are mutually exclusive | Assert the selected script. Named test fails when the exclusion is removed. **Do not assert an emitted parenthetical.** An earlier revision of this row required it; no code emits `(The witness was sworn)`, `(The witness was affirmed)` or `(Interpreter sworn)`, and none is in scope here. The §3.16(a) notation is the reporter's responsibility in the transcript body, not generated output — see findings F-15 and F-19. Writing an emitter to satisfy this row would be unauthorized scope |
| 6 | Skip requires a non-empty reason | Named test fails when the requirement is removed |
| 7 | Merged panel still writes two step entries | Assert entry count and both stepIds |
| 8 | Certificate names the administering officer | Two-officer fixture where the administering officer is *not* first in `officers` |
| 9 | `textRevisionId` recorded per step | Assert the value matches the revision that was rendered |

Additional checks, reported as findings rather than guards:

- **Reload during a run.** Reload the browser mid-sequence. Report what happens to sequence position and to already-written step entries. If state is lost, say so plainly and do not repair it under this brief. Session recovery across reload is unverified on this branch and is a separate piece of work.
- **Two-officer fixture.** Build one and say where it lives.

## 10. Reporting

Every step result must be verified against disk, not against the screen. A screen observable proves rendering; it does not prove a write. For each item in section 9, report the file and the assertion, not a description of what you saw.

If any measurement returns zero or a suspiciously round number, run a positive control before reporting it.

If you cannot complete an item, say so. Do not report an item as done that you did not observe.
