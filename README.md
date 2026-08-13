# Depo-Pro New

Depo-Pro New is a local-first Windows application for deposition intake, audited audio analysis and RX 12 processing, Claude-assisted case-term extraction, and Deepgram Nova-3 transcription.

## Architecture

- React 19 UI served locally at `http://localhost:3000`
- Node local service bound to `127.0.0.1:4317`
- Immutable audio originals and audited derivatives under the ignored `data/` directory
- Windows DPAPI-protected Claude and Deepgram credentials
- FFmpeg/FFprobe analysis and compatibility conversion
- iZotope RX 12 VST3 processing through a pinned Python/Pedalboard worker

This application currently requires Windows and local native dependencies. The Cloudflare/Vinext scaffolding remains transitional and is not a production deployment target for workflows that depend on RX, FFmpeg, DPAPI, or localhost.

## Prerequisites

- Windows 11
- Node.js `>=22.13.0`
- FFmpeg and FFprobe on `PATH`
- Python worker environment created from `requirements-pedalboard.txt`
- iZotope RX 12 Audio Editor and the allow-listed RX 12 VST3 modules
- Claude and Deepgram credentials configured in Administrator Settings

## Local setup

```powershell
cd "C:\Users\james\Projects\depo-pro-new"
npm install
python -m venv .venv-pedalboard
.\.venv-pedalboard\Scripts\python.exe -m pip install -r requirements-pedalboard.txt
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Administrator Settings shows readiness for Node, FFmpeg, FFprobe, RX, Python, Pedalboard, RX modules, Claude, and Deepgram.

## RX configuration

Discovery precedence is explicit `RX_EXECUTABLE_PATH`, the standard RX 12 installation location, then a safe unavailable state. The value must be the full executable path:

```text
RX_EXECUTABLE_PATH=C:\Program Files\iZotope\RX 12 Audio Editor\win64\iZotope RX 12 Audio Editor.exe
```

The Audio Tools screen exposes allow-listed profiles for Voice De-noise, De-click, De-hum, De-reverb, Dialogue Isolate, and Repair Assistant. The browser sends profile IDs only; the server controls plug-in paths and parameters. Machine-specific paths are omitted from durable audit records.

## Validation

- `npm test` — deterministic application, audio, Deepgram, RX adapter, and integrity tests
- `npm run test:integration` — disposable audio through installed RX modules
- `npm run typecheck` — TypeScript validation
- `npm run lint` — ESLint validation
- `npm run build` — production build
- `npm run verify` — deterministic release gate

## Current limits

- Deposition metadata remains browser-managed; SQLite migration requires a separately reviewed data model.
- Deepgram transcription remains synchronous. Durable asynchronous jobs, callback recovery, and immutable raw response storage require a separate design.
- Canonical transcript graph, correction decisions, workspace, UFM, and certification are not yet implemented.
