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
| 10 | Generate; open the DOCX in desktop Word | **PASS** — reporter-completed document, 18:05:13 |
| 11 | Read the index: real examiner, matching range | **PASS** |
| 12 | Clear the examiner; generation refuses | **PASS (property)** — method unreachable |
| 13 | Immutable evidence and overlays unchanged across the run | **PASS** |

Thirteen of thirteen, with step 12 qualified. Steps 10, 11 and 13 were run on 2026-08-28 against a
real 8m51s local capture. Step 12's property holds by construction rather than by the method the
step describes; the distinction is recorded below rather than absorbed into the count.

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

## Steps 10, 11 and 13: the first complete transcript

Generated 2026-08-28 16:20:18 from `DEP-20260827-LL0D2`: 43,944 bytes, twelve pages.

**Step 11 -- every prediction registered before the file existed.** Written down while generation
was still blocked, then read off the document: twelve pages decomposing as 3 front + 7 testimony +
2 certification; examination range 4-10; appearances at page 2; certificate at 11; no changes-and-
signature section, signature being waived. All hold. The index reads

```
  Appearances................................ 2
  Dana Ellsworth Whitaker
    Examination by Rufus Q. Pemberton-Stack........... 4-10
  Reporter's Certificate..................... 11
```

`EXAMINING ATTORNEY` appears nowhere and neither does `WITNESS`, so the placeholder removed in
e14ea85 stayed removed and the one still live at build-pages.mjs:156 did not fire. The appearance
page prints `FOR BRAZOS RIDGE MUTUAL INSURANCE COMPANY:` -- attorney-2's OTHER wording, as a
heading alone -- beside `FOR THE PLAINTIFF:` naming its represented party.

**Step 13 -- generation adds and does not mutate.** Against a capture taken at 15:48, immediately
before generating: zero files changed, three added (the docx, the rendering spec, the line map).
The audio, the capture manifest, the ASR evidence, the raw Deepgram response and request, the
deposition record, the canonical record, the assembly and the intake are all byte-identical. The
WAV's sha256 is the value the capture session computed when recording stopped at 18:03:53,
unchanged through the attach, the transcription, every record edit since, and now generation.

**Step 10 -- Word round trip, verified by comparison rather than by eye.** The document was opened
in desktop Word, saved, closed and reopened. Comparing the generated file with Word's output: 300
paragraphs both, text byte-identical across all 300, page size 12240x15840 DXA and identical
margins, one sectPr each, zero explicit page breaks in both -- pagination is line-count driven, as
designed. Word rewrote the container and shrank it (43,944 to 38,389 bytes) and changed nothing
that matters.

The decisive figure is Word's own: `docProps/app.xml` reports **Pages 12, Lines 333, Words 2077**.
That is Word paginating the document itself, not the application asserting its own page count, and
it confirms the 3 + 7 + 2 decomposition independently.

The round-trip artifact is not committed -- it is 38 kB of binary reproducible by repeating the
round trip. Its sha256 is
`392c8198246257e32a97c8bf5f39666009c9d7c56fe0376691812110c96aeb09`.

**The caveat that governs all three.** This document carries certification values entered by the
builder, not by the reporter: custodial attorney, officer's charges, charges billed to and
certification date were typed at 13:44 during setup and were never overwritten before generation.
So these steps establish that the machinery produces a correct certified document. They do not
establish that a reporter carried a deposition through to a certified deliverable, which is what
the gate exists to show. The regeneration after the reporter enters those four is the document
that answers the second question, and this record must not be read as though it already had.

**Two defects the document itself revealed**, neither visible to any test: the certificate printed
`That $$1,240.00` because the template supplies the dollar sign the field also accepted (fixed in
27104bc), and the time-allocation clause renders an empty paragraph between "as follows:" and the
next clause. A third, the caption's right-hand column collapsing three lines into one, is recorded
below as part of the unfinished operator boundary.

## Step 12: the property holds, and the step's method is unreachable

Step 12 asks for the examiner to be cleared and generation to refuse. The state it describes cannot
be reached from any screen, by either route:

- Clearing the examiner in Prepare Complete Transcript is refused at the preparation boundary --
  `ASSEMBLY_EXAMINER_MISSING`, "Select the examining attorney from the participants on this
  deposition." The save does not happen; the record stayed byte-identical to the capture taken
  immediately before the attempt, revision 3, examiner `attorney-2`.
- Removing the examining attorney through the counsel editor is not possible either. CounselEditor
  offers Add and Save and has no remove control at all.

So `COMPLETE_TRANSCRIPT_EXAMINER_REQUIRED` and `COMPLETE_TRANSCRIPT_EXAMINER_UNRESOLVED` are
unreachable from the application. They are exercised by unit tests, and by construction a reporter
cannot enter the state they guard.

That is a stronger property than the step asked for -- prevention rather than detection -- and it
is deliberately not recorded as a plain PASS. What was verified is that the application refuses to
create the condition. What was not verified, because it cannot be, is the model-level refusal
firing in a running application. Reaching it would have required writing the record directly, which
this gate forbids: a refusal manufactured that way proves nothing about the software.

**A gap this surfaced.** `6f3101e` added counsel editing after intake and handles add and edit but
not remove. A reporter who lists an attorney by mistake has no way to take them off;
`actualAppearance: false` covers "listed but did not appear" and not "should never have been
listed". Recorded, not fixed.

## The reporter-completed document

The document read for steps 10 and 11 above carried certification values the builder had typed
during setup. At 18:01:29 the reporter entered their own -- custodial attorney Rufus Q. Pemberton,
charges $1,200, billed to Brazos Ridge, certified 2026-08-28 -- through Certification pages, where
Preview saves before it renders. At 18:05:13 they regenerated.

That document, 43,929 bytes, is the one step 10 turns on. It was produced end to end from a
deposition a reporter created: manual intake, capture through the application's own recorder,
Deepgram transcription, reporter-entered court and method, reporter-entered certification. The
earlier document demonstrated the machinery; this one demonstrates the workflow, and the record
should not be read as though the first had done both.

Predictions registered before it was generated, and held: twelve pages decomposing 3 + 7 + 2,
examination 4-10, appearances 2, certificate 11, and `That $1,200` with one dollar sign. The last
is the behaviour proof that the restart carrying 27104bc took -- registered in place of arguing
from process timestamps, and answered by the file.

Step 13 re-run against it: the audio sha256 and the capture manifest are identical to the values
from before any of the day's edits, and the only changed file is the canonical record, which the
reporter changed by typing into it at 18:01:29. That attribution is by timestamp rather than by a
capture taken between the save and the regenerate, and is recorded as inference.

299 paragraphs rather than 300: one trailing blank line dropped from the final page, which the
renderer does by design when content runs longer. Not a defect.

**And the document showed a second doubled label.** `Marguerite Okonkwo-Vance, Texas CSR CSR 9174`
-- the template writes `Texas CSR ` and the reporter modal labels the field "CSR number", so the
natural entry duplicates it. Identical in shape to the doubled dollar sign found in the first
document, and found the same way: by reading a certificate. Every template token was then checked
against the last word of the literal preceding it. Two double in practice; two more would if a
reporter typed the label (`caption.causeNumber` after `NO.:`, `reporter.firmRegistrationNumber`
after `Firm Registration No.`); the rest are prose prepositions where a value beginning "the" or
"to" reads correctly and a strip would corrupt it. The two latent ones are deliberately left alone.

## A refusal that occupies the position of a confirmation

Observed while the reporter saved the certificate. Preview on the standalone Certification pages
screen saves first and renders second, so a successful save followed by a refused render shows only

```
INSERTION_VALIDATION_BLOCKED: UNEXPECTED_BLANK:index.examinations,
UNEXPECTED_BLANK:index.reportersCertification
```

in the same message line a success would have used. The refusal is correct -- `7c5f17f` again: the
standalone path has no authoritative pagination, so the index cannot say which page the examination
or the certificate falls on, and it refuses rather than inventing numbers. The screen even says
where to go instead, on the button below: "Full transcript: generate in the Workspace."

But a reporter reading that line cannot tell "your values were saved and the preview cannot be
rendered here" from "your save failed". Those need different reactions, and after six earlier saves
that genuinely had not landed, the wrong reading is the natural one. The message should say the
values were saved before it says what could not be rendered.

Same shape as the rest of this run's findings: the code is right and the screen does not say what
happened.

## Finding: three defects of one shape, none of them test-detectable

The suite was green at 998 / 987 / 11 / 0 throughout. Every one of these was found by a person
looking at a screen, and none of them could have failed a test in this repository, because in each
case the code was correct and the screen was lying about the record.

| screen | what it showed | what it did |
|---|---|---|
| Certification pages | blank, while four values were stored | Preview posted the blanks and erased them |
| Court and method | grey example text that was not a value | Save wrote nothing |
| Workspace | *ready · revision 3* above a blocked banner | two readiness notions, contradicting |

The first is the serious one. `InsertionPagesScreen` initialised to `EMPTY_CERTIFICATE` and never
read; `runPreview` posts the whole certificate and the route rewrites every field it owns. So the
ordinary action the screen invites destroyed certification values already on the record, silently,
on certified content. Worse than the `?? 2` defect this branch removed: that printed a wrong value
where this erases a right one and leaves nothing behind to notice. Fixed in `a2b69e6`; the route
was deliberately left alone, and a mutation making it merge-only fails a test that pins why -- a
value entered by mistake could then never be cleared.

The second is a real defect and was fixed in `fc21973`: the placeholders were complete realistic
entries rendered grey inside empty boxes, and read as data already present.

**It is not, however, what cost the four failed save attempts, and the earlier version of this
entry said it was.** The correction matters more than the original claim. What was measured on the
failed attempts is only this: no POST reached any Depo Pro instance on the machine, and the record
was untouched. When the builder later drove the same form itself, with the values verifiably in
the fields and the button enabled and `elementFromPoint` returning that button at the click
coordinates, the handler still never ran -- because the tab had been reloaded with
`window.location.reload()`, which kills its input pipe. `form_input` kept working, being a DOM
write rather than an OS event; the click did not. A fresh tab, same values, same button, saved on
the first attempt.

So one cause is established -- the builder's own harness on the attempts the builder drove -- and
the cause on the reporter's attempts is *unknown*, not diagnosed. The placeholder explanation fit
the evidence and was wrong. It is recorded here because a tidy account of four failures with three
neat causes is exactly the kind of thing this document exists to not contain.

**What this says about where the remaining defects are.** This branch has argued that the gap in
Depo-Pro is usability rather than depth. The run demonstrated it rather than asserting it: with
987 passing tests, the defects that stopped a reporter completing a deposition were all in the
layer no test observes -- what the screen claims about the record. That is the case for a manual
gate, and it is a better one than anything written before this checkpoint started.

## Limitation: the index is examiner-only, not Q./A.

Recorded so a later reader does not mistake step 11 for more than it is. The speaker map is
unreconciled -- 15 paragraphs, no speakers assigned -- so the transcript body renders entirely as
colloquy. That does not block generation and does not affect the index: the examination entry
resolves from the assembly through `examiningCounselId`, not from the speaker map, so the
examiner's name and page range print regardless. What step 11 will therefore confirm is that the
index names a real examiner over a real range. It will not have confirmed that the examiner's
questions are marked `Q.`, because with no speaker map there are none.

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
