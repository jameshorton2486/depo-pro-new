# Transcript AI Structural Review — Audit Authorization

**Audit and design only.** No implementation, no deletion, no commits to production behaviour until
the audit returns and is approved.

Production Trial #1 (`DEP-20260901-3PPOB`, Jennifer Baier) is paused mid-reconciliation. Its
deposition data, transcript, speaker map, audio evidence, canonical record and overlay must not be
modified by this audit.

---

## What Trial #1 already established, before the audit starts

These are measurements from the live trial, not hypotheses. The audit should treat them as given and
spend its effort elsewhere.

**Deepgram diarization is not canonical speaker authority, in both directions.** From 9,040 words
across eight clusters:

| | Evidence |
|---|---|
| One cluster holds several people | **DG 3** — 163 words, 86 segments. Contains the witness answering the oath (05:00 *"Yes, ma'am"*) and answering questions (45:48 *"Correct"*, 82:57 *"In Selma"*), **and** counsel at 93:42 *"We'll reserve our questions till the time trial."* |
| One person is split across clusters | **DG 7 @ 78:52** *"I have it."* is Jennifer Baier, confirmed by the reporter from the audio. Her substantive answers either side are DG 2. DG 7 at 23:25 and 54:38 remain unidentified. |
| A cluster can be too small to identify from text | **DG 5** — two words total, *"1 2nd."* at 28:15. |
| A role can be established without a name | **DG 4** is unmistakably the videographer from the on-record opening, but no name is spoken and the Notice names none. |

**On-record introductions were sufficient for five of eight clusters** — the reporter, the witness and
both attorneys identified themselves by name, and the videographer by function. Any AI proposal layer
should be expected to find at least these.

---

## The finding that reframes this work

**An AI speaker-proposal pass already exists** and is well-built:

- `server/speaker-attribution-pass.mjs` — `suggestSpeakerAttributions`, returns `applied:false`
- `server/speaker-attribution-prompt.mjs` — a narrowly scoped system prompt and tool schema
- `validateSpeakerSuggestions` — refuses unknown buckets, identities outside the canonical roster,
  unsupported roles, and any proposal without confidence and evidence
- `tests/speaker-attribution-pass.test.mjs`, `tests/speaker-attribution-prompt.test.mjs`

Its proposal is addressed by **bucket**:

```
{ sourceJobIdentity, deepgramSpeaker, speakerIdentity, transcriptRole, confidence, evidence }
```

One Deepgram cluster maps to one canonical person. **The evidence above shows that shape cannot
express what Trial #1 found.** It cannot say "this utterance in cluster 7 is the witness", and it
cannot say "cluster 3 is two people".

So the first question the audit must answer is not *should we build an AI proposal layer* — one
exists — but:

> **Can the existing pass be re-addressed from bucket to stable word range, keeping its validator,
> its refusal behaviour and its tests, or does the range case require a second pass beside it?**

Answer that with the code, not by preference.

---

## Standing rulings the audit may not reopen

- **Question detection may not come from punctuation alone.** Ruled during Phase C and measured:
  456 of 1,972 sentences ended in a question mark against 484 examiner turns, and *"Counsel, can we
  take a short break?"* carries one while being colloquy. A punctuation rule is wrong in both
  directions at once.
- **Three facts stay separate** — who spoke, who is examining, and what kind of utterance it was.
  `server/transcript-labels.mjs` already implements this separation and it is qualified.
- **The reporter is the authority.** AI proposes; the reporter accepts; only then does anything reach
  the transcript. No proposal may apply itself, whatever its confidence.

---

## Part I — the audit

### 1. Authority map

For each capability, name the code that decides it, its inputs, whether the decision is persisted,
whether the reporter can override it, and whether it reaches certified output. **Prove the consumer
chain to the Word file. Do not infer from function names.**

Deepgram speaker · canonical speaker · Q. · A. · colloquy · paragraph boundary · turn boundary ·
examination boundary · BY-line · resumption BY-line.

Start with, and do not stop at: `transcript-labels.mjs`, `transcript-render.mjs`,
`transcript-print-model.mjs`, `reporter-overlay.mjs`, `complete-transcript-model.mjs`,
`shared-document-model.mjs`, `speaker-attribution-pass.mjs`, `entity-pass.mjs`,
`correction-validator.mjs`, `correction-chunker.mjs`, `local-api.mjs`, `WorkspaceScreen.tsx`,
`WorkspaceDocumentPages.tsx`, and their tests.

### 2. Existing inference rules

For every heuristic — *active examiner spoke therefore QUESTION*, *witness spoke after a pending
question therefore ANSWER*, *diarization changed therefore new turn*, *same cluster therefore same
person* — report file, function, rule, input, output, why it exists, current test coverage, and
**whether Trial #1 proved it reliable or unreliable.**

### 3. Three classifications, and nothing is deleted

- **KEEP** — deterministic code that stays correct once the reporter has supplied better upstream
  facts. A reporter-approved examination boundary driving a `CROSS-EXAMINATION` heading probably
  belongs here.
- **RETIRE CANDIDATE** — inference whose responsibility should move to propose-and-review. Say
  exactly what would replace it. **Mark it; do not remove it.** Some of it is qualified architecture
  that will still be right downstream of an AI proposal.
- **CONSUMER ONLY** — code that both infers and renders, and should instead consume an approved fact.

### 4. Addressing

Can the existing `asrWordId` architecture address a word, an utterance, a multi-word span, a turn
boundary, and a per-utterance speaker override? **Prefer the existing word ids. Introduce a second
identity system only if they are demonstrably insufficient**, and show the demonstration.

Note that `split` already carries a speaker (`{op:"split", beforeWordId, speakerIdentity,
transcriptRole}`) and `label` already addresses by word or segment. Establish whether an accepted
range proposal can be expressed entirely in existing overlay operations.

### 5. Three levels of proposal, and which survive

The audit must decide between three units of authority rather than assuming one replaces the others.

**GLOBAL** - `DG cluster -> canonical person`. What exists today. Only safe when the whole bucket
really is one person, which was true for five of Baier's eight clusters.

**RANGE** - `word A .. word B -> canonical person`. Needed for mixed buckets like DG 3, and for
isolated errors like DG 7 @ 78:52 where one utterance belongs to someone else.

**BOUNDARY** - `a new speaker turn begins at word X`. Needed where diarization failed to create a real
turn at all - Etminan's 224 missing boundaries are this case.

**Do not automatically retire the bucket-level pass.** Determine whether GLOBAL remains useful as a
fast proposal for demonstrably homogeneous clusters while RANGE and BOUNDARY provide the safe general
mechanism. Five of eight clusters being clean is an argument for keeping it, not against.

### 6. The bucket assumption

Find every place that assumes one Deepgram id maps to one canonical person — the speaker map schema,
`speakerEvidenceBuckets`, `validateSpeakerSuggestions`, the Counsel Editor's selector, the print
model's placeholder. **Mark them; change nothing.** Then determine whether a per-range override can
sit above the evidence layer while the original `deepgramSpeaker` value survives untouched on every
word.

### 7. Paragraph identity

Trace raw words → segments → paragraphs → printed paragraphs. Establish what currently creates a
paragraph boundary. Confirm that visual page boundaries are not part of paragraph identity — a
correction may span a page break because pagination is a projection.

### 8. Convergence

Find where the streaming and prerecorded pipelines become structurally equivalent. The target is one
review entry point after evidence normalisation. Report the convergence boundary; build two paths
only if the evidence contracts genuinely differ.

### 9. Trigger cost

Before proposing "run on Workspace open", measure: how long a pass takes on 9,040 words, what it
costs, what happens on a second visit, and what happens when the transcript has moved since the last
run. A job that restarts every time the reporter opens the screen is worse than a button.

### Deliverable

Authority map · inference rules · KEEP · RETIRE CANDIDATE · CONSUMER ONLY · convergence point ·
addressing assessment · proposed representation of an approved structural fact · migration strategy ·
test strategy · risks to qualified architecture · exact files implementation would touch.

**Then stop.**

---

## Part II — the prompt, as design text only

Draft the system prompt the review service would use. Do not wire it in.

It must state that the model is not the transcript authority; that it proposes for reporter review;
that it uses only supplied evidence and invents no testimony or participant fact.

**Categories, enumerated by the server contract, not by the model:** `SPEAKER`, `TURN_BOUNDARY`,
`QUESTION`, `ANSWER`, `COLLOQUY`, `EXAMINATION_BOUNDARY`.

Every proposal carries a stable start and end word id, current state, proposed state, canonical person
where applicable, timestamps, confidence and evidence.

Specific authorities and limits:

- **Speaker** — addressable at the smallest supported range, never assuming a cluster is one person.
- **Turn boundary** — no single signal is authoritative. Punctuation alone never establishes a turn;
  a diarization change alone never establishes a canonical speaker change.
- **Question** — not from a question mark, not from the speaker being the examiner, not from
  preceding witness speech. *"I'll rephrase." "Counsel, can we take a break?" "I have nothing
  further."* are colloquy whatever their punctuation.
- **Answer** — witness speech is not automatically an answer. It may be clarification, an oath
  response, a request for repetition, or colloquy.
- **Examination boundary** — may be proposed, never established.
- **Paragraphing** — never for readability, never merging speakers, never splitting a continuous
  utterance without evidence.
- **Text** — this pass has no rewriting authority at all. Numbers, dates, amounts, names, grammar and
  substance are outside it and belong to separately authorised correction capabilities.
- **Confidence is advisory.** High confidence authorises nothing.
- **Reporter free text is context, never authority.** It cannot widen the category list, authorise
  automatic application, or bypass server validation. The validators define the authority.

**Prefer no proposal to an uncertain one.**

---

## Part III — implementation requirements, recorded not built

Proposals reviewed individually with original text, proposed text, location, speaker, timestamp,
confidence and evidence. Explicit acceptance before anything applies. Accepted proposals go through
the existing reporter-overlay transaction system and are undoable as one action. A proposal made
against a transcript that has since moved is refused, not applied — the review-state hash already
does this and must be used. Raw Deepgram evidence and timestamps survive untouched.

**Do not claim completion if the UI collects an instruction the server cannot validate and apply.**

---

## Approved Workspace panel behaviour, recorded here so implementation does not have to re-ask

Answered 2026-09-01, implementation deferred until this audit returns.

- **Speaker establishes who spoke, and nothing more.** Q., A. and ordinary attorney colloquy are
  derived from the approved speaker plus examination state where deterministic rules legitimately
  support it. **Examiner colloquy stays a separate utterance-type override** and is not folded into
  speaker identity - it is the third fact.
- **Videographer is shown even when the name is unknown**, reading as *"Videographer - name not
  established"*. The role can be established while the identity is not; Trial #1 proves it. It must
  not manufacture a person. `Other...` remains for everyone else and never creates a participant
  implicitly.
- **Bare Enter does not split once editing is inline.** Too easy to trigger by reflex while typing. An
  explicit *Split here* action only; a deliberate shortcut such as Ctrl+Enter may follow if real use
  justifies it. Bare Enter must not create a structural transcript operation.
- **Low-confidence workload stays visible but compact** - a count such as *"385 low-confidence words"*
  beside REVIEW. Per-word and per-paragraph confidence belongs under Details.

## Sequencing risk

This audit and the approved Workspace Transcript Tools UX checkpoint touch the same surface: the
panel where a reporter accepts or rejects a structural decision. Building the panel first and then
discovering the proposal layer needs different affordances means building it twice.

The audit is read-only and cheap. **Run it before the UX implementation**, and let its answer about
proposal shape inform what the REVIEW group in the panel has to display.
