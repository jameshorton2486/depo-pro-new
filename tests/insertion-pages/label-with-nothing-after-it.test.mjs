import assert from "node:assert/strict";
import test from "node:test";
import { renderTemplatePage } from "../../server/insertion-pages/render-template.mjs";

// A certification page was printing "Firm Registration No." with nothing after it for a reporter
// who has no firm registration. That states a requirement on a certified page and then fails to
// answer it, which is worse than not raising it: a reader cannot tell an omission from an oversight.
//
// The appearance page already followed this rule -- Nunez prints with no phone and no email at all,
// rather than with labels holding nothing. The certification pages come from templates rather than
// from code, and the rule had not reached them.
const page = (body, values) => renderTemplatePage({ body }, values, { pageNumber: 1, role: "test" })
  .lines.map((line) => line.text).filter((text) => text !== "");

test("a line whose every field is absent is omitted, not left as a bare label", () => {
  assert.deepEqual(page("Firm Registration No. ^reporter.firmRegistrationNumber^", {}), []);
  assert.deepEqual(page("^a^, CSR ^b^", {}), [], "a line of nothing but absent fields and punctuation goes too");
});

test("a line whose field is present still prints", () => {
  // The positive control. Suppressing the line when the number exists would hide a fact the
  // certificate is required to state.
  assert.deepEqual(
    page("Firm Registration No. ^reporter.firmRegistrationNumber^", { "reporter.firmRegistrationNumber": "7788" }),
    ["Firm Registration No. 7788"],
  );
});

test("a line with no fields at all always prints", () => {
  // Page furniture. The rule keys on fields being absent, not on a line looking empty.
  assert.deepEqual(page("CERTIFICATE OF REPORTER", {}), ["CERTIFICATE OF REPORTER"]);
});

test("a line with one field filled and one absent still prints", () => {
  // What is there is still true, so the line stays and only the absent field renders as nothing.
  assert.deepEqual(page("^a^ / ^b^", { a: "MIAH BARDOT" }), ["MIAH BARDOT / "]);
});

test("an empty string is a value, and a zero is a value", () => {
  // Only null and undefined are absent. A field the record deliberately holds as empty is not the
  // same as a field the record does not have, and this must not collapse the two.
  assert.deepEqual(page("Charges: ^cert.charges^", { "cert.charges": "" }), ["Charges: "]);
  assert.deepEqual(page("Pages: ^n^", { n: 0 }), ["Pages: 0"]);
});

test("the page is still padded to the body grid after a line is dropped", () => {
  const rendered = renderTemplatePage({ body: "A\nFirm Registration No. ^x^\nB" }, {}, { pageNumber: 1, role: "test" });
  assert.equal(rendered.lines.length, 25, "dropping a line must not shorten the 25-line body");
  assert.deepEqual(rendered.lines.slice(0, 2).map((line) => line.text), ["A", "B"]);
});
