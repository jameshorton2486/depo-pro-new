# UFM production packet implementation report

Date: 2026-08-29

## Outcome

The application now presents the UFM implementation as a coordinated family of pages rather than as one template. The two source-backed Texas variants are available, visible, previewable, and generated from the same canonical deposition record and the same 25-line rendering specification used by Word output. Federal variants remain explicit fail-closed catalog entries because the referenced federal source figures are not installed.

The existing one-record architecture remains the authority for all three consumers:

1. deposition setup and UFM fields;
2. Deepgram prerecorded/live keyterm JSON projections; and
3. UFM administrative and certification pages.

No second Deepgram data store or independent UFM data store was introduced.

## Audit conclusions adopted

- The Texas requested-signature packet already contains eight roles: title, appearances, index, changes, signature, and three certification pages.
- The Texas waived-signature packet contains five roles: title, appearances, index, and two certification pages.
- Complete-transcript assembly already exists and is owned by the Workspace. The certification screen must not create a competing transcript pagination authority.
- Jurisdiction and signature disposition remain the only template selectors. Interpreter, exhibits, volume count, remote status, and videotaping are facts or conditional content, not separate template identities.
- Realtime/unedited delivery is not a certification-page variant. The supplied UFM manual expressly excludes the normal format box and certification treatment for that product.
- Federal packets cannot be reconstructed responsibly from the supplied 2010 manual and geometry sheet. Their manifests therefore remain blocked until the actual source figures are supplied and reviewed.

## Changes implemented

### Template catalog

`insertionTemplateCatalog()` reads all four variant manifests and reports:

- availability and review state;
- approval-digest state;
- every page role in the variant;
- source-figure references;
- explicit blocking reasons and expected source location.

The local API exposes this through `GET /api/insertion-pages/catalog`. The Certification Pages screen displays the catalog, so a user can see that a Texas packet is a multi-page family and why federal options do not generate.

### Production page preview

The screen now displays each assembled administrative page with all 25 numbered physical line positions. This preview reads `renderingSpec.pages`, the same shared model passed to Word generation. It is not a separately formatted HTML approximation.

### Attorney-time workflow

The existing canonical attorney-time read/write boundary is now reachable from the UI. A reporter can add ordered party/attorney rows and whole minutes; Preview saves them with reporter-entered provenance before assembly. Empty names, fractional minutes, and negative minutes are rejected by the store. The values populate the certificate's time-used statement.

### Rendering corrections

- Consecutive co-counsel for the same represented side share one `FOR ...` heading.
- Caption `)` delimiters are aligned after variable substitution and before wrapping. The aligner is restricted to lines whose field inventory identifies them as caption content, so parentheses in narrative or certification prose are not shifted.
- Multi-page administrative roles preserve sequential 25-line pagination. UFM section 2.13 permits a short final page, and the missing figure source does not authorize redistributing 26 lines as two half-empty 13-line pages.
- `THE VIDEOGRAPHER: NONE` is printed only when the canonical record explicitly says the deposition was not videotaped.
- A deposition marked videotaped with no named videographer raises blocking finding `VIDEOGRAPHER_UNRECORDED` rather than producing a false appearance page.
- The Certification Pages screen now reads and writes the canonical videographer roster, so the blocking finding has a reporter-accessible remedy and the recorded names populate the appearance page.

### Complete transcript boundary

The full-document option now states that it uses the complete transcript prepared in the Workspace. Standalone certification output remains index-free because it has no authoritative transcript pagination. Complete transcript assembly—not this screen—owns final page numbers and index destinations.

## Reference limitations

The supplied `Uniform-Format-Manual-07012010 (3).pdf` is a 30-page rules document whose figure table of contents is reserved and whose referenced Figures 1–35A are not embedded. `Texas Freelance Geometry Measurements.pdf` establishes two-page geometry requirements but is not a complete template collection. `UFM-Template-Preview.docx` demonstrates only four sections. These files support the Texas geometry and current reviewed Texas packet behavior, but they do not authorize invented federal language or every historical figure.

## Verification

- TypeScript typecheck: passed.
- ESLint: passed.
- Production build: passed.
- Full automated suite after implementation: all functional tests passed except the known environment test that refuses to run while local API port 4317 is occupied. The legacy videographer assertion was updated to distinguish explicit `false` from missing/`true` state.
- Added a catalog boundary test requiring both Texas role families and explicit blocked reasons for both federal variants.

## Remaining source-dependent work

1. Obtain the complete, authoritative UFM figure collection referenced by the manifests, especially federal figures.
2. Transcribe each new figure into a separate reviewed page role; record its source figure and field inventory.
3. Run visual comparison against the source page, approve its content digest separately, and only then mark the variant available.
4. Add any new jurisdiction only as its own source-backed variant. Do not reuse Texas certificate language under a federal or out-of-state label.

These are deliberate compliance gates, not unfinished wiring. The application now exposes them to the user instead of hiding them behind a single preview document.
