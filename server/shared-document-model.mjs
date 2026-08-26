// Pure final-document structure and pagination. It has no filesystem, UI, or export concerns.
// The transcript renderer remains authoritative for words, labels, and paragraph boundaries;
// this module retains those decisions while adding character/token placement.
export const SHARED_DOCUMENT_MODEL_VERSION="1.0.0";

const spaces=count=>" ".repeat(Math.max(0,count));

function hardWrap(token,width,findings,paragraphId,start){
  findings.push({code:"PRINT_UNBREAKABLE_TOKEN",severity:"warning",target:paragraphId,message:`A ${token.length}-character token exceeds the ${width}-character line area and was hard-wrapped.`});
  const pieces=[];
  for(let offset=0;offset<token.length;offset+=width)pieces.push({text:token.slice(offset,offset+width),start:start+offset,end:start+Math.min(offset+width,token.length)});
  return pieces;
}

// Returns source character ranges as well as line strings. Boundary whitespace is layout and is
// deliberately excluded, matching the existing Preview behavior.
export function wrapText(text,firstWidth,continuationWidth,findings=[],paragraphId=null){
  const source=String(text??"");
  let left=source.search(/\S/);if(left<0)return[{text:"",start:0,end:0}];
  let right=source.length;while(right>left&&/\s/.test(source[right-1]))right--;
  const output=[];let cursor=left,width=firstWidth;
  while(cursor<right){
    const remaining=source.slice(cursor,right);
    if(remaining.length<=width){output.push({text:remaining,start:cursor,end:right});break}
    let at=-1;
    for(let index=Math.min(width,remaining.length-1);index>=0;index--)if(/\s/.test(remaining[index])){at=index;break}
    if(at<0){
      const relativeEnd=remaining.search(/\s/),tokenEnd=relativeEnd<0?right:cursor+relativeEnd;
      const chunks=hardWrap(source.slice(cursor,tokenEnd),width,findings,paragraphId,cursor);
      output.push(chunks.shift());
      if(chunks.length){cursor=chunks[0].start}else{cursor=tokenEnd;while(cursor<right&&/\s/.test(source[cursor]))cursor++}
    }else{
      let end=cursor+at;while(end>cursor&&/\s/.test(source[end-1]))end--;
      output.push({text:source.slice(cursor,end),start:cursor,end});
      cursor=cursor+at;while(cursor<right&&/\s/.test(source[cursor]))cursor++;
    }
    width=continuationWidth;
  }
  return output.length?output:[{text:"",start:0,end:0}];
}

function tokenRuns(paragraph){
  const text=String(paragraph.text??"");
  const runs=[];let cursor=0;
  for(const token of (paragraph.words??[]).filter(word=>!word.deleted)){
    const value=String(token.display??token.text??"");
    const at=text.indexOf(value,cursor);
    if(at<0)continue;
    if(at>cursor)runs.push({id:`generated:${paragraph.id}:separator:${cursor}`,kind:"generated",role:"separator",text:text.slice(cursor,at),start:cursor,end:at});
    runs.push({id:token.tokenId??token.id,kind:token.tokenKind??(token.authored?"authored":"evidence"),role:"spoken-text",text:value,start:at,end:at+value.length,
      sourceWordId:token.sourceWordId??(token.authored?null:token.id),sourceJobIdentity:paragraph.sourceJobIdentity??null,audioStart:token.start??null,audioEnd:token.end??null,confidence:token.confidence??null});
    cursor=at+value.length;
  }
  if(cursor<text.length)runs.push({id:`generated:${paragraph.id}:separator:${cursor}`,kind:"generated",role:"separator",text:text.slice(cursor),start:cursor,end:text.length});
  return runs;
}

function fragmentsFor(piece,runs,prefix,paragraphId,lineIndex){
  const fragments=[];
  if(prefix)fragments.push({id:`generated:${paragraphId}:layout:${lineIndex}`,kind:"generated",role:"layout",text:prefix,sourceWordId:null});
  for(const run of runs){
    const start=Math.max(piece.start,run.start),end=Math.min(piece.end,run.end);
    if(end<=start)continue;
    fragments.push({...run,text:run.text.slice(start-run.start,end-run.start),sourceStart:start,sourceEnd:end});
  }
  return fragments;
}

export function paginateSharedDocument(document,{profile,findings=[]}={}){
  const lineWidth=profile.charactersPerLine;
  const paragraphs=document.sections.flatMap(section=>section.paragraphs??[]),content=[];
  for(const paragraph of paragraphs){
    const layout=paragraph.layout??{tokenCol:0,textCol:0,wrapCol:0,centered:false},runs=tokenRuns(paragraph);
    const trace={paragraphId:paragraph.id,sourceSegmentIds:[...(paragraph.segmentIds??[])],sourceWordIds:[...(paragraph.asrWordIds??[])],start:paragraph.start??null,end:paragraph.end??null};
    if(paragraph.byLine){const value=String(paragraph.byLine);content.push({content:value,paragraphId:paragraph.id,trace,kind:"by-line",fragments:[{id:`generated:${paragraph.id}:by-line`,kind:"generated",role:"by-line",text:value,sourceWordId:null}]})}
    const text=String(paragraph.text??"");
    if(layout.centered){
      for(const [index,piece] of wrapText(text,lineWidth,lineWidth,findings,paragraph.id).entries()){
        const prefix=spaces(Math.floor((lineWidth-piece.text.length)/2));
        content.push({content:`${prefix}${piece.text}`,paragraphId:paragraph.id,trace,kind:"paragraph",fragments:fragmentsFor(piece,runs,prefix,paragraph.id,index)});
      }
      continue;
    }
    const tokenCol=Number.isInteger(layout.tokenCol)?layout.tokenCol:null,textCol=Number.isInteger(layout.textCol)?layout.textCol:null,wrapCol=Number.isInteger(layout.wrapCol)?layout.wrapCol:0;
    let prefix="",firstTextCol=textCol??0;
    if(paragraph.label&&tokenCol!==null){prefix=`${spaces(tokenCol)}${paragraph.label}`;prefix+=textCol!==null?spaces(textCol-prefix.length):String(layout.inlineAfterLabel??"  ");firstTextCol=prefix.length}else if(textCol!==null)prefix=spaces(textCol);
    const pieces=wrapText(text,Math.max(1,lineWidth-firstTextCol),Math.max(1,lineWidth-wrapCol),findings,paragraph.id);
    pieces.forEach((piece,index)=>{const indentation=index===0?prefix:spaces(wrapCol);content.push({content:`${indentation}${piece.text}`,paragraphId:paragraph.id,trace,kind:"paragraph",fragments:fragmentsFor(piece,runs,indentation,paragraph.id,index)})});
  }
  for(const line of content)if(line.content.length>profile.charactersPerLine)findings.push({code:"PRINT_LINE_OVERFLOW",severity:"blocking",target:line.paragraphId,message:`A rendered line occupies ${line.content.length} characters; the profile permits ${profile.charactersPerLine}.`});
  const pages=[];
  for(let offset=0;offset<content.length||(!content.length&&offset===0);offset+=profile.linesPerPage){
    const occupied=content.slice(offset,offset+profile.linesPerPage);
    pages.push({id:`transcript-body-${pages.length+1}`,role:"transcript-body",pageNumber:pages.length+1,lines:Array.from({length:profile.linesPerPage},(_,index)=>occupied[index]?{position:index+1,occupied:true,...occupied[index]}:{position:index+1,occupied:false,content:"",paragraphId:null,trace:null,kind:"blank",fragments:[]})});
  }
  return pages;
}

export function buildSharedDocumentModel({rendered,paragraphs,profile}={}){
  if(!rendered?.paragraphs)throw new Error("SHARED_DOCUMENT_RENDERED_TRANSCRIPT_REQUIRED");
  const document={schemaVersion:SHARED_DOCUMENT_MODEL_VERSION,recordType:"SHARED_FINAL_DOCUMENT",source:{transcriptContentHash:rendered.transcriptContentHash??null,renderedContentHash:rendered.renderedContentHash??null},sections:[{id:"transcript-body",role:"transcript-body",paragraphs:paragraphs??rendered.paragraphs}]};
  const findings=[];
  return{...document,pages:paginateSharedDocument(document,{profile,findings}),findings};
}

// Boundary for future DOCX and Workspace consumers. It deliberately exposes the same sections,
// token-bearing paragraphs, and physical pages without teaching this foundation either consumer
// how to render them.
export function sharedDocumentConsumerView(document){
  if(document?.recordType!=="SHARED_FINAL_DOCUMENT"||!Array.isArray(document.sections)||!Array.isArray(document.pages))throw new Error("SHARED_DOCUMENT_REQUIRED");
  return{schemaVersion:document.schemaVersion,source:document.source,sections:document.sections,pages:document.pages};
}
