import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";

export const REVIEW_ELECTION_STATUSES = Object.freeze(["REQUESTED", "NOT_REQUESTED", "RESOLVED_BY_STIPULATION"]);
const clean = (value, limit=2000) => String(value ?? "").trim().slice(0, limit);

function fileFor(root, depositionId, storageRoot) {
  return path.join(depositionDirectory(root, depositionId, { storageRoot }), "intake", "canonical-deposition-record.json");
}
function atomicJson(file, value) {
  const temporary=`${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value,null,2)}\n`, "utf8");
  fs.renameSync(temporary,file);
}

export function currentReviewElection(record) {
  return record?.reviewElection?.events?.at(-1) ?? null;
}

export function recordReviewElection(root, { depositionId, storageRoot, input, actor }={}) {
  const status=clean(input?.status,80), recordedBy=clean(actor,300), sourceAnchor=clean(input?.sourceAnchor,500);
  if (!REVIEW_ELECTION_STATUSES.includes(status)) throw new Error("Choose a recognized Rule 30(e) review status.");
  if (!recordedBy) throw new Error("A review election requires server-established attribution.");
  if (!sourceAnchor) throw new Error("A review election requires an evidence source anchor.");
  if (status === "REQUESTED" && !clean(input?.requestedBy,300)) throw new Error("Record who requested Rule 30(e) review.");
  const file=fileFor(root,depositionId,storageRoot);
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record=JSON.parse(fs.readFileSync(file,"utf8"));
  record.reviewElection ??={schemaVersion:"1.0.0",events:[]};
  const prior=record.reviewElection.events.at(-1) ?? null;
  if (prior && !clean(input?.correctionReason,1000)) throw new Error("Explain why the Rule 30(e) election is being corrected.");
  const event={
    id:crypto.randomUUID(), kind:"RULE_30E_REVIEW_ELECTION", jurisdiction:"federal", status,
    requestedBy:status === "REQUESTED" ? clean(input.requestedBy,300) : null,
    requestedAt:status === "REQUESTED" ? clean(input.requestedAt,80) || null : null,
    sourceAnchor, stipulationText:status === "RESOLVED_BY_STIPULATION" ? clean(input?.stipulationText,8000) || null : null,
    correctionReason:clean(input?.correctionReason,1000) || null, supersedesEventId:prior?.id ?? null,
    recordedBy, recordedAt:new Date().toISOString(),
  };
  if (status === "RESOLVED_BY_STIPULATION" && !event.stipulationText) throw new Error("Record the exact stipulation resolving review.");
  record.reviewElection.events.push(event);
  atomicJson(file,record);
  return event;
}
