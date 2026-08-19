// The deposition date prints on the page-1 preamble and on the reporter's certificate. A
// transcript certifying that testimony was taken on a date it was not is a defective certificate,
// and nothing downstream can catch it: the folder name is derived from the same value, so every
// structural gate sees consistency.
//
// The new-deposition form prefilled the field with today's date. `required` was satisfied by the
// prefill, so the reporter was never forced to look at it -- a missing value wearing a confident
// answer. Extraction supplies it or the reporter does; nothing invents it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const page = fs.readFileSync(path.resolve(import.meta.dirname, "..", "app", "page.tsx"), "utf8");
const field = page.match(/name="depositionDate"[^>]*\/>/)?.[0] ?? "";

test("the deposition date field exists and is required", () => {
  assert.ok(field, "the new-deposition form must carry a depositionDate input");
  assert.match(field, /required/);
});

test("no date is invented for the reporter", () => {
  assert.doesNotMatch(field, /new Date\(\)/,
    "a prefilled date satisfies `required` without the reporter ever reading the field");
  assert.doesNotMatch(field, /Date\.now\(\)/);
});

test("an extracted date still prefills, because that came from the document", () => {
  assert.match(field, /intakeDraft\?\.depositionDate/,
    "extraction may supply the date; only the clock may not");
});

test("nothing else in the create path invents a date", () => {
  // The guard is worth little if a sibling field learns the same habit.
  const inputs = page.match(/<input[^>]*type="date"[^>]*\/>/g) ?? [];
  const invented = inputs.filter(input => /new Date\(\)|Date\.now\(\)/.test(input));
  assert.deepEqual(invented, [], "a date input must not default to the clock");
});
