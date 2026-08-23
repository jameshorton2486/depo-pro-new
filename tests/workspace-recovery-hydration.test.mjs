import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  RECOVERED_WORKSPACE_MISSING,
  RECOVERED_WORKSPACE_RESTORED,
  RECOVERED_WORKSPACE_UNASSIGNED,
  resolveRecoveredWorkspace,
} from "../app/workspace-recovery.mjs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const live = fs.readFileSync(new URL("../app/LiveCaptureScreen.tsx", import.meta.url), "utf8");

test("recovered deposition identity is reported from Live Capture to the workspace owner", () => {
  assert.match(live, /setRecoveredDepositionId\(item\.depositionId \?\? ""\)/);
  assert.match(live, /onRecoveredDeposition\(item\.depositionId\)/);
  assert.match(page, /onRecoveredDeposition=\{restoreRecoveredDeposition\}/);
});

test("characterization: outer workspace identity is owned by page active state", () => {
  assert.match(page, /const \[active, setActive\] = useState<Deposition \| null>\(null\)/);
  assert.match(page, /hasDeposition=\{Boolean\(active\)\}/);
  assert.match(page, /depositionLabel=\{active\?\.witness\}/);
  assert.match(page, /<LiveCaptureScreen deposition=\{active\}/);
});

test("normal selection and matching recovered selection resolve the canonical deposition", () => {
  const a = { id: "DEP-A", witness: "A" };
  assert.deepEqual(resolveRecoveredWorkspace([a], "DEP-A"), {
    kind: RECOVERED_WORKSPACE_RESTORED,
    deposition: a,
  });
});

test("a recovered session wins over stale client selection without mutating either deposition", () => {
  const a = Object.freeze({ id: "DEP-A", witness: "A" });
  const b = Object.freeze({ id: "DEP-B", witness: "B" });
  const before = JSON.stringify([a, b]);
  const result = resolveRecoveredWorkspace([a, b], "DEP-B");
  assert.equal(result.kind, RECOVERED_WORKSPACE_RESTORED);
  assert.equal(result.deposition, b);
  assert.equal(JSON.stringify([a, b]), before);
});

test("missing and unassigned recovery never guess another deposition", () => {
  const a = { id: "DEP-A" };
  assert.deepEqual(resolveRecoveredWorkspace([a], "DEP-X"), {
    kind: RECOVERED_WORKSPACE_MISSING,
    deposition: null,
  });
  assert.deepEqual(resolveRecoveredWorkspace([a], null), {
    kind: RECOVERED_WORKSPACE_UNASSIGNED,
    deposition: null,
  });
});

test("hydration reports identity only and cannot start or replace a recording", () => {
  const helper = fs.readFileSync(new URL("../app/workspace-recovery.mjs", import.meta.url), "utf8");
  const callbackStart = page.indexOf("const restoreRecoveredDeposition");
  const callback = page.slice(callbackStart, page.indexOf("},[]);", callbackStart) + 6);
  assert.doesNotMatch(helper, /startCapture|createCapture|stopCapture|sessionId|fetch\(/);
  assert.doesNotMatch(callback, /live-capture\/start|setShowLiveCapture/);
});
