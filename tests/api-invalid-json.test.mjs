import assert from "node:assert/strict";
import test from "node:test";
import { server } from "../server/local-api.mjs";
import { allowedApiOrigins } from "../server/api-origins.mjs";

test("malformed and non-object JSON are client errors before any deposition write", async t => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/depositions`;
  for (const body of ["{", "null", "[]", '"string"', "42"]) {
    const response = await fetch(url, { method: "POST", headers: {
      Origin: [...allowedApiOrigins()][0], "content-type": "application/json",
    }, body });
    assert.equal(response.status, 400, body);
    assert.equal((await response.json()).code, "INVALID_JSON");
  }
  const oversized = await fetch(`http://127.0.0.1:${server.address().port}/api/audio/select`, {
    method: "POST", headers: { Origin: [...allowedApiOrigins()][0], "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(70 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "REQUEST_TOO_LARGE");
});
