const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_OPTIONS = { month: "short", day: "numeric", year: "numeric" };

export function formatDisplayDate(value, locale = "en-US") {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return new Intl.DateTimeFormat(locale, { ...DISPLAY_OPTIONS, timeZone: "UTC" }).format(date);
  }

  return new Intl.DateTimeFormat(locale, DISPLAY_OPTIONS).format(new Date(value));
}
