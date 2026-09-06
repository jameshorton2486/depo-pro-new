import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";
import { createFixedPageDocxSpec } from "./final-document-docx.mjs";

const escapeText=value=>String(value??"").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)").replace(/[^\x20-\x7e]/g,"?");
const object=(number,body)=>`${number} 0 obj\n${body}\nendobj\n`;

export function renderFixedPagePdf(spec){
  const profile=spec.profile,pageWidth=profile.page.widthTwips/20,pageHeight=profile.page.heightTwips/20;
  const textX=profile.text.leftMarginTwips/20,lineHeight=profile.text.lineSpacingTwips/20;
  const box=profile.formatBox,boxX=box.leftInches*72,boxY=pageHeight-(box.topInches+box.heightInches)*72;
  const firstY=pageHeight-profile.text.topMarginTwips/20-profile.font.pointSize*.75;
  const characterWidth=profile.font.pointSize*.6;
  const fontObject=3,firstPageObject=4,pageRefs=spec.pages.map((_page,index)=>`${firstPageObject+index*2} 0 R`).join(" ");
  const objects=[object(1,`<< /Type /Catalog /Pages 2 0 R >>`),object(2,`<< /Type /Pages /Count ${spec.pages.length} /Kids [${pageRefs}] >>`),object(fontObject,"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")];
  for(const [index,page] of spec.pages.entries()){
    const pageObject=firstPageObject+index*2,contentObject=pageObject+1;
    const commands=["q",`${box.borderPoints} w`,`${boxX.toFixed(3)} ${boxY.toFixed(3)} ${(box.widthInches*72).toFixed(3)} ${(box.heightInches*72).toFixed(3)} re S`,`Q BT /F1 ${profile.font.pointSize} Tf`];
    const pageNumber=String(page.pageNumber??index+1),pageNumberX=pageWidth-box.rightClearanceInches*72-pageNumber.length*profile.font.pointSize*.6;
    commands.push(`1 0 0 1 ${pageNumberX.toFixed(3)} ${(pageHeight-27).toFixed(3)} Tm (${escapeText(pageNumber)}) Tj`);
    for(const line of page.lines){
      const y=firstY-(line.position-1)*lineHeight;
      const number=String(line.position),lineNumberX=boxX-4-number.length*characterWidth;
      commands.push(`1 0 0 1 ${lineNumberX.toFixed(3)} ${y.toFixed(3)} Tm (${number}) Tj`);
      if(line.text)commands.push(`1 0 0 1 ${textX.toFixed(3)} ${y.toFixed(3)} Tm (${escapeText(line.text)}) Tj`);
    }
    commands.push("ET");
    const stream=`${commands.join("\n")}\n`;
    objects.push(object(pageObject,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`));
    objects.push(object(contentObject,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`));
  }
  let pdf="%PDF-1.4\n%Depo-Pro fixed-page transcript\n",offsets=[0];
  for(const item of objects){offsets.push(Buffer.byteLength(pdf));pdf+=item}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,"0")} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,"ascii");
}

export function createTranscriptPdfArtifact(root,{depositionId,printModel,storageRoot,outputDirectory=null}={}){
  const directory=outputDirectory?path.resolve(outputDirectory):path.join(depositionDirectory(root,depositionId,{storageRoot}),"transcript");
  const complete=printModel?.recordType==="COMPLETE_TRANSCRIPT_DOCUMENT_MODEL",stem=complete?"complete-transcript":"professional-testimony";
  const spec=createFixedPageDocxSpec(printModel),bytes=renderFixedPagePdf(spec),outputPath=path.join(directory,`${stem}.pdf`);
  fs.mkdirSync(directory,{recursive:true});const temporary=`${outputPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,outputPath);
  return{outputPath,bytes:bytes.length,specSha256:spec.sha256,pages:spec.pages.length,searchable:true,profile:spec.profile.id};
}
