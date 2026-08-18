import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The application has exactly one route to Deepgram, and for most of its life one screen called
// it. Nothing else in the suite notices if that call disappears: delete the screen, run the
// tests, watch them pass, and find out later that the app can no longer produce a transcript.
//
// These are reachability assertions, not behaviour. They do not care which screen owns a control
// -- moving it is expected, and this file survived exactly that move untouched. They fail only
// when the last caller the router can reach disappears.
//
// Walked from the router rather than over the directory. A grep across app/*.tsx would pass with
// the control sitting in a module nothing renders, which is the failure this exists to prevent:
// the file would still contain the string and the application still could not transcribe.
const ENTRY = fileURLToPath(new URL("../app/page.tsx", import.meta.url));

// Only relative specifiers are followed, so a control reached through a package import would not
// be seen. That is a bounded claim, not a covered case.
function importGraph(entry) {
  const seen = new Set(), queue = [entry];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current) || !fs.existsSync(current)) continue;
    seen.add(current);
    const source = fs.readFileSync(current, "utf8");
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
      const base = path.resolve(path.dirname(current), match[1]);
      const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.mjs`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen];
}

const reachable = importGraph(ENTRY).map(file => ({ name:path.basename(file), text:fs.readFileSync(file, "utf8") }));
const callers = needle => reachable.filter(file => file.text.includes(needle)).map(file => file.name);

test("the router can still reach a screen that starts a transcription",()=>{
  // runTranscriptionJob has one call site, POST /api/audio/transcribe. If this fails, Deepgram is
  // unreachable from the application however much code still mentions it.
  assert.ok(callers("/api/audio/transcribe").length > 0, "nothing the router renders calls POST /api/audio/transcribe");
});

test("the router can still reach a keyterm override",()=>{
  // authoritativeKeyterms refuses more than 50 terms without a recorded reason, so a deposition
  // above the cap cannot be transcribed at all unless some reachable screen collects one.
  assert.ok(callers("keytermOverrideReason").length > 0, "nothing the router renders collects a keyterm override reason");
});

test("the router can still reach transcription job state",()=>{
  // Where a failed job and its preserved vendor error become visible. Without it a failure is
  // silent and there is no way to retry.
  assert.ok(callers("/api/transcription/jobs").length > 0, "nothing the router renders reads transcription job state");
});

test("the router can still reach speaker assignment",()=>{
  for (const endpoint of ["/api/transcript/speaker-candidates","/api/transcript/speaker-map"]) {
    assert.ok(callers(endpoint).length > 0, `nothing the router renders calls ${endpoint}`);
  }
});

test("the walk reaches past the router, and reports nothing it should not",()=>{
  // Guards the guard, twice. Every assertion above passes vacuously if resolution stops at
  // page.tsx or returns nothing, and a check that cannot fail is worse than no check.
  assert.ok(reachable.length > 5, `import resolution must reach beyond the router, got ${reachable.length} module(s)`);
  assert.ok(reachable.some(file => file.name === "WorkspaceScreen.tsx"), "a known rendered screen must appear in the graph");
  assert.ok(reachable.some(file => file.name === "transcript-paragraphs.mjs"), "the walk must follow .mjs imports too");
  assert.equal(callers("/api/does-not-exist").length, 0, "the matcher reports callers that do not exist");
});

test("an orphaned module does not satisfy the guard",()=>{
  // The specific weakness of the directory-scan version this replaced. A file under app/ that
  // the router never imports must not count as a caller.
  const orphan = fileURLToPath(new URL("../app/__reachability-orphan.tsx", import.meta.url));
  fs.writeFileSync(orphan, 'const dead = "/api/audio/transcribe"; export default dead;\n');
  try {
    assert.equal(importGraph(ENTRY).some(file => file.endsWith("__reachability-orphan.tsx")), false,
      "an unimported file must not appear in the graph");
  } finally {
    fs.rmSync(orphan, { force:true });
  }
});
