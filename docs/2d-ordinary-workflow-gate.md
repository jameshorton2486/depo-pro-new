# Checkpoint 2D — ordinary-workflow gate

**Run:** 2026-08-27 into 2026-08-28, against `f91c007` on `integration/release-bridge`.
**Still current at:** `6f3101e`. Six commits have landed since the run — `31da059`, `e9aa445`,
`e310912`, `7c5f17f`, `6f3101e` and this one. None of them changed a path these steps exercised:
they close the examiner placeholder, the Preview messaging, the standalone index and counsel
editing, all downstream of or beside the nine steps below. The results are not re-run against head,
and this line exists so a later reader knows that rather than inferring it.
**Deposition:** `DEP-20260827-LL0D2`, *Whitaker v. Brazos Ridge Logistics, LLC* — disposable, created
through the ordinary reporter path. No real matter was used.
**Storage root:** `.milestone2-corrected-data`.

Every step that persists something was confirmed by reading the record off disk, never by reading
the screen. Screen-only steps are marked as such, because nothing else can check them.

## Result

| Step | | Verdict |
|---|---|---|
| (a) | Seed a court reporter through the real modal | **PASS** |
| 1′ | Reach Deposition Setup through the manual route | **PASS** |
| 2′ | Submit Setup; a deposition record is written | **PASS** |
| 3 | Counsel exist as canonical records with stable ids | **PASS** |
| 4 | Provenance reads `REPORTER_ENTERED` | **PASS** |
| 5 | Derived keyterms appear in `TermReviewTable` | **PASS** |
| 6 | An omitted required field is refused, naming the field | **PASS** |
| 7 | Examining attorney selected from canonical counsel | **PASS** |
| 8 | Preparation saved; survives reload | **PASS** |
| 9 | A stale second save is refused | **PASS** |
| 10 | Generate; open the DOCX in desktop Word | **not begun** |
| 11 | Read the index: real examiner, matching range | **not begun** |
| 12 | Clear the examiner; generation refuses | **not begun** |
| 13 | Immutable evidence and overlays unchanged across the run | **not begun** |

Nine of thirteen. Steps 10–13 need a transcript on this deposition, which needs audio through
Deepgram — still `NOT TESTED — EXTERNAL CONFIGURATION REQUIRED`.

## Evidence

**(a)** `reporters.json` written, 569 bytes. `/api/reporters` returned one record, id
`92632006-e577-43fc-9667-881ad3be6fcf`, `CSR 9174`, Tax ID left empty. On save the modal closed and
the Setup select showed the reporter **already selected with no reload**, and the value it held was
byte-identical to the id the store persisted — so the select was not tracking something the store
had not kept.

**1′** The manual route reached Deposition Setup. This is `ef7a3f6` demonstrated: before it, an
unconditional `required` on the Notice file input meant native constraint validation refused the
manual route before any application code ran. **Zero network requests matching `anthropic`** across
the whole run.

**2′** `DEP-20260827-LL0D2` written to
`okonkwo-vance_m/2026-ci-90210/whitaker_dana_2026-08-27/deposition.json`.

**3, 4** `attorney-1` and `attorney-2`, both `REPORTER_ENTERED` / `REPORTER_ADDED`. Counsel side
carried the values chosen in the form, checked against the selection rather than for mere presence:
`attorney-1` → `PLAINTIFF` with `sideOther` MISSING; `attorney-2` → `OTHER` with
`sideOther = "BRAZOS RIDGE MUTUAL INSURANCE COMPANY"`. That is `dc81a47`'s guarantee — wording only
for `OTHER` — seen for the first time against a real write path rather than a test's.

**5** `TermReviewTable` rendered `TERM | SOURCE | CORRECTION | FLAG` with one row per derived
keyterm, both of them names typed into manual entry. Observed on a second intake pass that was
cancelled without creating a record; `grep` afterwards found no trace of it on disk.

**6** Omitting the cause number produced, verbatim:

> Enter the cause number.

That is `MANUAL_REQUIRED_FIELDS`' own per-field string reaching the reporter rather than a generic
"complete all fields". `aria-invalid="true"` was set on **exactly one control** — the cause-number
input — with every other field unmarked, which also confirms `ab00e19` in the only instrument that
can see it: a syntax-tree test can prove the attribute is conditional, not that a browser computes
it on one input and not another.

**7, 8** Preparation saved through the panel:

```
intake/complete-transcript-assembly.json   revision 1
preparedBy  Marguerite Okonkwo-Vance          (the reporter from step (a))
preparedAt  2026-08-28T05:48:31.291Z          (stamped by the save, not defaulted)
operator    texas-state / waived / "Waived on the record by agreement of counsel" / attorney-1
```

The panel moved from *Complete transcript blocked — action required* to *Complete transcript ready ·
revision 1*, and a **fresh page load** in a new tab repopulated all four values and reported ready.
Until this run the only writer of that file was `scripts/create-milestone2-browser-fixture.mjs`.

**9** Two tabs both holding revision 1. One saved (→ revision 2, examiner `attorney-2`); the other
saved while still expecting revision 1 and was refused:

> ASSEMBLY_REVISION_CONFLICT: this preparation was changed elsewhere. You were editing revision 1;
> the stored preparation is now revision 2. Reload before saving so the other change is not lost.

Shown as a conflict rather than as field findings — reload, not retry. The record still read
revision 2 with examiner `attorney-2` afterwards, so the stale save was refused and did not merge.

## What nearly invalidated this run

An earlier pass reached 2′ and appeared to pass. The record it wrote had **no `side` field at all**,
because `npm run dev` starts two processes and only one of them reloads: Vite hot-reloads the
browser, Node does not reload server modules. The API had been up since 14:49 while eight later
commits changed server code, so the front end was current and the back end was two hours old. Every
visible signal said pass.

Only reading the record off disk caught it. That deposition was deleted, the API restarted, and the
gate re-run from 2′. The same trap recurred later — a server file edited 65 seconds after a restart
— and was caught the same way.

**The check, before believing any browser observation:** compare the API process start time against
the newest commit touching `server/`. Stopping the harness task is not enough; it kills the npm
wrapper while the children keep the ports, and the restart then dies with `EADDRINUSE`.

## Resumed run, 2026-08-28: real audio through the ordinary path

The run resumed with a genuine 8m51s local capture rather than a fixture. Two blockers were found
and fixed, and generation is refused on a third that no screen can clear.

**Two blockers, stacked.** `ac50582`: OpeningProceduresScreen built its own origin,
`http://127.0.0.1:4317`, while this worktree runs 4331 -- so the live path was unreachable here at
all. Behind it, `558aa5b`: `POST /api/audio/transcribe` opened with `readAudioAudit`, which throws
when no intake record exists, and live capture never writes one by either attach path. No
live-captured audio could be transcribed by any route. Both were found by running the ordinary
workflow with real audio; neither was visible to the suite.

**Capture through transcription, verified end to end.**

```
capture      LIVE-20260828175501-ECA52D, FINALIZED, 531.0s, 44.1 kHz / 2ch / 24-bit
levels       mean -25.8 dB, peak -5.6 dB, both channels alive -- speech, not a dead microphone
sha256       0dcdf33a239f82c7492eadf8f2719bddcd63a2ffafcaf339c9e3b0a91834b1d4
attach       ASSIGNED_TO_DEPOSITION; sha256 and byte count IDENTICAL either side of the move
transcribe   completed first attempt, converted:false, 113 segments of real speech
```

The hash was recorded before the attach and recomputed off the moved file afterwards. The attach
links evidence; it does not rewrite it. That is step 13's core question, answered early.

**Step 10 is refused, and the refusal is the result.** Generation named six blank fields
individually rather than printing a sentence with nothing after it:

```
DEPOSITION_METHOD_MISSING:deposition.remote
UNEXPECTED_BLANK:caption.court
UNEXPECTED_BLANK:cert.custodialAttorney
UNEXPECTED_BLANK:cert.charges
UNEXPECTED_BLANK:cert.chargesResponsibleParty
UNEXPECTED_BLANK:cert.certificationDate
```

This is `7c5f17f` holding in the deliverable, at the point where `?? 2` and `?? ""` would have
reached paper -- and naming each field separately, the property step 6 confirmed for the intake
form. It is a pass of the guard, not a failure of the run.

**Why it cannot be cleared.** `caption.court` and `deposition.remote` are set only by
`buildCanonicalRecord` at intake. Manual intake collects five fields -- case style, witness, cause
number, deposition date, deponent type -- and neither is among them. Nothing writes them
afterwards: the canonical record's only write routes are certification, counsel and honorific, and
OpeningProceduresScreen has no input of any kind. So a deposition created through the manual route
cannot produce a complete transcript at any point in its life. Same shape as the transcribe join:
built on both sides, no path between.

**Verification checkboxes, measured.** Every `MISSING` field on Pre-Record Verification renders its
checkbox `disabled` -- a reporter cannot attest to a blank. The participant checkbox on Appearances
has no such gate, and was enabled for both counsel while their Role and Actual appearance read
Missing.

**Instrument note.** Browser clicks stop dispatching after `window.location.reload()`, the same as
after `navigate`; `scroll_to` keeps working because it is not an input event, and only a fresh tab
recovers input. Two silent no-op clicks were discarded rather than read as results.

## Open question: what the participant checkbox asserts

Not filed as a defect. The two checkboxes on Opening Procedures gate differently, and the
difference may be correct.

A field checkbox is disabled when its field is `MISSING` -- verifying a field is a statement about
that field's value, so there is nothing to verify. The participant checkbox has no such gate
(`disabled={busy}`), and was enabled for both counsel on `DEP-20260827-LL0D2` while their Role and
Actual appearance read Missing. That is defensible on its own terms: verifying a participant
plausibly asserts "this person is correctly identified", which is answerable while their
attendance is still unrecorded.

What makes it worth deciding is the appearance-page rule, which is pinned by
`tests/insertion-pages/appearance-filter.test.mjs`: counsel print unless `actualAppearance` is
`false`, and *counsel whose attendance was never recorded is not dropped*. So an attorney whose
appearance was never recorded prints on the appearance page as though present. A reporter who
ticked Verified against that participant may reasonably believe they confirmed the appearance the
page then asserts.

This is a question about what the control means, not about whether the code is correct. Settle what
the participant checkbox asserts, then gate it or do not, to match. Revisit after the gate.

## Withdrawn: a false attestation defect that does not exist

Recorded because it was nearly filed as a release blocker. Pre-Record Verification was reported as
allowing a reporter to tick Verified against a `MISSING` field. It does not: the control is
`disabled={busy||item.state==="MISSING"}`, confirmed on the running screen across seven MISSING
fields -- Court, County, Scheduled start, Actual start, Location, Remote proceeding, Remote
platform -- every one of them disabled, and every present field enabled.

The claim came from reading the word "Missing" rendered beside a checkbox and not checking the
attribute. A blocker list is only useful if every row is real; a phantom beside the certification
index and the examiner placeholder makes the real rows harder to trust.

## Not claimed

- Steps 10–13. No transcript exists on this deposition.
- Anything about live Deepgram, four simultaneous capture devices, or approved oath wording.
- That the panel is correct beyond what these nine steps exercised. Its unit tests are the weaker
  instrument and do not inherit this run's credibility.
