// Turns one controlled paragraph edit into the existing word-anchored reporter overlay.
// This module is pure so the evidence/provenance boundary can be characterized without a browser.

const visibleWords=paragraph=>(paragraph?.words??[]).filter(word=>!word.deleted);

export function wordCharacterRanges(paragraph){
  const source=String(paragraph?.text??"");
  const ranges=[];
  let cursor=0;
  for(const word of visibleWords(paragraph)){
    const value=String(word.display??word.text??"");
    const start=source.indexOf(value,cursor);
    if(start<0)throw new Error(`DIRECT_EDIT_TOKEN_NOT_FOUND: ${word.id}`);
    ranges.push({word,start,end:start+value.length,value});
    cursor=start+value.length;
  }
  return ranges;
}

export function paragraphEditTransaction(paragraph,nextValue){
  const before=String(paragraph?.text??""),after=String(nextValue??"");
  if(before===after)return[];
  if(!after.trim())throw new Error("DIRECT_EDIT_EMPTY_PARAGRAPH: Removing a complete paragraph is a structural edit and is not authorized in Phase 5.");
  let prefix=0;
  while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
  let suffix=0;
  while(suffix<before.length-prefix&&suffix<after.length-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
  const oldEnd=before.length-suffix,newEnd=after.length-suffix,ranges=wordCharacterRanges(paragraph);
  const touched=ranges.filter(range=>range.end>prefix&&range.start<oldEnd);
  if(!touched.length){
    const previous=[...ranges].reverse().find(range=>range.end<=prefix);
    const following=ranges.find(range=>range.start>=prefix);
    const text=after.slice(prefix,newEnd).trim();
    if(!text)throw new Error("DIRECT_EDIT_STRUCTURAL_WHITESPACE: Joining transcript tokens is a structural edit and is not authorized in Phase 5.");
    if(previous?.word.authored)return[{op:"replace",wordId:previous.word.id,text:`${previous.value} ${text}`}];
    if(following?.word.authored)return[{op:"replace",wordId:following.word.id,text:`${text} ${following.value}`}];
    if(previous)return[{op:"insert",afterWordId:previous.word.id,text}];
    if(following)return[{op:"insert",beforeWordId:following.word.id,text}];
    throw new Error("DIRECT_EDIT_ANCHOR_REQUIRED: The paragraph has no stable token anchor.");
  }
  const first=touched[0],last=touched.at(-1);
  const replacement=`${before.slice(first.start,prefix)}${after.slice(prefix,newEnd)}${before.slice(oldEnd,last.end)}`.trim();
  const operations=[];
  if(replacement)operations.push({op:"replace",wordId:first.word.id,text:replacement});
  else operations.push({op:"delete",wordId:first.word.id});
  for(const range of touched.slice(1))operations.push({op:"delete",wordId:range.word.id});
  return operations;
}
