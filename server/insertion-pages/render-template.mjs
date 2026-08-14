const FIELD = /\^([a-z][a-zA-Z0-9_.-]*)\^/g;

export function renderTemplatePage(template, values, { pageNumber, role, linesPerPage = 25 } = {}) {
  const output = [];
  for (const sourceLine of template.body.replace(/\r/g, "").split("\n")) {
    const fields = [...sourceLine.matchAll(FIELD)].map((match) => match[1]);
    if (fields.length === 1 && sourceLine.trim() === `^${fields[0]}^` && Array.isArray(values[fields[0]])) {
      for (const text of values[fields[0]]) output.push({ text: String(text), fields });
      continue;
    }
    const text = sourceLine.replace(FIELD, (_match, field) => values[field] == null ? "" : String(values[field]));
    output.push({ text, fields });
  }
  while (output.length > linesPerPage && output.at(-1)?.text === "") output.pop();
  while (output.length < linesPerPage) output.push({ text: "", fields: [] });
  return { pageNumber, role, lines: output.map((line, index) => ({ line: index + 1, ...line })) };
}
