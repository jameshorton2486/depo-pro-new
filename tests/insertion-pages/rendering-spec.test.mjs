import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRenderingSpec, workspaceDocumentFromRenderingSpec } from "../../server/insertion-pages/rendering-spec.mjs";

const page = (role, marker) => ({ id: role, role, lines: Array.from({ length: 25 }, (_, index) => ({ line: index + 1, text: index === 0 ? marker : "", fields: [] })) });
const insertionPageSet = { sha256: "fixture", pages: [page("title", "TITLE"), page("index", "INDEX"), page("certification1", "CERTIFICATE")] };

test("shared rendering spec orders insertions around canonical transcript pages", () => {
  const spec = createRenderingSpec({ depositionId: "depo-1", insertionPageSet, transcriptPages: [page("transcript", "Q. Testimony")], generatedAt: "2026-08-14T00:00:00.000Z" });
  assert.deepEqual(spec.pages.map((item) => item.role), ["title", "index", "transcript", "certification1"]);
  assert.equal(spec.pages.every((item) => item.lines.length === 25), true);
  assert.equal(spec.source.canonicalTranscriptIncluded, true);
  assert.match(spec.sha256, /^[a-f0-9]{64}$/);
  const workspace = workspaceDocumentFromRenderingSpec(spec);
  assert.equal(workspace.renderingSpecSha256, spec.sha256);
  assert.equal(workspace.pages[2].content[0].content[0].text, "Q. Testimony");
});

test("rendering spec rejects pages outside the canonical 25-line model", () => {
  assert.throws(() => createRenderingSpec({ depositionId: "depo-1", insertionPageSet: { sha256: "x", pages: [{ role: "title", lines: [] }] }, generatedAt: "now" }), /exactly 25 lines/);
});

test("Python transcript formatter renders the shared spec without changing text", t => {
  const formatterRoot=process.env.DEPO_PRO_FORMATTER_ROOT??path.join(os.homedir(),"transcript_formatter"),formatter=path.join(formatterRoot,"docx_exporter.py");
  // Resolved exactly as server/final-document-docx.mjs resolves it. This gate used to demand that
  // DEPO_PRO_PYTHON be set AND name an existing file, while the runtime accepts the bare string and
  // falls back to "python" -- and scripts/test-all.mjs never loads .env.local, so the variable was
  // always unset under the suite. The test therefore skipped on the very machine whose PATH resolves
  // python to the interpreter .env.local names, and the skip read as "no interpreter here" when the
  // truth was "this test asked a question the runtime does not ask". A skip is scored as a pass, so
  // nothing went red while an integration test sat idle for months.
  const python=process.env.DEPO_PRO_PYTHON??"python";
  const probe=spawnSync(python,["-c","import docx, lxml"],{encoding:"utf8",windowsHide:true});
  if(probe.error)return t.skip(`no Python interpreter resolved from DEPO_PRO_PYTHON ?? "python" (tried ${python}: ${probe.error.message})`);
  if(probe.status!==0)return t.skip(`Python at ${python} cannot import python-docx/lxml: ${(probe.stderr||"").trim()}`);
  if(!fs.existsSync(formatter))return t.skip(`Transcript formatter is unavailable at ${formatterRoot}; set DEPO_PRO_FORMATTER_ROOT to run this integration test.`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-renderer-"));
  const specPath = path.join(temporary, "spec.json");
  const outputPath = path.join(temporary, "output.docx");
  const spec = createRenderingSpec({ depositionId: "depo-1", insertionPageSet, generatedAt: "2026-08-14T00:00:00.000Z" });
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const script = fileURLToPath(new URL("../../server/insertion-pages/python-docx-renderer.py", import.meta.url));
  const rendered = spawnSync(python, [script, "--spec", specPath, "--output", outputPath, "--formatter-root", formatterRoot], { encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(fs.existsSync(outputPath), true);
  assert.ok(fs.statSync(outputPath).size > 1_000);
  const structural = spawnSync(python, ["-c", "from docx import Document; import json,sys; d=Document(sys.argv[1]); print(json.dumps({'count':len(d.paragraphs),'text':'\\n'.join(p.text for p in d.paragraphs)}))", outputPath], { encoding: "utf8" });
  assert.equal(structural.status, 0, structural.stderr);
  const structure = JSON.parse(structural.stdout);
  assert.equal(structure.count, 77);
  assert.match(structure.text, / 1 TITLE/);
  assert.match(structure.text, / 1 INDEX/);
  assert.match(structure.text, / 1 CERTIFICATE/);
});
