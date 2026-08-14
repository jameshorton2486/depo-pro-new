import assert from "node:assert/strict";
import test from "node:test";
import { fetchExternal } from "../server/external-fetch.mjs";

const response=status=>({status,arrayBuffer:async()=>new ArrayBuffer(0)}),options={label:"test",attempts:2,timeoutMs:1000,sleep:async()=>{}};

test("ambiguous timeout is never retried",async()=>{let calls=0;await assert.rejects(fetchExternal("https://example.invalid",{}, {...options,fetchImpl:async()=>{calls++;const error=new Error("aborted");error.name="AbortError";throw error}}),/outcome is unknown/);assert.equal(calls,1)});
test("429 and server failures retry",async()=>{for(const status of [429,500,502,503,504]){let calls=0;const result=await fetchExternal("https://example.invalid",{}, {...options,fetchImpl:async()=>response(++calls===1?status:200)});assert.equal(result.status,200);assert.equal(calls,2)}});
test("permanent client failure is not retried",async()=>{let calls=0;const result=await fetchExternal("https://example.invalid",{}, {...options,fetchImpl:async()=>{calls++;return response(400)}});assert.equal(result.status,400);assert.equal(calls,1)});
test("connection failure retries",async()=>{let calls=0;const result=await fetchExternal("https://example.invalid",{}, {...options,fetchImpl:async()=>{if(++calls===1)throw new Error("connection refused");return response(200)}});assert.equal(result.status,200);assert.equal(calls,2)});
