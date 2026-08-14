import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("explicit RX integration run fails when the disposable fixture is unset",()=>{
  const env={...process.env,RUN_RX_INTEGRATION:"1"};delete env.DEPO_PRO_RX_TEST_AUDIO;
  const result=spawnSync(process.execPath,["scripts/test-rx-integration.mjs"],{cwd:path.resolve("."),env,encoding:"utf8",windowsHide:true});
  assert.equal(result.status,2);assert.match(result.stderr,/RUN_RX_INTEGRATION=1 but DEPO_PRO_RX_TEST_AUDIO is unset/);
});
