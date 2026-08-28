// The API has to answer the tree that is actually serving the app.
//
// Each working tree serves on its own port so that a server left running in one cannot silently
// answer for another. The API is a second server on a fixed port, so every request from the screen
// is cross-origin -- and an origin's name includes the port. A literal 3000 in the allowlist made
// the per-tree ports worse than the problem they fixed: every tree except the default one loaded,
// looked normal, and then failed every request with "Origin not allowed", with nothing on screen
// saying why.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { allowedApiOrigins, localApiPort } from "../server/api-origins.mjs";

test("the allowed origins follow the port this tree serves on", () => {
  assert.deepEqual([...allowedApiOrigins({ PORT: "3005" })],
    ["http://localhost:3005", "http://127.0.0.1:3005"]);
  assert.deepEqual([...allowedApiOrigins({ PORT: "3001" })],
    ["http://localhost:3001", "http://127.0.0.1:3001"]);
});

test("a tree on its own port is not refused, and another tree's port is", () => {
  // The defect, stated as the reporter met it: the app on 3005 could not make a single request.
  const origins = allowedApiOrigins({ PORT: "3005" });
  assert.ok(origins.has("http://localhost:3005"), "the tree being served is allowed");
  assert.ok(origins.has("http://127.0.0.1:3005"), "both spellings: they are different origins to a browser");
  assert.equal(origins.has("http://localhost:3000"), false, "and a different tree is not");
});

test("no PORT means the app's own default, which is 3000", () => {
  // Absent is not the same as unreadable. Nobody asked for a port, so the app is where it always is.
  assert.deepEqual([...allowedApiOrigins({})], ["http://localhost:3000", "http://127.0.0.1:3000"]);
  assert.deepEqual([...allowedApiOrigins({ PORT: "" })], ["http://localhost:3000", "http://127.0.0.1:3000"]);
});

test("an unreadable PORT throws rather than quietly trusting 3000", () => {
  // Falling back would put a tree that asked for its own port back on the shared one -- the exact
  // failure the per-tree ports exist to prevent, done silently.
  for (const raw of ["abc", "99999", "0", "-1", "30 00"])
    assert.throws(() => allowedApiOrigins({ PORT: raw }), /not a port number/, `PORT=${raw}`);
});

test("the local API keeps 4317 by default and accepts an isolated override", () => {
  assert.equal(localApiPort({}), 4317);
  assert.equal(localApiPort({ LOCAL_API_PORT:"4331" }), 4331);
  assert.throws(() => localApiPort({ LOCAL_API_PORT:"wrong" }), /not a port number/);
});

test("the API asks for the allowlist rather than carrying one", () => {
  // Read as text: importing local-api.mjs starts a server. The literal being gone is the whole
  // point, so a future edit that puts it back fails here rather than in a browser on a Tuesday.
  const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  assert.match(source, /allowedApiOrigins\(\)/, "the allowlist is derived");
  assert.doesNotMatch(source, /new Set\(\[\s*"http:\/\/localhost:\d+"/, "and not written out");
});
