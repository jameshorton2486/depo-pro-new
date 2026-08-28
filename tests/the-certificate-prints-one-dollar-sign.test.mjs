// "That $$1,240.00 is the deposition officer's charges" reached a certified page.
//
// certification-2.tmpl writes the dollar sign itself -- "That $^cert.charges^ is..." -- so a
// reporter who types the natural thing into a field labelled "Deposition officer's charges" gets
// two. Found by reading the first complete transcript this application produced from a
// reporter-created deposition; no test in the suite looks at what a certified page says.
//
// Stripped at the print site, not at the write boundary. The record keeps what the reporter typed
// -- that is what REPORTER_ENTERED means -- and the page prints what its own sentence needs. The
// alternative, normalising on the way in, would make the stored value differ from the entry and
// leave the next print site to guess which convention it was holding.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { stripLeadingCurrency as strip } from "../server/insertion-pages/assemble.mjs";

const SOURCE = fs.readFileSync(new URL("../server/insertion-pages/assemble.mjs", import.meta.url), "utf8");
const TEMPLATE = fs.readFileSync(new URL("../templates/insertion-pages/TEXAS_STATE_SIGNATURE_WAIVED/certification-2.tmpl", import.meta.url), "utf8");


test("a typed dollar sign does not survive to the page that supplies its own", () => {
  assert.equal(strip("$1,240.00"), "1,240.00");
  assert.equal(strip("$ 900"), "900");
  assert.equal(strip("1,240.00"), "1,240.00", "a value without one is untouched");
});

test("only the first is taken, so a doubled entry is not silently made single", () => {
  // "$$5" becomes "$5", not "5". A reporter who typed two meant something this cannot guess at,
  // and a certified page must not invent the answer -- it prints what remains and is visibly odd.
  assert.equal(strip("$$5"), "$5");
});

test("an unrecorded amount stays unrecorded and keeps blocking", () => {
  assert.equal(strip(null), null);
  assert.equal(strip(undefined), undefined);
  // "" must not become a number-shaped nothing; UNEXPECTED_BLANK still has to see it.
  assert.equal(strip(""), "");
});

test("the print site strips, and the template still writes the sign", () => {
  assert.match(SOURCE, /"cert\.charges": stripLeadingCurrency\(/, "the charges token must be stripped where it is printed");
  assert.match(TEMPLATE, /That \$\^cert\.charges\^/, "the template owns the dollar sign; if it stops, the strip becomes wrong");
});
