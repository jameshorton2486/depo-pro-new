// Page numbers on the index are the paginator's to state, not the caller's to supply.
//
// `completePagination` had two branches. Given an examiner it derived the examination range from
// the testimony bounds and was right. Given an `examinations` array it took `startPage` and
// `endPage` verbatim, offset only by front-matter depth, and nothing compared them to anything.
//
// On a 221-page transcript that printed:
//
//     Examination by Michael Alvarez........... 4-5
//
// where testimony ran 4-216. Every other line of that index was derived and correct. This one was
// whatever it had been handed, on a certified page, with no validation between the number and the
// paper.
//
// It was latent -- no production code supplied that array, so the derived branch is what shipped --
// and the source comment already asserted the right rule, "The reporter never enters page ranges".
// The code just did not enforce it. The reporter's authority is examination *structure*: who
// examined, and in what order. Never the page a thing lands on.
import assert from "node:assert/strict";
import test from "node:test";
import { completePagination } from "../server/complete-transcript-model.mjs";

// Front matter is three pages, so a 213-page body occupies 4..216.
const BODY = 213, FIRST = 4, LAST = 216;
const paginate = examinations => completePagination({
  testimonyPages: BODY, signatureDisposition: "requested",
  ...(examinations ? { examinations } : { examiner: "Michael Alvarez" }),
});

test("the examination range is derived from the testimony the paginator placed", () => {
  const [examination] = paginate(null).index.examinations;
  assert.equal(examination.startPage, FIRST);
  assert.equal(examination.endPage, LAST);
});

test("an examination carrying its own page numbers is refused, not believed", () => {
  // The characterized defect: this used to return { startPage:4, endPage:5 } and print it.
  assert.throws(
    () => paginate([{ examiner: "Michael Alvarez", startPage: 4, endPage: 5 }]),
    /EXAMINATION_PAGES_NOT_ACCEPTED/,
    "a supplied page range reached the index unchecked",
  );
  // Either half alone is the same mistake.
  assert.throws(() => paginate([{ examiner: "Michael Alvarez", startPage: 4 }]), /EXAMINATION_PAGES_NOT_ACCEPTED/);
  assert.throws(() => paginate([{ examiner: "Michael Alvarez", endPage: 5 }]), /EXAMINATION_PAGES_NOT_ACCEPTED/);
});

test("an examination that names only its examiner is placed by the paginator", () => {
  const [examination] = paginate([{ examiner: "Michael Alvarez" }]).index.examinations;
  assert.equal(examination.examiner, "Michael Alvarez", "who examined is the caller's to say");
  assert.equal(examination.startPage, FIRST, "where it falls is not");
  assert.equal(examination.endPage, LAST);
});

test("more than one examination is refused, because nothing here can place the boundary", () => {
  // Where one examiner stops and the next begins is in the transcript -- BY-lines and examination
  // headings -- not in the page count. Deriving a split from testimony bounds would be inventing
  // one. Refusing says so; guessing would put a fabricated boundary on a certified index.
  assert.throws(
    () => paginate([{ examiner: "Michael Alvarez" }, { examiner: "Grace Whitfield" }]),
    /MULTIPLE_EXAMINATIONS_UNPLACEABLE/,
  );
});

// The assertion the qualification harness cannot make, and the reason §122 matters: an index is
// only correct if it follows the transcript. A body one page longer must move every citation after
// it, and nothing in the suite has ever checked that.
test("one more page of testimony moves every citation after it by exactly one", () => {
  const before = completePagination({ testimonyPages: BODY, signatureDisposition: "requested", examiner: "A" }).index;
  const after = completePagination({ testimonyPages: BODY + 1, signatureDisposition: "requested", examiner: "A" }).index;

  assert.equal(after.examinations[0].startPage, before.examinations[0].startPage, "testimony still begins after the same front matter");
  assert.equal(after.examinations[0].endPage, before.examinations[0].endPage + 1, "the examination absorbed the extra page");
  assert.equal(after.changesAndSignature.startPage, before.changesAndSignature.startPage + 1);
  assert.equal(after.changesAndSignature.endPage, before.changesAndSignature.endPage + 1);
  assert.equal(after.reportersCertification.startPage, before.reportersCertification.startPage + 1);
  assert.equal(after.reportersCertification.endPage, before.reportersCertification.endPage + 1);
});

test("front matter that grows also moves what follows it", () => {
  const three = completePagination({ testimonyPages: BODY, signatureDisposition: "requested", examiner: "A", frontPages: 3 }).index;
  const four = completePagination({ testimonyPages: BODY, signatureDisposition: "requested", examiner: "A", frontPages: 4 }).index;
  assert.equal(four.examinations[0].startPage, three.examinations[0].startPage + 1, "testimony starts one page later");
  assert.equal(four.examinations[0].endPage, three.examinations[0].endPage + 1);
  assert.equal(four.reportersCertification.startPage, three.reportersCertification.startPage + 1);
});
