# Production Trial #1 — New Deposition From Scratch

**Objective.** Prove that Depo-Pro can take a brand-new deposition from Notice and audio to a
transcript the reporter is willing to certify and deliver, without a finished transcript telling the
application what the answer should be.

Etminan is no longer the qualification record. It is a regression reference and an answer key that
stays on the far side of a wall.

---

## Phase 0 — the baseline, as measured 2026-09-01

| | |
|---|---|
| `main` | `840b512` — local and `origin/main` agree |
| Working branch | `fix/stage-one-certification-blanks`, **7 commits ahead, not pushed** |
| Working tree | clean |
| Tests | 1,324 pass, 1 fail, 11 skipped, of 1,336 |
| The one failure | `local-api-import-is-inert`, which refuses to run while the dev API holds port 4317; it passes with the port free |
| Tags | `known-good-840b512` (= `main`), `qualified-workspace-perf` (= `233a41d`, this branch tip) |
| Open PRs | #66, superseded by the merged Phase B–E work |

**The finding Phase 0 exists to catch: this session's seven commits are unmerged and unpushed.**
Everything qualified today — deferred certificate blanks, the parties editor, the counsel
contact-loss repair, caption wrapping, the firm-registration field, split-with-speaker, the
review-state-hash repair, page memoisation, the fetch scoping — exists only in one local branch. A
disk failure loses all of it.

**Gate before the trial begins:** push the branch, open a PR, let CI run both matrix legs, merge to
`main`, tag the result, and confirm `origin/main` matches. Branch protection (`enforce_admins: true`,
PR merges) was ruled on and has still not been applied; applying it is a settings change and is the
owner's, not a task for this trial.

---

## Standing rules

These bind every phase. They exist because the previous milestone drifted, and drifted in a way that
was invisible while it was happening.

### 1. The answer-key firewall

The certified Etminan transcript, and any other finished transcript, is validation evidence. It is
never production input.

Concretely, and this is the part that makes it enforceable: **for every fact entered into the trial
deposition, name the source document in the correction log's `why` before entering it.** Not after.
If no source can be named that a working reporter would actually possess — Notice, reporter profile,
recording, exhibit, something stated on the record, the reporter's own observation — then that is a
finding to be written down, not a gap to be filled from somewhere else.

The failure this prevents is specific and already happened once: Etminan's caption parties, counsel
sides and cause number were entered citing the certified transcript when every one of them was
available from the Notice of Deposition. The result looked identical and proved much less.

### 2. Every repair must be generic, and must say so

A repair discovered during the trial lands only if its commit message names the deposition-independent
reason it is needed — the class of deposition that hits it, not the instance that surfaced it.

If that sentence cannot be written, the fix does not land.

This is the mechanism that enforces "no deposition-specific fixes". It does not rely on judgement in
the moment, which is what failed last time.

### 3. Stop, characterise, smallest fix, qualify, resume

At the first thing that does not work: stop. Characterise the smallest problem. Fix only that. Qualify
it — targeted tests, mutation testing where the guard is load-bearing, full suite, typecheck, lint,
build, browser qualification. Then resume the same deposition.

Do not accumulate twenty defects and open an architecture phase.

### 4. No fabricated facts

The application may not invent a value, and neither may I. Where a fact is required and unknown, the
transcript refuses and the owner supplies it. Where a fact does not exist yet, it is deferred and
prints a fill-in rule. The three states stay distinct:

```
KNOWN                      -> print the fact
DEFERRED / not yet occurred -> print the approved blank
REQUIRED BUT UNKNOWN        -> refuse to certify
```

### 5. Screens are captured as each phase runs, not afterwards

Every phase gate includes its screenshots, tagged:

`GOOD` · `CONFUSING` · `TOO MANY CLICKS` · `MISSING INFORMATION` · `MISLEADING`

Nothing is redesigned during the trial. The capture is evidence for the UI pass that follows it.

---

## The trial

### Phase 1 — Workspace performance · **CLOSED**

Measured on a disposable copy, before and after:

| | Before | After |
|---|---|---|
| Selection click | 856 ms blocking | **75 ms** |
| Correction blocking | ~5,000 ms | **~1,000 ms** |
| Correction cycle | 8.7 s | **4.0 s** |
| Overlay POST | 922 ms | **25 ms** |
| Fetches per correction | 7 | **3** |

It missed the 1–2 s target and is closed anyway. The next thing worth learning about correction
burden comes from a real deposition, not another profiling round. **Revisit only if Trial #1 shows
4 s actually hurts.**

Two things recorded rather than carried forward: the reported degradation from 8 to 43 seconds was
withdrawn as unproven — DOM nodes and long tasks were both flat — and the estimate that four
unnecessary fetches cost 1.4 s of the cycle was wrong, because they ran in parallel with the
necessary ones.

### Phase 2 — Create the deposition

New Deposition → Notice upload → extraction → canonical record → Data Sheet.

Verify the application either establishes or asks the reporter to confirm: cause number, court,
jurisdiction, parties, witness, deposition date, deposition type, noticing attorney, counsel,
reporter.

**Gate:** the record holds the facts the source documents actually support, and nothing else.

### Phase 3 — Opening

Pre-Record → Appearances → Scripts and Oaths.

Verify: who actually attended, counsel identity and side, the questioning attorney, videographer,
interpreter if any, remote or in person, the oath, the reporter's attestation, start time.

The reporter, not the ASR, is the authority for every professional determination here.

**Known blocker, already characterised:** approved witness-oath wording has no persistence path.
`witnessOath.available` is hard-coded `false`, and `witnessSworn` plus the nine title-page narrative
tokens depend on it. This will stop the trial at Phase 3 and it is the owner's decision, not a build.

**Gate:** Opening holds the facts known at the start of the proceeding.

### Phase 3.5 — Live capture smoke test

**Added, because the plan's Phase 5 assumed a path that has never been run.** The Live Deposition
click-through — select Live → create → land on Live capture with that deposition's keyterms on the
socket — has never been exercised end to end. It was blocked on the Anthropic key, which now works,
and it is still unrun.

Run it on a disposable deposition before committing the trial to it. The positive control is counting
`keyterm=REDACTED` in the session's `connectionHistory`: `deepgram-live.mjs` redacts the terms out of
the stored URL, so their count proves the terms reached the wire. A socket that merely opened is not
the finding.

**If it fails, Trial #1 starts from an existing recording and live capture moves to Trial #2.**

### Phase 4 — Recording and transcription

Preflight → Record → Deepgram → Stop → finalize evidence.

Verify independently: audio exists, recording continues if Deepgram fails, hashes exist, channels and
files are preserved, raw Deepgram evidence is retained, timestamps and speaker information survive,
and no second authoritative transcript is created.

**Gate:** the evidentiary recording exists independently of the ASR.

### Phase 5 — Speaker reconciliation

From what was said on the record, the reporter's knowledge, and the audio. Not from a finished
transcript.

**Gate:** Deepgram speakers are mapped to canonical participants.

### Phase 6 — Workspace correction

The most important practical test. Correct as a reporter actually would, using text replacement,
paragraph editing, split-with-speaker, join, labels, examiner colloquy, examination boundaries,
undo/redo, playback, find/replace.

Measure: corrections per page, clicks per common correction, time per page, repeated frustrations,
operations needing excessive navigation.

**Automatic correction assistance is not authorised.** It becomes a question only if this deposition
proves manual review is unreasonably burdensome *after* Phase 1's performance work — and that is a
separate authorisation.

**Gate:** a corrected testimony body, without changing what the witness said.

### Phase 7 — Examination structure

Whichever of DIRECT / CROSS / REDIRECT / RECROSS actually occur. Do not manufacture one to test it.

Verify the reporter-facing control drives Q./A., the heading, the BY-line, the resumption BY-line,
the examination index, and pagination.

**Gate:** examination structure is established by reporter action, not paragraph-by-paragraph repair.

### Phase 8 — Exhibits · **THIS IS A BUILD, NOT A TEST**

**Named separately because every other phase exercises something that exists and this one does not.**
There is no exhibit workflow at all: no marking, no storage, no index. Etminan's nine exhibits were
spoken in the body and reached no index.

The trial will stop here and stay stopped until it is built. The reporter needs to establish exhibit
number, description, the page where it was marked, and offered/admitted status where the record type
requires it. Final page references must derive from actual pagination and must never be stored as
authoritative data.

Expect this to be the largest single piece of construction in the trial. Scope it when the trial
reaches it, against what this deposition actually needs.

**Gate:** exhibits marked during the deposition reach the exhibit index with page references derived
from pagination.

### Phase 9 — Administrative and certification facts

Only facts that exist by then: ending time, signature disposition, examination time used, reporter
certification information, applicable firm information. Future Rule 203 facts stay deferred and print
their approved blanks.

**Gate:** no certification statement asserts a fact the record cannot establish.

### Phase 10 — Prepare Complete Transcript

Front matter, pagination, indexes, Changes and Signature, certification, reporter information,
validation.

Every refusal must be actionable. A bare `UNEXPECTED_BLANK` that does not say what is missing is
itself a finding.

**Gate:** zero blocking findings, or a factual refusal the reporter understands and agrees with.

### Phase 11 — DOCX

Evaluate on its own merits. **Do not compare page count to Etminan.**

Verify: Letter size, margins, 25 lines, line numbers, page numbers, transcript box, Q/A geometry,
colloquy, parentheticals, headings, index, exhibits, Changes and Signature, certification, no
placeholder speakers, no broken clauses, no near-empty accidental pages.

**Gate:** mechanically qualified DOCX.

### Phase 12 — Reporter Word Human Gate

The owner opens it in Word and answers one question: *would I certify and deliver this?*

Review the first five pages, random testimony pages, every examination transition, the exhibit index,
the last testimony page, Changes and Signature, the certification, and the final page.

If no, record exactly why, fix only those defects, regenerate.

**Gate: REPORTER APPROVED — DELIVERABLE TRANSCRIPT.**

---

## After the trial

**UI pass.** Screen by screen, in this order: Deposition Library, Intake, Opening, Live Deposition,
Preview/Prepare/Final, and the Workspace last. Design proposals come from screenshots and recorded
pain points, never from repository access. Every UI change is presentation and ergonomics only, and
never in the same commit as a change to transcript semantics, evidence, persistence, validation,
certification, pagination or document generation.

**Trial #2** — a second completed deposition, no Trial-#1-specific assumptions. Aesthetic difference
from Trial #1 is not a reason to change anything: **only a Word-gate rejection justifies a change in
Trial #2.**

**Trial #3** — a deposition with no answer key at all. That is the one that matters.

---

## The stopping rule

Depo-Pro is finished when the owner can take a new deposition from Notice and audio to a transcript
they are willing to certify and deliver, without a completed transcript telling the application what
the answer should be.

Not when the audit is finished. The audit was never the product.
