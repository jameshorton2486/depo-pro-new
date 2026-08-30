import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
const route = source.slice(source.indexOf('req.url === "/api/claude/extract-notice"'), source.indexOf('req.url === "/api/master-data/project"'));

test("notice extraction does not attach a model-specific effort control", () => {
  assert.ok(route.length > 0, "the notice extraction route must remain reachable");
  assert.doesNotMatch(route, /output_config\s*:/, "an administrator-selectable model cannot receive an unconditional output_config");
  assert.doesNotMatch(route, /effort\s*:/, "an administrator-selectable model cannot receive an unconditional effort value");
});
