import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { depositionStorageRoot } from "../server/storage-config.mjs";

test("depositions default to the Windows user profile",()=>{
  assert.equal(depositionStorageRoot({USERPROFILE:"C:\\Users\\reporter"}),path.join("C:\\Users\\reporter","depos"));
});

test("an explicit deposition root takes precedence over the user profile",()=>{
  assert.equal(depositionStorageRoot({DEPO_PRO_DEPOSITIONS_ROOT:"D:\\Depositions",USERPROFILE:"C:\\Users\\reporter"}),path.resolve("D:\\Depositions"));
});

test("storage root resolution fails when neither configuration value is available",()=>{
  assert.throws(()=>depositionStorageRoot({}),/set DEPO_PRO_DEPOSITIONS_ROOT or USERPROFILE/);
});
