# ADR-0017 — Workspace UFM First-Render and Correction Architecture

**File:** docs/architecture/adr/ADR-0017-workspace-ufm-first-render.md
**Status:** DRAFT — proposed, not yet ratified. No code until owner ratifies.
**Date:** 2026-08-14
**Supersedes:** None
**Related:** ADR-0016 (Format and Correct button — Option A rename); ADR-0012 OQ-4/OQ-5/OQ-6; ADR-0015 (geometry)

---

## Context

When a transcript loads in the Workspace today, the TipTap editor renders
raw Deepgram output with light deterministic formatting (P-A pipeline:
speaker-role inference, basic Q/A classification, punctuation spacing).
The UFM-formatted output only appears at export time.

The reporter (Miah) cannot review, approve, or correct a transcript she
cannot see in its formatted state. Formatting must be a Workspace operation,
not an export operation, so the reporter's read-through is meaningful.

Additionally, an 8-step prompt series was written as a documentation artifact
showing corrections made to the Thomas deposition. That prompt contains
Thomas-specific hardcoded facts (parties, speakers, case metadata, exhibits,
certificate language) and must not be connected to any live transcript
verbatim. A generic, versioned, ID-bound replacement is required.

---

## Decisions

### D1 — The Workspace is the formatting and correction surface

Deterministic UFM formatting applies directly to the one canonical transcript
in the Workspace on first render. It is rule-based and does not create a review
queue. AI corrections are a separate category: the AI proposes structured
CorrectionObjects, and the reporter reviews, accepts, or rejects each proposal
under the ATIA paradigm. Accepted corrections apply to and autosave the same
canonical transcript. Export renders that canonical transcript and never
re-derives or re-formats its content at export time. This is the DTAS
reproducibility principle.

The two categories must remain distinct:

1. **Deterministic formatting:** Q/A structure, colloquy, objection placement,
   parentheticals, and spacing rules. Rule-based formatting may apply
   automatically on first render and creates no review queue.
2. **AI corrections:** STT error flags, speaker reassignment, proper-name
   resolution, and structural corrections. AI proposes CorrectionObjects; the
   reporter reviews and accepts or rejects each one before it changes the
   canonical transcript.

### D2 — First render is UFM-formatted

When a transcript loads in the Workspace, the TipTap editor renders it
in UFM format: Q./A. structure, colloquy labels, objection placement,
parentheticals, speaker roles, spacing rules. The raw Deepgram view is
not the default; the formatted view is.

### D3 — F19 scope (restatement of ratified decision)

The Workspace body renders transcript body only:

**In the Workspace body:**
- Q. and A. lines
- Colloquy (reporter, attorneys, videographer)
- Objections on their own lines
- Parentheticals (off-record, exhibits, recesses)
- Proceedings section (oath, appearances, on/off record)
- BY MR./MS. NAME: lines
- EXAMINATION section headers

**NOT in the Workspace body:**
- Caption page
- Appearances page
- Certificate page
- Errata/signature page
- Line numbers (editing gutter is an exempt editing aid per OQ-4)
- Format box (UFM export section only)

Admin pages generate at export from Intake metadata.

### D4 — "Format and Correct the Transcript" button applies corrections only

The button requests AI-assisted corrections ON TOP of the already-formatted
canonical transcript. Formatting already happened deterministically on first
render and does not enter a review queue. The button's job is to propose AI
corrections (STT error flags, speaker reassignment, proper-name resolution, and
structural corrections) as structured CorrectionObjects. The application
validates and persists those proposals for reporter review; the reporter
accepts or rejects each one. Only accepted corrections apply to the same
canonical transcript.

The existing `corrections` table, `correction_decisions` table,
`aiCorrectionBridge.ts`, and correction decision endpoints remain the
authoritative ATIA implementation of this flow. This ADR must not orphan,
bypass, or replace them.

### D5 — Parenthetical color is an open item

Navy blue (#1E3A5F) for parentheticals is listed in some documentation but
is NOT present in any of the four reference transcripts (Trisha Myler, CSR).
This is unratified. It is flagged as an open item for Miah's confirmation
before being encoded as a rule.

---

## Implementation Requirements (controlling — code PR must satisfy all seven)

These seven requirements were ratified by the owner on 2026-08-14 in
response to the agent's safety analysis. They are controlling for all
Part 2 code work.

**REQ-1 — Trigger only after transcription is complete.**
The Format and Correct correction pass must only run after transcription
is fully complete and the transcript is persisted. It must not run against
a partial or in-progress transcript.

**REQ-2 — Generic versioned prompt — no case-specific facts hardcoded.**
The correction prompt must be a generic, versioned template with no
hardcoded facts from any specific deposition (no party names, no case
numbers, no speaker maps, no exhibit names, no certificate language).
Case-specific context (parties, keyterms, speaker assignments) is injected
at runtime from Intake metadata, not baked into the prompt.

**REQ-3 — Bounded chunks with stable segment/token IDs.**
A 1,060-utterance transcript cannot be processed as one AI call. The
correction pass must send bounded chunks of the transcript, each chunk
identified by stable Deepgram segment/utterance IDs. The AI response
references those IDs — it does not return a rewritten document.

**REQ-4 — Structured corrections only — no rewritten free-form document.**
The AI must return structured CorrectionObjects (using the existing schema:
word_id anchor, correction type, proposed value, confidence score, evidence).
CorrectionObject is the structured contract between the AI correction service,
the application, and the existing ATIA review workflow. Validated proposals
are persisted for reporter review and an accept/reject decision. The AI must
not return a rewritten version of the transcript. Free-form document output is
prohibited.

**REQ-5 — Atomic application preserving Deepgram references.**
After validation and reporter acceptance, each CorrectionObject applies
atomically to the one canonical transcript and is autosaved. Each corrected
token is marked `aiTouched: true` with its original Deepgram value preserved
in `raw_text`. The immutable Deepgram word-level evidence chain must never be
broken. Corrections that cannot be anchored to a stable word_id must be
rejected without changing the transcript.

**REQ-6 — Never change substantive testimony without evidence.**
The AI must not change any spoken word, phrase, or utterance unless the
proposed correction is supported by one of:
  (a) the transcript itself (phonetic similarity to the proposed word),
  (b) the keyterms list supplied at transcription time,
  (c) case materials explicitly supplied to the correction pass.
Dropped words may not be reconstructed from context. Unrecoverable
content renders as [inaudible]. Oath and proceedings content may not
be synthesized.

**REQ-7 — Report failures without partial overwrites.**
If any chunk fails processing, the entire correction pass for that chunk
must roll back. No partial transcript state. The reporter must be informed
of the failure and the transcript must remain in its pre-correction state.
A failure in one chunk must not block or corrupt other chunks.

---

## Consequences

- The export pipeline becomes a thin renderer of the canonical transcript —
  it never re-derives structure or corrections.
- CorrectionObjects and correction decisions are the ATIA reporter-review
  mechanism. They may be persisted in the authoritative `corrections` and
  `correction_decisions` tables, but they do not become a second transcript
  authority, transcript snapshot, revision object, or prior-text copy.
- Certification is a state of the same canonical transcript, not a separate
  Certified Transcript object.
- The Thomas-specific 8-step prompt series remains as documentation only
  and must not be wired to any live transcript.
- Part 2 code work is blocked until this ADR is ratified and the generic
  versioned prompt is written and reviewed.
- Parenthetical color (navy vs. none) is blocked on Miah's confirmation.

---

## Open Items

| ID | Item | Owner | Blocks |
|---|---|---|---|
| OI-1 | Parenthetical color — navy #1E3A5F or none | Miah | F20 update, Part 2 CSS |
| OI-2 | Generic versioned correction prompt — closed 2026-08-15 | Agent | Closed |
| OI-3 | Chunk size and overlap strategy | Agent | REQ-3 implementation |
| OI-4 | Retranscription verification (clean Thomas) | James | REQ-2 scoping |

---

## What must NOT be built (hard stops)

- No oath synthesis: `THE WITNESS:  I do.` must not be fabricated
- No dropped-word reconstruction from context
- No Thomas-specific content in the generic prompt
- No single-call processing of a full 1,000+ utterance transcript
- No accept/reject workflow for deterministic formatting; it applies
  automatically on first render
- No bypass or orphaning of the ATIA AI-correction proposal and decision flow
- No transcript snapshots, prior-text copies, revisions, or generalized edit
  history; authoritative ATIA correction proposals and decision records remain
  permitted and required
- No second transcript authority; certification remains a state of the same
  canonical transcript
- No partial transcript overwrite on failure
- No code PR before this ADR is ratified
