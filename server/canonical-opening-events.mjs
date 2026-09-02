import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";

const clean = (value, limit = 4000) => String(value ?? "").trim().slice(0, limit);

function fileFor(root, depositionId, storageRoot) {
  return path.join(depositionDirectory(root, depositionId, { storageRoot }), "intake", "canonical-deposition-record.json");
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function ledger(record) {
  record.openingRecord ??= {};
  record.openingRecord.schemaVersion ??= "1.0.0";
  record.openingRecord.oathAdministrations ??= [];
  record.openingRecord.interpreterAdministrations ??= [];
  record.openingRecord.stipulationEvents ??= [];
  record.openingRecord.closingAttestations ??= [];
  record.openingRecord.auditEvents ??= [];
  return record.openingRecord;
}

export function readCanonicalOpeningRecord(root, { depositionId, storageRoot } = {}) {
  const file = fileFor(root, depositionId, storageRoot);
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  return structuredClone(ledger(record));
}

export function appendCanonicalOpeningEvent(root, { depositionId, storageRoot, kind, payload, actor } = {}) {
  const allowed = new Set(["OATH_ADMINISTRATION", "INTERPRETER_ADMINISTRATION", "STIPULATION_RESPONSE", "CLOSING_ATTESTATION"]);
  if (!allowed.has(kind)) throw new Error("Unsupported canonical opening event.");
  const who = clean(actor, 300);
  if (!who) throw new Error("A canonical opening event requires server-established attribution.");
  const file = fileFor(root, depositionId, storageRoot);
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const opening = ledger(record);
  const at = new Date().toISOString();
  const event = { id: crypto.randomUUID(), kind, recordedAt: at, recordedBy: who, ...structuredClone(payload ?? {}) };
  const collection = {
    OATH_ADMINISTRATION: "oathAdministrations",
    INTERPRETER_ADMINISTRATION: "interpreterAdministrations",
    STIPULATION_RESPONSE: "stipulationEvents",
    CLOSING_ATTESTATION: "closingAttestations",
  }[kind];
  opening[collection].push(event);
  opening.auditEvents.push({ id: crypto.randomUUID(), type: `${kind}_RECORDED`, at, actor: who, eventId: event.id });
  atomicJson(file, record);
  return event;
}

export function currentCanonicalOpeningFacts(record) {
  const opening = record?.openingRecord ?? {};
  const latest = (value) => Array.isArray(value) && value.length ? value[value.length - 1] : null;
  return {
    oathAdministration: latest(opening.oathAdministrations),
    interpreterAdministration: latest(opening.interpreterAdministrations),
    stipulationEvents: opening.stipulationEvents ?? [],
    closingAttestation: latest(opening.closingAttestations),
  };
}
