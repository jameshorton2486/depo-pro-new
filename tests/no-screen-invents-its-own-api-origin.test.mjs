// One screen with its own origin is one screen that stops working when the port moves.
//
// OpeningProceduresScreen hard-coded http://127.0.0.1:4317 -- the port the API falls back to when
// LOCAL_API_PORT is unset. Every other screen imports LOCAL_API_BASE_URL, which reads
// VITE_LOCAL_API_ORIGIN. So on a machine that sets a port, Opening Procedures fetched a closed
// socket and showed "Failed to fetch" while every other screen in the same tab worked. It was
// found in the browser's network log, not by a test, because nothing here was looking.
//
// The check is on the literal, not on the import: a screen can legitimately name the origin in a
// comment, but building one is the defect. api-client.ts is the one place allowed to hold the
// fallback, because it is the fallback.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("../app/", import.meta.url));
const ORIGIN = /(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*["'`]https?:\/\/[^"'`]+["'`]/g;

test("no screen builds an API origin of its own", () => {
  const offenders = [];
  for (const name of fs.readdirSync(appDirectory)) {
    if (!/\.(tsx|ts|mjs)$/.test(name) || name === "api-client.ts") continue;
    const source = fs.readFileSync(path.join(appDirectory, name), "utf8");
    for (const match of source.match(ORIGIN) ?? []) offenders.push(`${name}: ${match}`);
  }
  assert.deepEqual(offenders, [], `these build their own origin instead of importing LOCAL_API_BASE_URL:\n${offenders.join("\n")}`);
});

test("the screen that had the defect reaches the API through the shared origin", () => {
  const source = fs.readFileSync(path.join(appDirectory, "OpeningProceduresScreen.tsx"), "utf8");
  assert.match(source, /import \{ LOCAL_API_BASE_URL as API \} from "\.\/api-client"/);
  assert.ok(!/["'`]https?:\/\/127\.0\.0\.1/.test(source), "OpeningProceduresScreen still names a literal loopback origin");
});
