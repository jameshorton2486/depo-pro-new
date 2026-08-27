const FIELD = /\^([a-z][a-zA-Z0-9_.-]*)\^/g;

export function renderTemplatePage(template, values, { pageNumber, role, linesPerPage = 25 } = {}) {
  const output = [];
  for (const sourceLine of template.body.replace(/\r/g, "").split("\n")) {
    const fields = [...sourceLine.matchAll(FIELD)].map((match) => match[1]);
    if (fields.length === 1 && sourceLine.trim() === `^${fields[0]}^` && Array.isArray(values[fields[0]])) {
      for (const text of values[fields[0]]) output.push({ text: String(text), fields });
      continue;
    }
    // Omitted, not blanked -- the same rule the appearance page already follows, applied where the
    // line comes from a template rather than from code. A certification page was printing
    // "Firm Registration No." with nothing after it for a reporter who has no firm registration,
    // which states a requirement on a certified page and then fails to answer it. The specimens
    // carry no labels holding nothing.
    //
    // Only when every field on the line is absent. A line with no caret fields is page furniture
    // and always prints, and a line with some fields filled still prints, because what is there is
    // still true.
    if (fields.length && fields.every((field) => values[field] == null)) continue;
    const text = sourceLine.replace(FIELD, (_match, field) => values[field] == null ? "" : String(values[field]));
    output.push({ text, fields });
  }
  if (linesPerPage > 0) {
    while (output.length > linesPerPage && output.at(-1)?.text === "") output.pop();
    while (output.length < linesPerPage) output.push({ text: "", fields: [] });
  }
  return { pageNumber, role, lines: output.map((line, index) => ({ line: index + 1, ...line })) };
}
