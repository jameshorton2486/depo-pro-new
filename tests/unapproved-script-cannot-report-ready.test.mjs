import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OPENING_STEPS,
  getOpeningProjection,
  saveOpeningState,
} from "../server/opening-procedures.mjs";

// Ruling: an unapproved script cannot report ready.
//
// An oath is the record of how a witness was sworn, and a step that reports ready is a step a
// reporter relies on mid-proceeding. Before this, selecting "oath" or "affirmation" made the step
// ready on its own, so the screen could reach 7/7 while the words a witness would actually be sworn
// on still read "[WITNESS OATH OR AFFIRMATION -- APPROVED JURISDICTION-SPECIFIC TEXT REQUIRED]".
//
// The shape is the one the federal certification variants already use: available false,
// reviewStatus "source-required", present and named and unusable until someone supplies the text.
let counter = 0;
const nextId = () => `DEP-20260822-OA${String(++counter).padStart(3, "0")}`;

function scratch() {
  const depositionId = nextId();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-oath-"));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(folder, "intake"), { recursive: true });
  fs.writeFileSync(
    path.join(folder, "deposition.json"),
    JSON.stringify({ id: depositionId }),
  );
  fs.writeFileSync(
    path.join(folder, "intake", "canonical-deposition-record.json"),
    JSON.stringify({
      case: {
        caseStyle: {
          value: "A v. B",
          source: "NOD_EXTRACTED",
          state: "EXTRACTED",
        },
      },
      deposition: {
        witness: { value: "W", source: "NOD_EXTRACTED", state: "EXTRACTED" },
      },
      counsel: [
        {
          id: "c1",
          fullName: {
            value: "Ann Counsel",
            source: "NOD_EXTRACTED",
            state: "EXTRACTED",
          },
        },
      ],
    }),
  );
  return {
    depositionId,
    storageRoot,
    cleanup: () => fs.rmSync(storageRoot, { recursive: true, force: true }),
  };
}

const project = (s, state) => {
  if (state)
    saveOpeningState(null, {
      depositionId: s.depositionId,
      storageRoot: s.storageRoot,
      state,
    });
  return getOpeningProjection(null, {
    depositionId: s.depositionId,
    storageRoot: s.storageRoot,
  });
};
const script = (projection, id) =>
  projection.scripts.find((item) => item.id === id);

test("the approved governance supplies both witness and Texas interpreter oath text", () => {
  const s = scratch();
  const projection = project(s);
  const witness = script(projection, "witnessOath"),
    interpreter = script(projection, "interpreterOath");
  assert.equal(witness.available, true);
  assert.equal(witness.reviewStatus, "reviewed");
  assert.match(witness.expectedSource, /Texas Rule of Civil Procedure 199\.5/);
  assert.equal(interpreter.available, true);
  assert.equal(interpreter.reviewStatus, "reviewed");
  assert.match(interpreter.expectedSource, /Uniform Format Manual/);
  s.cleanup();
});

test("selecting an approved oath or affirmation makes the text-ready step ready", () => {
  // The ruling, stated directly. The selection is a choice about which text to use; it is not
  // evidence that the text exists.
  const s = scratch();
  for (const selection of ["OATH", "AFFIRMATION"]) {
    const projection = project(s, { witnessOathSelection: selection });
    assert.equal(
      projection.state.witnessOathSelection,
      selection,
      "the choice is still recorded",
    );
    assert.equal(
      projection.readiness.witnessOath,
      true,
      `${selection} selects approved governance text`,
    );
  }
  s.cleanup();
});

test("an interpreter oath that is required cannot be ready either", () => {
  const s = scratch();
  assert.equal(
    project(s, { interpreterDisposition: "REQUIRED" }).readiness
      .interpreterOath,
    false,
  );
  // Not applicable stays ready: there is no oath to administer, so there is no unapproved wording
  // to administer it with. That is an answer, not an omission.
  assert.equal(
    project(s, { interpreterDisposition: "NOT_APPLICABLE" }).readiness
      .interpreterOath,
    true,
  );
  s.cleanup();
});

test("a reviewed script is unaffected, so the rule is not just refusing everything", () => {
  // The positive control. instructions has approved wording and no tokens to fill, and it reports
  // ready exactly as it did before.
  const s = scratch();
  const projection = project(s);
  const item = script(projection, "instructions");
  assert.equal(item.available, true);
  assert.equal(item.reviewStatus, "reviewed");
  assert.equal(item.missing.length, 0);
  assert.equal(projection.readiness.instructions, true);
  s.cleanup();
});

test("the whole screen remains incomplete when other required facts are absent", () => {
  // What the ruling is actually protecting: the number the reporter reads mid-proceeding.
  const s = scratch();
  const projection = project(s, {
    witnessOathSelection: "OATH",
    interpreterDisposition: "NOT_APPLICABLE",
    examiningAttorneyId: "c1",
    verifiedFields: Object.fromEntries(
      [
        "case.caseStyle",
        "case.causeNumber",
        "case.court",
        "deposition.witness",
        "deposition.depositionDate",
        "deposition.actualStart",
        "deposition.location",
        "reporter.fullName",
      ].map((k) => [k, true]),
    ),
    verifiedParticipants: { c1: true },
  });
  assert.equal(projection.readiness.witnessOath, true);
  assert.ok(
    projection.completeCount < projection.totalCount,
    "every other step answered must still not produce a complete screen",
  );
  assert.equal(projection.totalCount, OPENING_STEPS.length);
});

test("pre-record readiness is enforced at the recording boundary", () => {
  // Unchanged by the ruling, and worth holding: a reporter who cannot start is worse off than one
  // who starts with a gap they can see. Nothing here gates recording.
  const s = scratch();
  const projection = project(s);
  assert.ok(
    Object.values(projection.readiness).some((value) => value === false),
  );
  assert.equal(projection.canStartRecording, false);
  assert.ok(projection.blockers.length > 0);
  s.cleanup();
});

test("an unreviewed script with nothing left to fill is still not ready", () => {
  // The case the rule actually exists for, and the one the real definitions cannot express.
  //
  // Both oath templates are bracket placeholders, so they read as having an unfilled token and are
  // refused on that ground alone -- which made the reviewStatus check indistinguishable from the
  // token check. A mutation removing it passed the whole suite. Supply an unreviewed script whose
  // wording is complete and the two come apart: nothing is missing, and it must still not be ready,
  // because the wording has not been approved.
  const s = scratch();
  // A selection is recorded first, so the only thing left deciding readiness is approval.
  saveOpeningState(null, {
    depositionId: s.depositionId,
    storageRoot: s.storageRoot,
    state: { witnessOathSelection: "OATH" },
  });
  const definitions = {
    witnessOath: {
      title: "Witness Oath / Affirmation",
      classification: "UNVERIFIED",
      available: false,
      reviewStatus: "source-required",
      expectedSource: "Approved wording.",
      whenToUse: "Before testimony.",
      template:
        "Do you swear the testimony you are about to give is the truth?",
    },
  };
  const projection = getOpeningProjection(null, {
    depositionId: s.depositionId,
    storageRoot: s.storageRoot,
    scriptDefinitions: definitions,
  });
  const item = projection.scripts.find((entry) => entry.id === "witnessOath");
  assert.equal(
    item.missing.length,
    0,
    "the fixture must have nothing left to fill, or it proves nothing",
  );
  assert.equal(
    projection.readiness.witnessOath,
    false,
    "unreviewed wording cannot be ready even when it is complete",
  );

  // And the same script, once reviewed, is ready -- so the refusal tracks approval and not something else.
  const reviewed = {
    witnessOath: {
      ...definitions.witnessOath,
      available: true,
      reviewStatus: "reviewed",
      expectedSource: null,
    },
  };
  const after = getOpeningProjection(null, {
    depositionId: s.depositionId,
    storageRoot: s.storageRoot,
    scriptDefinitions: reviewed,
  });
  assert.equal(after.readiness.witnessOath, true);
  s.cleanup();
});

test("a reviewed script with an unfilled token is not ready either", () => {
  // The third condition, isolated for the same reason as the second. No real readiness step
  // exercises it -- instructions has no tokens, and the oaths are refused on approval before the
  // tokens are ever consulted -- so dropping the token check passed the whole suite. Approved
  // wording with a hole in it is still not something to read onto the record.
  const s = scratch();
  saveOpeningState(null, {
    depositionId: s.depositionId,
    storageRoot: s.storageRoot,
    state: { witnessOathSelection: "OATH" },
  });
  const withHole = {
    witnessOath: {
      title: "Witness Oath",
      classification: "APPROVED_REPORTER_TEMPLATE",
      available: true,
      reviewStatus: "reviewed",
      expectedSource: null,
      whenToUse: "Before testimony.",
      template:
        "We are on the record at [ACTUAL TIME]. Do you swear to tell the truth?",
    },
  };
  const projection = getOpeningProjection(null, {
    depositionId: s.depositionId,
    storageRoot: s.storageRoot,
    scriptDefinitions: withHole,
  });
  const item = projection.scripts.find((entry) => entry.id === "witnessOath");
  assert.deepEqual(
    item.missing,
    ["ACTUAL TIME"],
    "the fixture must actually have a hole, or it proves nothing",
  );
  assert.equal(
    item.reviewStatus,
    "reviewed",
    "and it must be approved, so approval is not what refuses it",
  );
  assert.equal(projection.readiness.witnessOath, false);
  s.cleanup();
});
