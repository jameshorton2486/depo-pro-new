import assert from "node:assert/strict";
import test from "node:test";
import { systemPreflight } from "../server/preflight.mjs";

test("system preflight reports every required dependency without exposing secrets",()=>{
  const result=systemPreflight({config:{deepgramApiKey:"secret",anthropicApiKey:"secret",claudeModel:"test-model"}});
  for(const name of ["node","ffmpeg","ffprobe","rxEditor","pythonWorker","pedalboard","rxModules","deepgram","claude"])assert.ok(name in result.components);
  assert.equal(result.components.deepgram.ready,true); assert.equal(result.components.claude.ready,true); assert.doesNotMatch(JSON.stringify(result),/secret/);
});
