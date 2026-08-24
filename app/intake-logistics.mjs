// The extraction's logistics block, mapped to the fields the setup form actually reads.
//
// These two key sets overlapped on exactly one name -- `location` -- and even there the extractor
// emits an object while the form expects a string, so `text()` blanked it. The form read
// `scheduled_start`, `platform`, `remote`, `videotaped`, `time_zone`; the extractor writes
// `start_time`, `remote_platform`, `recording_method`. Six of seven form keys had no counterpart at
// all, so a Notice that stated the date, the time, the address and the platform produced a setup
// screen with every one of them blank, and a record that then called them extracted.
//
// What is deliberately NOT mapped, because no extractor key supplies it:
//
//   remote        `remote_platform: "Zoom"` implies it. Implication is not extraction, and a
//                 record must name the thing that actually supplied a value. Stays MISSING, which
//                 leaves DEPOSITION_METHOD_MISSING blocking the certified render -- the honest
//                 state: the Notice was read and did not answer the question in a form we asked.
//   videotaped    `recording_method: "stenographic and audiovisual"` implies it by parsing English.
//                 Same line. Stays MISSING.
//   time_zone     The zone is buried in the same prose as the time ("9:30 a.m. Central Time").
//                 Lifting it out as a side effect of the time parse would be that inference again,
//                 so it is not taken. Stays MISSING, stated rather than omitted.
//   corporateRepresentative  Never had a prefill from anything, and still does not.
//
// The eventual fix for the first two is the extraction schema emitting a `remote` boolean instead
// of leaving it to be read out of prose. That is a change to what we ask for, and a separate
// decision -- noted here so the next reader finds the reasoning rather than the gap.

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const clean = value => (typeof value === "string" ? value.trim() : "");

/**
 * "1201 Navarro Street, Suite 400" + "San Antonio" + "Texas" + "78205"
 *   -> "1201 Navarro Street, Suite 400, San Antonio, Texas 78205"
 *
 * Only the components the extractor supplied are joined, so an absent one never leaves a stray
 * separator behind. State and ZIP share a space rather than a comma, which is how the address is
 * written. Every component absent means there is no address, and that is MISSING -- not an empty
 * string, which would read as an answer.
 */
export function flattenLocation(location) {
  if (typeof location === "string") return clean(location) || undefined;
  if (!location || typeof location !== "object") return undefined;
  const region = [clean(location.state), clean(location.zip)].filter(Boolean).join(" ");
  const parts = [clean(location.street), clean(location.city), region].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/**
 * "9:30 a.m. Central Time" -> "09:30", for an <input type="time">.
 *
 * The zone is discarded rather than harvested; see the note above. Anything this cannot read
 * confidently returns undefined, so the field stays unanswered rather than becoming a guess.
 */
export function parseClockTime(value) {
  const text = clean(value);
  if (!text) return undefined;
  const match = /(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i.exec(text);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return undefined;
  const meridiem = (match[3] || "").toLowerCase().replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour > 23) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * "September 18, 2026" -> "2026-09-18", for an <input type="date">.
 *
 * This is the one that left a required field blank while the extractor had the answer sitting in
 * intake.json. Anything unreadable returns undefined: no partial-year fallback, no defaulting to
 * the filing date, no Date() coercion that would turn a typo into a confident wrong day.
 */
export function parseNoticeDate(value) {
  const text = clean(value);
  if (!text) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const named = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (!month) return undefined;
    return valid(Number(named[3]), month, Number(named[2]));
  }
  return undefined;
}

function valid(year, month, day) {
  if (!(year >= 1900 && year <= 2200) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return undefined;
  const stamp = new Date(Date.UTC(year, month - 1, day));
  if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The mapped fields, with `undefined` for anything the extraction did not supply. Nothing here
 * substitutes a default: an absent key stays absent all the way to the envelope, which records it
 * as MISSING.
 */
export function logisticsFields(ufmData) {
  const data = ufmData && typeof ufmData === "object" ? ufmData : {};
  const logistics = data.logistics && typeof data.logistics === "object" ? data.logistics : {};
  return {
    depositionDate: parseNoticeDate(logistics.deposition_date ?? data.deposition_date),
    scheduledStart: parseClockTime(logistics.start_time),
    location: flattenLocation(logistics.location),
    remotePlatform: clean(logistics.remote_platform) || undefined,
  };
}

// The five deponent types the setup screen offers.
//
// The extraction schema asks for `setup.deponentType` as a free-form string with no enum, so what
// comes back may be anything -- and for the Notice this was measured on it came back empty, with
// the only mention of "expert" sitting in a speaker_map note as prose. Reading a deponent type out
// of that note is the same inference line as reading `remote` out of "via Zoom".
//
// So: prefill only on an exact match to an option. Anything else leaves the control unselected,
// which the setup form submits as "" and the envelope records as MISSING. The screen previously
// showed "Fact witness" for this Notice -- not because anything said so, but because
// IntakeScreen defaulted `analysis.deponentType || "Fact witness"` and the select defaulted again
// on top of it. A default is not an answer.
export const DEPONENT_TYPES = Object.freeze([
  "Fact witness", "Expert witness", "Corporate representative", "Party", "Other",
]);

export function deponentTypeOption(value) {
  const text = clean(value);
  if (!text) return undefined;
  return DEPONENT_TYPES.find(option => option.toLowerCase() === text.toLowerCase());
}
