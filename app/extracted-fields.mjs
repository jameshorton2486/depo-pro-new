// Which canonical fields the extraction actually supplied.
//
// The canonical record used to stamp one source across every field: a Notice was filed, therefore
// all of them claimed the Notice. In a real record that made 25 of 51 Notice-attributed fields name
// the Notice for something it never produced -- a date the reporter typed, a time zone hardcoded in
// the setup screen, a deponent type that was only the first option in a select.
//
// This names the keys the extraction produced AND the reporter left alone. An edited value is the
// reporter's answer, not the document's, even where the document had one: the whole point of the
// review step is that the reporter can disagree with the extraction, and a record that keeps
// calling the result NOD_EXTRACTED erases that they did.
//
// Deliberately narrow. Only the fields the setup form is actually prefilled from appear here; the
// method-and-schedule block is absent because nothing reads `logistics` into the form yet, which is
// its own fix. A key missing from this list is attributed to the reporter, which is the truthful
// answer while nothing carries the extraction's value to the field.
import { logisticsFields } from "./intake-logistics.mjs";

const text = value => (typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim());
const same = (a, b) => text(a) !== "" && text(a).toLowerCase() === text(b).toLowerCase();

export function extractedFieldKeys(ufmData, read) {
  const data = ufmData && typeof ufmData === "object" ? ufmData : {};
  const caption = data.caption && typeof data.caption === "object" ? data.caption : {};
  const get = key => (typeof read === "function" ? read(key) : read?.get?.(key));

  const keys = [];
  // Field on the setup form -> the extraction value it was prefilled from.
  const scalars = [
    ["caseStyle", data.case_style, "caseStyle"],
    ["causeNumber", data.cause_number, "causeNumber"],
    ["witness", data.deponent, "witness"],
    ["court", caption.court, "canonicalCourt"],
    ["district", caption.district, "canonicalDistrict"],
    ["division", caption.division, "canonicalDivision"],
    ["county", caption.county, "canonicalCounty"],
  ];
  for (const [canonicalKey, extractedValue, formKey] of scalars) {
    if (same(extractedValue, get(formKey))) keys.push(canonicalKey);
  }

  // The method-and-schedule block, mapped from the extractor's own key names. Only the four the
  // extraction actually supplies appear; remote, videotaped and time_zone have no counterpart and
  // are never declared, so they stay MISSING however this form is filled in.
  const mapped = logisticsFields(data);
  const mappedPairs = [
    ["depositionDate", mapped.depositionDate, "depositionDate"],
    ["scheduledStart", mapped.scheduledStart, "canonicalScheduledStart"],
    ["location", mapped.location, "canonicalLocation"],
    ["remotePlatform", mapped.remotePlatform, "canonicalRemotePlatform"],
  ];
  for (const [canonicalKey, extractedValue, formKey] of mappedPairs) {
    if (same(extractedValue, get(formKey))) keys.push(canonicalKey);
  }

  // Lists the reporter does not edit on this screen, so supplying them is the whole claim.
  const parties = [...(Array.isArray(caption.plaintiff_block) ? caption.plaintiff_block : []),
    ...(Array.isArray(caption.defendant_block) ? caption.defendant_block : [])];
  if (parties.length) keys.push("parties");
  if (Array.isArray(data.speaker_map) && data.speaker_map.length) keys.push("attorneys");

  return keys;
}
