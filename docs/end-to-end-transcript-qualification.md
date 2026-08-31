# End-to-end transcript qualification

What `tests/qualify-one-transcript-end-to-end.test.mjs` establishes, and what it does not.

## Why it exists

Every other test in this suite asserts a rule about a paragraph. None asserted a property of a
deposition, because until now there was nothing deposition-sized to assert one against: the only
transcript fixture was `tests/fixtures/etminan-evidence.mjs` at **11 segments and 87 words**. The
real records this application has produced run 1,061 and 1,970 segments at roughly 12,000 and
14,000 words. Page geometry and document assembly had therefore only ever been exercised on
documents three pages long.

The specific risk that motivated this is the double review: if Page Review says a paragraph ends on
page 118 and Word breaks it onto 119, the reporter reviews the transcript twice — once here and
again after export — and the application has failed at the thing it is for.

## What it measures

`tests/fixtures/long-deposition.mjs` is a synthetic deposition at production length. Its text is
invented and no deposition testimony is reproduced in it; its *shape* is taken from the real
records — uneven question-and-answer runs, answers long enough to wrap many times at 63 characters,
objections interrupting an examination, a second examiner taking over partway through, and the
reporter and videographer speaking at the boundaries. It is deterministic by construction: a seeded
LCG, no clock, no `Math.random`.

The harness drives the real chain, using the same functions the API paths call:

```
WORKING.segments + overlay
      ↓ applyOverlay
      ↓ renderTranscript
      ↓ buildTranscriptPrintModel
      ↓ buildCompleteTranscriptModel
      ↓ createTranscriptDocxArtifact
   complete-transcript.docx
      ↓ reopened with python-docx
   line-for-line comparison against the print model
```

## Measured, 2026-08-31, at `3146f42`

| | |
|---|---|
| Segments | 1,602 |
| Words | 45,007 |
| Pages rendered | 221 |
| DOCX size | 79 KB |

| Stage | Time |
|---|---|
| `applyOverlay` | 4.1 ms |
| `renderTranscript` | 193.8 ms |
| `buildTranscriptPrintModel` | 616.5 ms |
| `buildCompleteTranscriptModel` | 391.8 ms |
| `createTranscriptDocxArtifact` | 2,093.9 ms |

Roughly 3.3 seconds end to end for a 221-page transcript, of which two thirds is the Python
renderer. Nothing here is a responsiveness concern; no optimisation was attempted or is proposed.

## What passed

- Every page, front matter and back matter included, carries exactly 25 line positions.
- No line exceeds the profile's 63-character width.
- Page numbers are contiguous from 1 with no gap or repeat.
- **Word and Page Review agree line for line across all 221 pages.**
- Page breaks are physical — a break before the first line of every page after the first.
- Two runs over identical input produce an identical `modelHash`.
- Reconstruction writes nothing to disk.

The 25-line and 63-character expectations are written as literals, deliberately not read from
`TEXAS_FREELANCE_DEPOSITION_V1`. Reading the expected value out of the profile under test would
make the assertion tautological — move `linesPerPage` to 24 and a profile-derived test would build,
expect and pass on 24 while the certified geometry had silently changed.

The comparison was mutation-tested before being relied on: injecting a single character at line
1200 fails the test with `Word and Page Review diverge at line 1200 (page 49, position 1)`. A guard
that has never failed is a guard nobody can describe.

## What this does NOT establish

- **Microsoft Word layout.** The comparison is against the DOCX as python-docx reads it. Word's own
  line-breaking and pagination have not been observed. This is the Human Gate and it remains open.
- **Workspace rendering.** The comparison is print-model-to-DOCX. Whether the browser draws the
  same thing is a separate question and untested here.
- **The reporter's editing operations at this scale.** Nothing here opens a paragraph, commits an
  edit, undoes it, or repaginates afterwards. Those remain unqualified.
- **Parentheticals and headings.** The fixture contains Q./A., colloquy, objections, examiner
  handover and long wrapped answers. It does not contain parentheticals or headings, because the
  segment shape this fixture is built on has no representation for them; inventing one would have
  tested the fixture rather than the application.
