import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// The application has exactly one route to Deepgram, and one screen calls it. Nothing else in
// the suite notices if that call disappears: delete the screen, run the tests, watch them pass,
// and find out later that the app can no longer produce a transcript at all.
//
// These are reachability assertions, not behaviour. They do not care which screen owns the
// control -- moving it is fine and expected. They fail only when the last caller vanishes.

const APP = new URL("../app/", import.meta.url);
const screens = fs.readdirSync(APP).filter(name => name.endsWith(".tsx"));
const sources = screens.map(name => ({ name, text:fs.readFileSync(new URL(name, APP), "utf8") }));
const callers = endpoint => sources.filter(file => file.text.includes(endpoint)).map(file => file.name);

test("some screen can still start a transcription",()=>{
  // runTranscriptionJob has one call site, POST /api/audio/transcribe, and that route has one
  // caller in the UI. If this fails, Deepgram is unreachable from the application.
  const found = callers("/api/audio/transcribe");
  assert.ok(found.length > 0, "no screen calls POST /api/audio/transcribe; the app cannot transcribe");
});

test("some screen can still record a keyterm override",()=>{
  // authoritativeKeyterms refuses more than 50 terms without a recorded reason, so a deposition
  // above the cap cannot be transcribed at all unless some screen offers this input.
  assert.ok(callers("keytermOverrideReason").length > 0, "no screen collects a keyterm override reason");
});

test("some screen can still show transcription job state",()=>{
  // Where a failed job and its preserved vendor error become visible. Without it a failure is
  // silent and the reporter has no way to retry.
  assert.ok(callers("/api/transcription/jobs").length > 0, "no screen reads transcription job state");
});

test("some screen can still assign speakers",()=>{
  for (const endpoint of ["/api/transcript/speaker-candidates","/api/transcript/speaker-map"]) {
    assert.ok(callers(endpoint).length > 0, `no screen calls ${endpoint}`);
  }
});

test("the reachability check is looking at real screens",()=>{
  // A positive control. Every assertion above passes vacuously if the directory scan returns
  // nothing, and a test that cannot fail is worse than no test.
  assert.ok(screens.length >= 8, `expected the app screens, found ${screens.length}`);
  assert.ok(screens.includes("WorkspaceScreen.tsx"), "the screen list is not what it should be");
  assert.equal(callers("/api/does-not-exist").length, 0, "the matcher reports callers that do not exist");
});
