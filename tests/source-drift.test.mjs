import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Character drift in generated source, caught by the suite instead of by remembering to look.
//
// Four instances so far: a Cyrillic character inside a CSS colour, a corrupted hex value, and
// Cyrillic letters inside a test comment -- which landed *after* a retrospective scan across
// 51 commits came back clean. The retrospective scan was accurate; the drift is a live
// generator, not a historical artifact. A scan that runs because someone remembers to run it
// will eventually not run, so this is a test file: scripts/test-all.mjs discovers it and
// already fails the run if discovery omits a test file.
//
// Two of the four were invisible in the browser. Both sat above a duplicate declaration that
// overrode them, so the page rendered correctly and would have shipped broken the moment the
// later rule moved. That is why this is mechanical rather than visual review.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv-pedalboard", "coverage"]);
const EXTENSIONS = new Set([".mjs", ".mts", ".js", ".ts", ".tsx", ".css"]);

// Numeric ranges rather than a regex character class, for two reasons. Written as literal
// characters the class makes this file the first thing its own scan flags -- which is how the
// first run of it failed. Written as escapes it trips no-misleading-character-class, because
// the Hebrew and Devanagari blocks contain combining marks; suppressing that rule to get green
// is not on the table. Code points have neither problem and read as what they are.
//
// Scripts a Latin-alphabet codebase has no reason to emit. Deliberately not a whitelist of
// permitted characters: em-dash, en-dash and typographic quotes are intentional in user-facing
// strings throughout, and flagging those would train everyone to ignore this test.
const FOREIGN_SCRIPTS = [
  [0x0370, 0x03ff], // Greek
  [0x0400, 0x04ff], // Cyrillic
  [0x0530, 0x058f], // Armenian
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0900, 0x097f], // Devanagari
  [0x3040, 0x30ff], // Hiragana and Katakana
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xac00, 0xd7af], // Hangul
];
// Invisible by construction, so no amount of reading catches these. Bidirectional overrides
// are in here because they can reorder how a line displays without changing what it does.
const INVISIBLE = [
  [0x200b, 0x200f], // zero-width space through right-to-left mark
  [0x202a, 0x202e], // bidirectional embedding and override
  [0x2060, 0x2060], // word joiner
  [0xfeff, 0xfeff], // byte order mark used mid-file
];
// A colour value that is not a colour. Scoped to CSS declarations so URL fragments and comment
// text elsewhere cannot trip it.
const MALFORMED_HEX = /:\s*#[0-9a-fA-F]*[g-zG-Z]/;

function findCodePoint(line, ranges) {
  for (const character of line) {
    const code = character.codePointAt(0);
    if (ranges.some(([low, high]) => code >= low && code <= high)) return character;
  }
  return null;
}
const detects = (line, ranges) => findCodePoint(line, ranges) !== null;

function sourceFiles(directory = ROOT) {
  return fs.readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    if (SKIP_DIRECTORIES.has(entry.name)) return [];
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : sourceFiles(full);
    return EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function scan(matches, { cssOnly = false } = {}) {
  const hits = [];
  for (const file of sourceFiles()) {
    if (cssOnly && path.extname(file) !== ".css") continue;
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (matches(line)) hits.push(`${path.relative(ROOT, file).replaceAll("\\", "/")}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

test("no non-Latin script characters in source",()=>{
  const hits = scan(line => detects(line, FOREIGN_SCRIPTS));
  assert.deepEqual(hits,[],`Non-Latin characters found in source:\n${hits.join("\n")}`);
});

test("no invisible or bidirectional-override characters in source",()=>{
  const hits = scan(line => detects(line, INVISIBLE));
  assert.deepEqual(hits,[],`Invisible characters found in source:\n${hits.join("\n")}`);
});

test("no malformed hex colour values in stylesheets",()=>{
  const hits = scan(line => MALFORMED_HEX.test(line),{ cssOnly:true });
  assert.deepEqual(hits,[],`Malformed hex colours found:\n${hits.join("\n")}`);
});

test("the scan reaches the files it claims to",()=>{
  // Without this a broken walk reports a clean tree forever, which is the failure mode of
  // every scanner that only ever says "nothing found".
  const files = sourceFiles().map(file => path.relative(ROOT, file).replaceAll("\\", "/"));
  for (const expected of ["app/globals.css","app/page.tsx","server/audio-pipeline.mjs","tests/source-drift.test.mjs"]) {
    assert.ok(files.includes(expected),`the drift scan did not reach ${expected}`);
  }
  assert.ok(files.length > 40,`the drift scan only reached ${files.length} files, which is too few to be walking the tree`);
  assert.equal(files.some(file => file.includes("node_modules")),false,"the scan must not walk node_modules");
});

test("each detector matches the drift it was written for",()=>{
  // The detectors are the whole test. An empty result set proves nothing about a check that
  // matches nothing, so each is exercised against the exact corruption that occurred. The
  // vectors are built from code points so this file stays pure ASCII and does not flag itself.
  const chars = (...codes) => String.fromCodePoint(...codes);
  const CYRILLIC_DI = chars(0x0434, 0x0438), CYRILLIC_ZHIT = chars(0x0436, 0x0438, 0x0442, 0x044c);
  assert.ok(detects(`  // ${CYRILLIC_DI}verge the reporter's correction`, FOREIGN_SCRIPTS));
  assert.ok(detects(`  --line:#384${CYRILLIC_ZHIT};`, FOREIGN_SCRIPTS));
  assert.ok(detects(`const value = ${chars(0x200b)}term;`, INVISIBLE));
  assert.ok(detects(`const value = ${chars(0x202e)}term;`, INVISIBLE));
  assert.ok(MALFORMED_HEX.test("  background:#152banother;"));

  // And does not match what is deliberately there. An em-dash in user-facing copy is the most
  // common character above ASCII in this tree; a detector that flagged it would be turned off.
  assert.equal(detects(`  note: "Reading only ${chars(0x2014)} no edits yet"`, FOREIGN_SCRIPTS),false);
  assert.equal(detects(`  quality_target_range: [20${chars(0x2013)}50]`, FOREIGN_SCRIPTS),false);
  assert.equal(detects(`  label: "Depo${chars(0x2019)}s"`, INVISIBLE),false);
  assert.equal(MALFORMED_HEX.test("  background:#152b3f;"),false);
  assert.equal(MALFORMED_HEX.test('  href="https://example.com/#anchor"'),false);
});
