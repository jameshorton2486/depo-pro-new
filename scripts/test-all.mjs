import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
function discover(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?discover(path.join(directory,entry.name)):entry.name.endsWith(".test.mjs")?[path.normalize(path.join(directory,entry.name))]:[])}
const discovered=discover("tests").sort();
const files=process.env.DEPO_PRO_TEST_FILES?process.env.DEPO_PRO_TEST_FILES.split(path.delimiter).map(file=>path.normalize(file)).sort():discovered;
const included=new Set(files),omitted=discovered.filter(file=>!included.has(file));
if(omitted.length){console.error(`Test discovery omitted ${omitted.length} file(s): ${omitted.join(", ")}`);process.exit(2)}
if(!files.length){console.error("No test files found.");process.exit(2)}
const child=spawn(process.execPath,["--test",...files],{stdio:"inherit",windowsHide:true});
child.on("exit",code=>process.exit(code||0));child.on("error",error=>{console.error(error);process.exit(1)});
