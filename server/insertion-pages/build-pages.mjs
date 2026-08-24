import { createInsertionPageSet } from "./page-model.mjs";
import { renderTemplatePage } from "./render-template.mjs";

const value = (field) => field && typeof field === "object" && "value" in field ? field.value : field;
const methodLabel = (method, detail) => method === "in-person" ? "" : ` (Via ${detail || method})`;

function captionValues(input) {
  const parties = input.record.parties ?? [];
  const plaintiffs = parties.filter((party) => /plaintiff/i.test(value(party.role))).map((party) => value(party.captionDisplayName) || value(party.name));
  const defendants = parties.filter((party) => /defendant/i.test(value(party.role))).map((party) => value(party.captionDisplayName) || value(party.name));
  return {
    "caption.causeNumber": input.caption.causeNumber,
    "caption.court": input.operator.courtHeadingLine ?? input.caption.court,
    "caption.plaintiffLabel": plaintiffs.length === 1 ? "PLAINTIFF," : "PLAINTIFFS,",
    "caption.plaintiffs": plaintiffs.join(", "),
    "caption.defendantLabel": defendants.length === 1 ? "DEFENDANT," : "DEFENDANTS,",
    "caption.defendants": defendants.join(", "),
    "caption.countyCourtLine": input.operator.countyCourtLine ?? "",
    "caption.judicialDistrictLine": input.operator.judicialDistrictLine ?? "",
  };
}

function appearanceLines(input) {
  const lines = [];
  for (const attorney of input.appearances) {
    lines.push(`FOR ${Array.isArray(attorney.representing) ? attorney.representing.join(", ") : attorney.representing}:`);
    lines.push(`${attorney.name}${methodLabel(attorney.participation.method, attorney.participation.detail)}`);
    // Omitted, not blanked. The specimens carry no empty lines where a field is absent -- Nunez
    // prints with no phone and no email at all, rather than with labels holding nothing.
    if (attorney.firm) lines.push(attorney.firm);
    if (attorney.address) lines.push(attorney.address);
    if (attorney.phone) lines.push(`Phone: ${attorney.phone}`);
  }
  // ALSO PRESENT prints whether or not anyone was. All three certified specimens carry the block
  // and a videographer line; Thomas renders "THE VIDEOGRAPHER:  NONE". Suppressing the block when
  // empty would leave a reader unable to tell "no videographer" from "not recorded".
  const videographers = input.record.participants?.videographers ?? [];
  const others = input.record.participants?.otherAttendees ?? [];
  lines.push("ALSO PRESENT:");
  lines.push(`THE VIDEOGRAPHER:  ${videographers.map((person) => value(person.fullName) ?? value(person.name) ?? String(person)).join(", ") || "NONE"}`);
  lines.push(...others.map((person) => value(person.name) ?? String(person)));
  return lines;
}

function indexLines(input) {
  const index = input.pagination.index ?? {};
  const lines = [`Appearances................................ ${index.appearances?.startPage ?? 2}`, ""];
  lines.push(input.deposition.witness ?? "WITNESS");
  for (const exam of index.examinations ?? []) lines.push(`  Examination by ${exam.examiner}........... ${exam.startPage}-${exam.endPage}`);
  if (input.signatureDisposition === "requested") lines.push(`Changes and Signature...................... ${index.changesAndSignature?.startPage ?? ""}`);
  lines.push(`Reporter's Certificate..................... ${index.reportersCertification?.startPage ?? ""}`);
  if ((index.exhibits ?? []).length) {
    lines.push("", "EXHIBITS", "NO.  DESCRIPTION                            PAGE");
    for (const exhibit of index.exhibits) lines.push(`${exhibit.number}    ${exhibit.description}    ${exhibit.page}`);
  }
  return lines;
}

// Only the two composed lines. The nine scalar cert.* values used to be re-read from
// operator.certification here and spread over input.fieldValues, which meant the map the guard
// validated and the map the page rendered from could disagree -- and once assemble began reading
// them from the canonical record, they did: validateFields saw the reporter's answer and the page
// printed undefined, dropping the clause anyway. One source, read once, in assemble.
function certificationValues(input) {
  return {
    "cert.timeUsedLines": (input.timeUsed?.parties ?? []).map((party) => `${party.name} - ${String(Math.floor((party.minutes ?? 0) / 60)).padStart(2, "0")} HOURS:${String((party.minutes ?? 0) % 60).padStart(2, "0")} MINUTES`).join("; "),
    "cert.counselLines": input.appearances.map((attorney) => `${attorney.name}, Attorney for ${(attorney.representing ?? []).join(", ")}`),
  };
}

export function buildTexasInsertionPageSet(input, { setId, depositionId, generatedAt }) {
  if (!input.variant?.startsWith("TEXAS_STATE_")) throw new Error(`Texas page builder cannot render ${input.variant ?? "an unspecified variant"}`);
  const templates = input.template.templates;
  const values = {
    ...input.fieldValues,
    ...captionValues(input),
    ...certificationValues(input),
    "deposition.proceedingHeading": input.operator.proceedingHeading ?? "ORAL DEPOSITION OF",
    "deposition.narrative.1": input.operator.titleNarrative?.[0] ?? "",
    "deposition.narrative.2": input.operator.titleNarrative?.[1] ?? "",
    "deposition.narrative.3": input.operator.titleNarrative?.[2] ?? "",
    "deposition.narrative.4": input.operator.titleNarrative?.[3] ?? "",
    "deposition.narrative.5": input.operator.titleNarrative?.[4] ?? "",
    "deposition.narrative.6": input.operator.titleNarrative?.[5] ?? "",
    "deposition.narrative.7": input.operator.titleNarrative?.[6] ?? "",
    "deposition.narrative.8": input.operator.titleNarrative?.[7] ?? "",
    "deposition.narrative.9": input.operator.titleNarrative?.[8] ?? "",
    "appearances.lines": appearanceLines(input),
    "index.lines": indexLines(input),
  };
  const roles = input.signatureDisposition === "requested"
    ? ["title", "appearances", "index", "changes", "signature", "certification1", "certification2", "certification3"]
    : ["title", "appearances", "index", "certification1", "certification2"];
  const pages = roles.map((role, index) => renderTemplatePage(templates[role], values, { pageNumber: index + 1, role }));
  return createInsertionPageSet({
    setId, depositionId, variant: input.variant, generatedAt, pages,
    templateHashes: Object.fromEntries(roles.map((role) => [role, templates[role].sha256])),
    intentionalBlanks: [],
  }, { profile: input.layoutProfile });
}
