// Folding the reviewed setup form back into the master deposition data record.
//
// Every input on that form is seeded with the extraction's own value, so writing
// CONFIRMED/REPORTER on submit would claim the reporter attested every field they scrolled past --
// and would drop the sourceDocument and citation that make an extracted cell evidentiary at all.
// So the rule is a comparison, not an overwrite:
//
//   unchanged  -> leave the cell alone; the document keeps its attribution and its citation
//   changed    -> the reporter's answer: CONFIRMED / REPORTER, with no document cited for it
//   cleared    -> the question is unanswered again: MISSING, and nothing claims to have answered it
//
// The cleared case is the one that bites. It used to return early on an empty value, so selecting
// "Not stated" over an extracted "remote: true" left the master cell saying the Notice had answered
// yes while the canonical record said the question was open -- two persisted files disagreeing
// about the same fact.
//
// This lives in its own module, and not inside the page component, because it decides what a
// certified record says a document said. That belongs somewhere a test can reach it.
import { deponentTypeOption, parseNoticeDate } from "./intake-logistics.mjs";

const cellOf = (section, key) => (section[key] && typeof section[key] === "object" ? section[key] : {});

/** "" is not "no". A tri-state control that was never answered stays absent. */
export const triState = (data, key) => (data.get(key) === "true" ? true : data.get(key) === "false" ? false : undefined);

export function reviewedMasterData(seed, data) {
  const master = structuredClone(seed && typeof seed === "object" ? seed : {});
  const caseData = (master.case ??= {});
  const deposition = (master.deposition ??= {});

  const write = (section, key, formKey, { kind = "text", normalizeSeed = value => value } = {}) => {
    // A control absent from the form is skipped rather than read as empty, so removing a field from
    // the sheet can never silently erase what the document said about it.
    if (!data.has(formKey)) return;
    const raw = String(data.get(formKey) ?? "");
    const previous = cellOf(section, key);
    const value = raw === "" ? null : kind === "boolean" ? raw === "true" : raw;
    if (value === normalizeSeed(previous.value ?? null)) return;
    section[key] = value === null
      ? { ...previous, value:null, status:"MISSING", sourceType:null, sourceDocument:null, citation:null, confidence:null }
      : { ...previous, value, status:"CONFIRMED", sourceType:"REPORTER", sourceDocument:null, citation:null, confidence:null };
  };

  // The fields at the top of the form are as reviewable as the ones on the data sheet, and were
  // previously left out entirely -- a corrected cause number reached the deposition record but not
  // the master record, which went on citing the Notice for the value the reporter had replaced.
  write(caseData, "caseStyle", "caseStyle");
  write(caseData, "causeNumber", "causeNumber");
  write(deposition, "witness", "witness");
  write(deposition, "representativeCapacity", "deponentType", { normalizeSeed:value => deponentTypeOption(value) ?? null });
  // The date input normalizes "May 4, 2026" to 2026-05-04, so the seed has to be read the same way
  // the input's own default was, or an untouched date looks edited.
  write(deposition, "scheduledDate", "depositionDate", { normalizeSeed:value => (typeof value === "string" ? parseNoticeDate(value) ?? value : value) });

  write(caseData, "court", "canonicalCourt");
  write(caseData, "district", "canonicalDistrict");
  write(caseData, "division", "canonicalDivision");
  write(caseData, "county", "canonicalCounty");

  write(deposition, "scheduledStart", "canonicalScheduledStart");
  write(deposition, "timeZone", "canonicalTimeZone");
  write(deposition, "location", "canonicalLocation");
  write(deposition, "remotePlatform", "canonicalRemotePlatform");
  write(deposition, "remote", "canonicalRemote", { kind:"boolean" });
  write(deposition, "videotaped", "canonicalVideotaped", { kind:"boolean" });
  write(deposition, "interpreted", "canonicalInterpreted", { kind:"boolean" });
  write(deposition, "corporateRepresentative", "canonicalCorporateRepresentative", { kind:"boolean" });

  return master;
}
