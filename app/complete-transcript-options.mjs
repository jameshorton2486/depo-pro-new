// The two closed choices a complete-transcript preparation records, in a module with no imports.
//
// They are validated in server/complete-transcript-assembly.mjs and offered by
// app/PrepareCompleteTranscript.tsx, so they cannot live in either: importing the server module
// into the browser pulls its whole graph -- deposition-store, audio-pipeline, node:child_process --
// into the client bundle and the application fails to load. Retyping them in the screen would be
// the other failure, a second answer to a question the validator already answers.
//
// So they live here, imported by both, the way COUNSEL_SIDES lives in app/manual-intake.mjs and is
// read by the canonical record.
export const JURISDICTIONS = Object.freeze(["texas-state", "federal"]);
export const DISPOSITIONS = Object.freeze(["requested", "waived"]);
