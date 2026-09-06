# Project review — 6 September 2026

## Source and preservation

Reviewed GitHub `jameshorton2486/depo-pro-new`, starting at main commit
`f85df51f2c728297364d90d3c5a26a54a620a6a4`, in a separate checkout. The supplied
`depo-pro-new-main` directory has no Git metadata and contains substantially older
source. It was inspected and its deterministic baseline ran (85 passed, 8 skipped),
but its source was not overwritten or replaced with upstream files.

## Review coverage

| Area | Review and outcome |
| --- | --- |
| Architecture and configuration | Inspected local service/UI launchers, origin configuration, storage configuration, and transitional Worker build. Production UI was listening on all interfaces; both production launch commands now explicitly bind to loopback. |
| Application workflows | Traced intake, reporter profiles, workspace editing, speaker proposals, opening procedures, insertion pages, and finalization to their server implementations and existing behavioral coverage. Removed an unreferenced ChatGPT authentication helper; local authorization does not use it. |
| External services | Inspected Claude extraction/proposal requests, prerecorded Deepgram, and live capture integration. Fixed deadlines ending at response headers in Claude and prerecorded Deepgram paths. Credential checks now have deadlines. Unknown outcomes are not automatically resubmitted. |
| API input | Malformed JSON and non-object request bodies now return 400 before mutation. Oversized JSON returns 413 without prematurely destroying the socket. |
| Persistence and evidence | Inspected deposition store, reporter store, protected-record guard, immutable transcription evidence, overlay operations, final artifact provenance, and backups. Backup hashing now uses a 1 MiB buffer, verification refuses linked contents, and source inventories are compared before and after copying. Backup and restore reject junctions redirecting their destinations across the intended boundary. |
| Dependencies | Updated vulnerable transitive browserslist, fast-uri, and fflate versions and associated browser data in the lockfile. No direct framework upgrades or database migrations. |
| Tests and development | Reviewed test discovery and Windows CI, retaining their full checks. Signal-terminated test/development subprocesses can no longer be reported as successful through a null exit code. Added network and HTTP regression tests and extended backup tests. |
| Documentation | Corrected stale claims that reporter persistence, editing, and finalization were unimplemented; documented Word dependencies and recovery behavior. |
| GitHub | No issues were returned by the repository's all-state issue listing. PR #91 merged after both Windows CI configurations passed. PR #66 was refreshed against main, its nine examination-anchor tests were checked locally, and it merged after both fresh CI configurations passed. |

## Verification

The upstream deterministic baseline passed: 1,579 passed, 11 skipped. Its
typecheck, lint, and production build also passed.

The revised deterministic suite passed: 1,586 passed, 11 skipped. Regression tests
exercise real disposable HTTP servers that stall after headers, successful exact
response preservation, Deepgram timeout classification, readiness completion,
malformed/oversized requests, large-file hash parity, and Windows junction refusal.
Full typecheck, lint, and production build are release gates for this change.

The production launcher was smoke-tested with an empty temporary deposition store
and separate ports. Both services reported ready; Windows reported both listeners
on `127.0.0.1`. The UI and allowed-origin API requests completed successfully. The
temporary servers were stopped afterward. This was an HTTP startup check, not an
interactive browser workflow qualification.

`npm audit` reported 3 vulnerable transitive packages before the update (2 high,
1 moderate), and zero afterward. This is the advisory database result at review
time, not a guarantee against unknown vulnerabilities.

## Limits retained

- The deterministic baseline skipped 11 native RX tests. The completion pass ran
  all 11 using installed RX 12 plug-ins, Pedalboard 0.9.24, numpy 2.5.2, and a
  generated 310-second, 48 kHz, 24-bit WAV. All 11 test cases passed, including
  writing and re-reading a qualification record. Microphones and paid provider
  requests were not exercised.
- Qualification results are distinct from test execution: De-hum passed the
  synthetic signal-path qualification. De-click reproduced its known
  chunk-invariance and alignment failures (maximum marker offset 6,467 frames,
  nonconstant). Its existing `asrSafe: false` and review-only restrictions remain.
  No claim of real-speech transcription accuracy follows from this synthetic test.
- Real deposition records, credentials, protection markers, and final certified
  artifacts were not modified. No production deployment was performed.
- Federal certificate variants remain blocked pending approved source material;
  they cannot safely be completed by inventing legal text.
- The storage model is filesystem-authoritative; the transitional hosting
  scaffolding is not a replacement for the native local service.
- Backup checks detect differences across the copy interval, but do not provide a
  transactional filesystem snapshot. Stop recording/editing before backing up.
- This review and the automated suite reduce regression risk; they do not establish
  that every hardware configuration, UI interaction, or certification case works.

## Completion follow-up

The native integration launcher now propagates a signal-terminated child as
failure, matching the deterministic launcher. The two reviewed pull requests are
merged; no issue or independent test work from this review remains deliberately
open. The older source folder is still preserved separately from the reviewed
Git checkout.
