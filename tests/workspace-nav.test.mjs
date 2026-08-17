import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const NAV = fs.readFileSync(path.join(APP, "WorkspaceNav.tsx"), "utf8");
const PAGE = fs.readFileSync(path.join(APP, "page.tsx"), "utf8");

// The nav's `needsDeposition` is a per-entry flag maintained by hand. `hasDeposition` derives
// from `active` at runtime and cannot drift, but the flag can -- the same way
// document-manifest.json drifted to listing one document while docs/ held four.
//
// The routing truth lives in page.tsx: views inside the `active?( ... )` group are exactly
// the ones that cannot render without an open deposition. These tests pin the hand-kept list
// to that group, so adding a deposition-scoped screen without marking it fails the build
// rather than shipping a nav entry that navigates to a crash.
function navViews() {
  return [...NAV.matchAll(/view:\s*"([^"]+)"/g)].map(match => match[1]);
}

function navViewsNeedingDeposition() {
  return [...NAV.matchAll(/\{\s*view:\s*"([^"]+)"[^}]*needsDeposition:\s*true[^}]*\}/g)].map(match => match[1]);
}

function routedUnderActiveDeposition() {
  // The `active?( ... ):"library"` group in the currentView expression.
  const line = PAGE.split("\n").find(candidate => candidate.includes("const currentView"));
  assert.ok(line, "page.tsx must declare currentView for this guard to read");
  const group = /active\?\(([^)]*)\)/.exec(line);
  assert.ok(group, "the currentView expression must keep its active?( ... ) group");
  return [...group[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

test("every deposition-scoped screen is marked as needing one",()=>{
  const routed = routedUnderActiveDeposition().sort();
  const marked = navViewsNeedingDeposition().sort();
  assert.deepEqual(marked, routed, `nav needsDeposition ${JSON.stringify(marked)} must match the views page.tsx routes under an open deposition ${JSON.stringify(routed)}`);
});

test("the nav lists every view the router can produce",()=>{
  // A nav that omits a working screen hides capability; one that lists a screen the router
  // cannot reach navigates nowhere. Both are caught here.
  const routerViews = [...PAGE.matchAll(/(?:^|[?:(])"(library|intake|audio-tools|transcript|review|compare|insertion-pages|admin)"/g)].map(match => match[1]);
  const listed = new Set(navViews());
  for (const view of new Set(routerViews)) assert.ok(listed.has(view), `page.tsx can produce view "${view}" but the nav does not list it`);
});

test("no nav entry points at a view the router cannot produce",()=>{
  for (const view of navViews()) assert.match(PAGE, new RegExp(`"${view.replace(/[-]/g, "\\-")}"`), `the nav lists "${view}" but page.tsx never produces it`);
});
