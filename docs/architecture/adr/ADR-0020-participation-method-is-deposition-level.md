# ADR-0020 — Participation method is a fact about the deposition, not about each attorney

**File:** docs/architecture/adr/ADR-0020-participation-method-is-deposition-level.md
**Status:** RATIFIED
**Date:** 2026-08-19
**Related:** ADR-0015 (geometry); the column-15 colloquy divergence, recorded on the same terms
**Note:** ADR-0019 is reserved for the AI correction pass and is deliberately unassigned. This
ruling was drafted as 0019 and renumbered before merge so that slot stays open.

---

## Context

`build-pages.mjs` rendered participation method per attorney: any method other than
`"in-person"` appended ` (Via <detail>)` to that attorney's appearance line, and
`validate.mjs` raised a **blocking** `APPEARANCE_METHOD_MISSING` for every attorney whose
`participation.method` was absent.

No certified transcript in the library renders that way.

## Evidence

Three certified transcripts, all reported by the same CSR, all conducted remotely:

| Specimen | Preamble | Per-attorney annotation |
|---|---|---|
| Etminan, 2026-04-24 | "via Zoom, before Miah Bardot, CSR" | none |
| Heath Thomas, 2026-04-30 | "via Zoom, before Miah Bardot, CSR" | none |
| Jennifer Baier, 2026-05-04 | "via Zoom, before Miah Bardot, CSR" | none |

Three for three, the method is stated **once, in the page-1 preamble**, and every attorney is
listed plainly in the APPEARANCES block.

The source document says the same. The Thomas Notice of Deposition states `Location: via Zoom`
on its cover sheet and, in the body: *"the deposition will be conducted remotely using secure
video teleconferencing technology. The court reporter may appear remotely… Counsel may appear
remotely without objection."* One statement, covering all participants.

The canonical record already models it at that level: `deposition.remote`,
`deposition.remotePlatform`, `deposition.telephone`, `deposition.videotaped`,
`deposition.reportingMethod`. All five are `null` in both existing records — an extraction gap,
not a schema gap.

## Decisions

### D1 — Method is deposition-level

`deposition.remote` / `remotePlatform` / `telephone` state the method for all participants. The
appearance block does not annotate it.

### D2 — No per-attorney `participation.method`

The attorney schema gains no `participation` field. `APPEARANCE_METHOD_MISSING` must not block
on a per-attorney field the certified record does not render.

### D3 — The exception is a deliberate ruling, not specimen-derived

Where a participant's method differs from the deposition's, that participant carries an optional
`participationException`, rendered as a suffix on their appearance line. Absent an exception, no
per-attorney annotation prints.

**This half is not grounded in a specimen.** All three transcripts are uniformly remote, so the
library cannot distinguish "never annotate per attorney" from "annotate only the exception." D1
and D2 are specimen-derived; D3 is a ruling recorded so that a later reader can tell which is
which — the same treatment as the column-15 colloquy divergence.

### D4 — Not built until it has a consumer

`participationException` is not added to any schema until the appearance-page renderer needs it.
A field with no consumer is a field nobody has tested.

## Consequences

- `methodLabel` in `build-pages.mjs` is unsupported by every certified document in the library
  and should be removed when D3's renderer is built, not before.
- Both existing canonical records need `deposition.remote` / `remotePlatform` populated. Neither
  can be repaired by re-extraction — a notice is an intake-time artifact with no post-creation
  write path — so both wait on the canonical-record write path.
