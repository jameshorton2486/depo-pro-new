import fs from "node:fs";
import path from "node:path";

export const RX12_EXECUTABLE_NAME = "iZotope RX 12 Audio Editor.exe";
export const RX12_DEFAULT_EXECUTABLES = Object.freeze([
  "C:\\Program Files\\iZotope\\RX 12 Audio Editor\\win64\\iZotope RX 12 Audio Editor.exe",
]);

function validateExecutable(candidate, { statSync, realpathSync }) {
  if (!candidate) return { valid:false, reason:"No RX executable path was configured." };
  const value=String(candidate), semantics=/^[a-z]:[\\/]/i.test(value)?path.win32:path;
  const resolved = semantics.resolve(value);
  if (semantics.basename(resolved).toLowerCase() !== RX12_EXECUTABLE_NAME.toLowerCase()) {
    return { valid:false, reason:`RX path must identify ${RX12_EXECUTABLE_NAME}, not a directory or another RX version.` };
  }
  try {
    if (!statSync(resolved).isFile()) return { valid:false, reason:"The configured RX path is not a file." };
    return { valid:true, executable:realpathSync(resolved) };
  } catch {
    return { valid:false, reason:"The configured RX executable does not exist or cannot be read." };
  }
}

export function inspectRx({
  environment = process.env,
  candidates = RX12_DEFAULT_EXECUTABLES,
  statSync = fs.statSync,
  realpathSync = fs.realpathSync,
  includeExecutable = false,
} = {}) {
  const configured = String(environment.RX_EXECUTABLE_PATH || "").trim();
  const checks = configured ? [{ path:configured, method:"RX_EXECUTABLE_PATH" }] : candidates.map(candidate => ({ path:candidate, method:"standard-install-location" }));
  let invalidConfiguration = null;
  for (const check of checks) {
    const validation = validateExecutable(check.path, { statSync, realpathSync });
    if (validation.valid) {
      return {
        installed:true, available:true, status:"ready", product:"iZotope RX Audio Editor", version:"12", majorVersion:12,
        edition:environment.RX_EDITION || null, detectionMethod:check.method,
        ...(includeExecutable ? { executable:validation.executable } : {}),
        capabilities:{ detection:true, interactiveEditor:true, unattendedEditorProcessing:false },
        automationEnabled:false,
        fallback:"FFmpeg profiles remain available. Automated Depo-Pro RX rendering uses the separately validated RX 12 Voice De-noise VST3 boundary.",
        requiredValidation:[],
      };
    }
    if (configured) invalidConfiguration = validation.reason;
  }
  return {
    installed:false, available:false, status:invalidConfiguration ? "invalid-configuration" : "unavailable",
    product:"iZotope RX Audio Editor", version:null, majorVersion:null, edition:null,
    detectionMethod:configured ? "RX_EXECUTABLE_PATH" : "standard-install-location",
    ...(includeExecutable ? { executable:null } : {}),
    capabilities:{ detection:true, interactiveEditor:false, unattendedEditorProcessing:false }, automationEnabled:false,
    fallback:invalidConfiguration || "iZotope RX 12 Audio Editor was not found; FFmpeg profiles remain available.",
    requiredValidation:[],
  };
}

export const _testing = { validateExecutable };
