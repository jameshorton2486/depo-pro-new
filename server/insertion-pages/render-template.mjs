const FIELD = /\^([a-z][a-zA-Z0-9_.-]*)\^/g;

export function renderTemplatePage(template, values, { pageNumber, role, linesPerPage = 25 } = {}) {
  const output = [];
  for (const sourceLine of template.body.replace(/\r/g, "").split("\n")) {
    const fields = [...sourceLine.matchAll(FIELD)].map((match) => match[1]);
    if (fields.length === 1 && sourceLine.trim() === `^${fields[0]}^` && Array.isArray(values[fields[0]])) {
      for (const text of values[fields[0]]) output.push({ text: String(text), fields });
      continue;
    }
    // The same expansion where the line carries furniture as well as the field. The caption needs
    // it: a style of the cause too long for the left column has to run down several rows, and every
    // one of those rows still has to carry the ")" delimiter or the block loses its column.
    //
    // Any OTHER field on the line belongs to the first row alone. On a caption row that is the court
    // heading, which sits beside the first line of the party's name and not beside each wrapped
    // continuation of it -- exactly as the certified specimen prints it.
    const expanded = fields.find((field) => Array.isArray(values[field]));
    if (expanded) {
      const rows = values[expanded].length ? values[expanded] : [""];
      rows.forEach((item, index) => {
        output.push({
          text: sourceLine.replace(FIELD, (_match, field) => field === expanded
            ? String(item)
            : index === 0 && values[field] != null ? String(values[field]) : ""),
          fields,
        });
      });
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
