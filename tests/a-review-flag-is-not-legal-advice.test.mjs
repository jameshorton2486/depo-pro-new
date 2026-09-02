// A review flag reports the document. It does not say what the law requires.
//
// On the Heath Thomas notice the extraction returned, as a review flag:
//
//   FRCP 30(b)(1) typically requires reasonable written notice; 21 days is usually sufficient,
//   but confirm no objections from defending counsel.
//
// Nothing in the document says that. It is advice about what a federal rule requires, shown to a
// court reporter who is not the party's lawyer, by an application that is not a source of law and
// that the reporter cannot check by reading the notice in front of them.
//
// WHAT THIS TEST CANNOT DO. The constraint lives in a prompt, and a prompt is a request. This pins
// that the rule is in the file the server actually loads and that both flag-bearing fields are
// named by it -- so the rule cannot be dropped in an edit without a test going red. It cannot show
// that a model obeyed it. That needs one live extraction of that notice with the flags read, and
// it is a manual gate, not this. Treat this as a placeholder for coverage, in the sense of the
// release gap report section 6a, not as coverage.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The same path local-api.mjs reads. v1.md exists and is loaded by nothing.
const PROMPT = fs.readFileSync(path.join(root, "prompts", "extraction", "case_terms", "v2.md"), "utf8");

test("the prompt the server loads forbids legal commentary in a review flag", () => {
  assert.match(PROMPT, /## Review flags state what the document says/,
    "the rule has a heading of its own because a clause buried in a bullet list is a clause a model skims");
  assert.match(PROMPT, /must not state, paraphrase, or\s+characterise a rule of law/);
  assert.match(PROMPT, /21 days is usually sufficient/,
    "the refused example is the one that actually reached a reporter; a made-up example teaches less");
});

test("the rule covers both fields that reach the reporter as review flags", () => {
  // local-api renders setup.warnings AND anomalies into the same list. A rule naming only one of
  // them would leave the other free, and warnings had no guidance in this prompt at all.
  const section = PROMPT.slice(PROMPT.indexOf("## Review flags state what the document says"));
  assert.match(section, /`setup\.warnings` and `anomalies`/);

  const api = fs.readFileSync(path.join(root, "server", "local-api.mjs"), "utf8");
  assert.match(api, /Review flag: \$\{item\.detail/, "anomalies still render as review flags");
  assert.match(api, /warnings:\s*\[\s*\.\.\.\(data\.setup\.warnings\s*\|\|\s*\[\]\)/, "and so do setup warnings");
});
