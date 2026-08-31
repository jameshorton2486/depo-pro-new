// The final document runs on a toolchain nothing in the tree declared.
//
// createTranscriptDocxArtifact shells out to a Python renderer that imports python-docx and lxml.
// Neither is a Node dependency, so package.json cannot mention them, and nothing else did either:
// the interpreter resolved as `DEPO_PRO_PYTHON ?? "python"`, meaning the Word deliverable rested on
// whatever happened to be on PATH. It worked on the machine it was built on, which is the property
// that makes this kind of dependency dangerous rather than safe.
//
// Two things close it, and this file characterizes both. The dependency is declared in
// requirements-docx.txt. And systemPreflight -- which already reports on ffmpeg, ffprobe, RX and
// pedalboard -- now reports on this too, so a machine cannot say it is ready while being unable to
// produce the one artifact a reporter serves.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { systemPreflight } from "../server/preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Set at call time and restored, so one case cannot license the next.
function withPython(value, run) {
  const previous = process.env.DEPO_PRO_PYTHON;
  if (value === null) delete process.env.DEPO_PRO_PYTHON;
  else process.env.DEPO_PRO_PYTHON = value;
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env.DEPO_PRO_PYTHON;
    else process.env.DEPO_PRO_PYTHON = previous;
  }
}

test("the Word toolchain is declared where a human can find it", () => {
  const file = path.join(root, "requirements-docx.txt");
  assert.ok(fs.existsSync(file), "the renderer's Python dependencies are undeclared");
  const text = fs.readFileSync(file, "utf8");
  // Pinned, not floating. An unpinned dependency reintroduces the defect on the next release.
  assert.match(text, /^python-docx==\d+\.\d+\.\d+$/m, "python-docx must be pinned");
  assert.match(text, /^lxml==\d+\.\d+\.\d+$/m, "lxml must be pinned");
});

test("every package the renderers import is declared", () => {
  // Read from the renderers rather than a list kept beside them, so a new import cannot be added
  // without this failing.
  const declared = fs.readFileSync(path.join(root, "requirements-docx.txt"), "utf8");
  const sources = ["server/fixed-page-docx-renderer.py", "server/insertion-pages/python-docx-renderer.py"]
    .filter(file => fs.existsSync(path.join(root, file)))
    .map(file => fs.readFileSync(path.join(root, file), "utf8"));
  assert.ok(sources.length, "no renderer found to check");

  const stdlib = new Set(["__future__", "argparse", "json", "pathlib", "sys", "os", "re", "math", "typing", "dataclasses", "collections", "itertools", "datetime", "textwrap"]);
  const packages = new Set();
  for (const source of sources) {
    for (const [, name] of source.matchAll(/^(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
      if (!stdlib.has(name)) packages.add(name === "docx" ? "python-docx" : name);
    }
  }
  for (const name of packages) {
    assert.match(declared, new RegExp(`^${name}==`, "m"), `${name} is imported by a renderer but not declared`);
  }
});

test("readiness reports on the toolchain the deliverable actually runs on", () => {
  const components = systemPreflight({}).components;
  assert.ok("docxRenderer" in components, "readiness said nothing about the Word renderer");
  assert.ok("ready" in components.docxRenderer);
});

test("an interpreter that is not there is reported, not assumed", () => {
  // The case that mattered: a reporter's machine without the toolchain. Readiness must say so
  // rather than reporting green and failing when a transcript is finally produced.
  const report = withPython("depo-pro-no-such-interpreter", () => systemPreflight({}));
  assert.equal(report.components.docxRenderer.ready, false);
  assert.ok(report.components.docxRenderer.error, "a refusal must say what went wrong");
  assert.equal(report.overallReady, false, "a machine that cannot render Word is not ready");
});

test("the resolution matches the renderer's, so readiness cannot pass while rendering fails", () => {
  // final-document-docx.mjs resolves `process.env.DEPO_PRO_PYTHON ?? "python"`. If preflight ever
  // checked a different interpreter it would be reporting on something the renderer never runs.
  const renderer = fs.readFileSync(path.join(root, "server/final-document-docx.mjs"), "utf8");
  const preflight = fs.readFileSync(path.join(root, "server/preflight.mjs"), "utf8");
  assert.match(renderer, /process\.env\.DEPO_PRO_PYTHON\s*\?\?\s*"python"/);
  assert.match(preflight, /process\.env\.DEPO_PRO_PYTHON\s*\|\|\s*"python"/);
});
