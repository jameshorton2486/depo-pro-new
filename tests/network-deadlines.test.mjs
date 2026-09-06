import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchExternal } from "../server/external-fetch.mjs";
import { transcribeWithDeepgram } from "../server/deepgram-service.mjs";
import { waitForReady } from "../scripts/start-local.mjs";

async function endpoint(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("external deadline covers a response stalled after headers without resubmitting", async t => {
  let calls = 0;
  const url = await endpoint(t, (_req, res) => { calls++; res.writeHead(200); res.write('{"partial":'); });
  await assert.rejects(fetchExternal(url, {}, { label: "test", timeoutMs: 100, attempts: 2 }), /outcome is unknown/);
  assert.equal(calls, 1);
});

test("completed external response retains status, headers and exact body", async t => {
  const payload = '{ "text": "test ✓" }\n';
  const url = await endpoint(t, (_req, res) => { res.writeHead(201, { "x-request-id": "fixture" }); res.end(payload); });
  const response = await fetchExternal(url, {}, { label: "test" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-request-id"), "fixture");
  assert.equal(await response.text(), payload);
});

test("Deepgram deadline covers the raw response body and reports unknown outcome", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "depo-deadline-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "fixture.wav"); fs.writeFileSync(filePath, "disposable");
  const url = await endpoint(t, (req, res) => { req.resume(); res.writeHead(200); res.write('{"metadata":'); });
  await assert.rejects(transcribeWithDeepgram({ apiKey: "fixture", filePath, timeoutMs: 100,
    request: { url, keyterms: [] } }), error => error.code === "TIMEOUT");
});

test("startup readiness times out when a server accepts but never answers", async t => {
  const url = await endpoint(t, () => {});
  await assert.rejects(waitForReady(url, { attempts: 1, timeoutMs: 100, intervalMs: 0 }), /did not become ready/);
});

test("startup readiness succeeds without waiting for an unfinished response body", async t => {
  const url = await endpoint(t, (_req, res) => { res.writeHead(200); res.write("ready"); });
  assert.equal(await waitForReady(url, { attempts: 1, timeoutMs: 1000 }), true);
});
