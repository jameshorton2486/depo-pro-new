import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_TEMPLATE_ROOT, loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";

test("reviewed Texas template inventories are hash-verified and enumerate caret fields", async () => {
  const loaded = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED");
  assert.equal(loaded.available, true);
  assert.ok(loaded.templates.fieldInventory.fields.includes("caption.court"));
  assert.ok(loaded.templates.fieldInventory.fields.includes("reporter.firmRegistrationNumber"));
});

test("manifest hashes verify against a CRLF checkout of the same templates", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "depo-pro-templates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(DEFAULT_TEMPLATE_ROOT, root, { recursive: true });
  for (const entry of await readdir(root, { recursive: true })) {
    if (!entry.endsWith(".tmpl")) continue;
    const filePath = path.join(root, entry);
    await writeFile(filePath, (await readFile(filePath, "utf8")).replaceAll("\n", "\r\n"));
  }

  const loaded = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED", { root });
  assert.equal(loaded.available, true);
  for (const [role, template] of Object.entries(loaded.templates)) {
    assert.equal(template.body.includes("\r"), false, `${role} retained a carriage return`);
  }
});

test("federal template variants remain loud stubs pending an approved source", async () => {
  const loaded = await loadTemplateVariant("FEDERAL_SIGNATURE_REQUESTED");
  assert.equal(loaded.available, false);
  assert.match(loaded.expectedPath, /certification\.tmpl$/);
});
