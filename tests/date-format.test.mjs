import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplayDate } from "../app/date-format.mjs";

test("date-only deposition values retain their stored calendar day", () => {
  assert.equal(formatDisplayDate("2026-08-12"), "Aug 12, 2026");
  assert.equal(formatDisplayDate("2026-04-24"), "Apr 24, 2026");
});

test("timestamp values retain instant-based local formatting", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    assert.equal(formatDisplayDate("2026-04-24T01:00:00.000Z"), "Apr 23, 2026");
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});
