import fs from "node:fs";
import path from "node:path";
import { createTranscriptDocxArtifact } from "../server/final-document-docx.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../server/texas-freelance-deposition-profile.mjs";

const proofRoot=process.env.DEPO_PRO_GEOMETRY_PROOF_ROOT??"C:\\Users\\james\\Projects\\depo-pro-new\\geometry-proof";
const source=path.join(proofRoot,"output","geometry-proof","semantic-model-and-pagination.json"),fixture=JSON.parse(fs.readFileSync(source,"utf8"));
const pages=fixture.pages.map((lines,pageIndex)=>({id:`transcript-body-${pageIndex+1}`,pageNumber:pageIndex+1,lines:Array.from({length:25},(_,index)=>{const line=lines[index];return line?{position:index+1,occupied:true,content:line.text,paragraphId:line.paragraph_id,fragments:(line.token_ids??[]).map(id=>({id,sourceWordId:id}))}:{position:index+1,occupied:false,content:"",paragraphId:null,fragments:[]}})}));
const printModel={modelHash:fixture.semantic_hash,source:{reviewStateHash:fixture.semantic_hash,transcriptContentHash:fixture.semantic_hash},layoutProfile:TEXAS_FREELANCE_DEPOSITION_V1,pages};
const outputDirectory=path.join(proofRoot,"output","professional-testimony-workspace-v1");
const result=createTranscriptDocxArtifact(process.cwd(),{depositionId:"synthetic-profile-b-proof",printModel,outputDirectory});
console.log(JSON.stringify({...result,pages:pages.length,occupiedLines:pages.flatMap(page=>page.lines).filter(line=>line.occupied).length,fixture:source},null,2));
