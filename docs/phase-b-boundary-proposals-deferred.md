# Phase B — AI boundary proposals, formally deferred

**Ruled 2026-09-02 from Production Trial #1 measurement.** Not a preference, and not a scoping
compromise: the deposition was measured and the capability had no work left to do.

## The ruling

**AI BOUNDARY proposals are not presently justified.**

Do not implement a BOUNDARY proposal type. Do not implement bulk RANGE acceptance to compensate for
one-proposal-per-analysis throughput.

Phase B is preserved as a reopening candidate, on one condition: a later production deposition
demonstrates missing turn boundaries that are **difficult for the reporter to locate through ordinary
review**. Difficulty of location is the test, not the count.

## What Baier measured

Against `DEP-20260901-3PPOB` at `reviewStateHash de561295…`, read-only, nothing accepted.

| | |
|---|---|
| Genuine missing-turn-boundary cases | **77** |
| Require audio to locate | **0** |
| Both cut edges visible from punctuation | **70** |
| One edge visible | **7** |
| Neither edge visible | **0** |
| Median misattributed range | **1 word** |
| Affected printed paragraphs | **62 of 738 — 8.4%** |
| Splits needed | 84 (70 cases need one, 7 need two) |
| Existing correction | 2 clicks per split |
| Measured correction cycle | **~310 ms** (5 runs, 288–432) |

Every one of the 77 was located by RANGE from retained transcript evidence, and every one planned
into existing `label` and `split` operations — 0 unplannable. A BOUNDARY proposal type would add an
AI authority with no fact left for it to state: a range proposal covering part of somebody else's
segment *is* the boundary claim, and the Phase A planner makes the cut.

The shape is consistent and unglamorous. The median case is a one-word witness answer absorbed into
counsel's turn, printed today inside a paragraph labelled `Q.`:

```
Q.  And you are the director. Correct? Yep. Yes, sir. Does that mean
    you're at the top Yes. Of the church or the school...
```

## The finding that changed the architecture

Replaying all 173 RANGE proposals against a hash-identical throwaway copy: **1 applied, 172 refused
`STALE_CORRECTION_PROPOSAL`.** Accepting one changes the review-state hash, so every other proposal
from that pass dies. One acceptance per pass run, by construction.

The pass takes 195 seconds. So:

```
by hand, split-with-speaker   84 splits × 2 clicks = 168 clicks,  ~26 s of application waiting
by accepting AI proposals     77 accepts × 1 click =  77 clicks,  ~4.2 h of pass re-runs
```

**Correcting by hand is roughly 580× faster than accepting the proposals.** Bulk acceptance would
close that gap, but it solves the wrong problem.

## The architecture this implies

```
Transcript AI  ->  finds suspicious locations
               ->  REVIEW WORKLIST
               ->  reporter navigates directly there
               ->  existing correction tools
               ->  authoritative overlay
```

AI does not need to apply every proposal. Its highest-value contribution to Baier is *"here are 62
paragraphs you should review"*. The reporter clicks through them and uses controls that already cost
310 ms. Fewer AI authorities, fewer proposal types, a simpler application.

## The roster finding, kept because it is testable

RANGE proposed **Miah Bardot, the court reporter, at 0.95 confidence** for the videographer's own
script — *"Today's date is 05/04/2026. Time is 09:31AM. We are on the record."* The whole-cluster
pass had **declined** the same evidence at 30%: *"could be court reporter or videographer …
insufficient evidence."*

The videographer is not on the canonical roster, so the model chose the closest permissible identity.
That is a roster problem presenting as an AI problem, and forcing a choice from an incomplete roster
is what manufactures a confident false attribution.

**The experiment to run later:** once the roster carries `Videographer — name not established`, rerun
the identical analysis with the prompt unchanged and see whether the false attribution disappears.
That measures whether better canonical context improves AI output without touching the prompt — and
it is a question worth an answer either way.

## What remains open on Baier

- DG 3 — 86 segments, 163 words, mixed; RANGE covers it
- DG 4 — 14 segments, the videographer, blocked on the roster rather than on a capability
- DG 5 — one segment, two words, *"1 2nd."*; needs listening
- DG 7 — two segments, two words, *"Okay."* ×2; needs listening
- Examination — one implicit DIRECT boundary, `atWordId: null`, never explicitly established
- Examiner colloquy — 2 candidates of 355 paragraphs labelled `Q.`

## Evidence immutability, closed

Recorded before the diagnostic and identical after 173 RANGE and 8 GLOBAL proposals:

```
asr-evidence.json        a3aca7208b14feb7…
working.json             4e2de03ea14861e8…
reporter-overlay.json    b7091a68929c142c…
Jennifer_Baier_Audio.m4a a1787bcfa170577c…
```

Proposal generation writes a pass record *beside* the evidence and touches none of it. This closes
the outstanding Phase 5 evidence-file immutability measurement with real before/after hashes.
