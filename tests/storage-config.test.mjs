import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { depositionStorageRoot } from "../server/storage-config.mjs";

test("depositions default to the operating-system user home directory",()=>{
  assert.equal(depositionStorageRoot({},()=>"C:\\Users\\reporter"),path.join("C:\\Users\\reporter","depos"));
});

test("an explicit deposition root succeeds without resolving the user home directory",()=>{
  assert.equal(depositionStorageRoot({DEPO_PRO_DEPOSITIONS_ROOT:"D:\\Depositions"},()=>{throw new Error("must not resolve home")}),path.resolve("D:\\Depositions"));
});

test("storage root resolution fails when neither configuration value is available",()=>{
  assert.throws(()=>depositionStorageRoot({},()=>""),/set DEPO_PRO_DEPOSITIONS_ROOT or configure an operating-system user home directory/);
});
