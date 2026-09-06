import assert from "node:assert/strict";
import test from "node:test";

import { insertionTemplateCatalog } from "../../server/insertion-pages/templates.mjs";

test("catalog exposes every supported and blocked UFM variant with its page family", async () => {
  const catalog = await insertionTemplateCatalog();
  assert.deepEqual(catalog.map((item) => item.variant), [
    "TEXAS_STATE_SIGNATURE_REQUESTED",
    "TEXAS_STATE_SIGNATURE_WAIVED",
    "TEXAS_STATE_AFFIRMATION_SIGNATURE_REQUESTED",
    "TEXAS_STATE_AFFIRMATION_SIGNATURE_WAIVED",
    "FEDERAL_OATH_REVIEW_REQUESTED",
    "FEDERAL_OATH_REVIEW_NOT_REQUESTED",
    "FEDERAL_AFFIRMATION_REVIEW_REQUESTED",
    "FEDERAL_AFFIRMATION_REVIEW_NOT_REQUESTED",
  ]);
  const requested = catalog[0];
  assert.equal(requested.available, true);
  assert.deepEqual(requested.roles, ["title", "appearances", "index", "changes", "signature", "certification1", "certification2", "certification3"]);
  const waived = catalog[1];
  assert.equal(waived.available, true);
  assert.deepEqual(waived.roles, ["title", "appearances", "index", "certification1", "certification2"]);
  assert.deepEqual(catalog[2].roles, requested.roles);
  assert.deepEqual(catalog[3].roles, waived.roles);
  for (const federal of catalog.slice(4)) {
    assert.equal(federal.available, true);
    assert.equal(federal.approval?.state, "current");
    assert.deepEqual(federal.roles, ["certification"]);
  }
});
