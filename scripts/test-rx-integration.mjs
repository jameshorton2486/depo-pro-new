import { spawn } from "node:child_process";
if(!process.env.DEPO_PRO_RX_TEST_AUDIO){console.error("RUN_RX_INTEGRATION=1 but DEPO_PRO_RX_TEST_AUDIO is unset.");process.exit(2)}
const child=spawn(process.execPath,["--test","tests/rx-modules-installed.integration.test.mjs"],{stdio:"inherit",windowsHide:true,env:{...process.env,RUN_RX_INTEGRATION:"1"}});
child.on("exit",code=>process.exit(code||0)); child.on("error",error=>{console.error(error);process.exit(1)});
