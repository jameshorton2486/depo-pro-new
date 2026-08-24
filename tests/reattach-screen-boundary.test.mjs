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

test("discovery runs on mount and decides rather than guessing", () => {
  // Rewritten when discovery was composed onto /api/live-capture/recoverable. The endpoint is no
  // longer scoped by deposition -- it reports every running recording and every abandoned one, and
  // the screen chooses. What has to hold is that the choice is made by chooseRecovery rather than by
  // taking the first thing in the list.
  const effect = SCREEN.match(/useEffect\(\(\) => \{[^}]*fetch\(`\$\{API\}\/api\/live-capture\/recoverable[\s\S]*?\}, \[reattach\]\);/);
  assert.ok(effect, "the lookup runs on mount, keyed on the reattach it will call");
  assert.match(effect[0], /chooseRecovery\(payload\)/, "the decision is one function, not scattered conditionals");
  assert.match(effect[0], /if \(!current\) return;/, "an answer arriving after unmount changes nothing");
  assert.ok(!/setSession\(null\)/.test(effect[0]),
    "finding nothing must not clear a session already held -- after a stop the screen is showing that session's hashes");
});

test("more than one running recording is never guessed between", () => {
  // The screen presents the choice instead of picking. Two depositions recording at once is rare and
  // exactly when guessing wrong costs the most.
  assert.match(SCREEN, /setChoices\(decision\.sessions\)/);
  assert.match(SCREEN, /More than one recording is running/);
});
