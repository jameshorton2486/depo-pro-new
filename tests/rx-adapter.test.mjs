import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { inspectRx, RX12_DEFAULT_EXECUTABLES, RX12_EXECUTABLE_NAME } from "../server/rx-adapter.mjs";

const verified = "C:\\Program Files\\iZotope\\RX 12 Audio Editor\\win64\\iZotope RX 12 Audio Editor.exe";
const fakeFiles = (...files) => ({
  statSync(value) { return { isFile:() => files.some(file => path.resolve(file).toLowerCase() === path.resolve(value).toLowerCase()) }; },
  realpathSync(value) { return path.resolve(value); },
});

test("configured full RX 12 executable path is accepted, including spaces", () => {
  const result = inspectRx({ environment:{RX_EXECUTABLE_PATH:verified}, candidates:[], ...fakeFiles(verified), includeExecutable:true });
  assert.equal(result.available,true); assert.equal(result.version,"12"); assert.equal(result.detectionMethod,"RX_EXECUTABLE_PATH"); assert.equal(result.executable,path.resolve(verified));
});

test("directory-only RX path is rejected", () => {
  const result = inspectRx({ environment:{RX_EXECUTABLE_PATH:path.dirname(verified)}, ...fakeFiles(path.dirname(verified)), includeExecutable:true });
  assert.equal(result.available,false); assert.equal(result.status,"invalid-configuration"); assert.match(result.fallback,/must identify/i);
});

test("missing configured executable fails closed instead of falling back", () => {
  const result = inspectRx({ environment:{RX_EXECUTABLE_PATH:verified}, candidates:RX12_DEFAULT_EXECUTABLES, ...fakeFiles(), includeExecutable:true });
  assert.equal(result.available,false); assert.equal(result.detectionMethod,"RX_EXECUTABLE_PATH"); assert.equal(result.executable,null);
});

test("verified RX 12 default installation location is discovered without RX 11", () => {
  const result = inspectRx({ environment:{}, candidates:[verified], ...fakeFiles(verified), includeExecutable:true });
  assert.equal(result.available,true); assert.equal(result.detectionMethod,"standard-install-location"); assert.equal(path.basename(result.executable),RX12_EXECUTABLE_NAME);
});

test("RX 11 executable cannot masquerade as RX 12", () => {
  const rx11="C:\\Program Files\\iZotope\\RX 11 Audio Editor\\win64\\iZotope RX 11 Audio Editor.exe";
  const result=inspectRx({environment:{RX_EXECUTABLE_PATH:rx11},...fakeFiles(rx11),includeExecutable:true});
  assert.equal(result.available,false); assert.equal(result.status,"invalid-configuration");
});

test("durable status omits the machine-specific executable path", () => {
  const result=inspectRx({environment:{RX_EXECUTABLE_PATH:verified},...fakeFiles(verified)});
  assert.equal(result.available,true); assert.equal("executable" in result,false);
});
