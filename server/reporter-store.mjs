import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// firmRegistrationWaiver is the reason a firm registration number does not apply to this reporter,
// and its presence IS the waiver -- there is no separate applicable flag, so the record cannot hold
// "not applicable" with nothing to say why, which is the state a certificate could not defend.
//
// It is a fact about the reporter, not about any deposition, so it applies to everything she
// certifies. Miah Bardot certifies under an individual Texas CSR: three certified transcripts,
// both jurisdictions, six signature blocks, and not one prints a firm registration number.
//
// No firmRegistrationNumber field here on purpose. No certified document in the library carries
// one. The validator's number branch stays intact for a firm-employed reporter; it needs no store
// field until such a reporter exists.
// csrExpiration is here because six byte-identical signature blocks across three certified
// transcripts all carry "EXPIRES 6-30-2026", the reviewed template prints
// ^reporter.csrExpirationDate^, and validateInsertionInput blocks without it -- so a store that
// could not hold one made a certification page unrenderable for the reporter this application is
// for. firmRegistrationNumber is still deliberately absent: no specimen justifies it.
const REPORTER_FIELDS = ["name", "company", "email", "phone", "licenseNumber", "csrExpiration", "taxId", "address", "firmRegistrationWaiver"];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function storeFile(storageRoot) {
  return path.join(path.resolve(storageRoot), "reporters.json");
}

function text(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function normalizeReporter(input) {
  const id = text(input?.id || crypto.randomUUID(), 128);
  if (!ID_PATTERN.test(id)) throw new Error("Court reporter ID is invalid.");
  const reporter = { id };
  for (const field of REPORTER_FIELDS) reporter[field] = text(input?.[field]);
  if (!reporter.name) throw new Error("Court reporter name is required.");
  return reporter;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}

export function listReporters(storageRoot) {
  const file = storeFile(storageRoot);
  if (!fs.existsSync(file)) return [];
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  if (document?.schemaVersion !== "1.0.0" || !Array.isArray(document.reporters)) {
    throw new Error("Court reporter directory is malformed or unsupported.");
  }
  return document.reporters.map(normalizeReporter).sort((a, b) => a.name.localeCompare(b.name));
}

function writeReporters(storageRoot, reporters) {
  const normalized = reporters.map(normalizeReporter);
  const ids = new Set();
  for (const reporter of normalized) {
    if (ids.has(reporter.id)) throw new Error(`Court reporter ID ${reporter.id} appears more than once.`);
    ids.add(reporter.id);
  }
  normalized.sort((a, b) => a.name.localeCompare(b.name));
  atomicJson(storeFile(storageRoot), { schemaVersion:"1.0.0", updatedAt:new Date().toISOString(), reporters:normalized });
  return normalized;
}

export function createReporter(storageRoot, input) {
  const reporter = normalizeReporter(input);
  const reporters = listReporters(storageRoot);
  if (reporters.some(item => item.id === reporter.id)) throw new Error("Court reporter already exists.");
  writeReporters(storageRoot, [...reporters, reporter]);
  return reporter;
}

export function importReporters(storageRoot, input) {
  if (!Array.isArray(input)) throw new Error("Court reporters must be an array.");
  const existing = listReporters(storageRoot);
  const byId = new Map(existing.map(reporter => [reporter.id, reporter]));
  for (const candidate of input) {
    const reporter = normalizeReporter(candidate);
    if (!byId.has(reporter.id)) byId.set(reporter.id, reporter);
  }
  return writeReporters(storageRoot, [...byId.values()]);
}
