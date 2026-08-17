import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const ENTRY = path.join(APP, "ReporterReviewScreen.tsx");

// Every way this codebase could reach a server or persist state. A grep for `fetch(` and
// `method:` is not this list -- it omits sendBeacon, XMLHttpRequest, form submission, and
// mutation-hook wrappers, any one of which would make the surface writable while the narrow
// check still reported clean.
const WRITE_VECTORS = Object.freeze({
  "fetch with a method": /method\s*:/,
  "XMLHttpRequest": /XMLHttpRequest/,
  "navigator.sendBeacon": /sendBeacon/,
  "form submission": /<form|\baction\s*=/,
  "mutation hook": /useMutation|useSWRMutation|\bmutate\s*\(/,
  "contentEditable": /contentEditable/,
  "editable control": /<input|<textarea|<select/,
  "socket": /new WebSocket|EventSource/,
  "storage write": /(?:local|session)Storage\.(?:setItem|removeItem|clear)/,
  "filesystem write": /createWritable|showSaveFilePicker/,
});

// Resolves static and dynamic imports, then theirs, so a write path one import away is caught.
// The narrow version of this check reads a single file and would miss exactly that.
//
// Dynamic import() is matched deliberately. The first version of this walk matched only
// `from "..."`, and a module pulled in by `await import("./x")` passed the guard cleanly --
// verified by adding one and watching all three tests stay green.
//
// Known limit: only relative specifiers are followed. A package import is not resolved, so a
// write path reached through node_modules would not be seen. That is a real gap, not a
// covered case, and the claim this guard licenses is bounded accordingly.
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

test("the reporter read-through reaches no write-capable client",()=>{
  // The banner on this screen tells a reporter the surface cannot change anything, about a
  // system handling certified work product. That representation needs a guard that fails
  // when it stops being true, not an inspection that was accurate on the day it was written.
  const graph = importGraph(ENTRY);
  assert.ok(graph.includes(ENTRY),"the entry module must be in its own graph");
  const found = [];
  for (const file of graph) {
    const source = fs.readFileSync(file, "utf8");
    for (const [name, pattern] of Object.entries(WRITE_VECTORS)) {
      if (pattern.test(source)) found.push(`${path.basename(file)}: ${name}`);
    }
  }
  assert.deepEqual(found, [], `the read-through must reach no write vector, found: ${found.join("; ")}`);
});

test("the read-through graph is walked transitively, not just the entry file",()=>{
  // Guards the guard. If import resolution silently stopped at the entry module, the check
  // above would pass vacuously for anything hidden one import away.
  const graph = importGraph(ENTRY);
  assert.ok(graph.length > 1,`import resolution must reach beyond the entry file, got ${graph.length} module(s)`);
  assert.ok(graph.some(file => file.endsWith("transcript-paragraphs.mjs")),"the known dependency must appear in the resolved graph");
});

test("every request the read-through makes is a plain GET",()=>{
  const requests = [];
  for (const file of importGraph(ENTRY)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/fetch\(/g)) requests.push(`${path.basename(file)}@${match.index}`);
  }
  assert.equal(requests.length, 1, `expected exactly one request, found ${requests.length}: ${requests.join(", ")}`);
  const source = fs.readFileSync(ENTRY, "utf8");
  assert.match(source, /\/api\/transcript\/working\?/, "the single request must be the working-transcript read");
});
