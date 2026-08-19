import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReporter, importReporters, listReporters } from "../server/reporter-store.mjs";

function fixture(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-reporters-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root; }
const reporter=(id,name)=>({id,name,company:"Firm",email:"reporter@example.test",phone:"(555) 555-0100",licenseNumber:"CSR-1",taxId:"",address:"Texas"});

test("court reporters persist in the filesystem directory", t => {
  const root=fixture(t),created=createReporter(root,reporter("reporter-1","Zoe Reporter"));
  assert.equal(created.id,"reporter-1");
  assert.deepEqual(listReporters(root).map(item=>item.name),["Zoe Reporter"]);
});

test("legacy import merges by stable id without overwriting filesystem records", t => {
  const root=fixture(t);createReporter(root,reporter("reporter-1","Authoritative Name"));
  const result=importReporters(root,[reporter("reporter-1","Browser Name"),reporter("reporter-2","Added Name")]);
  assert.deepEqual(result.map(item=>item.name),["Added Name","Authoritative Name"]);
});

test("malformed reporter entries fail closed", t => {
  const root=fixture(t);
  assert.throws(()=>createReporter(root,{id:"bad/id",name:"Reporter"}),/ID is invalid/);
  assert.throws(()=>createReporter(root,{id:"reporter-1",name:""}),/name is required/);
});
