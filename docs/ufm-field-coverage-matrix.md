# UFM Field Coverage Matrix

Controlling reference: Texas Court Reporters Certification Board, *Uniform Format Manual Examples*, 47 pages, figures 1-35A. This phase models requirements only; it does not generate UFM pages.

| UFM requirement | Canonical field | Primary source | Availability | Requirement | Figures / variants |
|---|---|---|---|---|---|
| Court, county/district/division, judicial district | `case.*` | NOD_EXTRACTED | Before deposition | Required/conditional | 1, 3, 5-6, 8-9, 22, 29-30D |
| Cause number and complete caption | `case.causeNumber`, `case.caseStyle`, `parties[]` | NOD_EXTRACTED | Before | Required | 1, 3, 5-6, 8-9, 22, 29-30D |
| Party legal names, roles, aliases | `parties[].{name,role,aliases,captionDisplayName}` | NOD_EXTRACTED | Before | Required | Caption-bearing figures |
| Proceeding title/type and witness capacity | `deposition.{proceedingType,witness,representativeCapacity,representedOrganization}` | NOD_EXTRACTED | Before | Required/conditional | 1, 3, 29-30D |
| Volume and transcript page range/count | `deposition.volumeNumber`, `transcript.{volumes,pageCount}` | TRANSCRIPT_DERIVED | Pagination | Conditional | 1, 3, 10-12, 23-24, 26-28 |
| Scheduled date/time/location | `deposition.{depositionDate,scheduledStart,timeZone,location}` | NOD_EXTRACTED | Before | Required | 1, 3, 7, 29-30D |
| Actual start/end and reporting method | `deposition.{actualStart,actualEnd,reportingMethod}` | TRANSCRIPT_DERIVED / REPORTER_PROFILE | After | Required | 3, 29-30D |
| Remote, telephone, video, interpreted | `deposition.{remote,remotePlatform,telephone,videotaped,interpreted}` | NOD_EXTRACTED then REPORTER_ENTERED | Before/after | Conditional | 3-4, 16, 22, 29-30D |
| Attorneys, firms and contact information | `counsel[]` | NOD_EXTRACTED | Before | Conditional | 2, 4, 8-9, 29A-30D |
| Represented parties and actual/remote appearance | `counsel[].{represents,actualAppearance,remoteAppearance}` | NOD_EXTRACTED / REPORTER_ENTERED | Before/during | Conditional | 2, 4, 29A-30D |
| Other attendees and videographer | `participants.{otherAttendees,videographers}` | REPORTER_ENTERED | During | Optional/conditional | 4, 29A |
| Interpreter identity/language | `participants.interpreters[]` | REPORTER_ENTERED | During | Conditional | 16, 22 |
| Reporter name, CSR, expiration, official/freelance status | `reporter.*` | REPORTER_PROFILE | Before | Required | 1, 5-9, 12-13, 22, 29-30D |
| Reporting firm registration/address/phone | `reporter.{firm,firmRegistrationNumber,address,phone}` | REPORTER_PROFILE | Before | Conditional | 8-9, 12-13, 29-30D |
| Witness sworn and transcript accuracy | `deposition.witnessSworn`, certification variant | REPORTER_ENTERED | During/after | Required | 5-9, 12-13, 29-30D |
| Signature requested/waived/reserved | `signature.status` | REPORTER_ENTERED | During | Required | 7-9, 12-13, 30C |
| Submission, deadline, return and attached changes | `signature.{submittedToWitnessDate,returnDeadlineDays,dueDate,returnedDate,errataReceived}` | WORKFLOW_DERIVED / REPORTER_ENTERED | After | Conditional | 8-9 |
| Changes and signature/errata entries | `signature.errata[]` | REPORTER_ENTERED | After | Conditional | 7, 30C |
| Custodial attorney/delivery recipient | `certification.{custodialAttorney,deliveryRecipient}` | REPORTER_ENTERED | After | Conditional | 8-9, 30D |
| Attorney/party time used | `certification.attorneyTime[]` | TRANSCRIPT_DERIVED then confirmed | After | Conditional | 8-9, 30D |
| Officer charges and responsible party | `certification.{officerCharges,chargesResponsibleParty}` | REPORTER_ENTERED | After | Conditional | 8-9, 12-13 |
| Certificate service, recipients and filing | `certification.{serviceDate,serviceRecipients,clerkFiled}` | WORKFLOW_DERIVED / REPORTER_ENTERED | After | Required/conditional | 8-9, 12-13 |
| Certification date, Rule 203 and variant | `certification.{certificationDate,rule203Certified,variant}` | REPORTER_ENTERED / WORKFLOW_DERIVED | After | Required | 5-9, 12-13, 22, 29-30D |
| Disinterested declaration | `certification.disinterestedDeclaration` | REPORTER_ENTERED | After | Required | 5-9, 12-13, 22, 29-30D |
| Examination sequence/type/examiner/page/volume | `transcript.examinations[]` | TRANSCRIPT_DERIVED | Pagination | Conditional | 10-12, 23-24, 26-28 |
| Chronological proceedings/events | `transcript.chronologicalEvents[]` | TRANSCRIPT_DERIVED | Pagination | Optional | 10, 26-28 |
| Exhibits offered/admitted/volume/page | `exhibits[]` | TRANSCRIPT_DERIVED then confirmed | Pagination | Conditional | 11, 24, 34 |
| Requested documents/information | `transcript.requestedDocuments[]` | TRANSCRIPT_DERIVED | Pagination | Conditional | 11 |
| Certified questions and page/line | `transcript.certifiedQuestions[]` | TRANSCRIPT_DERIVED | Pagination | Conditional | 11 |
| Tape transcription side/media markers and disclaimer | `transcript.volumes[]`, certification variant | REPORTER_ENTERED / TRANSCRIPT_DERIVED | After | Conditional | 12-13, 29-30D |
| Unedited/realtime disclaimer and signatures | certification variant metadata | REPORTER_ENTERED | After | Conditional | 25 |
| Nonappearance details | `nonappearance.*` | NOD_EXTRACTED / REPORTER_ENTERED | Scheduled/during | Conditional | 29 |
| Exhibit inventory/certification chain | `exhibits[]` plus custody metadata | REPORTER_ENTERED | After | Future conditional | 34 |
| Official reporter appellate administrative forms | reporter/case plus future filing metadata | REPORTER_PROFILE / WORKFLOW_DERIVED | Future | Future variant | 31-33, 35-35A |

## Coverage validation

All substantive placeholder families in figures 1-30D and the deposition-related portions of figures 34-35A are representable. Figures 31-33 are administrative appellate forms rather than deposition transcript pages; their shared case/reporter fields are represented, while monthly-report batching and appellate-record request workflow remain explicitly future workflow metadata rather than silent omissions.

No blocking representational gap remains for the requested Canonical Deposition Data Record phase. Output-template wording, pagination rules, and jurisdiction-specific clause selection remain intentionally out of scope.
