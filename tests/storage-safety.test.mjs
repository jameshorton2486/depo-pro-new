import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ALLOW_SYNCED_ROOT, classifyStorageRoot, findRedirect, findSyncRoot, isUncPath, syncRootsFromEnvironment } from "../server/storage-safety.mjs";

const NEVER_EXISTS = () => false;
const NEVER_LINKED = () => ({ isSymbolicLink:() => false });

test("sync roots come from what the client publishes, not from folder names",()=>{
  const roots=syncRootsFromEnvironment({OneDrive:"C:\\Users\\pat\\OneDrive",OneDriveCommercial:"C:\\Users\\pat\\OneDrive - Firm"},{existsSync:NEVER_EXISTS});
  assert.deepEqual(roots.map(item=>item.client),["OneDrive","OneDrive for Business"]);
  assert.match(roots[0].source,/environment variable/);
});

test("Dropbox roots are read from its own info.json",()=>{
  const roots=syncRootsFromEnvironment({LOCALAPPDATA:"C:\\Users\\pat\\AppData\\Local"},{
    existsSync:()=>true,
    readFileSync:()=>JSON.stringify({personal:{path:"C:\\Users\\pat\\Dropbox"}}),
  });
  assert.equal(roots.length,1);
  assert.equal(roots[0].client,"Dropbox (personal)");
  assert.equal(roots[0].root,path.resolve("C:\\Users\\pat\\Dropbox"));
});

test("an unreadable Dropbox config is not treated as proof Dropbox is absent",()=>{
  const roots=syncRootsFromEnvironment({LOCALAPPDATA:"C:\\Users\\pat\\AppData\\Local"},{existsSync:()=>true,readFileSync:()=>"{ not json"});
  assert.deepEqual(roots,[]);
});

test("a folder merely named like a sync client is not flagged",()=>{
  // The mechanism check is the whole point: this path contains "OneDrive" but no client
  // reports it, so there is no sync engine touching it.
  const result=classifyStorageRoot("C:\\Projects\\OneDrive-migration-notes",{environment:{},syncRoots:[],existsSync:NEVER_EXISTS,lstatSync:NEVER_LINKED});
  assert.equal(result.synced,false);
  assert.deepEqual(result.warnings,[]);
});

test("a path inside a reported sync root is flagged with the client that reported it",()=>{
  const environment={OneDrive:"C:\\Users\\pat\\OneDrive"};
  const result=classifyStorageRoot("C:\\Users\\pat\\OneDrive\\Documents\\depos",{environment,existsSync:()=>true,lstatSync:NEVER_LINKED});
  assert.equal(result.synced,true);
  assert.equal(result.syncClient,"OneDrive");
  assert.equal(result.warnings[0].code,"SYNCED_STORAGE_ROOT");
  assert.match(result.warnings[0].message,/hold file handles/);
});

test("a sibling of the sync root is not inside it",()=>{
  // C:\...\OneDriveArchive starts with the same characters as C:\...\OneDrive but is a
  // different directory. Prefix matching must respect the separator.
  const environment={OneDrive:"C:\\Users\\pat\\OneDrive"};
  const result=classifyStorageRoot("C:\\Users\\pat\\OneDriveArchive\\depos",{environment,existsSync:()=>true,lstatSync:NEVER_LINKED});
  assert.equal(result.synced,false);
});

test("no username pattern decides anything",()=>{
  // The rejected design matched C:\Users\<name>\(projects|depos). Any local directory must
  // pass regardless of where it sits or what the user is called.
  for (const candidate of ["D:\\evidence\\depos","C:\\depo-storage","C:\\Users\\someone-else\\work\\depos"]) {
    const result=classifyStorageRoot(candidate,{environment:{},syncRoots:[],existsSync:()=>true,lstatSync:NEVER_LINKED});
    assert.deepEqual(result.warnings,[],`${candidate} must not warn`);
  }
});

test("a junction in the ancestry is reported, since it can redirect a local-looking path",()=>{
  const link=path.resolve("C:\\Users\\pat\\Documents");
  const result=classifyStorageRoot("C:\\Users\\pat\\Documents\\depos",{environment:{},syncRoots:[],existsSync:()=>true,lstatSync:candidate=>({isSymbolicLink:()=>path.resolve(candidate)===link})});
  assert.equal(result.redirectedVia,link);
  assert.equal(result.warnings[0].code,"REDIRECTED_STORAGE_ROOT");
});

test("UNC paths are remote by definition",()=>{
  assert.equal(isUncPath("\\\\server\\evidence"),true);
  assert.equal(isUncPath("C:\\evidence"),false);
  const result=classifyStorageRoot("\\\\server\\evidence\\depos",{environment:{},syncRoots:[],existsSync:()=>true,lstatSync:NEVER_LINKED});
  assert.equal(result.remote,true);
  assert.ok(result.warnings.some(item=>item.code==="REMOTE_STORAGE_ROOT"));
});

test("the override acknowledges warnings without hiding that it was used",()=>{
  const environment={OneDrive:"C:\\Users\\pat\\OneDrive",[ALLOW_SYNCED_ROOT]:"1"};
  const result=classifyStorageRoot("C:\\Users\\pat\\OneDrive\\depos",{environment,existsSync:()=>true,lstatSync:NEVER_LINKED});
  assert.deepEqual(result.warnings,[],"acknowledged warnings are not raised");
  assert.equal(result.acknowledged,true);
  assert.equal(result.suppressedWarnings[0].code,"SYNCED_STORAGE_ROOT","the finding is still reported, just not raised");
  assert.equal(result.synced,true,"the underlying fact is unchanged by acknowledging it");
});

test("the override does not claim an acknowledgement when there was nothing to acknowledge",()=>{
  const result=classifyStorageRoot("C:\\depos",{environment:{[ALLOW_SYNCED_ROOT]:"1"},syncRoots:[],existsSync:()=>true,lstatSync:NEVER_LINKED});
  assert.equal(result.acknowledged,false);
});

test("findSyncRoot matches the root itself, not only paths beneath it",()=>{
  const roots=[{client:"OneDrive",root:path.resolve("C:\\Users\\pat\\OneDrive"),source:"test"}];
  assert.ok(findSyncRoot("C:\\Users\\pat\\OneDrive",roots));
  assert.equal(findSyncRoot("C:\\Users\\pat",roots),null);
});

test("a missing ancestor does not break redirect detection",()=>{
  const result=findRedirect("C:\\does\\not\\exist\\depos",{lstatSync:()=>{throw Object.assign(new Error("ENOENT"),{code:"ENOENT"})}});
  assert.equal(result,null);
});
