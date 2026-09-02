Depo-Pro-New Opening Proceeding Governance

Texas State and Federal Civil Depositions
Document type: Product-governance standard and reporter operating procedure
Status: Proposed governing baseline
Version: 1.0.0
Verified through: September 2, 2026

Scope and limitation. This document governs how Depo-Pro-New should guide, record, validate, and render the opening of a stenographically reported civil deposition. It is not legal advice and does not override a case-specific court order, local rule, deposition notice, or valid stipulation. Federal local rules and case orders must be checked for every matter. Texas UFM requirements govern the resulting Texas reporter's record; they do not create a federal transcript-format mandate.

1. Governing decision

Depo-Pro-New must maintain two distinct opening profiles:

TEXAS_STATE_CIVIL_DEPOSITION

FEDERAL_CIVIL_DEPOSITION

The product may share data fields and interface components, but it must not present one universal script as legally mandatory in both jurisdictions.

1.1 Authority tiers

Every spoken or generated block must carry one of these classifications:

Tier

Meaning

Product behavior

REQUIRED

Expressly required by a controlling rule or necessary to satisfy it

Blocks commencement or final certification if absent

REQUIRED_IN_SUBSTANCE

The legal duty is mandatory, but no exact words are prescribed

Requires an approved substance-equivalent script or a recorded variance

CONDITIONAL

Required only when a stated circumstance exists

Appears and becomes blocking only when the condition is true

CUSTOMARY

Professional practice that improves the record but is not a rule mandate

Optional; must not be described as legally required

COUNSEL_CONTROLLED

A decision or stipulation belonging to counsel or the deponent

Reporter may invite counsel to state it but must not supply or presume it

TRANSCRIPT_FORMAT

Required or recommended in the written record, not necessarily spoken

Enforced during assembly rather than treated as spoken dialogue

2. Corrections to the reviewed source material

The supplied draft contains useful components but must not become governing text without these corrections:

Texas Rule 199.5 does not require the federal five-item officer opening. It requires every oral deponent to be placed under oath before examination. The rule does not itself require the officer to announce the officer's name and business address, the date/time/place, the deponent's name, and every person present.

Federal Rule 30(b)(5)(A) does require those five categories, unless the parties stipulate otherwise: officer name and business address; date, time, and place; deponent name; administration of oath or affirmation; and identities of all persons present.

Texas appearances and an officer identification block are strong record-making practice, not Rule 199.5 mandates. Depo-Pro-New should include them as a standard Texas workflow without mislabeling the source.

The reporter must not announce that all parties stipulated unless each agreement was actually placed on the record or otherwise reliably established. The Thomas transcript's statement that all parties had stipulated occurred before the displayed individual appearances and contained no responses establishing the stipulation in that passage.

There are no universal “standard stipulations.” Objections, custody, signature, remote administration, exhibits, and other matters must be recorded individually and exactly as stated. The reporter must not propose substantive terms or act as counsel.

Texas signature review is not the same as federal review. Under Texas Rule 203.1, a stenographic transcript is presented for examination and signature unless the witness and all parties waive it or another listed exception applies. Under Federal Rule 30(e), review occurs only if the deponent or a party requests it before the deposition is completed.

The Texas 20-day period runs from provision of the transcript, not from the deposition date. The federal 30-day period runs from notice by the officer that the transcript or recording is available.

No rule requires the exact traditional religious oath wording. Texas and federal law require an oath or affirmation in substance. The script must provide a secular affirmation without requiring the witness to justify the choice.

Raising the right hand is customary, not a universal validity requirement. The oath or affirmation and the witness's unambiguous assent are the controlling record events.

The reporter's business address is federally required in the on-record opening. A firm name alone is not a business address. Texas should store the business address for certification and professional identification even though Rule 199.5 does not command its spoken inclusion.

Remote location is legally consequential. Texas Rule 199.1(b) treats a remote deposition as taken where the witness is located. Federal Rule 30(b)(4) likewise treats it as taking place where the deponent answers. The witness's location and the officer's authority must therefore be resolved before the oath.

The written witness setup is not proof that the oath occurred. Depo-Pro-New may render “having been first duly sworn” only from a recorded oath event and audible/confirmed assent, never merely because a template expects the phrase.

3. Universal pre-record gate

Before the reporter opens the record, Depo-Pro-New must require or visibly mark unresolved:

3.1 Case identity

Jurisdiction profile: Texas state or federal

Court name, district/division when applicable, and county when applicable

Exact case style from the controlling notice/caption

Cause number for Texas state matters; civil action/case number for federal matters

Deponent's full name

Deposition date

Notice/commission/order source reviewed

3.2 Officer identity and authority

Officer's full name

Business address

Credential type and number, if applicable

Credential status checked by the reporter or firm workflow

No disqualifying relationship or interest identified

Authority to administer the oath at the legally relevant location

3.3 Attendance and modality

In person or remote

Physical location of the witness: city, state, and country

Physical location of the officer when remote

Platform, if remote

Names and roles of all persons known to be present

Interpreter presence, language, mode, and identity

Additional audio/audiovisual recording method stated in the notice or separately noticed

Any court order or stipulation governing remote administration available

3.4 Technical readiness for a remote deposition

Reporter can see and hear the witness, when video is being used

Witness can hear the reporter and counsel

Audio recording/transcription path is active

Reporter has a reliable way to identify who is speaking

Witness identity has been verified by the authorized human workflow

No one has begun substantive examination

No-guess rule: Unknown court, cause/case number, witness location, officer identity, or oath authority must remain visibly unresolved. Depo-Pro-New must not generate a guessed statement.

4. Texas state civil deposition workflow

4.1 Legal minimum

For an oral deposition under Texas Rule 199:

The deposition must be before an officer authorized by law to take depositions.

Testimony, objections, and other statements must be recorded when made.

A remote deposition is considered taken where the witness is located.

Every oral deponent must first be placed under oath.

A Texas CSR is competent to administer oaths in the performance of court-reporting duties.

Texas does not prescribe a verbatim opening announcement equivalent to Federal Rule 30(b)(5)(A). Depo-Pro-New should nevertheless use the fuller standard below because it creates a clear, auditable record.

4.2 Texas sequence

Start recording and confirm the record is open.

State date, actual time, case identity, deponent, court, cause number, modality, and legally relevant place.

Identify the deposition officer and credential.

Take appearances one person at a time.

Identify other persons present.

Record only actual stipulations or agreements, if counsel chooses to make them.

Give optional neutral record-clarity instructions.

If an interpreter will translate testimony, identify and qualify the interpreter as directed by counsel/court and administer the interpreter oath or affirmation.

Offer the witness a neutral oath-or-affirmation choice.

Administer the selected oath or affirmation and obtain an audible, unambiguous response.

Record the oath event and method in the canonical deposition record.

Announce that counsel may proceed.

Generate the UFM-compliant witness/examination setup from the recorded facts.

4.3 Approved Texas standard opening

THE REPORTER: We are on the record. Today is [DEPOSITION_DATE], and the
time is [ACTUAL_START_TIME]. This is the oral deposition of [WITNESS_NAME]
in [CASE_STYLE], pending in the [COURT_NAME], [COUNTY_NAME] County, Texas,
Cause Number [CAUSE_NUMBER]. This deposition is being taken [IN_PERSON_OR_REMOTE].
For purposes of this remote deposition, the witness is located in
[WITNESS_CITY], [WITNESS_STATE_OR_COUNTRY].

I am [OFFICER_NAME], [CREDENTIAL_DESCRIPTION], number [CREDENTIAL_NUMBER],
and I am serving as the deposition officer. Counsel, beginning with the
noticing attorney, please state your name, the party you represent, and your
location. After counsel, each other person present should identify themselves
and their role.

Usage rules:

Omit the remote-location sentences for an in-person deposition and state the physical place instead.

Do not say “pursuant to the Texas Rules” unless the jurisdiction profile is verified.

Do not say the parties “agree” merely because they appeared remotely. If an agreement is needed, counsel must state it.

The officer may add a business address, but Depo-Pro-New must classify that sentence as standard practice rather than a Texas Rule 199.5 requirement.

4.4 Optional Texas record-clarity instructions

Tier: CUSTOMARY

THE REPORTER: [WITNESS_NAME], to help me make a clear and accurate record,
please answer aloud rather than by nodding or gesturing, allow each question
to finish before answering, and pause briefly if counsel makes an objection.
If you cannot hear or understand a question, please say so.

These instructions protect record clarity but are not a substitute for counsel's examination instructions and must not advise the witness how to answer substantively.

4.5 Texas interpreter oath or affirmation

Tier: CONDITIONAL and REQUIRED_IN_SUBSTANCE when an interpreter is used. The Texas UFM supplies suggested text.

THE REPORTER: [INTERPRETER_NAME], do you solemnly swear or affirm that the
interpretation you will give in this deposition will be from English to
[LANGUAGE] and from [LANGUAGE] to English to the best of your ability?

THE INTERPRETER: I do.

Sign-language variant:

THE REPORTER: [INTERPRETER_NAME], do you solemnly swear or affirm that the
interpretation you will give in this deposition will be from English to
[SIGN_LANGUAGE] and from [SIGN_LANGUAGE] to English to the best of your ability?

The transcript should record (Interpreter sworn) or another accurate UFM parenthetical only after the event occurs.

4.6 Texas witness oath and affirmation

Before presenting religious wording, ask neutrally:

THE REPORTER: [WITNESS_NAME], do you prefer to take an oath or an affirmation?

Approved oath:

THE REPORTER: Do you solemnly swear that the testimony you are about to give
will be the truth, the whole truth, and nothing but the truth, so help you God?

THE WITNESS: I do.

Approved affirmation:

THE REPORTER: Do you solemnly affirm that the testimony you are about to give
will be the truth, the whole truth, and nothing but the truth?

THE WITNESS: I do.

An affirmation must not add religious language. Depo-Pro-New must record SWEAR, AFFIRM, or OTHER_AUTHORIZED_FORM, the exact spoken text, the response, the officer, and the time.

4.7 Texas written witness setup

Tier: TRANSCRIPT_FORMAT under UFM §§ 3.10-3.11.

[WITNESS_NAME],

having been first duly sworn [or affirmed], testified as follows:

                         EXAMINATION

BY MR./MS./MX. [EXAMINER_SURNAME]:

The selected title must come from the person's confirmed display name, not from audio inference. The setup must identify the witness, examiner, sworn/affirmed status, and examination type consistent with the applicable UFM figure.

4.8 Texas signature disposition

Texas stenographic depositions default to presentment for examination and signature. Depo-Pro-New must not require counsel to “request signature” as though Texas followed Federal Rule 30(e).

Allowed states:

PRESENTMENT_REQUIRED_DEFAULT

WAIVED_BY_WITNESS_AND_ALL_PARTIES_ON_RECORD

EXCEPTION_WRITTEN_QUESTIONS

EXCEPTION_NONSTENOGRAPHIC_RECORDING

UNRESOLVED

The waiver state requires the witness and every party; silence is not waiver.

5. Federal civil deposition workflow

5.1 Federal Rule 30(b)(5)(A) minimum

Unless the parties stipulate otherwise, the officer must begin with an on-record statement that includes:

Officer's name and business address

Date, time, and place of the deposition

Deponent's name

Administration of the oath or affirmation

Identity of all persons present

The federal workflow must not permit substantive questioning before all five are completed or a specific stipulation altering the procedure is recorded.

5.2 Federal sequence

Start recording and state the record is open.

State officer name and full business address.

State date, actual time, and place; for remote proceedings, identify the place where the deponent is answering.

State deponent's name.

Establish the identity of every person present, including remote attendees.

Record the recording method and any additional recording method when appropriate.

Record any case-specific remote-oath authorization, stipulation, or order; do not invent one.

Give optional neutral record-clarity instructions.

Swear or affirm an interpreter when used.

Administer the oath or affirmation to the deponent and obtain audible assent.

Record the oath event in canonical data.

Invite the examining attorney to proceed.

5.3 Approved federal standard opening

THE REPORTER: We are on the record. I am [OFFICER_NAME], and my business
address is [OFFICER_BUSINESS_ADDRESS]. Today is [DEPOSITION_DATE], and the
time is [ACTUAL_START_TIME]. This is the oral deposition of [WITNESS_NAME]
in [CASE_STYLE], pending in the United States District Court for the
[FEDERAL_DISTRICT_AND_DIVISION], Civil Action Number [CASE_NUMBER].

This deposition is being taken [IN_PERSON_OR_REMOTE]. The place of the
deposition is [WITNESS_CITY], [WITNESS_STATE_OR_COUNTRY], where the deponent
is answering the questions. For the identity of all persons present, please
state your full name, whom you represent or your role, and your current
location, beginning with the noticing attorney.

After all persons identify themselves, the officer administers the oath or affirmation. That oath is part of the Rule 30(b)(5)(A) opening; it is not merely a later optional step.

5.4 Federal interpreter oath or affirmation

Federal Rule of Evidence 604 requires a qualified interpreter to give an oath or affirmation to make a true translation but prescribes no verbatim formula.

THE REPORTER: [INTERPRETER_NAME], do you solemnly swear or affirm that you
will make a true and accurate interpretation of the questions and answers
from English to [LANGUAGE] and from [LANGUAGE] to English, to the best of
your skill and ability?

THE INTERPRETER: I do.

Interpreter qualification is distinct from the oath. Depo-Pro-New should record who established qualification and any objection without deciding competency itself.

5.5 Federal witness oath and affirmation

Federal Rule of Evidence 603 requires an oath or affirmation to testify truthfully in a form designed to impress that duty on the witness. No exact formula is prescribed.

Use the same neutral choice and approved oath/affirmation forms in § 4.6. The officer must be authorized under Federal Rule 28 or appointed by the court, and the product must account for the witness's location in remote proceedings.

5.6 Federal review request

Before the deposition is completed, the officer should provide a neutral opportunity to place the Rule 30(e) election on the record:

THE REPORTER: Before the deposition is completed, does the deponent or any
party request review of the transcript or recording under Federal Rule of
Civil Procedure 30(e)?

This belongs in the closing workflow, not the opening. Record who requested review and the answer. Do not characterize silence as a request.

5.7 Federal completion statement

Federal Rule 30(b)(5)(C) requires the officer, at the end, to state on the record that the deposition is complete and to set out attorney stipulations about custody of the transcript/recording, exhibits, or other pertinent matters.

THE REPORTER: The deposition of [WITNESS_NAME] is complete at
[ACTUAL_END_TIME]. Counsel, please state any stipulations concerning custody
of the transcript or recording, exhibits, or other pertinent matters.

If there are none, record that no stipulations were stated; do not generate substantive terms.

6. Stipulations governance

6.1 Reporter role

The reporter may ask whether counsel wishes to place stipulations on the record. The reporter must not:

Declare “standard stipulations” binding without affirmative responses

Choose objection-waiver language

Negotiate custody, signature, exhibit, or delivery terms

Tell counsel what they have legally agreed to

Convert a prior firm's customary practice into a case fact

6.2 Recording structure

Each stipulation must be stored as a discrete event:

stipulation:
  id: stable-event-id
  topic: remote_oath | signature_review | custody | exhibits | objections | other
  proposed_by: person-id
  exact_record_text: "..."
  assents:
    - person_id: person-id
      response: assent | dissent | qualification | no_response
  effective_status: established | disputed | incomplete
  start_word_id: asr-anchor
  end_word_id: asr-anchor

Only established stipulations may drive transcript assembly or certification.

7. Oath-attestation gate

The oath event is evidentiary, not a checkbox inferred from later testimony.

7.1 Required event fields

witness_oath_event:
  witness_person_id: person-id
  officer_person_id: person-id
  kind: swear | affirm | other_authorized_form
  exact_prompt: "..."
  response_text: "I do"
  response_status: audible_unambiguous | clarified | unresolved
  administered_at: timestamp
  witness_location: city-state-country
  officer_authority_basis: credential-or-order-reference
  source_word_ids: [start-id, end-id]
  reporter_attestation:
    status: witnessed_and_recorded | exception_documented | unresolved
    recorded_by: operator-id
    recorded_at: timestamp
    reason: ""

7.2 Blocking rules

Depo-Pro-New must block “duly sworn/affirmed” rendering and final certification when:

No oath/affirmation event exists

The response was inaudible and never clarified

The person who administered it is unknown

Authority is unresolved

Remote witness location is unknown when it affects authority

The canonical event conflicts with the transcript

The correct remedy is to document the true exception and seek case-specific direction—not to backfill a fictional oath.

7.3 Inaudible response procedure

The Thomas transcript demonstrates the correct instinct but a weak record boundary: the reporter did not hear the first response, stopped, and obtained an audible “I do.” Depo-Pro-New should guide the officer to say:

THE REPORTER: I could not hear your response. I will administer the oath again.
[Repeat the complete oath or affirmation.]
THE WITNESS: I do.
THE REPORTER: Thank you. The witness's response is audible. Counsel may proceed.

This avoids ambiguity over whether the audible answer corresponded to the complete oath.

8. Remote-deposition governance

8.1 Required distinctions

Depo-Pro-New must separately store:

attendance_mode: in person or remote

witness_location

officer_location

platform

remote_authority_source: rule, order, stipulation, notice, or other

identity_verification_method

can_see_witness

can_hear_witness

“Zoom” is a platform, not the place of deposition and not proof of oath authority.

8.2 No generic remote-agreement prompt

The reviewed examples ask every lawyer to state “agreement for this remote deposition and remote swearing.” That may be appropriate in a specific case, but it must be conditional. The product should instead display:

Remote authority has not been documented.
[Record court order] [Record stipulation] [Record other authority] [Mark unresolved]

If a stipulation is used, counsel supplies its substance and each required participant's response is recorded.

9. Transcript rendering rules

9.1 Spoken record versus generated structure

Depo-Pro-New must distinguish:

Verbatim spoken content: reporter statement, appearances, stipulations, instructions, oaths, responses

Reporter-authored parentheticals: short, factual event descriptions

Generated structural headings: PROCEEDINGS, witness setup, EXAMINATION, and BY line

Generated headings must never be represented as spoken dialogue.

9.2 Texas UFM opening body

For Texas freelance transcripts, assembly must follow the applicable current UFM figures and rules, including witness identity, sworn/affirmed status, examiner identity, examination type, and interpreter treatment. Formatting is controlled by the UFM profile; content facts come from canonical events.

9.3 Federal format

The Federal Rules of Civil Procedure govern deposition procedure but do not create one nationwide UFM-equivalent page design. Depo-Pro-New must apply the selected federal district's local requirements, the ordering firm's approved template, and any case order. It must not label the Texas UFM as federal law.

10. Product workflow and UI gates

The screenshots show jurisdiction, signature disposition, examining attorney, and certification preparation inside Workspace. These are important, but the opening facts should be captured in Opening, not deferred until testimony correction.

10.1 Opening screen sections

Case & Authority — jurisdiction, court, case identifier, notice/order

Officer — identity, address, credential, authority

Method & Place — in person/remote, witness location, platform

Participants — expected roster and attendance confirmation

Opening Script — jurisdiction-specific, token-complete script

Stipulations — counsel-controlled event recorder

Interpreter — conditional identity, qualification, oath

Witness Oath — oath/affirmation choice, administration, response, attestation

Examiner — first examination boundary

Opening Complete — validation result and unresolved exceptions

10.2 State machine

DRAFT
  -> PRE_RECORD_VALIDATED
  -> ON_RECORD_IDENTIFICATION_COMPLETE
  -> APPEARANCES_COMPLETE
  -> INTERPRETER_READY_OR_NOT_APPLICABLE
  -> WITNESS_SWORN_OR_AFFIRMED
  -> EXAMINATION_STARTED

No state may be skipped silently. A human-authorized exception requires a reason, operator, and timestamp.

10.3 Jurisdiction-specific blockers

Texas blockers before examination:

Deponent not placed under oath/affirmation

Officer authority unresolved

Remote witness location unresolved when applicable

Interpreter required but not sworn/affirmed

Federal blockers before examination:

Any Rule 30(b)(5)(A) category missing

Deponent not placed under oath/affirmation

Officer authority unresolved

Identity of any person present unresolved

Interpreter required but not sworn/affirmed

10.4 Warnings, not blockers

Optional admonitions omitted

Reporter business address omitted from a Texas spoken opening but stored elsewhere

No stipulations made

No firm name stated

No credential number spoken where authority is otherwise established

11. Acceptance tests

11.1 Texas

A Texas opening without a federal-style business-address announcement may pass if the oath and authority requirements are satisfied; the product may warn under firm policy.

The record cannot show “duly sworn” without an oath event and assent.

A remote opening cannot treat “Zoom” as witness location.

Signature status defaults to presentment, not waiver.

Waiver requires witness plus all parties.

An interpreter branch cannot complete without interpreter oath/affirmation.

UFM witness setup is generated from the oath event and examination boundary.

11.2 Federal

Missing officer business address blocks opening completion absent a recorded stipulation altering the procedure.

Missing identity for one attendee blocks Rule 30(b)(5)(A) completion.

Oath/affirmation occurs as part of the opening before examination.

Remote place is the location where the deponent answers.

Rule 30(e) review remains unresolved until requested or declined before completion; it is not presumed at opening.

Closing includes the completion statement and actual attorney stipulations.

11.3 Shared integrity tests

Script tokens never resolve from stale deposition data.

Spoken time comes from the reporter's confirmed actual time, not scheduled time.

Case/cause terminology follows the selected jurisdiction.

A human can correct any generated token before it is spoken.

Changes to canonical opening facts preserve history and source evidence.

No UI action creates a stipulation without recorded assent.

12. Review of the Thomas opening

The Thomas federal opening contains several strong elements: actual date/time, deponent, federal court and division, case style, civil action number, federal-rule context, reporter identity and credential, appearances, remote locations, an oath, audible assent, and a witness/examination setup.

It also exposes the governance gaps this standard is intended to prevent:

The reporter's business address is missing, although Federal Rule 30(b)(5)(A)(i) requires it absent stipulation.

The opening says all parties stipulated to custody and other matters without displaying the terms being proposed and each party's assent in the reviewed passage.

The witness's physical location is not affirmatively stated by the reporter as the place of the remote deposition.

The identity call is framed as an “agreement” to remote procedure, combining attendance identification with a legal stipulation.

The first oath response was inaudible. The later “I do” cured the practical problem, but repeating the full oath would create a cleaner event boundary.

“Counsel may proceed” occurred only after audible assent, which is correct.

The written witness setup accurately follows the recorded oath event; this is the correct data dependency.

The Thomas transcript should therefore be treated as substantially sound but not the governing federal template.

13. Source hierarchy and change control

13.1 Controlling-source order

Case-specific court order

Applicable federal or Texas rule/statute

Applicable federal district local rule

Texas UFM for Texas reporter-record formatting

Valid stipulation placed on the record

Approved firm practice

Customary reporter guidance

13.2 Required maintenance

Review this governance file at least annually and whenever relevant rules change.

Store authority_version, verified_date, and source URL with each script block.

Legal changes must not silently rewrite completed deposition records.

New scripts enter as draft; promotion requires source review, transcript fixture testing, and human approval.

Depo-Pro-New should preserve the exact script version used for each deposition.

14. Primary authorities

Texas Rules of Civil Procedure, Rules 199 and 203 (current compilation)

Texas Judicial Branch Uniform Format Manual page

Uniform Format Manual for Texas Reporters' Records

Federal Rules of Civil Procedure, Rules 28-30

Federal Rules of Evidence, Rules 603-604

15. Governing summary

The safe Depo-Pro-New model is:

Verify the case and officer before recording; identify the proceeding and everyone present; record only stipulations actually made; swear or affirm any interpreter; swear or affirm the witness and capture audible assent; create the examination boundary; and generate written structure only from those recorded events.

Texas and federal proceedings share that logic, but only the federal rule expressly mandates the five-part on-record officer opening. The application must preserve that distinction.

