import { UFM_FREELANCE_LAYOUT_PROFILE } from "./layout-profile.mjs";

function escapePdfText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7e]/g, "?");
}

function pdfObject(number, body) {
  return `${number} 0 obj\n${body}\nendobj\n`;
}

export function renderInsertionPdf(pageSet, { geometry, profile = UFM_FREELANCE_LAYOUT_PROFILE } = {}) {
  if (!geometry || !Number.isFinite(geometry.textLeft) || !Number.isFinite(geometry.lineNumberLeft) || !Number.isFinite(geometry.firstLineY) || !Number.isFinite(geometry.lineHeight)) {
    throw new Error("PDF_GEOMETRY_UNVERIFIED: explicit reviewed geometry is required; UFM margins and gutter width must not be guessed.");
  }
  const objects = [];
  const pageCount = pageSet.pages.length;
  const fontObject = 3;
  const firstPageObject = 4;
  const pageRefs = pageSet.pages.map((_page, index) => `${firstPageObject + index * 2} 0 R`).join(" ");
  objects.push(pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(pdfObject(2, `<< /Type /Pages /Count ${pageCount} /Kids [${pageRefs}] >>`));
  objects.push(pdfObject(fontObject, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"));
  for (const [index, page] of pageSet.pages.entries()) {
    const pageNumber = firstPageObject + index * 2;
    const contentNumber = pageNumber + 1;
    const commands = ["BT", `/F1 ${profile.font.pointSize} Tf`];
    for (const line of page.lines) {
      const y = geometry.firstLineY - (line.line - 1) * geometry.lineHeight;
      commands.push(`1 0 0 1 ${geometry.lineNumberLeft} ${y} Tm (${line.line}) Tj`);
      commands.push(`1 0 0 1 ${geometry.textLeft} ${y} Tm (${escapePdfText(line.text)}) Tj`);
    }
    commands.push("ET");
    const stream = `${commands.join("\n")}\n`;
    objects.push(pdfObject(pageNumber, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentNumber} 0 R >>`));
    objects.push(pdfObject(contentNumber, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`));
  }
  let pdf = "%PDF-1.4\n%Depo-Pro deterministic insertion pages\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(pdf)); pdf += object; }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
