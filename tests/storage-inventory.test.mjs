import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectStorage } from "../server/storage-inventory.mjs";

test("storage inventory reports duplicates and never authorizes cleanup", t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-inventory-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const storageRoot=path.join(root,"depositions"),audioRoot=path.join(root,"audio-intake");fs.mkdirSync(storageRoot,{recursive:true});
  for(const [id,bytes] of [["upload-a",100],["upload-b",100],["upload-c",50]]){const directory=path.join(audioRoot,id);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,"audio.bin"),Buffer.alloc(bytes));fs.writeFileSync(path.join(directory,"audit.json"),JSON.stringify({storage:{original:{sha256:id==="upload-c"?"other":"same",bytes}}}));}
  const result=inspectStorage(root,{storageRoot,audioRoot});
  assert.equal(result.audioAudits,3);assert.equal(result.uniqueOriginals,2);assert.equal(result.duplicateGroups,1);assert.equal(result.duplicateOriginalBytes,100);assert.equal(result.unlinkedAudioAudits,3);assert.equal(result.cleanupAllowed,false);
});
