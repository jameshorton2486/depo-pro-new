# Texas UFM Master Mail-Merge and Data-Collection Table

This two-column worksheet covers the data-bearing fields identified in the Texas *Uniform Format Manual for Texas Reporters' Records*, its examples/figures, and Depo-Pro's canonical deposition record and insertion-page templates. The second column is intentionally blank for user entry.

Use repeatable paths ending in `[]` once for every applicable party, attorney, appearance, volume, examination, event, exhibit, question, errata entry, recipient, or media part. A blank does not mean that a field is required for every record; the applicable UFM form/profile determines which fields are required.

## Case, court, and caption

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{case.jurisdiction_type}}` | |
| `{{case.state}}` | |
| `{{case.county}}` | |
| `{{case.court_name}}` | |
| `{{case.court_number}}` | |
| `{{case.judicial_district}}` | |
| `{{case.federal_district}}` | |
| `{{case.federal_division}}` | |
| `{{case.trial_court_cause_number}}` | |
| `{{case.appellate_court_name}}` | |
| `{{case.appellate_cause_number}}` | |
| `{{case.case_style}}` | |
| `{{case.civil_or_criminal}}` | |
| `{{case.governing_rules}}` | |
| `{{case.presiding_officer_name}}` | |
| `{{case.presiding_officer_title}}` | |
| `{{case.trial_court_clerk_name}}` | |
| `{{case.trial_court_clerk_title}}` | |

## Parties and caption names (repeatable)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{parties[].legal_name}}` | |
| `{{parties[].caption_display_name}}` | |
| `{{parties[].role}}` | |
| `{{parties[].entity_type}}` | |
| `{{parties[].alias_qualifier}}` | |
| `{{parties[].alias_name}}` | |

## Proceeding and record

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{proceeding.record_type}}` | |
| `{{proceeding.type}}` | |
| `{{proceeding.title}}` | |
| `{{proceeding.date}}` | |
| `{{proceeding.scheduled_start_time}}` | |
| `{{proceeding.actual_start_time}}` | |
| `{{proceeding.actual_end_time}}` | |
| `{{proceeding.time_zone}}` | |
| `{{proceeding.location_name}}` | |
| `{{proceeding.location_address_1}}` | |
| `{{proceeding.location_address_2}}` | |
| `{{proceeding.location_city}}` | |
| `{{proceeding.location_county}}` | |
| `{{proceeding.location_state}}` | |
| `{{proceeding.location_zip}}` | |
| `{{proceeding.remote}}` | |
| `{{proceeding.remote_platform}}` | |
| `{{proceeding.telephone}}` | |
| `{{proceeding.videotaped}}` | |
| `{{proceeding.interpreted}}` | |
| `{{proceeding.reporting_method}}` | |
| `{{proceeding.requesting_party_or_counsel}}` | |
| `{{proceeding.noticing_party}}` | |
| `{{proceeding.taking_party}}` | |
| `{{proceeding.volume_number}}` | |
| `{{proceeding.total_volumes}}` | |
| `{{proceeding.volume_start_date}}` | |
| `{{proceeding.volume_end_date}}` | |
| `{{proceeding.volume_start_page}}` | |
| `{{proceeding.volume_end_page}}` | |
| `{{proceeding.total_page_count}}` | |

## Witness or deponent

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{witness.full_legal_name}}` | |
| `{{witness.honorific}}` | |
| `{{witness.first_name}}` | |
| `{{witness.middle_name}}` | |
| `{{witness.last_name}}` | |
| `{{witness.suffix_or_designation}}` | |
| `{{witness.representative_capacity}}` | |
| `{{witness.represented_organization}}` | |
| `{{witness.corporate_topics}}` | |
| `{{witness.address_1}}` | |
| `{{witness.address_2}}` | |
| `{{witness.city}}` | |
| `{{witness.state}}` | |
| `{{witness.zip}}` | |
| `{{witness.phone}}` | |
| `{{witness.email}}` | |
| `{{witness.sworn}}` | |
| `{{witness.sworn_by}}` | |
| `{{witness.oath_type}}` | |
| `{{witness.sworn_time}}` | |

## Notice, order, and authority

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{authority.notice_title}}` | |
| `{{authority.notice_date}}` | |
| `{{authority.notice_served_date}}` | |
| `{{authority.notice_served_by}}` | |
| `{{authority.subpoena_issued}}` | |
| `{{authority.subpoena_date}}` | |
| `{{authority.subpoena_duces_tecum}}` | |
| `{{authority.requested_information}}` | |
| `{{authority.court_order_title}}` | |
| `{{authority.court_order_date}}` | |
| `{{authority.court_order_description}}` | |
| `{{authority.agreements_stated_on_record}}` | |

## Counsel and appearances (repeatable)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{counsel[].honorific}}` | |
| `{{counsel[].full_name}}` | |
| `{{counsel[].state_bar_number}}` | |
| `{{counsel[].firm_or_office}}` | |
| `{{counsel[].address_1}}` | |
| `{{counsel[].address_2}}` | |
| `{{counsel[].city}}` | |
| `{{counsel[].state}}` | |
| `{{counsel[].zip}}` | |
| `{{counsel[].phone}}` | |
| `{{counsel[].fax}}` | |
| `{{counsel[].email}}` | |
| `{{counsel[].represented_parties}}` | |
| `{{counsel[].appearance_role}}` | |
| `{{counsel[].actual_appearance}}` | |
| `{{counsel[].remote_appearance}}` | |

## Other participants (repeatable)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{videographers[].full_name}}` | |
| `{{videographers[].company}}` | |
| `{{videographers[].address}}` | |
| `{{videographers[].phone}}` | |
| `{{videographers[].email}}` | |
| `{{interpreters[].full_name}}` | |
| `{{interpreters[].language}}` | |
| `{{interpreters[].certification_number}}` | |
| `{{interpreters[].company}}` | |
| `{{interpreters[].phone}}` | |
| `{{interpreters[].email}}` | |
| `{{other_attendees[].full_name}}` | |
| `{{other_attendees[].role}}` | |

## Reporter and reporting firm

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{reporter.full_name}}` | |
| `{{reporter.designations}}` | |
| `{{reporter.csr_number}}` | |
| `{{reporter.csr_state}}` | |
| `{{reporter.csr_expiration_date}}` | |
| `{{reporter.method}}` | |
| `{{reporter.official_status}}` | |
| `{{reporter.assigned_court}}` | |
| `{{reporter.notary_status}}` | |
| `{{reporter.notary_state}}` | |
| `{{reporter.signature_name}}` | |
| `{{reporter.firm_name}}` | |
| `{{reporter.firm_representative_name}}` | |
| `{{reporter.firm_registration_number}}` | |
| `{{reporter.firm_registration_expiration_date}}` | |
| `{{reporter.firm_registration_waiver}}` | |
| `{{reporter.address_1}}` | |
| `{{reporter.address_2}}` | |
| `{{reporter.city}}` | |
| `{{reporter.state}}` | |
| `{{reporter.zip}}` | |
| `{{reporter.phone}}` | |
| `{{reporter.fax}}` | |
| `{{reporter.email}}` | |

## Deputy/substitute official and another reporter's notes

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{substitute_reporter.full_name}}` | |
| `{{substitute_reporter.csr_number}}` | |
| `{{substitute_reporter.csr_expiration_date}}` | |
| `{{substitute_reporter.method}}` | |
| `{{substitute_reporter.firm_registration_number}}` | |
| `{{substitute_reporter.address}}` | |
| `{{substitute_reporter.phone}}` | |
| `{{substitute_reporter.email}}` | |
| `{{substitute_reporter.official_reporter_name}}` | |
| `{{substitute_reporter.assigned_court}}` | |
| `{{substitute_reporter.case_document_filing_date}}` | |
| `{{another_notes.original_reporter_name}}` | |
| `{{another_notes.original_reporter_csr_number}}` | |
| `{{another_notes.original_reporter_status}}` | |
| `{{another_notes.transcribing_reporter_name}}` | |
| `{{another_notes.transcribing_reporter_csr_number}}` | |
| `{{another_notes.notes_provided_by}}` | |
| `{{another_notes.notes_received_date}}` | |
| `{{another_notes.transcription_fee}}` | |
| `{{another_notes.fee_payor}}` | |

## Court recorder, logs, and nonstenographic source media (repeatable where marked)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{recording.method}}` | |
| `{{recording.media_type}}` | |
| `{{recording.device}}` | |
| `{{recording.operator_name}}` | |
| `{{recording.identifier}}` | |
| `{{recording.received_date}}` | |
| `{{recording.received_from}}` | |
| `{{recording.transcription_date}}` | |
| `{{recording.transcriber_name}}` | |
| `{{recording.transcriber_csr_number}}` | |
| `{{recording.request_information_source}}` | |
| `{{recording.recording_is_complete}}` | |
| `{{recording.log_entries[].date}}` | |
| `{{recording.log_entries[].location}}` | |
| `{{recording.log_entries[].case_number}}` | |
| `{{recording.log_entries[].case_style}}` | |
| `{{recording.log_entries[].speaker_name}}` | |
| `{{recording.log_entries[].event_description}}` | |
| `{{recording.log_entries[].start_time_or_counter}}` | |
| `{{recording.log_entries[].end_time_or_counter}}` | |
| `{{recording.media_parts[].part_number}}` | |
| `{{recording.media_parts[].side_or_channel}}` | |
| `{{recording.media_parts[].start_time_or_counter}}` | |
| `{{recording.media_parts[].end_time_or_counter}}` | |
| `{{recording.media_parts[].description}}` | |
| `{{recording.media_parts[].file_name}}` | |

## Indexes (repeatable)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{examinations[].witness_name}}` | |
| `{{examinations[].examination_type}}` | |
| `{{examinations[].examining_counsel}}` | |
| `{{examinations[].volume_number}}` | |
| `{{examinations[].start_page}}` | |
| `{{examinations[].end_page}}` | |
| `{{chronological_events[].date}}` | |
| `{{chronological_events[].description}}` | |
| `{{chronological_events[].volume_number}}` | |
| `{{chronological_events[].page}}` | |
| `{{master_index.entries[].witness_or_description}}` | |
| `{{master_index.entries[].volume_number}}` | |
| `{{master_index.entries[].page}}` | |

## Exhibits, requested material, and custody (repeatable)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{exhibits[].number_or_letter}}` | |
| `{{exhibits[].description}}` | |
| `{{exhibits[].date}}` | |
| `{{exhibits[].bates_range}}` | |
| `{{exhibits[].marked_by}}` | |
| `{{exhibits[].marked_page}}` | |
| `{{exhibits[].offered_page}}` | |
| `{{exhibits[].admitted_page}}` | |
| `{{exhibits[].volume_number}}` | |
| `{{exhibits[].disposition}}` | |
| `{{exhibits[].original_or_duplicate}}` | |
| `{{exhibits[].requested_for_record}}` | |
| `{{exhibits[].received_from}}` | |
| `{{exhibits[].received_date}}` | |
| `{{exhibits[].released_to}}` | |
| `{{exhibits[].released_date}}` | |
| `{{requested_documents[].description}}` | |
| `{{requested_documents[].requested_by}}` | |
| `{{requested_documents[].volume_number}}` | |
| `{{requested_documents[].page}}` | |

## Certified questions (repeatable)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{certified_questions[].number}}` | |
| `{{certified_questions[].question_text}}` | |
| `{{certified_questions[].certified_by}}` | |
| `{{certified_questions[].volume_number}}` | |
| `{{certified_questions[].page}}` | |
| `{{certified_questions[].line}}` | |

## Signature, changes, and errata (repeatable where marked)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{signature.status}}` | |
| `{{signature.disposition_basis}}` | |
| `{{signature.requested_date}}` | |
| `{{signature.submitted_to_witness_date}}` | |
| `{{signature.return_deadline_days}}` | |
| `{{signature.due_date}}` | |
| `{{signature.returned_date}}` | |
| `{{signature.witness_signed}}` | |
| `{{signature.errata_received}}` | |
| `{{signature.witness_signature}}` | |
| `{{signature.witness_signature_date}}` | |
| `{{signature.notary_name}}` | |
| `{{signature.notarization_date}}` | |
| `{{signature.errata[].page}}` | |
| `{{signature.errata[].line}}` | |
| `{{signature.errata[].original_text}}` | |
| `{{signature.errata[].changed_text}}` | |
| `{{signature.errata[].reason}}` | |

## Certification, delivery, service, time, and charges (repeatable where marked)

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{certification.variant}}` | |
| `{{certification.certification_date}}` | |
| `{{certification.execution_city}}` | |
| `{{certification.execution_county}}` | |
| `{{certification.execution_state}}` | |
| `{{certification.rule_203_certified}}` | |
| `{{certification.transcript_accuracy_certified}}` | |
| `{{certification.witness_sworn_certified}}` | |
| `{{certification.disinterested_declaration}}` | |
| `{{certification.custodial_attorney}}` | |
| `{{certification.custodial_attorney_firm}}` | |
| `{{certification.delivery_recipient}}` | |
| `{{certification.original_transcript_disposition}}` | |
| `{{certification.exhibit_disposition}}` | |
| `{{certification.delivery_method}}` | |
| `{{certification.delivery_date}}` | |
| `{{certification.attorney_time[].attorney_or_party}}` | |
| `{{certification.attorney_time[].time_used}}` | |
| `{{certification.total_deposition_time}}` | |
| `{{certification.officer_charges}}` | |
| `{{certification.transcription_fee}}` | |
| `{{certification.charges_responsible_party}}` | |
| `{{certification.payment_status}}` | |
| `{{certification.service_date}}` | |
| `{{certification.service_recipients[].name}}` | |
| `{{certification.service_recipients[].method}}` | |
| `{{certification.service_recipients[].address_or_email}}` | |
| `{{certification.clerk_filed}}` | |
| `{{certification.clerk_filing_date}}` | |

## Nonappearance

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{nonappearance.applicable}}` | |
| `{{nonappearance.scheduled_time}}` | |
| `{{nonappearance.waited_until}}` | |
| `{{nonappearance.absent_witness}}` | |
| `{{nonappearance.requesting_party}}` | |
| `{{nonappearance.persons_present}}` | |
| `{{nonappearance.notice_or_authority}}` | |

## Unedited/realtime rough draft

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{rough_draft.realtime}}` | |
| `{{rough_draft.matter_name}}` | |
| `{{rough_draft.proceeding_dates}}` | |
| `{{rough_draft.requesting_purchaser}}` | |
| `{{rough_draft.delivery_date}}` | |
| `{{rough_draft.purchaser_signature}}` | |
| `{{rough_draft.purchaser_signature_date}}` | |
| `{{rough_draft.reporter_signature}}` | |
| `{{rough_draft.reporter_signature_date}}` | |

## Appellate filing, record assembly, and document control

| Mail merge / Depo-Pro field | Your value |
|---|---|
| `{{filing.ordering_party}}` | |
| `{{filing.designation_received_date}}` | |
| `{{filing.designated_record_description}}` | |
| `{{filing.record_due_date}}` | |
| `{{filing.extension_requested_date}}` | |
| `{{filing.extension_requested_to_date}}` | |
| `{{filing.appellate_filing_date}}` | |
| `{{filing.appellate_filing_method}}` | |
| `{{filing.record_status}}` | |
| `{{filing.text_volume_file_name}}` | |
| `{{filing.media_part_file_name}}` | |
| `{{filing.volume_or_part_sequence_number}}` | |
| `{{filing.file_extension}}` | |
| `{{document.template_profile}}` | |
| `{{document.template_version}}` | |
| `{{document.record_profile}}` | |
| `{{document.generated_date}}` | |
| `{{document.generated_by}}` | |

## Scope notes

- Formatting-only UFM rules (page size, margins, line numbering, character spacing, headers, footers, Q-and-A tabs, colloquy, quotations, dashes, and ellipses) are not data-entry fields and therefore do not appear in this worksheet.
- The UFM examples use generic bounded text such as `REPORTER'S NAME`, `PARTY/ATTORNEY`, or blank rules. The names above normalize those prompts into stable Depo-Pro paths; they are not represented as verbatim variables published by the UFM.
- `[]` identifies a repeatable collection and avoids losing additional parties, counsel, examinations, exhibits, questions, recipients, or media parts in fixed numbered fields.
- Current Depo-Pro insertion templates consume a subset of this dictionary. A field's presence here does not by itself mean the renderer already supports it.

## Sources

- Texas Judicial Branch, *Uniform Format Manual for Texas Reporters' Records*, approved May 25, 2010 and amended June 28, 2010.
- Texas Judicial Branch, *Uniform Format Manual for Texas Reporters' Records: Figures and Examples*.
- `docs/ufm-field-coverage-matrix.md`.
- `server/canonical-deposition-record.mjs`.
- `templates/insertion-pages/**`.
