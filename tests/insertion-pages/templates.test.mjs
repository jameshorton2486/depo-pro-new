import assert from "node:assert/strict";
import test from "node:test";
import { loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";

test("reviewed Texas template inventories are hash-verified and enumerate caret fields", async () => {
  const loaded = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED");
  assert.equal(loaded.available, true);
  assert.ok(loaded.templates.fieldInventory.fields.includes("caption.court"));
  assert.ok(loaded.templates.fieldInventory.fields.includes("reporter.firmRegistrationNumber"));
});

test("federal template variants remain loud stubs pending an approved source", async () => {
  const loaded = await loadTemplateVariant("FEDERAL_SIGNATURE_REQUESTED");
  assert.equal(loaded.available, false);
  assert.match(loaded.expectedPath, /certification\.tmpl$/);
});
