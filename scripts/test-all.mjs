import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const files=fs.readdirSync("tests").filter(name=>name.endsWith(".test.mjs")).sort().map(name=>path.join("tests",name));
if(!files.length){console.error("No test files found.");process.exit(2)}
const child=spawn(process.execPath,["--test",...files],{stdio:"inherit",windowsHide:true});
child.on("exit",code=>process.exit(code||0));child.on("error",error=>{console.error(error);process.exit(1)});
