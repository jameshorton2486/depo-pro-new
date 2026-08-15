# Depo-Pro New

Depo-Pro is a local-first Windows application for deposition intake, immutable audio preservation, audited RX 12 processing, Claude-assisted case extraction, Deepgram Nova-3 transcription, canonical ASR evidence, and reviewed insertion-page generation.

## Local architecture

- Project source and runtime: `C:\Users\james\projects\depo-pro-new`
- Browser UI: `http://localhost:3000`
- Node local API: `http://127.0.0.1:4317`
- Deposition workspaces: the operating-system user home directory plus `depos` (resolved by Node `os.homedir()`)
- Audio-intake evidence and encrypted credentials: ignored `data/` directory inside the project
- Credentials: Windows DPAPI-protected; never written to request URLs or browser storage
- Native processing: FFmpeg/FFprobe plus pinned Python, Pedalboard, and allow-listed RX 12 modules

Both application services and all durable deposition artifacts run from the local C drive. Claude document extraction and Deepgram transcription are external API operations initiated by the local server; their credentials remain local, and Depo-Pro preserves the resulting evidence locally.

The deposition root can be changed explicitly with `DEPO_PRO_DEPOSITIONS_ROOT`. Keep it on local storage. A cloud sync engine holds file handles, performs partial writes, and can rewrite files underneath Depo-Pro while a deposition is being written, which is why deposition folder commits already carry a retry ladder for Windows sharing violations.

`npm run status` warns when the project root or the deposition root is inside a sync client's own reported root, behind a junction that redirects it, or on a UNC network path. The warning does not block: set `DEPO_PRO_ALLOW_SYNCED_ROOT=1` to acknowledge it deliberately, and the acknowledgement is reported rather than hidden. Detection is by mechanism — what the sync client itself publishes — so a folder that merely has a client's name in it is not flagged, and no username or directory-layout pattern is involved. Two gaps are worth knowing: a OneDrive cloud placeholder is invisible once the client is uninstalled and its environment variables are gone, and a mapped network drive letter is not detected.

## Prerequisites

- Windows 11
- Bundled Node.js 22.13.0 installed through the project dependencies
- FFmpeg and FFprobe on `PATH`
- Python environment at `.venv-pedalboard`
- `pedalboard==0.9.24`
- iZotope RX 12 Audio Editor and the allow-listed RX 12 VST3 modules
- Claude and Deepgram credentials configured through Administrator Settings

## Run locally

```powershell
cd "C:\Users\james\projects\depo-pro-new"
npm install
npm run status
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Keep the PowerShell window open while Depo-Pro is running. Stop both local services with `Ctrl+C`.

## Storage boundaries

- The `depos` folder under the operating-system user home directory is the filesystem-authoritative deposition library.
- `data/audio-intake` contains immutable intake audio and audited derivatives used before deposition creation.
- `data/secrets.dat` contains DPAPI-encrypted local credentials.
- `.env.local` contains machine configuration such as the RX executable path; it is ignored by Git.
- Generated build directories, dependencies, logs, caches, and temporary render artifacts are not source files and must not be copied between installations.

## Deepgram evidence pipeline

The server loads saved ordered keyterms, verifies the frozen deposition audio SHA-256, and submits prerecorded audio using Nova-3 with pinned diarizer v2. Each durable job preserves:

1. `request.json` — exact final URL, options, ordered keyterms, and audio identity.
2. `raw-response.json` — exact vendor response bytes and SHA-256.
3. `asr-evidence.json` — immutable word timing, confidence, speaker evidence, and actual diarizer metadata.
4. `transcript/working.json` — derived, source-referenced Working Transcript.

Identical evidence requests are reused rather than retranscribed. Corrupt derived evidence can be rebuilt from a valid preserved raw response without another Deepgram call.

## RX processing

Discovery precedence is the explicit `RX_EXECUTABLE_PATH`, the standard RX 12 installation location, then a safe unavailable state. Machine-specific paths are omitted from durable evidence records.

Canonical RX derivatives are lossless FLAC files with the source sample rate, channels, frame count, and timeline preserved. Original clipping remains an evidentiary defect even if processing conceals it. Playback proxies and review-only derivatives are structurally ineligible for transcription unless explicitly promoted through the audited workflow.

## Insertion pages

The repository includes the canonical 25-line page model, reviewed Texas requested/waived template variants, hash-verified template inventories, Word rendering through the Python formatter boundary, and Thomas regression fixtures. Federal certificate variants remain intentional blocking stubs until an approved federal certificate source is supplied. Unknown UFM geometry continues to fail closed.

## Validation commands

- `npm run status` — report the local installation, storage root, and live service readiness without revealing secrets
- `npm test` — deterministic application, audio, Deepgram, RX, canonical-data, and insertion-page tests
- `npm run test:rx` — opt-in installed RX integration against an approved disposable fixture
- `npm run test:deepgram` — opt-in live Deepgram integration against an approved disposable fixture
- `npm run typecheck` — TypeScript validation
- `npm run lint` — ESLint validation
- `npm run build` — production build
- `npm run verify` — complete deterministic release gate

## RX profile qualification

`asrSafe` on a profile is a claim about how a plug-in behaves. `server/rx-qualification.mjs` measures it and writes a per-profile record.

```powershell
npm run fixture:rx -- "$env:TEMP\depo-rx-fixture"
node -e "import('./server/rx-qualification.mjs').then(async m => { const r = await m.qualifyProfile({ fixturePath: '<fixture>', profileIds: ['rx12-de-hum-dynamic-v1'] }); m.writeQualificationRecord('<records>', r) })"
```

`scripts/make-rx-fixture.mjs` synthesizes a disposable fixture deterministically: 310 seconds so the ten-second chunk loop runs 31 times, impulse markers at exactly known sample offsets including one straddling a chunk seam, 60 Hz hum with harmonics, room tone, periodic table noise, and overlapping speech-band content. It emits both a 24-bit and a 16-bit WAV, the 24-bit one exercising the native path where source depth exceeds the canonical 16-bit derivative. Seeded throughout, so regenerating produces a byte-identical file and the fixture hash in a record identifies exactly that content.

**What the synthetic fixture can and cannot qualify.** Determinism, time alignment, chunk invariance, frame parity and real-time factor are properties of the signal path and are measured more precisely against synthesized audio, where a marker's position is known rather than estimated. The ASR delta — the test that actually earns `asrSafe` — compares Deepgram output against a human-verified reference and needs real speech with a real transcript. A profile qualified against this fixture is qualified for the signal-path properties only; `asrSafe` remains a separate, unearned claim until measured against real testimony.

Two measurement rules the runner enforces, both learned by getting them wrong first:

- **Determinism compares decoded PCM, not the container.** Derivatives carry provenance in FLAC metadata including a per-render operation id, so container hashes can never match and would report every profile as non-deterministic.
- **Alignment cross-correlates a window, rather than picking the loudest sample.** De-click exists to remove isolated impulses, so peak-picking its output locks onto unrelated content and invents a large offset. The surrounding material survives and still correlates.

## Continuous integration

`.github/workflows/verify.yml` runs `npm run verify` on Windows against a clean checkout, on every pull request and every push to `main`.

Two jobs. The primary one pins Node to the `package.json` floor — the version the manifest promises — and checks out with `core.autocrlf=true`, which is how a Windows machine clones this repository by default. That combination is deliberate: the template-integrity defect fixed in Slice 1B existed because an established working tree passed while a fresh CRLF checkout failed every manifest hash. A build step asserts the pinned floor still matches `engines.node`, so the two cannot drift apart silently. The secondary job runs current Node with LF endings.

Nothing in the working tree is carried between runs. Only the npm download cache is reused; `node_modules` is rebuilt from the lockfile each time.

**What CI cannot prove.** The RX integration and qualification suites need licensed iZotope VST3 plug-ins and a disposable audio fixture, neither of which can exist on a hosted runner, so they skip. Determinism, time alignment, and chunk invariance are therefore *not* enforced by CI. They are measured locally through `server/rx-qualification.mjs` and recorded as per-profile qualification records. A green build says the code is sound; it says nothing about whether a profile carrying `asrSafe: true` has earned it.

## Current boundaries

- The reporter directory still originates in browser-managed configuration and should be migrated into the filesystem-authoritative profile store.
- Deepgram processing is synchronous behind a durable job abstraction because the local Windows service has no public callback endpoint.
- Reporter editing, AI correction proposals, final transcript classification/pagination, and certification lifecycle remain downstream phases.
- Federal certification text and final UFM layout measurements require approved authoritative sources before those variants can be released.
- Cloudflare/Vinext scaffolding is transitional. Native RX, DPAPI, filesystem evidence, and localhost services are intentionally not cloud-deployed.
