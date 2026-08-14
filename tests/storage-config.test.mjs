import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DEFAULT_DEPOSITIONS_ROOT, depositionStorageRoot } from "../server/storage-config.mjs";

test("depositions default to the configured reporter directory",()=>{
  assert.equal(DEFAULT_DEPOSITIONS_ROOT,"C:\\Users\\james\\depos");
  assert.equal(depositionStorageRoot({}),path.resolve(DEFAULT_DEPOSITIONS_ROOT));
  assert.equal(depositionStorageRoot({DEPO_PRO_DEPOSITIONS_ROOT:"D:\\Depositions"}),path.resolve("D:\\Depositions"));
});
