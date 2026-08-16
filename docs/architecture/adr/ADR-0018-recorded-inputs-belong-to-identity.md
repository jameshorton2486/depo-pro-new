# ADR-0018 — An input that changes output belongs to the identity of what produced it

**File:** docs/architecture/adr/ADR-0018-recorded-inputs-belong-to-identity.md
**Status:** PROPOSED — documents a pattern already applied twice in shipped code. Ratification makes it binding on future instances.
**Date:** 2026-08-16
**Supersedes:** None
**Related:** ADR-0017 (Workspace UFM first-render and correction architecture — the third instance below governs its correction seam)

---

## Context

The same defect has now been found three times in unrelated subsystems, twice
by measurement and once by inspection before it shipped. Each time it was
diagnosed as a local bug and fixed locally. It is not local.

The shape: **something that changes what a function produces is not part of
what identifies that function's output.** Two artifacts then carry identical
stated provenance while being different, and nothing in the record can tell
them apart. Every existing check passes, because every existing check is
looking at the fields that were recorded.

This is worth naming because the local fixes look nothing alike — a worker
command-line argument, a server-side catalog, an argument-order guarantee —
while the defect is the same one, and the next instance will look like a fourth
unrelated thing.

---

## The three instances

### I1 — RX render chunk size *(found by measurement, fixed)*

`chunk_frames = sample_rate * 10` was hardcoded in the Pedalboard worker and
recorded nowhere. Qualification then measured four of six RX profiles as **not
chunk-invariant**: renders at 10-second and 30-second chunk sizes produce
different audio, while two renders at the same chunk size in separate processes
are byte-identical.

So chunk size was an input that changed output, absent from the provenance
record. Two derivatives of the same profile at the same version could differ
and the audit could not distinguish them.

**Fixed by:** `--chunk-seconds` as a worker argument; `renderChunkSeconds`
pinned per profile in the catalog; recorded per render as
`renderChunkSeconds` / `renderChunkFrames`; a chain whose profiles pin
conflicting sizes fails closed; profile version bumped, because derivatives
rendered before the pin cannot be told apart from those after it.

### I2 — Client-supplied term groups *(found by inspection, fixed before it shipped)*

`POST /api/transcript/compare` accepted `termGroups` in the request body, and
those groups fed the category-regression check that gates automatic ASR source
selection. A client sending narrow or empty groups silently weakened the gate:
the negation check only fires if negations are in the set, so a UI bug or a
stale cached payload produced a comparison that ran every check, passed, and
selected a source having verified nothing.

The gate failed open, and quietly.

**Fixed by:** versioned server-side `TERM_GROUP_SETS`; the client sends a
`termGroupSetId`; case terms resolve server-side from the UFM registry and
intake keyterms; the resolved id and version are stamped onto the comparison;
`chooseMeasuredAsrSource` refuses candidates scored under different sets; an
unresolvable set refuses to select at all rather than selecting on a weaker
check.

### I3 — Derivation composition order *(prospective — do not repeat this one)*

`working.json` is a projection: `f(asr-evidence, storedParameters)`. Today
`storedParameters` has one entry, `speakerMap.assignments`, applied by
`applySpeakerAssignments` inside `mergeWorking` and re-applied on every
re-derivation.

The correction seam in ADR-0017 adds a second entry. Once two stored parameters
are applied during one derivation, **the order in which they compose is part of
`f`** — and it is not obviously commutative. Attribution is keyed on
`` `${segment.sourceJobIdentity}:${segment.deepgramSpeaker}` ``, so a correction
that preserves both fields commutes with attribution and one that collapses two
keys into one does not.

Unpinned, two derivations from identical inputs can diverge, and
`transcript_hash` stops meaning what it claims.

---

## Decisions

### D1 — An input that changes output is recorded in the identity of the producer

If varying it varies the artifact, it belongs in the record that identifies the
artifact: a profile version, a set version, a derivation contract. Not in a
comment, not in a default, not in the reader's memory of how it was run.

### D2 — Recording it requires a version bump

Artifacts produced before the input was recorded are indistinguishable from
those produced after. A version bump is what makes them distinguishable, and it
is required even when the input's value did not change.

### D3 — Absent is not a default value

A missing measurement is not zero. A missing render rate is not "fast", a
missing latency figure is not "aligned", an unresolved term group set is not
"no regressions found". Each must be representable as absent, must render as
absent to whoever reads it, and must not be substituted with a value that
happens to be falsy.

Corollary: where a total is computed across items and one is unmeasured, the
total is a **minimum**, not an estimate, and must say so.

### D4 — Conflicts fail closed

Where two sources pin an input to different values — profiles in a chain, a
stored parameter versus a request — the operation refuses rather than choosing
one. Choosing silently produces exactly the artifact this ADR exists to prevent.

### D5 — An input reaching a gate from outside the trust boundary is not an input to that gate

A caller able to narrow the criteria a check applies is a caller able to disable
the check. Such inputs are named by identifier and resolved on the trusted side,
the way the RX profile catalog already resolves plug-in parameters from a
profile id.

---

## Implementation Requirements (controlling)

1. **Every instance carries a test that fails when the input stops being
   recorded.** Not a test that the current value is correct — a test that the
   value is present and reaches the artifact. The invariant is the recording,
   not the setting.

2. **Tests for these invariants are mutation-tested before being trusted.**
   Remove the guard, confirm the test fails, restore. An invariant test that
   passes with the guard removed is documentation, not a guard. Three tests in
   this codebase have been rewritten after failing that check.

3. **The identity is written to the durable record**, not only returned to the
   caller. A value that exists only in a response cannot be audited later.

4. **Composition order for `mergeWorking` is pinned and asserted** before a
   second stored parameter is added, per I3.

---

## Consequences

Version numbers move more often, and for reasons that look cosmetic from
outside — a pin added without a behaviour change still bumps. That is the
intended cost: the version is what makes two otherwise-identical records
distinguishable.

Records get longer. `renderChunkSeconds`, `termGroupSetId`,
`measuredLatencyFrames`, `sourceBitDepth`, `decodeFrameDelta` are all fields
that exist because something varied and nothing said so.

Some fields will be recorded that never vary in practice. That is cheaper than
discovering which ones did after an artifact is disputed.

---

## Open Items

- **I3 is unresolved.** Composition order must be pinned and asserted before the
  correction seam lands, and the class boundary between corrections that
  preserve the attribution key and those that collapse two keys into one should
  be settled at scope time rather than discovered from a mis-attributed merge.

- **Adjacent but not the same defect:** measured plug-in latency and source bit
  depth were unrecorded *properties* rather than unrecorded *inputs*. They
  produced the same failure — a record asserting something untrue — and the same
  remedy applied. Whether to widen this ADR to cover properties, or leave them
  as a related pattern, is undecided.

---

## What must NOT be built (hard stops)

- **No silent default for a missing input.** If a value is absent, the code says
  absent. It does not substitute zero, "unknown", or the last known value.

- **No inference of an input's value from a pattern across other artifacts.**
  Chunk invariance has no predictive rule — the obvious hypothesis was tested
  and killed by a counterexample. An unpinned profile is one that was measured
  and found invariant, never one assumed to be.

- **No caller-supplied criteria for a check the caller's work is subject to.**
