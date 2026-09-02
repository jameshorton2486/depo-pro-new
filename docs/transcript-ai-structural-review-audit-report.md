# Transcript AI Structural Review — Audit Report

**Read-only investigation. Nothing was implemented, deleted or modified.** `main` is at the qualified
baseline; Trial #1 (`DEP-20260901-3PPOB`) is untouched.

---

## The headline

**Most of this is already built, and it is built in the wrong place.**

There are two proposal pipelines in this repository. One is bucket-addressed and speaker-only. The
other is range-addressed, per-pass-gated, roster-validated, stale-checked — and already permits
`speaker_assignment` and `structure` as correction types. They do not talk to each other.

The recommendation is therefore **not** to build a Transcript AI subsystem. It is to emit structural
proposals into the validator that already exists, and to let the older bucket pass become a fast path
for clusters that are demonstrably one person.

---

## 1. Current authority map

| Capability | Deciding code | Input | Persisted | Reporter override | Reaches Word |
|---|---|---|---|---|---|
| Deepgram speaker | Deepgram | audio | `asr-evidence.json`, every word | **No — evidence** | No, never printed |
| Canonical speaker | `speaker-map` endpoint → `working.json` | reporter assignment | `speakerMap.assignments` | Yes, the map | Yes, via label |
| Per-utterance speaker | `reporter-overlay` `label` / `split` | reporter | `reporter-overlay.json` | Yes | Yes |
| Q. | `transcript-labels.mjs` | identity + examiner | **No — derived** | Indirectly | Yes |
| A. | `transcript-labels.mjs` | role + `pendingQuestion` | **No — derived** | Indirectly | Yes |
| Colloquy | `transcript-labels.mjs` | role, identity | **No — derived** | Indirectly | Yes |
| Examiner colloquy | overlay `colloquy` / `uncolloquy` | reporter | overlay | Yes | Yes |
| Paragraph boundary | `app/transcript-paragraphs.mjs` `canMerge` | segment fields + timing | **No — derived** | via `split`/`join` | Yes |
| Examination boundary | overlay `examination` | reporter | overlay | Yes | Yes, heading/BY-line/index |
| Placeholder speaker | `transcript-print-model.mjs` | cluster index | No | — | **Refused** at finalization |

Consumer chain proved to Word: `asr-evidence` → `working.json` segments → `renderTranscript` →
`labelParagraphs` → `buildSharedDocumentModel` → `buildTranscriptPrintModel` /
`buildCompleteTranscriptModel` → `createTranscriptDocxArtifact`.

---

## 2. Existing AI / inference passes

**`speaker-attribution-pass.mjs`** — proposes canonical identity per Deepgram bucket. Validator refuses
unknown buckets, identities outside the roster, unsupported roles, missing confidence or evidence.
Returns `applied:false`. Tested.

**`entity-pass.mjs`** — proposes misheard proper names against a lexicon built from the canonical
record and keyterms. Explicitly applies nothing. Chunked. Tested.

**`correction-validator.mjs`** — the general proposal validator. This is the important one, and
section 10 explains why.

---

## 3. Every place whole-bucket identity is assumed

- `speakerMap.assignments` — the schema is `{sourceJobIdentity, deepgramSpeaker, speakerIdentity,
  transcriptRole}`. One row per cluster.
- `speakerEvidenceBuckets` / `app/transcript-paragraphs.mjs` `speakerBuckets` — aggregates by
  `jobIdentity:deepgramSpeaker`.
- `validateSpeakerSuggestions` — keyed on the same pair; refuses duplicates per bucket.
- The Counsel Editor speaker selector — one bucket per attorney.
- `sameSpeaker` in `canMerge` — compares `deepgramSpeaker`, so a cluster change starts a paragraph.

**None of these is wrong.** They are correct for a homogeneous cluster and cannot express a mixed one.
Marked, not touched.

---

## 4. Q/A/colloquy inference rules, in full

From `labelParagraphs`, in evaluation order:

| # | Condition | Emits | Notes |
|---|---|---|---|
| 1 | role `WITNESS` and a question is open | **A.** | |
| 2 | role `WITNESS`, no open question | **THE WITNESS:** | oath responses, asides |
| 3 | identity is the examiner **and** the word is in the colloquy set | **COLLOQUY, own name** | reporter's §247 mark; keeps the question open |
| 4 | identity is the examiner | **Q.** | opens a question; may carry `(BY X)` |
| 5 | no examiner yet, role `QUESTIONING_ATTORNEY` | **Q.** | adopts them, implicit DIRECT |
| 6 | any other attorney | **COLLOQUY, own name** | keeps the question open; arms resumption |
| 7 | anyone else | **COLLOQUY** | closes the question |

**No rule reads the text.** Not one consults punctuation, a question mark, or word content. Every
branch is a function of approved speaker identity, participant role, examination state, and the
reporter's colloquy marks.

**Trial #1 verdict: reliable.** Every misattribution observed came from the *speaker* being wrong,
never from the derivation. Correcting DG 7 @ 78:52 to the witness produced `A.` immediately and
correctly, with no further reporter action.

---

## 5. Paragraph / turn construction chain

`words → segments (Deepgram) → canMerge → display paragraphs`.

`canMerge` continues a paragraph when **all** hold: same job, same upload, **same `deepgramSpeaker`**,
same `speakerIdentity`, same `transcriptRole`, gap ≤ 3s, combined length ≤ 900 chars, and no
`forceParagraphBoundaryBefore`.

Two consequences that matter:

**A diarization change starts a paragraph.** This is the *"diarization changed therefore new turn"*
heuristic. Etminan disproved its converse: 224 turns where the speaker changed and diarization did
not, so no boundary was created.

**A speaker correction implicitly creates a boundary**, because `sameSpeaker` compares
`speakerIdentity`. That is why 78:52 became its own paragraph without a split.

**Segment is the addressing floor.** `label` addresses a segment. To relabel part of a segment you
must `split` first. Baier has 1,532 segments for 9,040 words — 5.9 words per segment — so the floor is
fine in practice.

---

## 6. Examination model interaction

An accepted boundary moves examiner authority *before* the paragraph holding the anchor, so that
paragraph is the new examiner's first question. A nameless boundary is refused before assignment. A
boundary naming the current examiner is a no-op rather than a reset. Boundaries drive Q./A. context,
headings, BY-lines, resumption BY-lines, the examination index and its page references.

This is qualified and Trial #1 exercised it correctly — Olvera was adopted as implicit DIRECT and every
question rendered `Q.` without intervention.

---

## 7. KEEP

- `labelParagraphs` in full. It derives from approved facts and reads no text. Better upstream facts
  make it *more* correct, not less.
- The examination model and its heading/BY-line/index consumers.
- `colloquy`/`uncolloquy` as a separate utterance-type fact.
- `correction-validator.mjs` — see section 10.
- The `previewLabel` mark and the finalization refusal built on it.
- Overlay transaction semantics, stale-state protection, undo/redo.

## 8. RETIRE / REPLACE candidates — marked, not removed

- **Bucket-only addressing in `validateSpeakerSuggestions`.** Should gain range and boundary forms, or
  hand those categories to the general validator. **Keep the bucket form** — five of Baier's eight
  clusters were homogeneous, and a whole-cluster proposal is one review action instead of hundreds.
- **`sameSpeaker`'s reliance on `deepgramSpeaker` alone to start a turn.** Not wrong, but incomplete:
  it cannot create a boundary diarization missed. A `BOUNDARY` proposal accepted as a `split` fills
  that gap without changing this function.

## 9. CONSUMER ONLY

- `withPreviewLabels` — presentation of an unresolved speaker; should keep consuming, never decide.
- The Counsel Editor selector — should consume whatever the approved representation becomes.

---

## 10. GLOBAL / RANGE / BOUNDARY — the recommendation

**The range-addressed validator already exists**, in `correction-validator.mjs`:

```
CORRECTION_TYPES = ["spelling","punctuation","capitalization",
                    "word_replacement","inaudible",
                    "speaker_assignment","structure"]
```

`speaker_assignment` and `structure` are **already permitted types**. The validator already:

- takes `wordId` **and `endWordId`** — a range
- refuses `END_WORD_PRECEDES_ANCHOR`, `RANGE_CROSSES_READ_ONLY_WORD`, `OVERLAPPING_PROPOSAL_RANGE`
- gates types per pass — `CORRECTION_TYPE_NOT_ENABLED_FOR_PASS`
- refuses `SPEAKER_ASSIGNMENT_WITHOUT_IDENTITY` and `IDENTITY_NOT_IN_ROSTER`
- refuses `DIGITS_ALTERED`
- refuses prose — `PROPOSAL_KEYS`, `UNSTRUCTURED_FIELD`
- carries `reviewStateHash` and refuses a stale proposal

**Recommendation:** keep all three levels.

| Level | Mechanism | Status |
|---|---|---|
| GLOBAL | existing bucket pass | **keep as a fast path** for homogeneous clusters |
| RANGE | `correction-validator` `speaker_assignment` with `wordId`+`endWordId` | validator exists; **no pass emits it** |
| BOUNDARY | `structure` type, accepted as overlay `split` (which already carries a speaker) | validator exists; **no pass emits it** |

**What is missing is a pass that emits RANGE and BOUNDARY, and the review UI for them. Not a
subsystem.**

---

## 11. Convergence point

`working.json` — both pipelines produce it, and everything downstream consumes it. Streaming writes it
incrementally, batch writes it once. **One entry point, keyed on `reviewStateHash`.** No evidence was
found that the two require different evidence contracts. Do not build two systems.

## 12. Addressing assessment

Existing `asrWordId` values are sufficient. Do not introduce a second identity system.

- word → `wordId`
- span → `wordId` + `endWordId` (validator supports it today)
- turn boundary → `split` at a word, which already carries `speakerIdentity` and `transcriptRole`
- a range's *end* → a second `split`

Every accepted proposal is expressible in existing overlay operations.

## 13. Proposed approved-structure representation

None. Accepted proposals become **existing overlay operations** — `label`, `split` (with speaker),
`colloquy`/`uncolloquy`, `examination`. That preserves undo/redo, reconstruction, orphan reporting and
stale-state protection for free, and adds no new persisted structure to qualify.

## 14–16. Validation, staleness, undo

Validation is `correction-validator` with `allowedCorrectionTypes` set per pass. Staleness is the
existing `reviewStateHash` on both the chunk and the mutation. Undo is unchanged: one accepted
proposal becomes one transaction, reversible in one action — as demonstrated on 78:52 today.

## 17–18. Prompt and schema

Draft prompt: `docs/transcript-ai-structural-review-audit.md`, Part II. Schema: extend the existing
proposal object with `endWordId` (already validated) and constrain `correctionType` to
`speaker_assignment` / `structure` for this pass. Categories come from the server contract, never the
model.

## 19. Workspace REVIEW section

Must display, per proposal: original text, proposed change, page/line, current and proposed speaker,
timestamp, confidence, evidence — with individual accept/reject, and a stale banner when the
transcript has moved. **Group by category**, because a homogeneous-cluster proposal is one decision
covering hundreds of paragraphs while a range proposal is one utterance.

## 20. Migration

Additive. The bucket pass keeps working. New pass, new `passId`, new allowed types. No existing test
changes meaning.

## 21. Test plan

Per category: the incorrect case is detected; the correction is proposed; nothing applies
automatically; acceptance applies it; undo restores; a stale proposal is refused; ambiguity produces
no proposal; an explicit exception is untouched; a page break does not affect addressing; evidence and
timestamps survive; additional-instructions text cannot widen authority. Mutations: drop the range
check, drop the roster check, drop the stale check, let a proposal self-apply, widen the type gate.

## 22. Cost of automatic-on-open

Baier is 9,040 words. The entity pass chunks; a structural pass over the whole transcript is a larger
prompt. **Measure before deciding.** Recommendation: detect an unreviewed transcript on Workspace
open and offer *Run Transcript AI Review*, with the job keyed to `reviewStateHash` so it cannot
restart on every visit. Do not run automatically until cost and latency are measured.

## 23. Files implementation would touch

New: a structural pass beside `entity-pass.mjs`, its prompt, its tests. Modified: `local-api.mjs` (one
route), `correction-validator.mjs` (allowed types for the new pass), the Workspace REVIEW section.

## 24. Do not touch

`labelParagraphs`; the examination model; `colloquy`/`uncolloquy`; overlay operation semantics;
`reviewStateHash`; undo/redo; `withPreviewLabels` and the finalization refusal; pagination;
`shared-document-model`; Word generation; certification; raw evidence.

## 25. Phases, with Human Gates

1. Emit `speaker_assignment` RANGE proposals from a new pass. **Gate:** reporter reviews on Baier.
2. Emit `structure` BOUNDARY proposals. **Gate:** measured against Etminan's 224 known-missing turns.
3. Wire the REVIEW section into the new Workspace panel. **Gate:** browser qualification.
4. Consider automatic-on-open, only after phase 1–2 cost is measured.

---

# TRANSCRIPT AI STRUCTURAL REVIEW — READY FOR IMPLEMENTATION

The architecture exists. The work is a new pass emitting into an existing validator, and a review
surface for two proposal categories the validator already permits.

**One caveat that is not a blocker but should be decided before phase 1:** `label` addresses a
*segment*, so a RANGE proposal narrower than a segment must be accepted as `split` + speaker rather
than as `label`. Baier averages 5.9 words per segment, so this is rare — but the acceptance path must
choose the operation based on whether the range aligns to segment edges, and that choice belongs in
the server, not the model.
