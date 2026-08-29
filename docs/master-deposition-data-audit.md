# Master Deposition Data Audit

Audit date: 2026-08-29  
Audited tree: `C:\Users\james\Projects\depo-pro-new`  
Audit baseline commit: `34493c90c701f23f56cf79f35f21ca12e9ba0596`  
Implementation HEAD: `30f93e2` -- the branch the work was built on and measured against.  
Revised: 2026-08-29, after the review below and the corrections it produced.

## Conclusion

The application had the components needed for a UFM-oriented data table, but it did not have one authoritative intake record. Document extraction returned separate setup, Deepgram, and UFM-shaped objects; intake persisted overlapping copies; and `deposition.json.canonicalData` could drift from `intake/canonical-deposition-record.json`.

The implemented direction is one persisted `MASTER_DEPOSITION_DATA_RECORD` with three deterministic consumers:

1. Deposition Setup / canonical record input.
2. A bounded Deepgram terminology projection used by live and prerecorded transcription.
3. A Texas freelance UFM projection used by template rendering.

Compatibility responses remain at the extraction API boundary for existing callers, but new depositions no longer persist separate Deepgram and UFM intake files.

## Audited surfaces

- New Deposition UI, manual intake, extraction schema, and local extraction endpoint.
- Deposition creation and local storage layout.
- Canonical deposition record construction and provenance rules.
- Live and prerecorded Deepgram keyterm consumers and correction handling.
- UFM/certification rendering, insertion pages, and later-stage workflow authorities.
- Existing local deposition specimens and repository-wide test coverage.

## Evidence and risks found

- The extraction response was repackaged into `deepgramArtifact` and `ufmData`, creating multiple representations of the same facts.
- The New Deposition page described those representations as separate generated files.
- Live and prerecorded transcription read the duplicated Deepgram artifact rather than a shared source record.
- Older stored records can contain stale duplicated canonical data and NOD provenance on null values.
- Only the Etminan canonical specimen was present in current local storage. No Thomas deposition JSON record was found; Thomas material exists only as tests/audio/document artifacts.
- The detailed UFM collection-table document referenced in the prior discussion was not present in the repository or found elsewhere on the local disk. The existing canonical UFM placeholder coverage and the supplied field design were therefore used as the governing field families.

## Implemented controls

- Each extracted field is an evidence cell with value, status, source type, source document, citation, and confidence.
- Missing values have no source attribution. Explicit `false` remains different from missing.
- Setup values the reporter *changed* become `CONFIRMED` / `REPORTER` facts; values they left as the document wrote them keep the document's attribution and citation; values they cleared become `MISSING`.
- Manual intake creates the same master record shape with reporter provenance.
- Deepgram limits are enforced while projecting from master terminology.
- New intake persistence uses schema `2.0.0` and stores the master record, warnings, source artifacts, and audio references once.
- Legacy records and callers retain fallback readers; no existing deposition was rewritten.

## Review and corrections

The first implementation was reviewed against the persisted files rather than the modules, and five
data-integrity defects were found and fixed. They are recorded here because each was a way the
record could state something no document said.

1. **The master record's provenance never reached disk.** `canonicalInputFromMaster` derived
   `extractedFields` honestly and lost: `createDeposition` spreads `canonicalSeed` after it, and the
   setup page was still computing a second list there from the legacy `ufmData` copy. Two lists that
   can disagree about what a document said is one list too many. `canonicalSeed` now carries values
   only, and the master record is the sole provenance authority.
2. **Two persisted files disagreed about the same fact.** Selecting "Not stated" over an extracted
   `remote: true` left the master cell asserting the Notice had answered yes while the canonical
   record recorded no answer. The review fold now clears the cell.
3. **Untouched fields were converted into reporter attestations.** Every control is seeded with the
   extraction's own value, so writing CONFIRMED/REPORTER on submit claimed the reporter attested
   every field they scrolled past, and discarded the `sourceDocument` and `citation` that make a
   cell evidentiary. The fold now compares against the seed: unchanged keeps the document's
   attribution, changed becomes the reporter's, cleared becomes MISSING.
4. **Interpreted and corporate representative could not be entered.** Both had become hidden inputs
   with no value. They are tri-state selects again, alongside Remote and Videotaped.
5. **Manual intake fabricated reporter-confirmed facts.** `jurisdiction: "Texas"` and
   `proceedingType: "ORAL_DEPOSITION"` shipped as CONFIRMED/REPORTER, and an empty `represents`
   array read as truthy and was confirmed with them. A guessed value carrying an attestation is
   worse than a blank: a blank asks the question again, an attestation closes it.

The review fold moved out of the page component into `app/master-data-review.mjs` so a test can
reach it, and `app/extracted-fields.mjs` -- which answered the same provenance question against the
old `ufmData` copy -- was deleted, its rules migrated onto the live functions.

## Verification

Measured on the corrected tree at `30f93e2` plus working-tree changes:

- TypeScript typecheck: passed.
- ESLint: passed.
- Production build: passed.
- Full suite: 1,036 tests; 1,024 passed, 11 skipped, 1 failed.
- The one failure is `importing server/local-api.mjs does not bind a port`, which refuses when port
  4317 is already in use because it cannot then tell a leaked listener from a running dev server.
  Stop the local API and it passes. Note that its non-zero exit short-circuits `npm run verify`, so
  typecheck, lint and build do not run in that chain -- they were run separately here.
- `tests/master-data-crosses-the-persistence-boundary.test.mjs` drives extraction -> reporter review
  -> `createDeposition` and reads both persisted files. Three mutations were applied to the fixes
  and each was killed by name.
- The four tri-state controls were confirmed present and answerable in the running application. No
  automated test covers their presence, because there is no render harness.

## Remaining migration work

Existing schema-1 intake records remain readable through compatibility fallbacks. They should be migrated only through a separately reviewed, non-destructive migration that preserves original files and records every derived value; this implementation intentionally does not rewrite historical deposition evidence.

Open against the one-record architecture, in the order they block real output:

1. **Counsel `side` is not carried by the master record.** `masterDataFromExtraction` builds no
   `side` cell, so `canonicalInputFromMaster` cannot pass one on, and `buildTexasInsertionPageSet`
   throws `APPEARANCE_SIDE_MISSING`. No deposition created through the master path can print an
   appearance page. This is the first blocker for UFM output.
2. **Party and counsel provenance is stamped per array, not per row.** `createCanonicalDepositionRecord`
   uses one `sourceFor("parties")` for every row, so a list mixing an extracted party with a
   reporter-entered one would label both alike. Not reachable today -- the setup screen does not
   edit parties -- and it needs a change in the record builder, not only in the projection.
3. **`projectTexasFreelanceUfm` is narrower than the coverage matrix.** `certification.attorneyTime[]`
   is the known omission: TRCP 203.2(e), cited in the comment at UFM §3.3, requires the officer to
   certify the time used by each party, and the certificate refuses without it. `actualStart` and
   `actualEnd` have cells that nothing projects. The rest of `docs/ufm-field-coverage-matrix.md`
   should be walked field by field.
4. **`canonicalSeed` still duplicates reviewed values.** Provenance now comes only from the master
   record, but the same reviewed values are still sent twice and the seed copy wins the spread. The
   finished shape is reviewed master -> canonical projection, with no parallel seed.
5. **Legacy `ufmData` and `deepgramArtifact` remain on the extraction response and client types.**
   Three client reads still depend on `ufmData` -- the deposition-date default, the cause-number
   fallback, and the term/anomaly counts. They must move before the legacy objects can be dropped
   from the new path.
