// Protect, inspect, or lift protection on a live deposition's canonical record.
//
// A COMMAND RATHER THAN A BUTTON. Protecting is rare and lifting should be rarer, and neither
// belongs beside the fifteen-minute unlock on the Opening screen -- a control that ends protection
// permanently, one click from the one that opens it briefly, is the control that gets pressed. This
// is a thing a person types on purpose.
//
//   node scripts/protect-deposition.mjs status  DEP-20260901-3PPOB
//   node scripts/protect-deposition.mjs protect DEP-20260901-3PPOB --reason "..."
//   node scripts/protect-deposition.mjs lift    DEP-20260901-3PPOB --reason "..."
import { depositionDirectory } from "../server/deposition-store.mjs";
import { PROTECTION_FILE, protectDeposition, protectionProjection, readProtection, unprotectDeposition } from "../server/protected-records.mjs";

const [action, depositionId, ...rest] = process.argv.slice(2);
const flag = (name) => { const at = rest.indexOf(`--${name}`); return at === -1 ? null : rest[at + 1] ?? null; };

const usage = `Usage:
  node scripts/protect-deposition.mjs status  <depositionId>
  node scripts/protect-deposition.mjs protect <depositionId> --reason "why this record is protected"
  node scripts/protect-deposition.mjs lift    <depositionId> --reason "why protection is being lifted"`;

if (!["status", "protect", "lift"].includes(action) || !depositionId) {
  console.error(usage);
  process.exit(1);
}

// Resolved through the store, so the id has to name a real deposition. A path typed by hand is a
// path that can be typed wrong, and the whole point of this file is not writing to the wrong record.
let directory;
try { directory = depositionDirectory(null, depositionId); }
catch (error) { console.error(`${depositionId}: ${error.message}`); process.exit(1); }

const show = (label) => {
  const raw = readProtection(directory);
  console.log(`\n${label}`);
  console.log(`  deposition ${depositionId}`);
  console.log(`  folder     ${directory}`);
  if (!raw) { console.log(`  ${PROTECTION_FILE} is absent -- this deposition is not protected.`); return; }
  console.log(JSON.stringify(raw, null, 2).split("\n").map(line => `  ${line}`).join("\n"));
  const projection = protectionProjection(directory);
  console.log(`  in effect: ${projection ? (projection.unlocked ? `PROTECTED, open for ~${Math.round(projection.msRemaining / 60000)} more minutes` : "PROTECTED, closed to writes") : "not protected"}`);
};

if (action === "status") { show("Current state"); process.exit(0); }

const reason = flag("reason");
if (!String(reason ?? "").trim()) {
  console.error(`${action} requires --reason "…".\n\n${usage}`);
  process.exit(1);
}

show("Before");
if (action === "protect") protectDeposition(directory, { reason });
else unprotectDeposition(directory, { reason });
show("After");
console.log();
