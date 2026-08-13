import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeposition, depositionDirectory, resolveDepositionAudio, scanDepositions } from "../server/deposition-store.mjs";

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-store-")),uploadId=crypto.randomUUID(),directory=path.join(root,"data","audio-intake",uploadId);fs.mkdirSync(directory,{recursive:true});const bytes=Buffer.from("audited audio"),sha256=crypto.createHash("sha256").update(bytes).digest("hex");fs.writeFileSync(path.join(directory,"original.wav"),bytes);fs.writeFileSync(path.join(directory,"audit.json"),JSON.stringify({schemaVersion:"3.0.0",uploadId,originalName:"recording.wav",selectedSource:"original",selectedDerivativeOperationId:null,storage:{original:{key:`audio-intake/${uploadId}/original.wav`,sha256,bytes:bytes.length,immutable:true},derivatives:[]},history:[]}));return{root,uploadId,bytes}}

test("deposition store survives a fresh scan and copies audited audio",t=>{const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));const id="DEP-20260813-ABCDE",record=createDeposition(value.root,{deposition:{id,caseStyle:"Smith v. Jones",witness:"Alex Smith",depositionDate:"2026-08-13",audioIntakeIds:[value.uploadId],keyterms:["Smith"]},artifacts:{notice:{name:"notice.pdf",base64:Buffer.from("notice").toString("base64")}}});assert.equal(record.audio[0].sha256,crypto.createHash("sha256").update(value.bytes).digest("hex"));assert.deepEqual(scanDepositions(value.root).depositions.map(item=>item.id),[id]);assert.deepEqual(fs.readFileSync(resolveDepositionAudio(value.root,id,0).file),value.bytes)});

test("scanner reports orphaned and malformed deposition folders",t=>{const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));const root=path.join(value.root,"data","depositions");fs.mkdirSync(path.join(root,"DEP-20260813-AAAAA"),{recursive:true});fs.mkdirSync(path.join(root,"DEP-20260813-BBBBB"),{recursive:true});fs.writeFileSync(path.join(root,"DEP-20260813-BBBBB","deposition.json"),"not json");const issues=scanDepositions(value.root).issues;assert.equal(issues.find(item=>item.folder.endsWith("AAAAA")).code,"ORPHANED_FOLDER");assert.equal(issues.find(item=>item.folder.endsWith("BBBBB")).code,"MALFORMED_DEPOSITION")});

test("invalid IDs and traversal are rejected before filesystem access",()=>{assert.throws(()=>depositionDirectory("C:/safe","../outside"),/Invalid deposition ID/);assert.throws(()=>depositionDirectory("C:/safe","DEP-20260813-AAAAA/../../x"),/Invalid deposition ID/)});
