// Importing the local API must not bind a port.
//
// This is the precondition for testing the assembly endpoints behaviourally instead of by
// readFileSync source pinning. Eight existing tests read server/local-api.mjs as text precisely
// because importing it used to start a listener; the assembly write path added in Checkpoint 2B
// is the last thing that should be verified by grepping for its own name.
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

// Read from the same source the module does, so the check cannot drift from what it would bind.
const port = Number(process.env.LOCAL_API_PORT) || 4317;

function portIsFree(candidate) {
  // Binding is the only honest probe. A connect() attempt would also succeed against something
  // else that happens to hold the port, which would report the wrong reason for the wrong thing.
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(candidate, "127.0.0.1");
  });
}

test("importing server/local-api.mjs does not bind a port", async () => {
  assert.equal(await portIsFree(port), true,
    `Port ${port} was already in use before the import, so this test could not tell a leaked listener from a running dev server. Stop the local API and re-run.`);

  const localApi = await import("../server/local-api.mjs");

  assert.equal(await portIsFree(port), true,
    `Importing server/local-api.mjs bound port ${port}. The listener must start only when the file is the process entry point.`);
  // The import has to be worth doing: a module that binds nothing but also exports nothing would
  // pass the assertion above while leaving the endpoints untestable.
  assert.equal(typeof localApi.server.listen, "function");
});
