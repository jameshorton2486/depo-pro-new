import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordLiveCaptureActualEnd, recordLiveCaptureActualStart, readDepositionCorrections } from "../server/deposition-store.mjs";

const ID="DEP-20260902-START";
const field=(value,source="REPORTER_ENTERED",state=value==null?"MISSING":"REPORTER_ADDED")=>({value,source,state,confidence:null,citations:[]});
function fixture(t,{mode="live"}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-start-")),storageRoot=path.join(root,"store"),folder=path.join(storageRoot,"reporter","cause","witness");
  fs.mkdirSync(path.join(folder,"intake"),{recursive:true});
  fs.writeFileSync(path.join(folder,"deposition.json"),JSON.stringify({id:ID,creationMode:mode,caseStyle:"A v. B",witness:"W"}));
  fs.writeFileSync(path.join(folder,"intake","canonical-deposition-record.json"),JSON.stringify({
    deposition:{actualStart:field(null,"TRANSCRIPT_DERIVED","MISSING"),actualEnd:field(null,"TRANSCRIPT_DERIVED","MISSING"),timeZone:field("America/Chicago")},
    reporter:{fullName:field("Riley Reporter")},case:{},counsel:[],participants:{interpreters:[],videographers:[],otherAttendees:[]},
  }));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return{root,storageRoot,folder};
}

test("the first live capture start automatically records Actual Start with system provenance",t=>{
  const s=fixture(t),result=recordLiveCaptureActualStart(s.root,{depositionId:ID,storageRoot:s.storageRoot,startedAt:"2026-09-02T14:31:42.000Z"});
  assert.equal(result.value,"09:31");
  const canonical=JSON.parse(fs.readFileSync(path.join(s.folder,"intake","canonical-deposition-record.json"),"utf8"));
  assert.deepEqual({value:canonical.deposition.actualStart.value,source:canonical.deposition.actualStart.source,state:canonical.deposition.actualStart.state},{value:"09:31",source:"SYSTEM_CAPTURED",state:"DERIVED"});
  const [entry]=readDepositionCorrections(s.root,ID,{storageRoot:s.storageRoot});
  assert.equal(entry.who,"DepoPro live capture service (automatic)");
  assert.equal(entry.valueSource,"SYSTEM_CAPTURED");
  assert.match(entry.why,/first local capture start event/);
});

test("a continuation cannot replace the first start",t=>{
  const s=fixture(t);
  recordLiveCaptureActualStart(s.root,{depositionId:ID,storageRoot:s.storageRoot,startedAt:"2026-09-02T14:31:00.000Z"});
  const second=recordLiveCaptureActualStart(s.root,{depositionId:ID,storageRoot:s.storageRoot,startedAt:"2026-09-02T15:45:00.000Z"});
  assert.equal(second.recorded,false);
  assert.equal(second.value,"09:31");
  assert.equal(readDepositionCorrections(s.root,ID,{storageRoot:s.storageRoot}).length,1);
});

test("the latest observed live stop records Actual End with system provenance",t=>{
  const s=fixture(t);
  recordLiveCaptureActualEnd(s.root,{depositionId:ID,storageRoot:s.storageRoot,endedAt:"2026-09-02T16:02:00.000Z"});
  const second=recordLiveCaptureActualEnd(s.root,{depositionId:ID,storageRoot:s.storageRoot,endedAt:"2026-09-02T16:45:00.000Z"});
  assert.equal(second.value,"11:45");
  const canonical=JSON.parse(fs.readFileSync(path.join(s.folder,"intake","canonical-deposition-record.json"),"utf8"));
  assert.deepEqual({value:canonical.deposition.actualEnd.value,source:canonical.deposition.actualEnd.source,state:canonical.deposition.actualEnd.state},{value:"11:45",source:"SYSTEM_CAPTURED",state:"DERIVED"});
});

test("the live capture start path invokes automatic Actual Start recording",()=>{
  const source=fs.readFileSync(path.join(process.cwd(),"server","live-capture.mjs"),"utf8");
  assert.match(source,/if\s*\(depositionId\)[\s\S]{0,80}?recordLiveCaptureActualStart\(/);
  assert.match(source,/startedAt:\s*wall/);
});

test("the opening UI offers manual time and source entry only for prerecorded workflows",()=>{
  const source=fs.readFileSync(path.join(process.cwd(),"app","OpeningProceduresScreen.tsx"),"utf8");
  assert.match(source,/projection\.creationMode\s*===\s*"existing_recording"/);
  assert.match(source,/type="time"/);
  assert.match(source,/Source \/ basis/);
});
