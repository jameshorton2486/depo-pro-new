/** Court identifiers are case-insensitive in intake, but every rendered and stored form uses capitals. */
export const normalizeCauseNumber = (value) => String(value ?? "").trim().toLocaleUpperCase("en-US");
