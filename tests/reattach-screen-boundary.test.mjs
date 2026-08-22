import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// This covers an interaction neither branch could have tested, because neither had the other.
// Session reattach asks the server for a RECORDING session the moment the live screen mounts.
// Opening Procedures put a second screen on the same deposition-scoped surface. The question is
// whether a mount that crosses between them can reattach against the wrong deposition, or reattach
// while the other screen owns the surface.
const PAGE = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const SCREEN = fs.readFileSync(new URL("../app/LiveCaptureScreen.tsx", import.meta.url), "utf8");

test("only one screen can own the surface, so a reattach cannot fire underneath another", () => {
  // navigate() assigns every screen flag from the same `next`, so exactly one can be true. If a
  // future edit sets one of these without clearing the others, two screens are open at once and
  // the live screen -- which returns first -- would silently mount under the one the reporter
  // chose, firing a reattach the reporter never asked for.
  const navigate = PAGE.match(/function navigate\(next:NavView\)\{[\s\S]*?\n {2}\}/);
  assert.ok(navigate, "navigate is the one place that decides which screen is showing");
  assert.match(navigate[0], /setShowOpening\(next==="opening"\)/);
  assert.match(navigate[0], /setShowLiveCapture\(next==="live-capture"\)/);
  assert.ok(
    !/setShowOpening\(true\)|setShowLiveCapture\(true\)/.test(navigate[0]),
    "a flag set to a literal true rather than derived from `next` is how two screens become open at once",
  );
});

test("the live screen is only reachable through the flag navigate controls", () => {
  const guard = PAGE.match(/if \(showLiveCapture\) \{[\s\S]*?\n {2}\}/);
  assert.ok(guard, "the live screen is returned behind its own flag");
  assert.match(guard[0], /<LiveCaptureScreen[\s\S]*deposition=\{active\}/,
    "and it is handed the open deposition, which is what scopes the reattach");
});

test("the reattach is scoped to the deposition the screen was given, and re-asks when that changes", () => {
  const effect = SCREEN.match(/useEffect\(\(\) => \{[^}]*fetch\(`\$\{API\}\/api\/live-capture\/running[\s\S]*?\}, \[openDepositionId\]\);/);
  assert.ok(effect, "the lookup is keyed on the open deposition, not run once and forgotten");
  assert.match(effect[0], /depositionId=\$\{encodeURIComponent\(openDepositionId\)\}/,
    "the server is asked about this deposition and no other");
  assert.ok(
    !/setSession\(null\)/.test(effect[0]),
    "finding nothing must not clear a session already held -- after a stop the screen is showing that session's hashes",
  );
  assert.match(effect[0], /if \(!current \|\| !payload\?\.sessionId\) return;/,
    "and an empty answer changes nothing at all");
});

test("openDepositionId is the open deposition and nothing else", () => {
  assert.match(SCREEN, /const openDepositionId = deposition\?\.id \?\? "";/,
    "if this ever fell back to something other than the prop, the reattach could ask about a deposition the screen is not showing");
});
