// Which origins the local API answers, and why it is not a constant.
//
// The screen and the API are separate servers on the same machine, so every request the app makes
// is cross-origin and has to be allowed by name -- and an origin's name includes its port. That
// port is no longer fixed: each working tree serves on its own so that a server left running in one
// cannot answer for another, which is a mistake that has already cost a day of chasing.
//
// A literal 3000 here made that change worse than the problem it solved. Every tree except the
// default one loaded, looked normal, and then failed every single request with "Origin not
// allowed" -- a dead application with nothing on screen saying why. A silently wrong tree is at
// least usable; this was not.
//
// Both spellings are allowed because localhost and 127.0.0.1 are different origins to a browser,
// and either can be what is in the address bar.

/**
 * The origins the API trusts, derived from the port this working tree serves the app on.
 *
 * An unreadable PORT throws rather than falling back to 3000. Falling back would put a tree that
 * asked for its own port back on the shared one, which is the failure the per-tree ports exist to
 * prevent -- and it would do it silently. An absent PORT is not the same thing: it means nobody
 * asked, and the app's own default is 3000.
 */
export function allowedApiOrigins(environment = process.env) {
  const raw = environment.PORT;
  const port = raw === undefined || raw === "" ? 3000 : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`PORT is "${raw}", which is not a port number, so the local API cannot tell which origin to trust.`);
  return new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
}
