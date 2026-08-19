import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  KEYTERM_PRODUCT_CAP,
  KEYTERM_TOKEN_BUDGET,
} from "../server/keyterm-limits.mjs";

const root = path.resolve(import.meta.dirname, "..");
const prompt = fs.readFileSync(
  path.join(root, "prompts", "extraction", "case_terms", "v2.md"),
  "utf8",
);

test("the active terminology prompt identifies its real version and artifact", () => {
  assert.match(prompt, /Prompt \(v2\)/);
  assert.match(prompt, /prompts\/extraction\/case_terms\/v2\.md/);
  assert.doesNotMatch(prompt, /Prompt \(v1\)/);
});

test("the active terminology prompt publishes the enforced keyterm limits", () => {
  assert.match(prompt, new RegExp(`Absolute cap: ${KEYTERM_PRODUCT_CAP} terms`));
  assert.match(prompt, new RegExp(`${KEYTERM_TOKEN_BUDGET}-estimated-token limits`));
  assert.doesNotMatch(prompt, /Absolute cap: 60 terms/);
});

test("the active terminology prompt names the structured tool as authoritative", () => {
  assert.match(prompt, /extract_deposition_intake/);
  assert.match(prompt, /structured\s+schema is the authoritative output contract/);
});
