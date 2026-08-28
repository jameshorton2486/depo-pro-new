import { appearancePhrase, captionParties } from "./assemble.mjs";
import { createInsertionPageSet } from "./page-model.mjs";
import { renderTemplatePage } from "./render-template.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../texas-freelance-deposition-profile.mjs";

const value = (field) => field && typeof field === "object" && "value" in field ? field.value : field;
const methodLabel = (method, detail) => !method || method === "in-person" ? "" : ` (Via ${detail || method})`;

// The joined strings are the printed form of the same two lists assemble put in fieldValues, so a
// caption line and the guard that clears it cannot disagree about who the parties are.
//
// COMPOSED, NOT VERBATIM -- a deliberate divergence from docket fidelity.
//
// Case styles carry irregular joins from the pleadings: "&", plain "and", slash boundaries, or no
// separator at all. Composing from the party array cannot reproduce them, so a petition reading
// "A & B" prints here as "A AND B". Preserving the docket exactly would mean the caption became
// reporter-typed free text, and then nothing would check that the text names the parties the record
// holds: a case style could omit a defendant while the appearance page still printed a block for
// them. The replacement guard would be fuzzy matching free text against party names on certified
// output, which is worse than the problem it solves.
//
// So the caption is provable rather than faithful, and the pluralisation guard, the blank guard and
// the rule above all keep their meaning. Note that the appearance page is unaffected either way --
// it reads captionParties directly, never this string.
//
// TRIGGER TO REOPEN: a real matter whose docket style the composed caption cannot express. Design
// the replacement guard first; this is not a field swap.
// Party names print in capitals. They are stored as the reporter typed them -- flattening O'Neill
// or DeLaGarza into the record would destroy a spelling nothing downstream can recover -- and
// capitalised here, where the page is what has to conform.
const upper = value => String(value).toUpperCase();

// The serial joiner for an appearance line: "A, AND B" for two, "A, B, AND C" for three or more.
//
// Specimen-derived. Both unambiguous two-party appearance lines use ", AND":
//
//   FOR THE DEFENDANTS, SK ELECTRIC, INC., AND CHUN YEAN:      Chun Yean
//   FOR THE DEFENDANTS, HMK MORTGAGE, LLC, AND HMK LTD.:       Filpi
//
// and Filpi's three plaintiffs read JULIAN CAMPOS, ROBERTO BARAHONA, AND MARTIN MORALES. Thomas's
// plain " AND " is not a counterexample: its heading and its caption label are both singular, so
// HOME DEPOT U.S.A., INC. A/K/A THE HOME DEPOT AND SHAWN HERBER is one party designation
// containing the word, not two parties joined.
//
// A rule keyed on internal commas was considered and is wrong: Filpi's caption joins
// HMK MORTGAGE, LLC -- which contains one -- with a plain AND.
function serialJoin(names) {
  if (!names.length) return "";
  if (names.length === 1) return upper(names[0]);
  return `${names.slice(0, -1).map(upper).join(", ")}, AND ${upper(names[names.length - 1])}`;
}

function captionValues(input) {
  const { plaintiffs, defendants } = captionParties(input.record);
  return {
    "caption.causeNumber": input.caption.causeNumber,
    "caption.court": input.operator.courtHeadingLine ?? input.caption.court,
    "caption.plaintiffLabel": plaintiffs.length === 1 ? "PLAINTIFF," : "PLAINTIFFS,",
    "caption.plaintiffs": upper(plaintiffs.join(", ")),
    "caption.defendantLabel": defendants.length === 1 ? "DEFENDANT," : "DEFENDANTS,",
    "caption.defendants": upper(defendants.join(", ")),
    "caption.countyCourtLine": input.operator.countyCourtLine ?? "",
    "caption.judicialDistrictLine": input.operator.judicialDistrictLine ?? "",
  };
}

// The phrase, or a refusal. validateInsertionInput already blocks a side nobody recorded, and both
// production callers throw on blocking findings before building -- but they are the only two, and a
// print site that renders `FOR null:` when a third one forgets is a certified page with a defect
// nobody would read as one. The guard costs a comparison and removes the whole class.
//
// It is separate from appearancePhrase rather than folded into it: the validator needs the null to
// detect the condition and report it as a finding. This is the print site refusing to be the place
// that discovers it.
function printedPhrase(attorney) {
  const phrase = appearancePhrase(attorney);
  if (!phrase) {
    throw new Error(`APPEARANCE_SIDE_MISSING: ${attorney.name || "a counsel record"} has no side recorded, so there is nothing to print after FOR.`);
  }
  return phrase;
}

// What follows the colon, and a deliberate divergence from the specimens.
//
// The certified transcripts carry THREE shapes for this line, all accepted by the courts that
// received them:
//
//   FOR THE PLAINTIFF, DEAVEN BABERS:        Chun Yean   -- designation inside the heading
//   FOR THE PLAINTIFF:   DELIA GARZA         Heath Thomas -- designation after the colon
//   FOR THE PLAINTIFFS:                      Goodwin     -- heading alone, no party named
//
// There is no single correct shape to derive, so this is a choice. The Thomas shape is used: it
// keeps the side and the parties as the two separate facts the record now holds separately, where
// putting the designation inside the heading would make the code compose a string it has no
// authority over. Do not "correct" this back toward Chun Yean.
//
// The caption and this line deliberately differ in how they join and case the same parties, and
// that is not inconsistency. Filpi's caption reads HMK MORTGAGE, LLC AND HMK LTD. while its own
// appearance page reads HMK MORTGAGE, LLC, AND HMK LTD. -- one document, one reporter. They answer
// to two authorities: the caption mirrors the court's docket as filed, and the appearance page
// follows transcription grammar. Do not unify them.
//
// captionParties is still read here, because WHO the parties are must never differ between the two
// blocks -- only how they are joined and capitalised does.
//
// A side with no parties recorded in that role prints the heading alone, which is the Goodwin shape.
function appearanceDesignation(attorney, input) {
  if (attorney.side !== "PLAINTIFF" && attorney.side !== "DEFENDANT") return "";
  const { plaintiffs, defendants } = captionParties(input.record);
  const parties = attorney.side === "PLAINTIFF" ? plaintiffs : defendants;
  return parties.length ? ` ${serialJoin(parties)}` : "";
}

function appearanceLines(input) {
  const lines = [];
  for (const attorney of input.appearances) {
    lines.push(`FOR ${printedPhrase(attorney)}:${appearanceDesignation(attorney, input)}`);
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

// A page number the index cannot prove is not printed.
//
// These were `?? 2` for Appearances and `?? ""` for Changes and Signature and the Reporter's
// Certificate. The standalone certification path supplies no pagination at all, so a document
// generated there printed "Appearances................ 2" -- a number nobody computed, indexed to
// nothing -- and a certificate line ending in blank space. Both looked like answers.
//
// There is no second paginator to fall back to and there must not be: complete-transcript
// pagination is the only authority that knows where these sections land. So the index refuses, and
// a document that cannot have an index does not get one -- see certificateOnly below.
function indexPage(value, section) {
  if (!Number.isInteger(value)) {
    throw new Error(`INDEX_PAGE_UNAVAILABLE: the index cannot state a page for ${section}; no authoritative pagination supplied one.`);
  }
  return value;
}

function indexLines(input) {
  const index = input.pagination.index ?? {};
  const lines = [`Appearances................................ ${indexPage(index.appearances?.startPage, "Appearances")}`, ""];
  lines.push(input.deposition.witness ?? "WITNESS");
  for (const exam of index.examinations ?? []) lines.push(`  Examination by ${exam.examiner}........... ${exam.startPage}-${exam.endPage}`);
  if (input.signatureDisposition === "requested") lines.push(`Changes and Signature...................... ${indexPage(index.changesAndSignature?.startPage, "Changes and Signature")}`);
  lines.push(`Reporter's Certificate..................... ${indexPage(index.reportersCertification?.startPage, "the Reporter's Certificate")}`);
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
    // The same phrase the appearance page prints. Two notions of what counsel represents in one
    // certified document -- one structured, one free text -- is a divergence reconciled wrongly later.
    "cert.counselLines": input.appearances.map((attorney) => `${attorney.name}, Attorney for ${printedPhrase(attorney)}`),
  };
}

function wrapAdministrativeLine(line, width) {
  const text = String(line.text ?? "");
  if (text.length <= width) return [{ ...line, text }];
  const indent = text.match(/^\s*/)?.[0] ?? "";
  const available = width - indent.length;
  if (available < 1) throw new Error("ADMINISTRATIVE_LINE_INDENT_EXCEEDS_PROFILE");
  // A rule made solely from template furniture terminates at the geometry boundary. It is not
  // prose and must not be compressed with Word fitText or consume a second transcript line.
  if (/^[_\-.]+$/.test(text.trim())) return [{ ...line, text: `${indent}${text.trim().slice(0, available)}` }];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const output = [];
  let current = indent;
  for (const word of words) {
    if (word.length > available) throw new Error(`ADMINISTRATIVE_TOKEN_OVERFLOW:${word}`);
    const candidate = current.trim() ? `${current} ${word}` : `${indent}${word}`;
    if (candidate.length <= width) current = candidate;
    else { output.push({ ...line, text: current }); current = `${indent}${word}`; }
  }
  if (current.trim() || !output.length) output.push({ ...line, text: current });
  return output;
}

function renderRolePages(template, values, { role, profile }) {
  const rendered = renderTemplatePage(template, values, { pageNumber: 1, role, linesPerPage: 0 });
  while (rendered.lines.length && !String(rendered.lines.at(-1)?.text ?? "").trim()) rendered.lines.pop();
  const wrapped = rendered.lines.flatMap((line) => wrapAdministrativeLine(line, profile.charactersPerLine));
  const pages = [];
  for (let offset = 0; offset < wrapped.length; offset += profile.linesPerPage) {
    const lines = wrapped.slice(offset, offset + profile.linesPerPage);
    while (lines.length < profile.linesPerPage) lines.push({ text: "", fields: [] });
    pages.push({ pageNumber: 0, role, lines: lines.map((line, index) => ({ line: index + 1, text: line.text, fields: [...(line.fields ?? [])] })) });
  }
  return pages.length ? pages : [{ pageNumber: 0, role, lines: Array.from({ length: profile.linesPerPage }, (_, index) => ({ line: index + 1, text: "", fields: [] })) }];
}

export function buildTexasInsertionPageSet(input, { setId, depositionId, generatedAt, certificateOnly = false }) {
  if (!input.variant?.startsWith("TEXAS_STATE_")) throw new Error(`Texas page builder cannot render ${input.variant ?? "an unspecified variant"}`);
  const templates = input.template.templates;
  const baseValues = {
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
  };
  // certificateOnly is the standalone certification path: a document with no transcript behind it,
  // and therefore no authoritative pagination. It carries NO INDEX, because an index states where
  // sections land and only complete-transcript pagination knows that. Omitting the page is the
  // honest form -- printing one with invented numbers was the defect.
  //
  // The index lines are built only when the index page is, so a certificate-only document never
  // asks for a number nobody can supply.
  const allRoles = input.signatureDisposition === "requested"
    ? ["title", "appearances", "index", "changes", "signature", "certification1", "certification2", "certification3"]
    : ["title", "appearances", "index", "certification1", "certification2"];
  const roles = certificateOnly ? allRoles.filter(role => role !== "index") : allRoles;
  const values = {
    ...baseValues,
    ...(roles.includes("index") ? { "index.lines": indexLines(input) } : {}),
  };
  const profile = input.layoutProfile?.id === TEXAS_FREELANCE_DEPOSITION_V1.id ? input.layoutProfile : TEXAS_FREELANCE_DEPOSITION_V1;
  const pages = roles.flatMap((role) => renderRolePages(templates[role], values, { role, profile }));
  pages.forEach((page, index) => { page.pageNumber = index + 1; });
  return createInsertionPageSet({
    setId, depositionId, variant: input.variant, generatedAt, pages,
    templateHashes: Object.fromEntries(roles.map((role) => [role, templates[role].sha256])),
    intentionalBlanks: [],
  }, { profile });
}
