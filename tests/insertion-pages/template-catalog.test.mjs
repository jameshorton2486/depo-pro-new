import assert from "node:assert/strict";
import test from "node:test";

import { insertionTemplateCatalog } from "../../server/insertion-pages/templates.mjs";

test("catalog exposes every supported and blocked UFM variant with its page family", async () => {
  const catalog = await insertionTemplateCatalog();
  assert.deepEqual(catalog.map((item) => item.variant), [
    "TEXAS_STATE_SIGNATURE_REQUESTED",
    "TEXAS_STATE_SIGNATURE_WAIVED",
    "FEDERAL_SIGNATURE_REQUESTED",
    "FEDERAL_SIGNATURE_WAIVED",
  ]);
  const requested = catalog[0];
  assert.equal(requested.available, true);
  assert.deepEqual(requested.roles, ["title", "appearances", "index", "changes", "signature", "certification1", "certification2", "certification3"]);
  const waived = catalog[1];
  assert.equal(waived.available, true);
  assert.deepEqual(waived.roles, ["title", "appearances", "index", "certification1", "certification2"]);
  for (const federal of catalog.slice(2)) {
    assert.equal(federal.available, false);
    assert.ok(federal.blockedBy.length > 0, `${federal.variant} must explain why it is blocked`);
  }
});
