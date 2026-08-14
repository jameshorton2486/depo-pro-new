import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeposition, depositionDirectory, resolveDepositionAudio, scanDepositions, _testing } from "../server/deposition-store.mjs";

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-store-")),uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId);fs.mkdirSync(directory,{recursive:true});const bytes=Buffer.from("audited audio"),sha256=crypto.createHash("sha256").update(bytes).digest("hex");fs.writeFileSync(path.join(directory,"original.wav"),bytes);fs.writeFileSync(path.join(directory,"audit.json"),JSON.stringify({schemaVersion:"3.0.0",uploadId,originalName:"recording.wav",selectedSource:"original",selectedDerivativeOperationId:null,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,sha256,bytes:bytes.length,immutable:true},derivatives:[]},history:[]}));return{root,uploadId,bytes}}

test("deposition store uses reporter and UFM cause-number directories",t=>{const value=fixture(),storageRoot=path.join(value.root,"depos"),options={storageRoot};t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));const id="DEP-20260813-ABCDE",record=createDeposition(value.root,{deposition:{id,caseStyle:"Smith v. Jones",witness:"Alex Smith",depositionDate:"2026-08-13",courtReporterName:"Brenda Miah",ufmData:{cause_number:"2026-CV-00123"},audioIntakeIds:[value.uploadId],keyterms:["Smith"]},artifacts:{notice:{name:"notice.pdf",base64:Buffer.from("notice").toString("base64")}}},options);assert.equal(record.storagePath,"miah_b/2026-cv-00123");assert.equal(record.audio[0].sha256,crypto.createHash("sha256").update(value.bytes).digest("hex"));assert.ok(fs.existsSync(path.join(storageRoot,"miah_b","2026-cv-00123","deposition.json")));assert.deepEqual(scanDepositions(value.root,options).depositions.map(item=>item.id),[id]);assert.deepEqual(fs.readFileSync(resolveDepositionAudio(value.root,id,0,options).file),value.bytes)});

test("reporter folder supports natural and last-name-first names",()=>{assert.equal(_testing.reporterFolder("Brenda Miah"),"miah_b");assert.equal(_testing.reporterFolder("Miah, Brenda"),"miah_b");assert.equal(_testing.reporterFolder("Brenda Miah, Jr."),"miah_b")});

test("storage identity requires a reporter and UFM cause number",()=>{assert.throws(()=>_testing.reporterFolder(""),/Court reporter is required/);assert.throws(()=>_testing.causeFolder({ufmData:{}}),/UFM cause number is required/)});

test("Windows directory commit retries transient file locks",()=>{let calls=0,waits=0;_testing.commitDirectory("staging","final",{rename:()=>{calls++;if(calls<3)throw Object.assign(new Error("locked"),{code:"EPERM"})},wait:()=>{waits++},attempts:3});assert.equal(calls,3);assert.equal(waits,2)});

test("directory commit does not retry non-transient failures",()=>{let calls=0;assert.throws(()=>_testing.commitDirectory("staging","final",{rename:()=>{calls++;throw Object.assign(new Error("exists"),{code:"EEXIST"})},wait:()=>{},attempts:20}),/exists/);assert.equal(calls,1)});

test("exhausted Windows rename has a distinguishable error",()=>{const waits=[];assert.throws(()=>_testing.commitDirectory("staging","final",{rename:()=>{throw Object.assign(new Error("locked"),{code:"EBUSY"})},wait:value=>waits.push(value),attempts:3,delayBaseMs:10}),error=>error.code==="DEPOSITION_COMMIT_BLOCKED"&&/after 3 attempts/.test(error.message));assert.deepEqual(waits,[10,20])});

test("scanner reports orphaned and malformed deposition folders",t=>{const value=fixture(),storageRoot=path.join(value.root,"depos"),options={storageRoot};t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));fs.mkdirSync(path.join(storageRoot,"miah_b","cause_a"),{recursive:true});fs.mkdirSync(path.join(storageRoot,"miah_b","cause_b"),{recursive:true});fs.writeFileSync(path.join(storageRoot,"miah_b","cause_b","deposition.json"),"not json");const issues=scanDepositions(value.root,options).issues;assert.equal(issues.find(item=>item.folder.endsWith("cause_a")).code,"ORPHANED_FOLDER");assert.equal(issues.find(item=>item.folder.endsWith("cause_b")).code,"MALFORMED_DEPOSITION")});

test("invalid IDs and traversal are rejected before filesystem access",()=>{assert.throws(()=>depositionDirectory("C:/safe","../outside",{storageRoot:"C:/safe/depos"}),/Invalid deposition ID/);assert.throws(()=>depositionDirectory("C:/safe","DEP-20260813-AAAAA/../../x",{storageRoot:"C:/safe/depos"}),/Invalid deposition ID/)});
