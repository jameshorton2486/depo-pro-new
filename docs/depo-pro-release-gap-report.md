# Depo-Pro — Completion and Release-Gap Report

**Baseline:** `80e516cbf31c16f0f0b44ccbb970ada2727c6182`
**Worktree:** `C:\Users\james\Projects\depo-pro-worktrees\complete-transcript-assembly`
**Branch:** `milestone2/complete-transcript-assembly`
**First written:** 2026-08-27. **Revised:** 2026-08-27, after Checkpoints 1, 2A, 2B and 2C landed.
**Repository changes made during this audit:** none. No merge, push, or deployment.

> **Currency note.** Sections 2 through 5 record the state at `80e516c` and are kept as the
> findings that motivated the integration work. Four commits have since landed on
> `integration/release-bridge` — `1c0780d`, `ca05735`, `0e5ae4d`, `b61c515` — and the component
> table in §6 is updated to reflect them; where a finding is closed, the table says so. The
> narrative sections are left as written so the reasoning survives. Checkpoint 2D is authorized
> but **not begun**.

---

## Executive conclusion

The accepted checkpoint is a strong, valid architecture baseline. Its evidence model, pagination authority, Workspace editor, Texas geometry, complete-document model, and DOCX renderer are genuinely built and genuinely qualified.

The application is nevertheless **not reporter-ready**, for one reason: the qualified complete-transcript engine has no connection to the ordinary reporter workflow, and the application does not say so.

| Measure | Estimate |
|---|---:|
| Complete-transcript **engine** | ~98% |
| Complete-transcript **workflow a reporter can reach** | ~35% |
| Whole application toward a controlled local release | **~72%** |

The highest-value remaining work is a small integration bridge. It is not another editor, pagination, UFM, or DOCX phase.

There is a second, quieter gap that neither earlier report identified, and it changes what "qualified" is currently able to mean: **the automated suite never renders a DOCX file.** See §3.

---

## 1. Audit basis and what was actually measured

Automated baseline, run in the worktree:

```bash
npm run verify
```

- **905 tests · 893 passed · 12 skipped · 0 failed**
- TypeScript PASS · ESLint PASS · production build PASS · exit code 0

**Correction to my earlier report, accepted.** I previously described the 12 skips as "the RX and Deepgram integration suites." That was wrong, and the correction I received was right. The actual composition, read from the run:

- **11 skips** — RX 12 integration and profile qualification, gated on `RUN_RX_INTEGRATION=1`
- **1 skip** — a Python transcript-formatter integration test, gated on `DEPO_PRO_PYTHON`
- **0 skips** relate to Deepgram

Live Deepgram qualification is a separate command and a separate external gate. It is not part of the normal suite and must never be reported as one of its skips.

Findings below marked **[measured]** were produced by running the code. Findings marked **[read]** come from reading it. Percentages are judgment, not measurement.

---

## 2. Principal finding — the complete transcript is fixture-accessible, not reporter-accessible

**[measured]**

`getCompleteTranscriptModel` refuses without `intake/complete-transcript-assembly.json` (`server/complete-transcript-model.mjs:78`). The only writer of that file anywhere in the tree is the synthetic fixture generator:

```
scripts/create-milestone2-browser-fixture.mjs:26
```

No screen, no API mutation, and no server path creates it for a deposition opened through Intake. A normal deposition therefore follows this path:

```
Complete document requested
        ↓
Assembly file absent
        ↓
Complete model fails
        ↓
Workspace silently requests the testimony-only print model   (WorkspaceScreen.tsx:152)
        ↓
Generate Word produces professional-testimony.docx
```

`generateDocx` selects its endpoint from whichever model happened to load, and reports the same message either way:

> Word proof generated from the shared pages

A reporter can therefore believe they generated a complete transcript while holding a file that contains testimony only — no title page, no appearances, no index, no changes and signature, no certification. The sole outward difference is the filename stem.

**This is the principal release blocker.**

It does not invalidate the 219/219 Word-parity result. That result proves the engine works when supplied with complete assembly data. It does not prove a reporter can supply that data.

---

## 3. Second principal finding — the DOCX boundary has no automated coverage

**[measured]** — not identified in either earlier report.

`tests/final-document-docx.test.mjs` exercises only `createFixedPageDocxSpec`, the pure JavaScript spec builder. It never calls `createTranscriptDocxArtifact`, never spawns Python, and never produces a `.docx` byte. **A green `npm run verify` does not render a single Word file.**

The Python renderer `server/fixed-page-docx-renderer.py` — the component that turns the shared model into the deliverable — is covered by nothing that runs by default.

Two consequences worth separating:

1. **The engine does work here.** I invoked `createTranscriptDocxArtifact` directly against a two-page Texas print model:

   ```
   outputPath: ...\docxout\professional-testimony.docx
   bytes:      37,745
   renderer:   DEPO_PRO_INTERNAL_FIXED_PAGE_OOXML_V1
   pages:      2   physicalLines: 26   profile: TEXAS_FREELANCE_DEPOSITION_V1
   ```

   Reopened with `python-docx`: 26 paragraphs — 25 line positions on page 1 plus page 2's first line, with trailing blanks on the final page correctly omitted. The far side of the boundary is sound on this machine.

2. **Nothing protects it.** The 219/219 parity and the nine-page round trip were one-off proofs, not regression-gated results. Any future change to the renderer, the spec shape, or the geometry constants can break the deliverable while the suite stays green.

**A related test-design defect.** The one formatter test that does exist skips under a guard stricter than production:

```js
// tests/insertion-pages/rendering-spec.test.mjs:30
const python = process.env.DEPO_PRO_PYTHON;
if (!python || !fs.existsSync(python)) return t.skip(...);
```

It requires `DEPO_PRO_PYTHON` to be a **path that exists**, while the runtime (`final-document-docx.mjs`) accepts the bare string and falls back to `"python"`. This machine has Python 3.13.15 and `python-docx` 1.1.2 installed and working — so the test skips on a machine where the code runs. That test also targets the **legacy** `~/transcript_formatter/docx_exporter.py` used by the older insertion-pages word service, which is a *different* renderer from the bundled fixed-page one. Fixing the guard would not cover the new path; new coverage is required.

---

## 4. Third finding — the index can print a placeholder examiner

**[measured]**

When no examination metadata is supplied, `completePagination` inserts a literal placeholder (`server/complete-transcript-model.mjs:33`). Nothing supplies real examinations — `operator.examinations` arrives only from the fixture-written assembly file, and `canonical-deposition-record.mjs:146` initialises `examinations:[]` and never fills it. Run directly:

```
examinations as the app produces them:
[ { "examiner": "EXAMINING ATTORNEY", "startPage": 4, "endPage": 12 } ]

INDEX lines that reach the document:
Appearances................................ 2
  Examination by EXAMINING ATTORNEY........... 4-12
Reporter's Certificate..................... 13
```

The page numbers are correct — real progress over `main`, where they were blank. The examiner identity is not. No test asserts on it.

The Workspace already knows the examining attorney and already sends `examinerIdentity` to the DOCX endpoint. It reaches `labelParagraphs` for Q/A bylines but never reaches the index. Missing examination authority should block generation, not produce confident placeholder prose.

---

## 5. Fourth finding — the standalone certification path still prints a blank page number

**[measured]** — omitted from the previous report.

The Certification pages screen remains reachable from the navigation ("Certification pages"). `InsertionPagesScreen.tsx:59` sends only `depositionId`, `mode`, and `operator` — no `pagination`. `indexLines` in `server/insertion-pages/build-pages.mjs` is unchanged from `main` and still carries `?? 2` and `?? ""`. Built through the real page builder with that payload:

```
 1|                               INDEX
 3| Appearances................................ 2        <- hardcoded default
 5| Jordan Example
 6| Reporter's Certificate.....................          <- blank page number
```

`validateInsertionInput` raises nothing: it checks only entries that already exist. So the standalone document generates clean and ships with a blank certificate page number and a defaulted appearances page. This path is separate from the complete-transcript path and was not fixed by the milestone work.

---

## 6. Component completion

| Component | % | Assessment |
|---|---:|---|
| Immutable ASR evidence and reporter overlays | 99 | Complete and qualified. Do not reopen |
| Texas geometry and shared pagination | 99 | Word-proven. Preserve `TEXAS_FREELANCE_DEPOSITION_V1@1.0.0` |
| Complete-transcript model and DOCX **engine** | 98 | Exact Word/PDF parity when supplied complete assembly data |
| Four-channel capture **configuration** | Built | Four slots, CH1 required, duplicate-device refusal generic over all channels, per-slot reattach precedence, `PARTICIPANT_MICROPHONE` excluded from diarization. `validateSources` imposes no upper bound |
| Four-channel **capture** | **NOT TESTED** | No automated test configures more than one source. `four-channel-slots.test.mjs` is a source-text pin and cannot fail if four channels do not record. See §6a |
| Professional testimony Workspace | 88 | Excellent editing surface. Deduction is for silently degrading the deliverable |
| Live capture and Deepgram | 82 | Capture and evidence plumbing exist. Live path externally unqualified |
| Audio tools and RX processing | 80 | Safe source selection and reviewed derivatives. Licensed-module and real-speech ASR qualification outstanding |
| Intake | 85 | Manual intake landed in `b61c515`, so a deposition no longer requires a Notice. Extraction still needs the Anthropic key; missing counsel still has no correction path |
| Reporter directory / profile management | 80 | Create and select exist; edit and delete do not |
| Certification variants overall | 80 | Texas strong; federal correctly unavailable; standalone index defect per §5 |
| DOCX regression coverage | 90 | CLOSED by `ca05735`. The suite now renders a real `.docx` and reopens it; mutating `linesPerPage` kills it by name. Word/PDF parity itself is still a manual check |
| Opening Procedures | 65 | Witness and interpreter oaths remain source-required stubs |
| Reporter-facing canonical data management | 65 | Internal model is broader than the UI |
| Multi-volume support | 60 | Detected and safely refused; playback, assembly, indexing, export incomplete |
| **Installation and launch** | **15** | No launcher, installer, shortcut or service. `npm start` is frontend-only; nothing outside `npm run dev` starts `server/local-api.mjs`. `.env.local` is hand-written and nothing creates or explains it |
| Release and integration management | 55 | Qualified checkpoint exists; integration, installation verification, approval outstanding |
| AI correction pass | 45 | Server machinery tested; no UI reaches it |
| Reporter-accessible complete transcript | 60 | Assembly authority exists and is writable (`0e5ae4d`); the preparation panel that calls it is Checkpoint 2D, not yet begun |
| Workflow-status lifecycle | 20 | Recorded in places; drives nothing |
| Exhibit collection and indexing | 15 | Output model can represent exhibits; no collection workflow |
| Federal certification | 0 | Correctly blocked pending approved authority |

**Overall: ~72% toward a reporter-ready controlled local release** — and that figure measures whether the *workflow* exists, not whether a reporter can reach it. The installation and launch row is upstream of everything else and is not reflected in it. Do not raise this number on the strength of Checkpoint 2D landing.

---

## 6a. The dominant defect mode: the rule pinned, the behaviour not

**[measured]** — five instances, all in work reviewed between 2026-08-26 and 2026-08-27.

| # | Instance | What the test pinned | What it could not reach |
|---|---|---|---|
| 1 | Workspace label binding | that `documentControlLabel` is *called* | that it is called with the live state; a hardcoded argument passes |
| 2 | `writeAssembly` schema validation | that `validateAssembly` returns the right findings | that the write path invokes it. Removing it from the write path killed **no test** |
| 3 | `manualIntakeAnalysis` `represents` | the array shape the extraction path produces | the string shape its real caller sends. Threw on first contact with a green suite behind it |
| 4 | Eight `local-api.mjs` route tests | that a literal appears in the source | that any route behaves |
| 5 | `four-channel-slots.test.mjs` | that `CHANNEL_SLOTS` declares four | that four channels record. No test configures more than one source |

**This is structural, not carelessness.** There is no render harness and no multi-source capture fixture, so source-text pinning is the only instrument available above the module boundary. Every time that gap is filled with a regex, the suite gains a test and gains no coverage.

Two of these were found only because a mutation returned an **empty kill set** and that was treated as *check* rather than *confirmation*. One (#3) was invisible to inspection entirely and was found only by running a manual gate — which is the demonstrated argument for gates: every automated test in a checkpoint can pass while the feature is unusable.

**Standing rules adopted from this.** A guard mutation runs at the **call site**, not only on the rule. A module consuming form-collected input **normalizes at its own boundary**, and its tests supply the caller's real shape. Validation is not normalization.

---

## 7. Priority plan

### Priority 0 — Preserve the qualified baseline

Do not alter `80e516c` directly. Create a separate integration branch from it and keep each correction independently reviewable.

**Manual control, before any work begins:**

```bash
git rev-parse HEAD && git status --short && npm run verify
```

Expected: SHA begins `80e516c`; clean tree; 905 tests, 893 passed, 12 skipped, 0 failed; typecheck, lint and build pass.

---

### Priority 1 — Make the testimony-only fallback explicit

The smallest immediate safety improvement, and the one that should land first because it is the difference between a known limitation and a wrong document handed to a court.

When the complete-document request fails, keep the reason instead of discarding it. Show a persistent document-status banner, and make the control and the completion notice name the output — *Generate testimony-only Word* versus *Generate complete transcript Word*.

Adopt a three-state document status the Workspace always displays:

- **Complete transcript ready**
- **Complete transcript blocked — action required**
- **Testimony body only**

**Manual test**

1. Create a throwaway deposition through ordinary Intake. Never a real matter, never the fixture generator.
2. Add or transcribe a short controlled recording.
3. Open Workspace without creating assembly information.
4. Read the document status. Generate Word.

*Pass:* the screen says complete assembly is unavailable and why; the button says testimony-only; the output is `professional-testimony.docx`; the notice states that title, appearances, index and certification pages are absent.

*Fail:* generic success; the reporter must infer the document type from the filename.

*Mutation check:* remove the warning and confirm the corresponding test fails. Restore it. A warning that shows in both states is not a warning.

---

### Priority 2 — Add the reporter-facing complete-transcript assembly action

Add the smallest sufficient workflow that creates the assembly authority the engine already expects. A **Prepare Complete Transcript** panel in the Workspace collecting or confirming: jurisdiction/profile; signature requested or waived; the basis for that disposition; examining attorney or examinations; required certification values; time allocations where known.

The **server** writes the versioned `complete-transcript-assembly.json` atomically. The browser supplies administrative authority only — it must not construct pages or pagination. The shared model remains the single document authority.

**Manual test**

1. Throwaway deposition created through Intake — not a fixture script.
2. Short audible recording; transcribe or load controlled evidence.
3. Assign witness and attorney speakers.
4. Open **Prepare Complete Transcript**; select Texas freelance deposition; choose the signature disposition and enter its basis; select the examining attorney; resolve required certification information; save.
5. Reload the browser. Generate Word.

*Pass:* assembly survives reload; Workspace reports **Complete transcript ready**; output is `complete-transcript.docx`; the document contains, in order — title, appearances, index, testimony, changes/signature where applicable, certification; Workspace, Word and PDF page breaks agree.

*Fail:* assembly disappears after reload; Workspace silently returns to testimony-only; administrative pages are absent; the UI invents its own pagination values.

---

### Priority 3 — Cover the DOCX boundary in the automated suite

Placed here, above the examiner fix, because Priorities 1 and 2 both change code that feeds the renderer and neither is currently protected by anything.

Add one test that runs by default when a working interpreter is present and calls `createTranscriptDocxArtifact` — not `createFixedPageDocxSpec` — then reopens the produced file and asserts page count and 25 line positions per non-final page. Relax the guard so it matches the runtime's own resolution (`process.env.DEPO_PRO_PYTHON ?? "python"`) and skips with a stated reason only when the interpreter or `python-docx` is genuinely absent.

**Manual test**

```bash
npm run verify
```

*Pass:* the run produces at least one real `.docx` and asserts against its reopened contents; the test count rises; removing a geometry constant makes it fail.

*Fail:* the suite is green with no `.docx` written anywhere.

*Cross-boundary rule:* asserting that spec JSON equals expected JSON proves nothing about the deliverable. The assertion must read the rendered file.

---

### Priority 4 — Require an authoritative examiner in the index

Remove the placeholder fallback. Complete assembly must use a reporter-selected canonical participant or explicitly entered, reporter-authorised examination data. With neither, complete generation stops with a corrective message.

**Manual test**

1. On the Priority 2 deposition, select an attorney with a distinctive name.
2. Generate the complete transcript; open the DOCX in desktop Microsoft Word; read the index.
3. Compare the index page range against the actual testimony pages.

*Pass:* `Examination by [the selected attorney]` with a range matching the document.
*Fail:* the placeholder appears anywhere; the wrong attorney appears; the range disagrees.

*Missing-authority test:* clear the examination selection and regenerate. Generation must refuse with a specific message, not print a guess.

---

### Priority 5 — Repair the standalone certification index

Per §5. Either supply real pagination to the standalone path, or add a blocking finding so the document refuses rather than printing a defaulted appearances page and a blank certificate page number. Emitting nothing is correct; emitting a confident wrong number is not.

**Manual test**

1. Throwaway deposition → **Certification pages** → Texas · signature waived → complete the certificate fields → Preview.

*Pass:* either the index shows real page numbers, or a blocking finding appears and *Generate Word document* is disabled.
*Fail:* it previews clean and generates a document whose index has a blank certificate page number.

*Mutation check:* remove the new finding and confirm the preview goes clean again.

---

### Priority 6 — Live Deepgram external qualification

The most important external-service gate. A qualification task, not a development task.

**Manual test**

1. Configure the ordinary Deepgram credential through Administrator Settings.
2. Throwaway deposition. Record ~60 seconds of clearly spoken controlled audio, preferably two channels — room microphone and a virtual-meeting or participant channel.
3. Observe live text. Stop and finalize. Run the normal prerecorded transcription path. Inspect the evidence inventory.

*Pass:* live text corresponds to audible speech; recording remains safe if live text becomes unavailable; correct channels preserved; the durable job contains `request.json`, `raw-response.json`, `asr-evidence.json` and the working transcript; the audio SHA-256 agrees with the request evidence; words carry timestamps and confidence; diarization metadata is preserved where returned; no credential appears in logs, URLs or artifacts.

If credentials remain unavailable, record exactly:

```
NOT TESTED — EXTERNAL CONFIGURATION REQUIRED
```

Do not call it passed.

---

### Priority 7 — Full ordinary-workflow qualification

After Priorities 1–6, take one disposable deposition through the entire reporter path. Do not use the fixture generator.

```
New Deposition → Notice extraction or manual intake → canonical data review
→ four-channel recording → stop/finalize → Deepgram evidence → speaker reconciliation
→ scoping/editing → low-confidence review → complete-transcript preparation
→ Workspace final pages → DOCX → Word Save/Close/Reopen → PDF
```

Verify: no silent fallback; correct examiner; correct appearances; Q/A and objections; audio playback and highlighting; autosave and reload; split and Backspace/Delete joins; complete index; certification; exact Word/PDF pagination; immutable evidence unchanged.

**This is the release-candidate gate.**

---

### Priority 8 — Approved oath wording *(externally blocked content)*

Obtain approved jurisdiction-specific wording for the witness oath, the civil affirmation, and the interpreter oath. Do not convert internet examples or informal practice into approved legal templates without authority.

**Manual test:** throwaway Texas deposition → Opening → verify caption and participants → select the approved oath or affirmation → complete the workflow.

*Pass:* approved text appears; source and classification are recorded; no placeholder remains; the workflow can reach 7/7 readiness.
*Fail:* a bracketed placeholder is readable on the record; selecting "Oath" alone makes an unavailable template appear ready.

---

### Priority 9 — Counsel editing UI

The server capability exists and is tested; no screen calls it. Place the caller near participant and speaker reconciliation rather than building a separate participant application.

**Manual test**

1. Throwaway deposition created without a Notice. Open Workspace; confirm no attorneys are offered.
2. Add two attorneys with firms, roles and represented parties. Assign one as examiner. Reload. Generate a complete transcript.

*Pass:* attorneys appear immediately as speaker candidates; data survives reload; appearances use the same canonical records; the selected examiner reaches the index; no duplicate participant store is created.

---

### Priority 10 — Remove stale Preview messaging

`TranscriptPreviewScreen.tsx` still shows a disabled **Export unavailable** control tooltipped *"PDF and Word output follow after page geometry is verified."* The geometry is verified and Word generation exists in the Workspace, so the screen now states something false. Remove the control and tooltip, or route it to the authoritative Workspace action. Do not build a second export engine.

**Manual test:** open Print Preview. *Pass:* no screen claims geometry is unverified; no disabled control suggests Word generation is unavailable; any export action routes to the same qualified authority.

---

## 8. Deferred

None of these should block a first Texas single-volume local release unless the intended scope requires them.

- **Federal certification (0%)** — wait for approved authority; continue failing closed.
- **Multi-volume (60%)** — plan separately after single-volume is stable. It touches audio identity, page ranges, indexing and assembly; it is not a cleanup item.
- **Exhibit collection (15%)** — build from canonical exhibit records when prioritised.
- **AI correction pass (45%)** — decide deliberately: expose a minimal propose/review/accept workflow, or remove the unreachable code. Do not let it distract from the release bridge.
- **Reporter directory edit/delete (80%)** — add when routine profile maintenance is needed; preserve audit and certificate authority.
- **Workflow-status lifecycle (20%)** — make it drive navigation or remove it. A field nothing reads earns nothing.
- **Source-text pins (§6a)** — a source-text pin is a **placeholder, not coverage**. Each one gets an inventory entry naming what it cannot reach. Not work now: the trigger is the render harness at Checkpoint 3, and that inventory is the list of what it should replace first. Deferred alongside it, not instead of it.
- **Four distinct capture devices on this hardware** — the open question is not "does the app support four channels" but "can Windows open four distinct DirectShow capture devices at once here". DirectShow hands a device to the first `ffmpeg` and refuses the second; what was measured in August was four processes across **two** devices. Answerable in twenty minutes with four real devices and no application involved. Not scheduled — but do not let a percentage stand in for it.
- **RX profile qualification (80%)** — continue real-speech measurement for any profile proposed as automatically ASR-safe. Keep uncertain profiles review-only.

---

## 9. Implementation discipline

**Keep the frozen baseline recoverable.** Do not rewrite `80e516c`. Work on an integration branch.

**Three reviewable checkpoints**, so risk stays legible and rollback stays independent:

1. Truthful fallback status
2. Complete assembly workflow **and DOCX regression coverage**
3. Examiner/index authority, standalone index repair, and full qualification

**Use ordinary-workflow fixtures.** The principal missing test is not another direct model fixture. It is a test that creates a deposition through the same path a reporter uses and then requests a complete transcript.

**Test across the actual boundary.** Do not accept `model JSON equals expected model JSON`. Require:

```
ordinary UI → persisted assembly authority → shared model → DOCX
→ desktop Microsoft Word → Save/Close/Reopen → PDF
```

**Update documentation last.** The README still carries boundaries that predate the qualified Workspace and complete-document work — including the claim that the reporter directory is browser-managed, which is no longer true. Update it after the release bridge is accepted, so it describes the application that actually ships.

---

## 10. Standing regression gate

Before and after every authorised item:

```bash
npm run verify && git diff --check && git status --short
```

Expected: 905 tests, 893 passed, 12 skipped, 0 failed; TypeScript, ESLint and production build pass; `git diff --check` clean.

Also verify after every relevant change: immutable evidence hashes unchanged; reporter overlays remain separate; stable paragraph and token identities survive; `TEXAS_FREELANCE_DEPOSITION_V1@1.0.0` constants unchanged; Workspace and DOCX still consume one shared pagination authority; Word Save/Close/Reopen stable; PDF line parity exact; no real deposition used; no OneDrive or LibreOffice involved.

**Honest limit of this gate, until Priority 3 lands.** `npm run verify` does not render a DOCX and does not check PDF parity. Those two lines are manual checks today. Listing them under an automated gate — as earlier drafts of this report did — overstates what green means.

---

## Final recommendation

Accept `80e516c` as the frozen, qualified **architecture** baseline. Do not yet describe it as a reporter-ready release.

The next work is one narrowly bounded integration package:

```
Truthful document status
        ↓
Reporter-created complete assembly  +  DOCX regression coverage
        ↓
Canonical examiner in index  +  standalone index repair
        ↓
Ordinary-workflow Word/PDF qualification
        ↓
Live Deepgram external gate
        ↓
Release-readiness decision
```

The editor, geometry, paginator and DOCX architecture do not need another redesign. The highest-value work is to give the reporter a truthful, ordinary path into the complete engine that already exists — and to put a regression gate around the deliverable that engine produces.
