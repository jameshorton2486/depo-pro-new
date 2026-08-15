// Detects whether an evidentiary storage root sits somewhere hostile to it.
//
// The hazard is real and specific: a sync engine takes file handles, performs partial
// writes, and reflows files underneath a running process. commitDirectory in
// deposition-store.mjs already carries a retry ladder for Windows EPERM/EBUSY on rename,
// and a sync client makes that path more likely, not less.
//
// Detection is by MECHANISM, never by path shape. An earlier version of this check tested
// for the substring "onedrive", and a proposed replacement matched
// C:\Users\<name>\(projects|depos) -- which would have reintroduced exactly the
// machine-shaped path literal that deriving the deposition root from the user profile was
// meant to remove. A username pattern is not a safety property.
//
// What this DOES detect:
//   - a path inside a sync client's own configured root, as reported by that client
//     (OneDrive environment variables, Dropbox's info.json)
//   - a junction or symbolic link anywhere in the ancestry, which is how a local-looking
//     directory gets redirected into a synced one
//   - a UNC path, which is remote by definition
//
// What it does NOT detect, stated so the gap is not mistaken for a guarantee:
//   - OneDrive cloud placeholders when the client is uninstalled and its environment
//     variables are gone. Node exposes no Windows file-attribute access, so
//     FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS is invisible from here.
//   - a mapped network drive letter, which needs a volume query this check deliberately
//     avoids so it stays free of subprocesses.

import fs from "node:fs";
import path from "node:path";

export const ALLOW_SYNCED_ROOT = "DEPO_PRO_ALLOW_SYNCED_ROOT";

// Each client is identified by something the client itself publishes -- an environment
// variable it sets, or a config file it writes -- not by a folder name we guess at.
export function syncRootsFromEnvironment(environment = process.env, { readFileSync = fs.readFileSync, existsSync = fs.existsSync } = {}) {
  const roots = [];
  for (const [variable, client] of [["OneDrive","OneDrive"],["OneDriveConsumer","OneDrive Personal"],["OneDriveCommercial","OneDrive for Business"],["iCloudDrive","iCloud Drive"]]) {
    const value = String(environment[variable] || "").trim();
    if (value) roots.push({ client, root:path.resolve(value), source:`${variable} environment variable` });
  }
  const dropboxInfo = environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, "Dropbox", "info.json") : null;
  if (dropboxInfo && existsSync(dropboxInfo)) {
    try {
      for (const [account, details] of Object.entries(JSON.parse(readFileSync(dropboxInfo, "utf8")))) {
        if (details?.path) roots.push({ client:`Dropbox (${account})`, root:path.resolve(details.path), source:"Dropbox info.json" });
      }
    } catch { /* an unreadable info.json means Dropbox cannot be confirmed, not that it is absent */ }
  }
  return roots;
}

function ancestors(target) {
  const resolved = path.resolve(target), found = [];
  let current = resolved;
  for (;;) {
    found.push(current);
    const parent = path.dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}

export function isUncPath(target) {
  return /^\\\\[^\\]/.test(String(target || ""));
}

// A junction or symlink anywhere above the target can redirect an ordinary-looking path
// into a synced or remote one. Missing ancestors are not an error here -- the root may not
// exist yet, which is a separate finding.
export function findRedirect(target, { lstatSync = fs.lstatSync } = {}) {
  for (const candidate of ancestors(target)) {
    try { if (lstatSync(candidate).isSymbolicLink()) return candidate; }
    catch { continue; }
  }
  return null;
}

export function findSyncRoot(target, syncRoots) {
  const resolved = path.resolve(target).toLowerCase();
  for (const entry of syncRoots) {
    const root = entry.root.toLowerCase();
    if (resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return entry;
  }
  return null;
}

/**
 * Classifies one storage root. Returns findings; it never throws and never blocks.
 *
 * Synced or remote storage is reported as a WARNING, not a failure. A hard failure here
 * would be set aside permanently within a week by anyone whose working copy legitimately
 * lives in such a place, which defeats the check entirely. DEPO_PRO_ALLOW_SYNCED_ROOT=1
 * acknowledges the warning deliberately, and the acknowledgement is itself reported so it
 * stays visible rather than becoming invisible configuration.
 */
export function classifyStorageRoot(target, { environment = process.env, syncRoots = syncRootsFromEnvironment(environment), existsSync = fs.existsSync, lstatSync = fs.lstatSync } = {}) {
  const resolved = path.resolve(target);
  const acknowledged = String(environment[ALLOW_SYNCED_ROOT] || "") === "1";
  const syncRoot = findSyncRoot(resolved, syncRoots);
  const redirect = findRedirect(resolved, { lstatSync });
  const unc = isUncPath(target);
  const warnings = [];
  if (syncRoot) warnings.push({ code:"SYNCED_STORAGE_ROOT", client:syncRoot.client, detectedVia:syncRoot.source, syncRoot:syncRoot.root, message:`${resolved} is inside the ${syncRoot.client} sync root. A sync engine can hold file handles and rewrite files underneath Depo-Pro while a deposition is being written.` });
  if (redirect) warnings.push({ code:"REDIRECTED_STORAGE_ROOT", link:redirect, message:`${redirect} is a junction or symbolic link, so this path may resolve somewhere other than it appears.` });
  if (unc) warnings.push({ code:"REMOTE_STORAGE_ROOT", message:`${target} is a UNC network path. Evidentiary audio and audit records should be written to local storage.` });
  return {
    path: resolved,
    exists: existsSync(resolved),
    synced: Boolean(syncRoot),
    syncClient: syncRoot?.client ?? null,
    redirectedVia: redirect,
    remote: unc,
    acknowledged: acknowledged && warnings.length > 0,
    warnings: acknowledged ? [] : warnings,
    suppressedWarnings: acknowledged ? warnings : [],
  };
}
