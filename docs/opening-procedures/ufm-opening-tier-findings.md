# UFM Findings — Opening Procedures Tier Rulings

### Scope of source read — authoritative statement

**This block is the single scope statement for all opening-procedures material. Other documents reference it and must not restate it.** Every negative claim in this file, in the oath inventory, and in the builder brief rests on this list. Amend it here only.

| Source | Read | Not read |
|---|---|---|
| UFM body, 2010 edition | Preface; §1 Definitions; §2 Page Formatting in full; §§3.1–3.24 | §§3.25–3.26; §§4–10 |
| Side-by-side analysis of the May 25, 2010 order | pages 1–18 | pages 19–33 |
| UFM figures, `UFM-Examples (2).pdf` | Figures 1, 6, 7, 7A, 8, 8A, 8B, 9, 9A, and 10 through 27 | Figures 2, 3, 4, 5, and 28 onward |
| Specimen transcripts | 21 `.docx` files, per `docs/opening-procedures/specimen-oath-extraction.txt` | — |
| Working tree | `server/insertion-pages/`, `server/opening-procedures.mjs`, `app/OpeningProceduresScreen.tsx`, `templates/insertion-pages/` | the rest |
| Texas authority | **nothing** | TRE 603, TRE 604, Gov't Code § 154.105, TRCP 199, TRCP 203 |

Figure page offset in `UFM-Examples (2).pdf`: figure number + 5 from Figure 9 onward, because Figure 9A occupies its own page. Figures 9 through 17 are pages 13 through 22.

**No Texas rule or statute has been read at any point in this investigation.** Every tier in this file that rests on TRE or Government Code authority rests on an unread source and is marked as such.

**Home of record.** These documents live in `docs/opening-procedures/` and are cited by repo path. They were previously loose in an unversioned Downloads folder, where on 2026-08-29 two were deleted and three were renamed without anyone intending it. Cite the repo path. Do not cite a Downloads path.

**Provenance of the specimen extraction.** `specimen-oath-extraction.txt` in this directory is a **regeneration**, produced 2026-08-29 by `extract-specimen-oaths.py` after the original was removed from Downloads. It is a reproduction, not the original artifact. It was verified on two independent axes before being accepted:

| Check | Meaning of failure | Result |
|---|---|---|
| String match, 20 assertions | A finding is now wrong | **20/20 pass** |
| Offset drift, 14 offsets | A source `.docx` was touched; findings text may hold but printed offsets no longer address the same bytes | **14/14 unchanged** |

Both axes are reported in PART 4 of the extraction file itself. Re-run the script to reproduce. A future regeneration that passes string match but shows offset drift is still usable for the findings' text and is **not** usable for anything that cites an offset.

Status of this file: findings, not rulings. Each item below is proposed for the ruling record. Assign real IDs under `docs/architecture/adr/` when adopting. Nothing here has crossed an authorship boundary; the reader of the source is also the writer of this file.

Two items reverse earlier statements made in conversation. They are marked **CORRECTION** and the earlier position is stated so the record shows what changed.

Items revised in the 2026-08-29 figures pass are marked **AMENDED**. The superseded reasoning is left standing above each amendment rather than deleted, so the record shows what the finding rested on before the figures were read.

---

## F-01 — The interpreter oath is not PRESCRIBED

**Status:** proposed, settled on the source
**Affects:** interpreter oath template record, tier label shown in the app

The tier splits three ways. Do not label the step with one tier.

| What | Tier | Basis |
|---|---|---|
| That an interpreter be sworn | REQUIRED-IN-SUBSTANCE | TRE 604. **Not read.** See O-01. |
| The wording of the oath | CUSTOMARY, with a suggested form published by the Supreme Court | The §3.11 box |
| That the transcript record it | MANDATORY | §3.11 body text, with Figure 16 |

Three independent indicators on the page support the middle row:

1. The heading is worded as a suggestion, not a requirement.
2. It sits in a box in reduced type. The UFM preface at printed page 3 states that such commentary does not prescribe format or content of the record and instead provides explanation and reference to statutes and court rules.
3. The mandatory sentence in §3.11 is about the transcript, not the script. It requires that the transcription show the witness's name and indicate the witness was sworn.

**Consequence for the app:** the interpreter oath step must not present as statutorily mandated wording. The mandatory obligation attaches to what the transcript shows, which is a renderer concern, not a script concern.

**CORRECTION.** I previously listed UFM §3.11 among citations to verify as possibly not existing. It exists and it carries interpreter oath text. The other model was right on that point. The error was in the tier, not the existence.

---

## F-02 — Figure 17 is a superseded cross-reference, and Figure 17 is something else entirely

**Status:** proposed, settled on the source **and on the figure itself**

The analysis at page 15 shows the 2003 manual's §16.2 pointing to Figure 17 for the interpreter material. The 2010 §3.11 references Figure 16 and drops that cross-reference.

**AMENDED.** Figure 17 has now been read. It is titled **"QUESTIONS AND ANSWERS"** and shows a Q&A tab-setting example beginning "Would you give your full name, Ann?" It contains no oath and no interpreter material of any kind. §2.11 cites it for tab settings, which is consistent with what is on the page.

The finding no longer rests on inference from the side-by-side analysis. The cited figure refutes the citation directly.

A draft citing Figure 17 for an interpreter oath is therefore wrong twice over: it is working from the edition the Supreme Court replaced, and it names a figure that does not carry that content in either edition's numbering as published here. This is Prompt B check #4, and the model that produced it reported nothing unverified.

---

## F-03 — The Court removed the response line from the suggested oath

**Status:** proposed, settled on the source
**Affects:** prompt pack rule 5a and the EXPECTED RESPONSE output field

The 2003 suggested oath block included the interpreter's affirmative reply inside it. The 2010 revision removes it.

The separation of spoken script from expected response is therefore the Court's own editorial decision, not a design preference invented in this project. Rule 5a in the prompt pack and the EXPECTED RESPONSE field in the sequencer both inherit source backing from this.

---

## F-04 — More than one deposition officer, each certifying their own recording

**Status:** proposed, settled on the source
**Affects:** builder brief §4 (`officers` array) and §8 (certificate linkage)

The §3.3 comment states that there may be more than one deposition officer, that both the stenographic and the non-stenographic recorder are deposition officers, and that each complies with Rule 203 as to the form of recording that person was responsible for.

This is stronger than the `officers` array assumed. Brief §8 currently frames the question as one certificate naming the administering officer. The source frames it as **each officer certifying the recording they were responsible for**.

**AMENDED.** The published certificate form has now been read and it has no way to express a two-officer deposition. See F-10. That narrows this question but does not answer it.

**Open design question, not yet decided:** does a two-officer deposition produce two certificates, and does the certification page need to generate per-officer? Do not let a builder resolve this by inference. Note that every available answer diverges from a published Supreme Court figure — see F-10 — so this is a ruling to be recorded and justified, not a design to be chosen on convenience.

---

## F-05 — Who may administer, and the Chapter 52 renumbering hazard

**Status:** substance proposed as settled; **all section numbers presumptively stale**
**Affects:** every Government Code citation inherited from this manual

The §3.7 comment states that where a party arranges non-stenographic recording by someone other than a CSR, the party must arrange for the witness to be sworn by a notary or another person competent to administer oaths. It cites TRCP 199.5(b) and Government Code § 52.025(b), the latter for the proposition that a CSR is competent to administer oaths.

**CORRECTION.** I previously flagged § 52.025(b) as doubtful. The manual confirms it as of 2010. But the reason it remains doubtful today is different and blanket:

> Every Government Code citation in this 2010 manual is to Chapter 52 — 52.001, 52.013(a)(7), 52.021(e), 52.021(f), 52.025(b), 52.033. Reporter regulation moved to Chapter 154 under the Judicial Branch Certification Commission. The substance likely survived. The numbers did not.

The Chapter 154 successor for oath authority appears to be § 154.105, "Title; Oaths." Its text has not been read here. See O-02.

**Rule to adopt:** no Government Code section number sourced from this manual may be cited in a template record or a certificate without independent confirmation of the current number. Treat manual-sourced Gov't Code cites as leads, never as citations.

---

## F-06 — TRCP 199.5(b) governs swearing, not an officer's opening statement

**Status:** proposed, settled on the source

The manual cites 199.5(b) in connection with swearing the witness. That is what it governs.

The earlier draft that cited 199.5(b) for an officer's opening statement containing name and address, date, time, place, deponent name, administration of the oath, and identity of all persons present was reproducing FRCP 30(b)(5)(A) under a Texas rule number. Confirmed. Prompt B check #5.

**Consequence:** the On-Record Commencement step has no Texas mandate of that scope. It is CUSTOMARY unless something not yet read says otherwise. Do not label it as required.

---

## F-07 — Recommended transcript notations map onto the sequencer branches

**Status:** proposed, settled on the source
**Affects:** builder brief guard #5 (already amended)

§3.16(a) gives recommended record notations that correspond one to one with the sequencer's conditional branches: interpreter sworn, witness sworn, witness affirmed.

The oath/affirmation exclusion is therefore not only a choice of script. It selects which parenthetical enters the transcript. Guard #5 now asserts the emitted notation rather than only which script rendered.

---

## F-08 — Figure 16 makes the transcript assert that the interpreter was sworn

**Status:** proposed, settled on the source
**Affects:** builder brief guards #1 and #3, and the renderer

Figure 16, "Witness Sworn Through Interpreter", is two lines:

> `^ WITNESS NAME,`
> `having been first duly sworn, testified through the duly sworn interpreter as follows:`

The transcript does not merely record that a witness was sworn. It affirmatively states that **the interpreter was also sworn**, and it does so in the same sentence, before any testimony.

**Consequence.** Guard #1 (placeholder text blocks advance) and guard #3 (interpreter oath precedes admonitions) are not two unrelated protections. They defend the same sentence. If the interpreter step is skipped, or its text is unresolved, and the renderer still emits Figure 16, the certified transcript asserts a fact that did not occur.

**AMENDED 2026-08-29, after reading the working tree. The stated consequence cannot occur in current code.**

The consequence above assumes the renderer emits Figure 16. It does not. There is no setup-line generator anywhere in the application: a search for `testified as follows` across `server/ app/ lib/ src/ templates/` returns nothing outside `scripts/create-milestone2-browser-fixture.mjs`, a synthetic fixture. The setup line, like the §3.16(a) notation in F-15, is transcript body content rather than generated output.

The refusal behaviour in brief §6 is correct. This was the wrong justification for it. Same error as guard #5 in F-15, one finding over, and this one was load-bearing: F-08 was cited as the clearest evidentiary reason for §6.

**Re-anchored to F-18.** The evidentiary case for §6 belongs on the certification page, which *is* generated, *is* certified output under the reporter's CSR number, and *does* carry a false assertion that measurement has confirmed. Brief §6 has been amended accordingly.

F-08 survives as a **source** finding — Figure 16 does make that dual assertion, and that remains true of any transcript produced to the figure. It no longer supports a claim about what this application does. See F-19.

---

## F-09 — Depositions head the setup EXAMINATION, not DIRECT EXAMINATION

**Status:** proposed, settled on the source
**Affects:** the renderer and the examination-commencement step. **Not** the sequencer.

Figures 14 and 15 are otherwise identical and differ in one line:

| Figure | Applies to | Heading |
|---|---|---|
| 14 | Official Reporter's Record (trial) | `^DIRECT EXAMINATION` |
| 15 | Freelance Transcription (deposition) | `EXAMINATION` |

Both open `^WITNESS NAME,` / `having been first duly sworn, testified as follows:` and both follow with `BY ^MR./MS. ^LAWYER:`.

**Checkable now, without code.** Etminan, Thomas and Baier are depositions. If those transcripts head the setup DIRECT EXAMINATION, the renderer is applying the trial figure to deposition output. That is a live divergence from a published figure, it exists today, and it has nothing to do with the opening sequencer.

Recorded here because it was found here. Not proposed as work under the sequencer brief.

---

## F-10 — The published certificate names one officer and provides one signature

**Status:** proposed, settled on the source
**Affects:** builder brief §8, and F-04's open question

Figure 9, "Certification Page When Signature Waived — Freelance Transcriptions", contains:

> `That the witness, ^WITNESS NAME, was duly sworn by the officer and that the transcript of the oral`
> `deposition is a true record of the testimony given by the witness;`

**"the officer."** Singular, and unnamed — the form does not carry a slot for who administered the oath. Figure 9A closes with a single signature block: one reporter's name, one Texas CSR number, one expiration date, one firm registration number, one address.

**Consequence.** The two-officer question in F-04 is not a choice between one certificate and two. The published form **cannot express a two-officer deposition at all.** Whatever the app does there departs from a Supreme Court figure.

That does not make it wrong. §3.3 expressly contemplates more than one deposition officer, each certifying the form of recording they were responsible for, so the figure and the comment are already in tension in the source. But it does mean the departure is deliberate and must be recorded as such.

**Consequence for brief §8.** The instruction that the certification page must name the administering officer goes beyond the published form. Before building it, decide whether the app is following Figure 9 or departing from it. A builder must not settle that.

---

## F-11 — This was verified once already and did not surface

**Status:** process finding, not a source finding

`UFM_CITATION_VERIFICATION_2026-05-31.md`, dated 2026-05-31 and sitting in the same folder, already records:

| Claim | Correct UFM location |
|---|---|
| Interpreter setup + oaths | **3.11, 3.12**, Figure 16 |

The Figure 16 answer had been verified three months before this conversation began, in a file on the same disk, and it did not surface when a model asserted Figure 17 and when this file recorded the figures as unavailable.

That same file lists Figure 9/9A under "Unverifiable from manual body — do not assert." The figures document verifies it outright; the page header reads "CERTIFICATION PAGE WHEN SIGNATURE WAIVED - FREELANCE TRANSCRIPTIONS - Figure 9." That row can be promoted to verified.

**Consequence.** The risk in this material is not that verification is hard. It is that completed verification is not findable. Adding a fourth file with "opening" in its name makes that worse, not better.

---

# Specimen findings — added 2026-08-29

Source: `specimen-oath-extraction.txt`, generated 2026-08-29 from `word/document.xml` of 21 `.docx` files, tags stripped, whitespace collapsed, no normalisation, byte offsets recorded.

Canonical specimens: `Baier_Jennifer_Deposition_2026-05-04.docx`, `Etminan_Mohammad_Deposition_2026-04-24.docx`, `Thomas_Heath_Deposition_2026-04-30.docx`.

**CORRECTION.** I predicted this extraction would find nothing, on the reasoning that §3.16(a)'s parenthetical and Figures 14–16's setup line exist so the oath need not be transcribed verbatim. All three canonical specimens carry the oath verbatim. That is the second prediction in this file the source has overturned. The reasoning was sound and the premise was wrong: the conventions are permissive, not substitutive.

---

## F-12 — The witness oath is one fixed string across all three specimens

**Status:** settled on the specimens
**Affects:** oath inventory item 4

Identical across all three canonical files, punctuation included:

> `Do you solemnly swear to tell the truth, the whole truth, and nothing but the truth, so help you God?`

The preamble varies by honorific only (`raise your right hand, sir?` / `ma'am?`). The response is not part of the oath and varies: `MR. ETMINAN: I do.`, `MS. BAIER: Yes, ma'am.`, and absent from canonical Thomas. This matches F-03, where the Supreme Court removed the reply from its own published form.

Seventeen of twenty-one files carry this string. **Read F-13 before treating that as independent corroboration.**

---

## F-13 — The identity is produced downstream, so the specimens evidence what was certified, not what was said

**Status:** settled on the specimens
**Affects:** F-12, and the tier for oath inventory items 4 and 5

Two files carry a different oath sentence, dropping the comma before `so help you God`. Both are Thomas:

> `Do you solemnly swear to tell the truth, the whole truth, and nothing but the truth so help you God?`

`Heath_Thomas_Current_DEPO_PRO_Export.docx` is ASR-stage. Its colloquy contains `SPEAKER 0:` inline, its response line reads `SPEAKER 0:I'm sorry, sir. I didn't hear you.`, and it has no setup line and no examination heading. Diarization is unmapped.

So for one deposition, the ASR output and the canonical output disagree on the oath sentence, and the canonical output agrees byte for byte with two other depositions. The punctuation is being normalised somewhere between capture and canonical.

**Two consequences.**

First, this is the positive control. Byte-identical text across seventeen files is the suspiciously clean measurement, and it would not be trustworthy on its own. The two divergent files prove the extraction detects variance when variance exists.

Second, and this is the finding: the specimens are strong evidence of **what the reporter certified**, and weak evidence of **what the reporter said**. That is sufficient to close oath inventory item 4 as a template, because the certificate attests to the transcript. It is not sufficient to support a claim about spoken practice, and the tier stays CUSTOMARY. The specimens are evidence of practice. They are not authority.

---

## F-14 — All three canonical specimens are remote, with remote swearing stipulated on the record

**Status:** settled on the specimens
**Affects:** the modality gap in the oath inventory

Every canonical specimen carries a stipulation taken before the oath, agreeing to the remote deposition and to remote swearing of the witness. The 2010 UFM predates remote depositions and cannot supply this. The specimens can.

The wording is **not** a template. Three genuine variants across three depositions:

| File | Text |
|---|---|
| Baier | `who you're representing, and the name of the city you're currently in` |
| Etminan | `who you're representing, and the name of the city you are currently in` |
| Thomas | `who you're representing, the name of the city you are currently in` |

Contraction differs, and Thomas drops the `and`. Contrast F-12, where the oath is fixed to the character. The oath reads as recited from something; the stipulation reads as spoken extemporaneously.

**Consequence.** The remote acknowledgment step in brief §5 is supported by the reporter's actual practice, but it has no canonical wording. If it is templated, the template is a new authored artifact, not an extraction, and it should be recorded as such.

---

## F-15 — The §3.16(a) parenthetical exists upstream and reaches no canonical specimen

**Status:** observed, not diagnosed

`(The witness was sworn.)` appears in three non-canonical files: `Dr_Etminan_Transcript.docx`, `Dr_Etminan_Transcripttest.docx`, and `Thomas_Deposition_Thursday April 30 2026.docx`.

It is absent from all three canonical specimens.

The recommended notation is therefore being produced at some stage and does not survive into canonical output. Whether that is deliberate, a pipeline drop, or an artifact of which files became canonical is not determined here. Recorded because F-07 and guard #5 both assume the renderer emits this notation, and no canonical specimen shows it doing so.

**AMENDED 2026-08-29, after reading the working tree.** The mechanism is now determined, and it is not a pipeline drop. **No code in the application emits this notation, or any §3.16(a) notation, ever.**

- `grep -rniE "witness was sworn|witness was affirmed|Interpreter sworn"` across `server/ app/ lib/ src/ templates/` returns one hit, and it is a source comment in `server/opening-procedures.mjs:23`.
- `server/transcript-labels.mjs` defines `PARENTHETICAL_CENTERED` and `PARENTHETICAL_INDENTED`, but these are **layout rules for positioning a parenthetical that is already present in the transcript text**. Nothing decides that a parenthetical should exist.

The notation is therefore transcript body content — typed, dictated, or carried from an earlier tool — not generated output. It reaches no canonical specimen because nothing produces it.

**Consequence for F-07 and builder brief guard #5.** Guard #5 was amended on 2026-08-29 to assert the emitted parenthetical. **That guard cannot be written against current code**, because there is no emitter to assert on. Either the brief adds an emitter as new scope, or guard #5 reverts to asserting the selected script and the notation stays a reporter responsibility. This is a decision, not a defect, and it is now O-09.

---

## F-16 — No canonical specimen contains the certificate line

**Status:** observed, not diagnosed

`That the witness, … was duly sworn by the officer` appears in seven files. None is canonical.

Two further observations from those seven:

- **Witness name casing diverges.** `That the witness, Heath Thomas,` in `Thomas_Deposition_Thursday April 30 2026.docx` against `That the witness, HEATH THOMAS,` in `heath_thomas_deposition.docx`. Figure 9 uses the caret convention for this slot. Under the standing rule that party names store mixed and render ALL CAPS at print, the mixed-case rendering is a miss. Both files are non-canonical, so this may be historical.
- **`Etminan_Deposition_Transcript_UFM.docx` carries the certificate line and the setup line but no oath colloquy at all.** A document asserting twice that the witness was sworn, containing no record of the swearing. That may be correct if it is certificate-and-front-matter output rather than a full transcript. It is the exact shape of the risk in F-08, so it is named rather than assumed benign.

---

## F-17 — The affirmation has no source in any direction examined

**Status:** settled across all sources read

`affirm` as a witness response is absent from all twenty-one files. No specimen touches oath inventory item 4's substitute.

Combined with what is already recorded: the UFM publishes no affirmation wording, Figures 14, 15 and 16 all read `having been first duly sworn`, and both certificate figures read `was duly sworn by the officer`. §3.16(a) offers `(The witness was affirmed)` and gives nothing to attach it to.

So for an affirming witness there is no published spoken text, no published setup line, no published certificate line, and now no specimen precedent either.

**Consequence, and this one may be live.** The app currently offers Affirmation as a value in Witness oath selection. If the renderer and the certification page emit the sworn forms regardless of that selection, then selecting Affirmation produces certified output asserting an oath the witness did not take, under a CSR number. That is a defect check against current behaviour, not research, and it is independent of everything else in this file.

---

## F-18 — O-06 closed: the certificate asserts an oath regardless of the selection

**Status:** **CONFIRMED DEFECT**, measured against current behaviour on 2026-08-29
**Closes:** O-06
**Affects:** the certification page. Not the sequencer, not any open authority question.

The conditional in F-17 is resolved. The app does emit the sworn form regardless of the selection.

**Static findings.**

- `app/OpeningProceduresScreen.tsx` offers `Witness oath selection` with values `UNRESOLVED / OATH / AFFIRMATION`. The choice is persisted: `server/opening-procedures.mjs:123` validates it against that list and writes it to the opening state.
- Both Texas certification templates carry the sentence as a **literal string with no token and no conditional**:
  - `templates/insertion-pages/TEXAS_STATE_SIGNATURE_REQUESTED/certification-1.tmpl:13`
  - `templates/insertion-pages/TEXAS_STATE_SIGNATURE_WAIVED/certification-1.tmpl:13`
  - both read `That the witness, ^deposition.witness^, was duly sworn by the officer`
- `witnessOathSelection` has **no consumer outside `server/opening-procedures.mjs` and its tests.** No certificate code path reads it.

**Measured, not inferred.** A throwaway record — witness `Jordan Throwaway`, cause `2026-CI-99999`, no specimen touched — was driven through the real path: `createCanonicalDepositionRecord` → `loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED")` → `assembleInsertionInput` → `buildTexasInsertionPageSet`. Built twice, once with `witnessOathSelection: "OATH"` and once with `"AFFIRMATION"`.

```
certification page, witnessOathSelection = OATH
    That the witness, Jordan Throwaway, was duly sworn
certification page, witnessOathSelection = AFFIRMATION
    That the witness, Jordan Throwaway, was duly sworn

sha256 identical across both selections : true
certification text identical            : true
contains 'affirm' anywhere              : false
```

**Positive control.** The same probe was run again changing `proceedingHeading`, a field the renderer does read. The sha256 differed. The probe detects change when change occurs, so the identical result above is a real null and not a broken harness.

**Consequence.** A reporter who selects Affirmation — correctly recording that the witness declined to swear — still generates a certification page stating the witness was duly sworn, under the reporter's name, CSR number and signature. No guard exists and no test covers it.

**Currently latent.** No specimen involves an affirming witness (F-17), so no incorrect certificate is known to have been produced. The defect is waiting on its first affirming witness.

**The narrow fix does not require closing any authority question.** The certificate does not need affirmation wording in order to stop asserting an oath. Refusing to generate when `witnessOathSelection` is `AFFIRMATION`, on the ground that no approved affirmation certificate line exists, closes the false-assertion path without inventing text. Recorded as O-10.

---

## F-19 — The certificate is generated; the transcript body is not

**Status:** rule proposed, derived from the F-15 and F-08 amendments
**Affects:** every evidentiary argument in this material

Two findings in this file placed an evidentiary argument on the transcript body, and measurement invalidated both the same way.

| Finding | Argument as written | Why it failed |
|---|---|---|
| F-07 / guard #5 | The renderer emits the §3.16(a) notation, so the branch selection has evidentiary weight | No code emits any notation |
| F-08 | The renderer emits Figure 16, so a skipped interpreter step yields a false transcript assertion | No code emits a setup line |

The dividing line:

| Artifact | Generated by the app? | Can carry a false assertion the app is responsible for? |
|---|---|---|
| Certification page | **Yes** — `templates/insertion-pages/`, via `buildTexasInsertionPageSet` | Yes. Confirmed by measurement in F-18 |
| Title page, appearances, index | **Yes** — `templates/insertion-pages/common/` | Yes |
| Transcript body: setup line, all parentheticals, the oath colloquy | **No** — typed, dictated, or carried from an earlier tool. `server/transcript-labels.mjs` positions parentheticals that already exist and authors none | Not by the app |

**Rule to adopt.** An argument that this application produces a false assertion must name a generated artifact. Where the assertion lives in the transcript body, the application's exposure is at most that it failed to help — a usability claim, not an evidentiary one.

Applying this rule before writing would have caught both failures. It is cheap to apply: name the file that emits the string.

---

## F-20 — Absence of a state file must never mean permission

**Status:** rule proposed. **Supersedes a rejected proposal, recorded below so it is not re-proposed.**
**Affects:** O-10, and any future guard that reads opening state

**REJECTED PROPOSAL, and why.** It was proposed that `updatedAt === null` in `blankState` (`server/opening-procedures.mjs:78-88`, returned by `readOpeningState` at line 98 when no file exists) be read as "this deposition predates the Opening workflow", and that certificate generation therefore be permitted in that case while refusing on a saved `UNRESOLVED`.

That is wrong. `updatedAt === null` does not mean the deposition is old. It means **no state file was found**, which is equally true when:

- the deposition was created today and the reporter never opened the Opening screen;
- the state file was deleted — and the library is user-visible folders on disk;
- a write failed, or a read errored and fell through.

The first case is fatal. A deposition taken next month, where the reporter skips the Opening screen entirely, returns `updatedAt === null` and generates the sworn certificate with no recorded basis — the exact failure the proposal was meant to close, now under a rule stating the application permitted it.

The defect in the reasoning is worth naming precisely, because it is repeatable: the discriminator distinguishes **saved from not-saved**, and the proposal then inferred **old from new** out of it. Those are different facts.

**Rule to adopt.** A safe path must never be triggered by the absence of a file. In a local-first application with user-visible, unmanaged folders, absence is the cheapest state for the world to produce and the least trustworthy thing to grant permission on. Permission must rest on something the record affirmatively says.

**The adopted form for O-10.** Refuse to generate the certification page **unless the record affirmatively states that an oath was administered.** Exactly two things satisfy that:

1. `witnessOathSelection === "OATH"`; or
2. a recorded migration field carrying `who` and `when`, in the same shape the correction log already requires.

Then backfill the existing library, writing that field with attribution. The library is small and bounded. F-12 supports `OATH` directly for the three canonical specimens; nothing supports it for the rest, so the rest are a judgement recorded as a fact rather than an inference left implicit.

This closes `AFFIRMATION`, closes `UNRESOLVED` in **both** of its forms, and never lets a missing file mean yes.

---

## Open items

| ID | Item | Why it matters | Who can close it |
|---|---|---|---|
| O-01 | TRE 604 not read | It is the actual authority for swearing an interpreter. F-01's top row rests on it. | Anyone with the rule text |
| O-02 | Gov't Code § 154.105 text not read | Determines the live citation for CSR oath authority, replacing the stale 52.025(b) | James — it was on screen |
| ~~O-03~~ | **CLOSED 2026-08-29.** Figures located in `UFM-Examples (2).pdf`. **Which figures were read is stated in the Scope block at the head of this file, not here.** | Superseded by F-02, F-08, F-09, F-10. The earlier statement that the figures were not present was wrong — they were on disk throughout. | Closed |
| O-04 | Two-officer certificate structure (F-04, F-10) | Figure 9 cannot express a two-officer deposition, so every available answer departs from a published figure. The departure has to be justified and recorded, not assumed. | James |
| O-05 | Lowercase-do typo in the §3.11 suggested form | Whether to reproduce the source faithfully or correct it. A deliberate divergence from a published form is a ruling, not a fix. | James |
| ~~O-06~~ | **CLOSED 2026-08-29.** The app emits `was duly sworn by the officer` regardless of the selection. | Superseded by F-18. Confirmed defect, measured with a positive control. Remediation is O-10. | Closed |
| O-07 | Whether the remote stipulation is templated or stays extemporaneous | F-14. Templating it creates a new authored artifact with no canonical source. | James |
| O-11 | Backfill the existing library with a recorded oath basis | F-20. The adopted O-10 rule refuses without one, so the backfill is a precondition for shipping the refusal, not a follow-up. Attribution required: `who` and `when`. | James |
| O-12 | Cause of the 2026-08-29 Downloads renames | Three files renamed, two deleted, none by this session. The transformation — hyphens, parentheses and spaces stripped or collapsed — matches how uploaded files are named, and the renamed set is exactly the uploaded set, which points at benign upload or sync tooling. **Confirm that, and separately confirm the outstanding credential rotation is done.** Unexplained file operations are also what that exposure would look like. Almost certainly unrelated; cheap to eliminate, expensive to skip. | James |
| ~~O-08~~ | **CLOSED 2026-08-29.** This file's *Scope of source read* block is now the single authoritative statement. O-03 and the oath inventory reference it and no longer restate it. | Amend scope in that block only. A second scope statement appearing anywhere is a regression. | Closed |
| O-09 | Guard #5 asserts an emitter that does not exist | F-15 amendment. Either the brief adds a notation emitter as new scope, or guard #5 reverts to asserting the selected script and the notation stays a reporter responsibility. | James |
| O-10 | Remediation for F-18. **Refusal is a mitigation, not a close.** | Refuse unless the record affirmatively says an oath was administered: `witnessOathSelection === "OATH"`, or a recorded migration field carrying `who` and `when`. See **F-20** — an earlier proposal keyed on the absence of a state file was rejected, and the rule against that shape is recorded there. Refusal needs no authority research and it stops the false assertion, but it converts a silent false statement into a **blocked workflow**. That is a real improvement and a worse experience. **Do not mark this item done when refusal ships.** The close requires approved affirmation certificate wording, which F-17 records as existing nowhere. | James |

---

## Raised, not proposed

The §3.3 comment carries a requirement under TRCP 203.2(e) that deposition officers certify the amount of time used by each party.

**AMENDED.** This is not adjacent to the certificate. It is inside it. Figure 9 carries the requirement in the certificate body:

> `That the amount of time used by each party at`
> `the deposition is as follows:`

followed by a per-attorney `^HRS:MIN` list. The obligation therefore already sits on the page the app renders, not beside it. Whether the app populates that block is a question about the certification page.

Still **not** proposed as work under the opening sequencer brief. Recorded so it is not rediscovered a third time.
