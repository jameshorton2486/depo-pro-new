// Asking a model one question: which word does the examination begin at?
//
// WHY A MODEL AT ALL. Everything else this application corrects deterministically, on the rule that
// if Depo-Pro can prove a correction it does not ask the AI to decide it. The examination boundary
// resists that. What marks it is the reporter finishing the opening procedure and handing the
// proceeding to counsel, and there is no derivable signal for a handoff -- it is language. The
// alternatives were measured and each fails on a real deposition:
//
//   the attorney's appearance role    says WHO examines, never WHEN -- this is the defect itself
//   the first witness utterance       fails: witnesses answer audio checks before the appearances
//   the oath attestation              fails: a recorded deposition was sworn before this reporter
//                                     ever opened the file, and there is no attestation to make
//
// WHAT THE MODEL MAY RETURN. One anchor and one examiner. It does not label paragraphs, does not
// write the heading, does not choose the BY-line, and cannot put a word on the page -- the
// deterministic labeller does all of that from the boundary alone. Every field it returns is
// checked against the deposition's own record in examination-boundary-rules.mjs before it becomes
// a structural fact.
//
// WHAT IS DELIBERATELY NOT ASKED. Cross, redirect and recross boundaries. Those are handovers the
// reporter marks as they read, the control for it already exists, and the defect this pass exists
// to fix is the first examination -- where an attorney's appearance was being read as testimony.
// Proposing later boundaries is a larger question and is not attempted here.
//
// NO PHRASE LIST. The examples below are context for recognising a transition, not strings to match
// on. A reporter says "you may proceed", "go ahead", "the witness is yours", or nothing at all and
// simply stops talking; a matcher built from any one deposition's wording would fail on the next.

export const EXAMINATION_BOUNDARY_PROMPT_VERSION = "examination-boundary-v1.0.0";

export const EXAMINATION_BOUNDARY_SYSTEM = [
  "You identify where the examination of a witness begins in a deposition transcript.",
  "",
  "A deposition opens with procedure that is not examination: going on the record, counsel stating",
  "their appearances, agreements about how a remote deposition will run, stipulations, technical and",
  "administrative discussion, and the administering of the oath. None of that is testimony, and none",
  "of it becomes testimony because the attorney speaking is the one who later conducts the",
  "examination. Examination begins when counsel starts questioning the witness.",
  "",
  "Signals that the transition has happened, in the order they usually carry weight:",
  "- the reporter or officer hands the proceeding to counsel, in whatever words they use",
  "- the record marks the witness as sworn and turns to counsel",
  "- counsel addresses the witness directly and begins a sustained sequence of questions answered",
  "  by the witness",
  "",
  "These are descriptions of what a transition looks like, not phrases to match. Depositions differ,",
  "and a reporter may hand over with a single word or simply stop speaking.",
  "",
  "Answer only when the transcript supports an answer. If the opening runs straight into questioning",
  "with no discernible transition, or the excerpt does not reach the start of examination, return no",
  "proposal. A wrong boundary silently reclassifies testimony in a certified record; returning",
  "nothing leaves the reporter to mark it themselves, which is a much smaller harm.",
  "",
  "Anchor your answer to the id of the FIRST word of the FIRST question of the examination. Never",
  "the handoff, never the oath, never the swearing-in recital -- the first word counsel says to the",
  "witness as examination. Use only word ids present in the excerpt. Do not write any transcript",
  "text, heading, or label: you are locating a position, not composing a document.",
].join("\n");

export const examinationBoundaryTool = Object.freeze({
  name: "propose_examination_boundary",
  description: "Report where the examination begins, or that the excerpt does not establish it.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "False when the excerpt does not establish where examination begins." },
      atWordId: { type: "string", description: "Id of the first word of the first examination question." },
      examinerPersonId: { type: "string", description: "Participant id of the attorney conducting the examination." },
      reasoning: { type: "string", description: "One sentence: what in the transcript marks the transition." },
    },
    required: ["found"],
  },
});

/**
 * The excerpt the model reads: the opening of the deposition, with word ids it can anchor to.
 *
 * `utterances` are the projected paragraphs in order. Only the opening is sent -- the examination
 * begins there or the transcript is not a deposition -- which keeps the call to one request and
 * gives the model the whole procedural sequence in one piece rather than split across chunks.
 */
export function buildExaminationBoundaryPrompt({ utterances = [], participants = [], limit = 40 } = {}) {
  const roster = participants
    .filter(item => ["QUESTIONING_ATTORNEY", "DEFENDING_ATTORNEY"].includes(String(item?.defaultRole ?? "").toUpperCase()))
    .map(item => `  ${item.id}  ${item.label ?? item.id}  (${item.defaultRole})`);
  const lines = utterances.slice(0, limit).map(item =>
    `[${item.wordId}] ${item.speaker ?? "UNIDENTIFIED"}${item.role ? ` (${item.role})` : ""}: ${item.text ?? ""}`);
  return [
    "Counsel of record, by participant id:",
    roster.length ? roster.join("\n") : "  (none recorded)",
    "",
    "The opening of the deposition. Each paragraph is prefixed with the id of its first word:",
    "",
    lines.join("\n"),
    "",
    "Where does the examination begin?",
  ].join("\n");
}
