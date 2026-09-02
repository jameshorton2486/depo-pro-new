import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readAudioAudit, resolveAudioItem } from "./audio-pipeline.mjs";
import {
  depositionStorageRoot,
  resolveDefaultDepositionsRoot,
} from "./storage-config.mjs";
import {
  counselEntry,
  createCanonicalDepositionRecord,
  field,
  partyEntry,
} from "./canonical-deposition-record.mjs";
import {
  applyCorrection,
  parseCorrectionLog,
  serializeCorrectionLog,
  validateCorrection,
} from "./canonical-corrections.mjs";
import {
  canonicalInputFromMaster,
  projectDeepgramKeyterms,
} from "./master-deposition-data.mjs";
import { normalizeCauseNumber } from "./cause-number.mjs";

const ID_PATTERN = /^DEP-\d{8}-[A-Z0-9]{5}$/;
function base(_root, { storageRoot } = {}) {
  return storageRoot ? path.resolve(storageRoot) : depositionStorageRoot();
}
function within(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function safeName(value, fallback) {
  return path
    .basename(String(value || fallback))
    .replace(/[^a-zA-Z0-9._ -]/g, "_");
}
function pathPart(value, label) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!normalized)
    throw new Error(`${label} is required to create the deposition folder.`);
  return normalized;
}
function personName(value, label) {
  const name = String(value || "").trim();
  if (!name)
    throw new Error(`${label} is required to create the deposition folder.`);
  const suffixes = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);
  let first, last;
  if (
    name.includes(",") &&
    !suffixes.has(name.split(",").at(-1).trim().toLowerCase())
  ) {
    const parts = name.split(",");
    last = parts[0];
    first = parts.slice(1).join(" ").trim();
  } else {
    const parts = name.replace(/,/g, "").split(/\s+/).filter(Boolean);
    while (parts.length > 1 && suffixes.has(parts.at(-1).toLowerCase()))
      parts.pop();
    first = parts[0];
    last = parts.at(-1);
  }
  return {
    first: pathPart(first, `${label} first name`),
    last: pathPart(last, `${label} last name`),
  };
}
function reporterFolder(value) {
  const { first, last } = personName(value, "Court reporter");
  return `${last}_${first[0]}`;
}
function causeFolder(metadata) {
  return pathPart(
    normalizeCauseNumber(
      metadata?.causeNumber ||
        metadata?.ufmData?.cause_number ||
        metadata?.ufmData?.causeNumber,
    ),
    "Cause number",
  );
}
function depositionFolder(metadata) {
  const { first, last } = personName(metadata?.witness, "Deponent"),
    date = pathPart(
      requiredText(metadata?.depositionDate, "Deposition date"),
      "Deposition date",
    );
  return `${last}_${first}_${date}`;
}
function atomicText(file, text) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`,
    descriptor = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(descriptor, text);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}
function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`,
    descriptor = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}
function commitDirectory(
  source,
  target,
  {
    rename = fs.renameSync,
    wait = (milliseconds) =>
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        milliseconds,
      ),
    attempts = 8,
    delayBaseMs = 350,
  } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rename(source, target);
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
      if (attempt === attempts) {
        const blocked = new Error(
          `Windows blocked the completed deposition folder rename after ${attempts} attempts. Close programs using the deposition files or check folder permissions, then try again.`,
          { cause: error },
        );
        blocked.code = "DEPOSITION_COMMIT_BLOCKED";
        throw blocked;
      }
      wait(delayBaseMs * attempt);
    }
  }
}
function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
export function depositionDirectories(root, options = {}) {
  const directory = base(root, options);
  fs.mkdirSync(directory, { recursive: true });
  const found = [];
  for (const reporter of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!reporter.isDirectory() || reporter.name.startsWith(".")) continue;
    const reporterPath = path.join(directory, reporter.name);
    for (const cause of fs.readdirSync(reporterPath, { withFileTypes: true })) {
      if (!cause.isDirectory() || cause.name.startsWith(".")) continue;
      const causePath = path.join(reporterPath, cause.name);
      for (const deposition of fs.readdirSync(causePath, {
        withFileTypes: true,
      })) {
        if (deposition.isDirectory() && !deposition.name.startsWith("."))
          found.push(path.join(causePath, deposition.name));
      }
    }
  }
  return found;
}
export function depositionDirectory(root, id, options = {}) {
  if (!ID_PATTERN.test(String(id))) throw new Error("Invalid deposition ID.");
  for (const directory of depositionDirectories(root, options)) {
    const record = path.join(directory, "deposition.json");
    if (!fs.existsSync(record)) continue;
    try {
      if (JSON.parse(fs.readFileSync(record, "utf8")).id === id)
        return directory;
    } catch {
      continue;
    }
  }
  throw new Error("Deposition was not found.");
}

export function scanDepositions(root, options = {}) {
  const storageRoot = base(root, options),
    depositions = [],
    issues = [];
  for (const folder of depositionDirectories(root, options)) {
    const relative = path.relative(storageRoot, folder),
      record = path.join(folder, "deposition.json");
    if (!fs.existsSync(record)) {
      issues.push({
        folder: relative,
        code: "ORPHANED_FOLDER",
        message: "deposition.json is missing.",
      });
      continue;
    }
    try {
      const value = JSON.parse(fs.readFileSync(record, "utf8"));
      if (!ID_PATTERN.test(value.id) || !value.caseStyle || !value.witness)
        throw new Error(
          "Required identity fields are missing or inconsistent.",
        );
      depositions.push(value);
    } catch (error) {
      issues.push({
        folder: relative,
        code: "MALFORMED_DEPOSITION",
        message:
          error instanceof Error
            ? error.message
            : "Invalid deposition metadata.",
      });
    }
  }
  depositions.sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(
      String(a.updatedAt || a.createdAt),
    ),
  );
  return { depositions, issues };
}

function writeArtifact(directory, relative, artifact) {
  if (!artifact?.base64) return null;
  const target = path.join(directory, ...relative.split("/"));
  if (!within(target, directory))
    throw new Error("Intake artifact path escaped the deposition folder.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(artifact.base64, "base64"), {
    flag: "wx",
  });
  return relative;
}

export function createDeposition(root, input, options = {}) {
  const metadata = {
      ...(input?.deposition || {}),
      causeNumber: normalizeCauseNumber(input?.deposition?.causeNumber),
    },
    id = String(metadata.id || "");
  if (!ID_PATTERN.test(id)) throw new Error("Invalid deposition ID.");
  const rootDirectory = base(root, options),
    reporter = reporterFolder(metadata.courtReporterName),
    cause = causeFolder(metadata),
    deposition = depositionFolder(metadata),
    causeDirectory = path.join(rootDirectory, reporter, cause),
    finalDirectory = path.join(causeDirectory, deposition);
  if (!within(finalDirectory, rootDirectory))
    throw new Error("Deposition path escaped its storage root.");
  fs.mkdirSync(causeDirectory, { recursive: true });
  if (fs.existsSync(finalDirectory))
    throw new Error(
      `A deposition already exists for ${metadata.witness} on ${metadata.depositionDate} in cause number ${metadata.causeNumber}.`,
    );
  const staging = path.join(
    causeDirectory,
    `.creating-${deposition}-${crypto.randomUUID()}`,
  );
  fs.mkdirSync(staging, { recursive: false });
  try {
    for (const name of [
      "intake",
      "audio/original",
      "audio/processed",
      "deepgram",
      "transcript",
      "exhibits",
      "ufm",
      "certification/history",
    ])
      fs.mkdirSync(path.join(staging, ...name.split("/")), { recursive: true });
    const artifacts = input.artifacts || {},
      noticeName = artifacts.notice
        ? safeName(artifacts.notice.name, "notice.bin")
        : "",
      courtOrderName = artifacts.courtOrder
        ? safeName(artifacts.courtOrder.name, "court-order.bin")
        : "";
    if (artifacts.notice)
      writeArtifact(staging, `intake/${noticeName}`, artifacts.notice);
    if (artifacts.courtOrder)
      writeArtifact(staging, `intake/${courtOrderName}`, artifacts.courtOrder);
    const supporting = (artifacts.supportingFiles || []).map(
      (artifact, index) =>
        writeArtifact(
          staging,
          `intake/supporting/${String(index + 1).padStart(2, "0")}-${safeName(artifact.name, "document.bin")}`,
          artifact,
        ),
    );
    const audio = [];
    for (const uploadId of metadata.audioIntakeIds || []) {
      const audit = readAudioAudit(root, uploadId),
        item = resolveAudioItem(audit),
        source = path.resolve(root, "data", item.key);
      const category =
          audit.selectedSource === "processed" ? "processed" : "original",
        name = safeName(
          audit.selectedSource === "processed"
            ? path.basename(item.key)
            : audit.originalName,
          path.basename(item.key),
        ),
        relative = `audio/${category}/${name}`,
        target = path.join(staging, ...relative.split("/"));
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      /* copyFileSync returns only after its internal handles are closed. */ audio.push(
        {
          uploadId,
          source: audit.selectedSource,
          operationId: audit.selectedDerivativeOperationId || null,
          sha256: item.sha256,
          path: relative,
          name,
        },
      );
    }
    const masterInput =
      metadata.masterData?.recordType === "MASTER_DEPOSITION_DATA_RECORD"
        ? canonicalInputFromMaster(metadata.masterData)
        : {};
    const canonicalData = createCanonicalDepositionRecord(
      {
        ...metadata,
        ...masterInput,
        ...(metadata.canonicalSeed || {}),
        caseStyle: metadata.caseStyle,
        witness: metadata.witness,
        causeNumber: metadata.causeNumber,
        depositionDate: metadata.depositionDate,
        deponentType: metadata.deponentType,
      },
      { noticeSupplied: Boolean(noticeName) },
    );
    const creationMode =
        metadata.creationMode === "live" ? "live" : "existing_recording",
      workflowStatus = String(
        metadata.workflowStatus ||
          (creationMode === "live" ? "scheduled" : "review"),
      );
    const now = new Date().toISOString(),
      record = {
        schemaVersion: "1.2.0",
        id,
        caseStyle: requiredText(metadata.caseStyle, "Case style"),
        witness: requiredText(metadata.witness, "Witness"),
        deponentType: String(metadata.deponentType || "Fact witness"),
        depositionDate: requiredText(
          metadata.depositionDate,
          "Deposition date",
        ),
        courtReporterId: String(metadata.courtReporterId || ""),
        courtReporterName: String(metadata.courtReporterName || ""),
        causeNumber: requiredText(metadata.causeNumber, "Cause number"),
        creationMode,
        workflowStatus,
        canonicalData,
        storagePath: `${reporter}/${cause}/${deposition}`,
        intakeNotes: String(metadata.intakeNotes || ""),
        noticeName,
        courtOrderName,
        audioFiles: audio.map((item) => item.name),
        audioIntakeIds: audio.map((item) => item.uploadId),
        audio,
        keytermCount: Array.isArray(metadata.keyterms)
          ? metadata.keyterms.length
          : 0,
        keyterms: Array.isArray(metadata.keyterms) ? metadata.keyterms : [],
        paths: {
          intake: "intake/intake.json",
          canonicalData: "intake/canonical-deposition-record.json",
          workingTranscript: "transcript/working.json",
        },
        createdAt: now,
        updatedAt: now,
      };
    const intake =
      metadata.masterData?.recordType === "MASTER_DEPOSITION_DATA_RECORD"
        ? {
            schemaVersion: "2.0.0",
            notice: noticeName || null,
            courtOrder: courtOrderName || null,
            supporting,
            masterData: metadata.masterData,
            warnings: metadata.warnings || [],
            audio,
          }
        : {
            schemaVersion: "1.0.0",
            notice: noticeName || null,
            courtOrder: courtOrderName || null,
            supporting,
            keyterms: record.keyterms,
            deepgramArtifact: metadata.deepgramArtifact || {},
            ufmData: metadata.ufmData || {},
            warnings: metadata.warnings || [],
            audio,
          };
    if (intake.masterData) {
      const projection = projectDeepgramKeyterms(intake.masterData);
      record.keyterms = projection.wire;
      record.keytermCount = projection.term_count;
    }
    atomicJson(path.join(staging, "intake", "intake.json"), intake);
    atomicJson(path.join(staging, "audio", "audit.json"), {
      schemaVersion: "1.0.0",
      items: audio,
    });
    atomicJson(
      path.join(staging, "intake", "canonical-deposition-record.json"),
      canonicalData,
    );
    atomicJson(path.join(staging, "deposition.json"), record);
    commitDirectory(staging, finalDirectory);
    return record;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

// The browser-playable copy, beside the frozen audio and never in place of it.
//
// It lives under audio/playback/ with a sidecar record so the alignment measurement, encoder
// versions and declared pre-skip travel with the file. resolveDepositionAudio still returns the
// original for every other purpose; nothing here changes what can be transcribed, and
// PLAYBACK_PROXY is absent from ASR_ELIGIBLE_KINDS so it never could.
export function playbackProxyPaths(root, id, index, options = {}) {
  const directory = depositionDirectory(root, id, options),
    base = path.join(directory, "audio", "playback");
  return {
    directory,
    file: path.join(base, `${Number(index)}.ogg`),
    record: path.join(base, `${Number(index)}.json`),
  };
}
export function readPlaybackProxy(root, id, index, options = {}) {
  const paths = playbackProxyPaths(root, id, index, options);
  if (!fs.existsSync(paths.file) || !fs.existsSync(paths.record)) return null;
  try {
    return {
      ...JSON.parse(fs.readFileSync(paths.record, "utf8")),
      file: paths.file,
    };
  } catch {
    return null;
  }
}
export function writePlaybackProxyRecord(
  root,
  id,
  index,
  record,
  options = {},
) {
  const paths = playbackProxyPaths(root, id, index, options);
  fs.mkdirSync(path.dirname(paths.record), { recursive: true });
  atomicJson(paths.record, record);
  return { ...record, file: paths.file };
}

const APPEARANCE_ROLES = Object.freeze([
  "QUESTIONING_ATTORNEY",
  "DEFENDING_ATTORNEY",
  "OTHER",
]);

/**
 * Adds audio to a deposition that already exists.
 *
 * Until this, audio[] could only be written by createDeposition, which meant a recording made for
 * a deposition could never reach it -- the same structural defect counsel had before
 * writeDepositionCounsel, and fixed the same way: a narrow endpoint rather than a wider intake.
 * Losing a recording is a lost record, not an inconvenience, so this is the seam that matters.
 *
 * The file is registered where it already lies rather than copied. A capture session writes inside
 * the deposition folder, resolveDepositionAudio resolves any path within that folder, and copying
 * would double the disk cost of every deposition to gain nothing.
 *
 * The SHA-256 is recomputed here rather than taken from the caller. The hash recorded when the
 * recording was finalized says what was captured; recomputing it at registration says the bytes on
 * disk are still those. A caller that supplies a hash is checked against the file and refused on
 * mismatch -- registering audio is exactly the moment to find out, not the moment to assume.
 */
export function appendDepositionAudio(
  root,
  { depositionId, entries, storageRoot } = {},
) {
  if (!Array.isArray(entries) || !entries.length)
    throw new Error("At least one audio entry is required.");
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(directory, "deposition.json");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const known = new Set((record.audio ?? []).map((item) => item.uploadId));
  const added = [];

  for (const entry of entries) {
    const uploadId = String(entry?.uploadId ?? "").trim();
    if (!uploadId) throw new Error("Every audio entry requires an upload id.");
    if (known.has(uploadId))
      throw new Error(`Audio ${uploadId} is already part of this deposition.`);
    const relative = String(entry?.path ?? "").replaceAll("\\", "/");
    if (!relative) throw new Error("Every audio entry requires a path.");
    const target = path.resolve(directory, ...relative.split("/"));
    if (!within(target, directory))
      throw new Error("Audio path escaped the deposition folder.");
    if (!fs.existsSync(target))
      throw new Error(`Audio file was not found: ${relative}`);
    const sha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(target))
      .digest("hex");
    if (entry.sha256 && entry.sha256 !== sha256)
      throw new Error(
        `Audio ${relative} failed SHA-256 verification; the file on disk is not the one that was recorded.`,
      );
    known.add(uploadId);
    added.push({
      uploadId,
      source: String(entry.source ?? "original"),
      operationId: entry.operationId ?? null,
      sha256,
      path: relative,
      name: String(entry.name ?? path.basename(target)),
    });
  }

  const audio = [...(record.audio ?? []), ...added];
  atomicJson(file, {
    ...record,
    workflowStatus: "recorded",
    audio,
    audioFiles: audio.map((item) => item.name),
    audioIntakeIds: audio.map((item) => item.uploadId),
    updatedAt: new Date().toISOString(),
  });
  return { depositionId, added };
}

/**
 * Replaces parties[] on an existing deposition, and touches nothing else.
 *
 * Narrow for the same reason writeDepositionCounsel is narrow: a party entry cannot orphan a word
 * id or invalidate a transcript hash, and it should not be able to reach anything that could.
 *
 * The rule this exists to hold: PARTY STATUS IS NOT ATTENDANCE. Writing a party never makes anyone
 * a speaker candidate. getSpeakerCandidates reads the witness, the reporter, counsel who actually
 * appeared, interpreters and videographers -- it does not read parties[], and must not begin to.
 * A defendant who never attended is still a defendant; a corporation cannot attend at all. If
 * party status were allowed to imply eligibility, a speaker map could attribute testimony to an
 * entity that was never in the room, which is a defect in the record rather than in the interface.
 */
/**
 * The parties as a screen edits them, in the shape writeDepositionParties takes back.
 *
 * Same contract as readDepositionCounsel beside it, and written at the same time for the same
 * reason: the caption prints the plaintiffs and the defendants, and a deposition whose Notice
 * extraction produced no parties had no way to record them at all. The id comes back first --
 * partyEntry falls back to `party-${index + 1}`, so an editor that dropped it would renumber the
 * parties by position.
 */
export function readDepositionParties(
  root,
  { depositionId, storageRoot } = {},
) {
  const file = path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = (field) =>
    field && typeof field === "object" && "value" in field
      ? field.value
      : field;
  return {
    depositionId,
    parties: (record.parties ?? []).map((entry) => ({
      id: entry.id,
      name: String(value(entry.name) ?? "").trim(),
      role: String(value(entry.role) ?? "").trim(),
      entityType: String(value(entry.entityType) ?? "").trim(),
      captionDisplayName: String(value(entry.captionDisplayName) ?? "").trim(),
    })),
  };
}

export function writeDepositionParties(
  root,
  { depositionId, parties, storageRoot, source = "REPORTER_ENTERED" } = {},
) {
  if (!Array.isArray(parties)) throw new Error("Parties must be an array.");
  const entries = parties.map((party, index) => {
    if (!String(party?.name ?? "").trim())
      throw new Error("Every party entry requires a name.");
    return partyEntry(party, index, { source });
  });
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id))
      throw new Error(`Party id ${entry.id} appears more than once.`);
    seen.add(entry.id);
  }
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  atomicJson(file, { ...record, parties: entries });
  return { depositionId, parties: entries };
}

/**
 * Replaces counsel[] on an existing deposition with reporter-typed entries.
 *
 * Deliberately narrow. It reads the canonical record, replaces one key, and writes it back --
 * it never touches the transcript, the overlay, the audio audit or any other field of the
 * record. That narrowness is the whole reason this is safer than the hand-edits it replaces:
 * a counsel entry cannot orphan a word id or invalidate a transcript hash.
 *
 * Entries are written REPORTER_ENTERED / REPORTER_ADDED. Counsel that came off the Notice keep
 * NOD_EXTRACTED, so the record shows which attorneys the document supplied and which a person
 * typed.
 *
 * Attorney of record and attorney who appeared are separate facts, and actualAppearance is where
 * they part company. A Notice seeds the roster; the transcript settles who was in the room, and
 * they disagree more often than the roster suggests. On DEP-20260814-LQ9R6 the Notice named Karen
 * M. Alvarado for Home Depot and Lucia D. Zhan appeared in her place, stating her appearance on
 * the record -- a substitution within the same firm. Writing the Notice's roster alone would have
 * recorded an attorney who was not there and omitted the one who defended the deposition.
 *
 * So both go in. Counsel who did not appear stay in counsel[] because the appearance page names
 * counsel of record, and getSpeakerCandidates filters them out because someone who was not there
 * cannot have spoken. That is the whole reason the two facts are stored separately rather than
 * one being inferred from the other. Ids are regenerated as attorney-1..n: a speaker map keyed to an id that this call
 * removes would be reconciling against someone who is no longer in the record, and
 * reconcileSpeakerMap already refuses an identity the canonical record does not contain.
 */
/**
 * The counsel roster, for a caller that needs to name one of them by canonical id.
 *
 * A complete-transcript assembly stores `operator.examiningCounselId` and never a typed name, so a
 * screen offering that choice has to be handed the same ids the record holds. Speaker candidates
 * will not do: that list merges counsel with the witness, the reporter, interpreters and
 * videographers, and once `appearanceRole` is unset -- which it is for manually entered counsel --
 * nothing in it distinguishes an attorney from anyone else.
 */
export function readDepositionCounsel(
  root,
  { depositionId, storageRoot } = {},
) {
  const file = path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = (field) =>
    field && typeof field === "object" && "value" in field
      ? field.value
      : field;
  return {
    depositionId,
    counsel: (record.counsel ?? []).map((entry) => ({
      // Every editable field, so a screen amending one attorney can send the rest back unchanged
      // rather than reconstructing them. Chief among them the id: counselEntry falls back to
      // `attorney-${index + 1}` when none is supplied, so an editor that dropped it would renumber
      // counsel by position and leave the examiner reference and every speaker mapping pointing at
      // an id that no longer exists -- while the save looked entirely successful.
      //
      // The same failure, found the same way: bar number, address, fax, phone and email were absent
      // here while counsel entries carried them, and they are exactly what the certified APPEARANCES
      // page prints. Recording a side through the Counsel Editor -- the only screen that offers one
      // -- emptied the address and phone of every attorney on the deposition, and reported success.
      id: entry.id,
      name: String(value(entry.fullName) ?? "").trim(),
      honorific: value(entry.honorific) ?? "",
      barNumber: String(value(entry.barNumber) ?? "").trim(),
      firm: String(value(entry.firm) ?? "").trim(),
      address: String(value(entry.address) ?? "").trim(),
      phone: String(value(entry.phone) ?? "").trim(),
      fax: String(value(entry.fax) ?? "").trim(),
      email: String(value(entry.email) ?? "").trim(),
      represents: value(entry.represents) ?? [],
      appearanceRole: value(entry.appearanceRole) ?? "",
      side: value(entry.side) ?? "",
      sideOther: value(entry.sideOther) ?? "",
      actualAppearance: value(entry.actualAppearance),
    })),
  };
}

export function writeDepositionCounsel(
  root,
  { depositionId, counsel, storageRoot } = {},
) {
  if (!Array.isArray(counsel)) throw new Error("Counsel must be an array.");
  const entries = counsel.map((attorney, index) => {
    const name = String(attorney?.name ?? attorney?.fullName ?? "").trim();
    if (!name) throw new Error("Every counsel entry requires a name.");
    const role = String(attorney?.appearanceRole ?? "")
      .trim()
      .toUpperCase()
      .replaceAll(" ", "_");
    if (role && !APPEARANCE_ROLES.includes(role))
      throw new Error(
        `Unsupported appearance role: ${attorney.appearanceRole}`,
      );
    return counselEntry(
      { ...attorney, name, appearanceRole: role || null },
      index,
      { source: "REPORTER_ENTERED" },
    );
  });
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id))
      throw new Error(`Counsel id ${entry.id} appears more than once.`);
    seen.add(entry.id);
  }
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  atomicJson(file, { ...record, counsel: entries });
  return { depositionId, counsel: entries };
}

/**
 * Records the certificate facts only a reporter can supply, on an existing deposition.
 *
 * Narrow in the same way writeDepositionCounsel is: it reads the canonical record, merges six
 * named keys across two blocks, and writes it back. It cannot touch the transcript, the audio
 * audit, or any certification field it does not name.
 *
 * The three event dates printed by the certificate are owned by the separate certificate-workflow
 * writer below. A reporter typing one here and the record claiming that a workflow derived it
 * would be a provenance defect, so this writer deliberately cannot accept those fields.
 *
 * An untouched control is MISSING, not "". A blank string would be an answer nobody gave, and
 * validateFields cannot tell it from an omission -- isBlank collapses them, so the certificate
 * would render a dropped clause with a clean bill of health, which is what UNEXPECTED_BLANK exists
 * to prevent. null with state MISSING is the honest record of a field left alone.
 */
const CERTIFICATION_FIELDS = Object.freeze([
  "custodialAttorney",
  "officerCharges",
  "chargesResponsibleParty",
  "certificationDate",
  "furtherCertificationDate",
]);

/**
 * The stored certificate, as the strings a form has to show.
 *
 * writeDepositionCertification rewrites every field it owns, setting anything absent to MISSING --
 * correct for a form that shows everything, and a data-loss path for one that shows nothing.
 * InsertionPagesScreen initialised to EMPTY_CERTIFICATE and never read, so Preview on a screen
 * that always looked blank erased values already on the record. The route is not the defect; a
 * merge-only route would mean a reporter could never clear a value entered by mistake, turning a
 * display bug into a permanent one. The screen has to load first, and this is what it loads.
 *
 * MISSING reads back as "" because that is what an empty control holds, and "" written back
 * becomes MISSING again -- so a form the reporter never touches round-trips to exactly the record
 * it started from.
 */
export function readDepositionCertification(
  root,
  { depositionId, storageRoot } = {},
) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const text = (envelope) =>
    envelope && envelope.value !== null && envelope.value !== undefined
      ? String(envelope.value)
      : "";
  const certification = Object.fromEntries(
    CERTIFICATION_FIELDS.map((key) => [key, text(record.certification?.[key])]),
  );
  return {
    depositionId,
    certification: {
      ...certification,
      returnedDate: text(record.signature?.returnedDate),
    },
  };
}

export function writeDepositionCertification(
  root,
  { depositionId, certification = {}, storageRoot } = {},
) {
  if (
    !certification ||
    typeof certification !== "object" ||
    Array.isArray(certification)
  )
    throw new Error("Certification must be an object.");
  const unknown = Object.keys(certification).filter(
    (key) => key !== "returnedDate" && !CERTIFICATION_FIELDS.includes(key),
  );
  if (unknown.length)
    throw new Error(`Unsupported certification field: ${unknown.join(", ")}`);
  const entry = (value) => {
    const text =
      typeof value === "string"
        ? value.trim()
        : value == null
          ? ""
          : String(value).trim();
    return text
      ? field(text, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" })
      : field(null, { source: "REPORTER_ENTERED", state: "MISSING" });
  };

  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));

  const certified = { ...record.certification };
  for (const key of CERTIFICATION_FIELDS)
    certified[key] = entry(certification[key]);
  // cert.returnStatus renders after "returned to the deposition officer on", so it is a date, and
  // the record already calls that signature.returnedDate. The template field keeps its name; the
  // record keeps its meaning.
  const signature = {
    ...record.signature,
    returnedDate: entry(certification.returnedDate),
  };

  atomicJson(file, { ...record, certification: certified, signature });
  return {
    depositionId,
    certification: certified,
    signature: { returnedDate: signature.returnedDate },
  };
}

// Dates created by the certificate workflow, not facts attributed to the Notice or free-form
// certificate testimony. Keeping this writer separate prevents a reporter-entered certificate
// field from claiming WORKFLOW_DERIVED provenance merely because both appear on the same page.
const CERTIFICATE_WORKFLOW_FIELDS = Object.freeze([
  "submissionDate",
  "returnDeadline",
  "serviceDate",
]);
const isoDate = (value) => {
  const text =
    typeof value === "string"
      ? value.trim()
      : value == null
        ? ""
        : String(value).trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new Error(`Certificate workflow date must use YYYY-MM-DD: ${text}`);
  const [year, month, day] = text.split("-").map(Number),
    date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error(`Certificate workflow date is invalid: ${text}`);
  return text;
};
const workflowDate = (value) =>
  value
    ? field(value, { source: "WORKFLOW_DERIVED", state: "DERIVED" })
    : field(null, { source: "WORKFLOW_DERIVED", state: "MISSING" });

export function readDepositionCertificateWorkflow(
  root,
  { depositionId, storageRoot } = {},
) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const text = (envelope) =>
    envelope?.value == null ? "" : String(envelope.value);
  return {
    depositionId,
    workflow: {
      submissionDate: text(record.signature?.submittedToWitnessDate),
      returnDeadline: text(record.signature?.dueDate),
      serviceDate: text(record.certification?.serviceDate),
    },
  };
}

export function writeDepositionCertificateWorkflow(
  root,
  { depositionId, workflow = {}, storageRoot } = {},
) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow))
    throw new Error("Certificate workflow must be an object.");
  const unknown = Object.keys(workflow).filter(
    (key) => !CERTIFICATE_WORKFLOW_FIELDS.includes(key),
  );
  if (unknown.length)
    throw new Error(
      `Unsupported certificate workflow field: ${unknown.join(", ")}`,
    );
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const values = Object.fromEntries(
    CERTIFICATE_WORKFLOW_FIELDS.map((key) => [key, isoDate(workflow[key])]),
  );
  const signature = {
    ...record.signature,
    submittedToWitnessDate: workflowDate(values.submissionDate),
    dueDate: workflowDate(values.returnDeadline),
  };
  const certification = {
    ...record.certification,
    serviceDate: workflowDate(values.serviceDate),
  };
  atomicJson(file, { ...record, signature, certification });
  return readDepositionCertificateWorkflow(root, { depositionId, storageRoot });
}

/**
 * The time each party used, as the certificate has to state it.
 *
 * certification-1 prints "That the amount of time used by each party at the deposition is as
 * follows:" and then ^cert.timeUsedLines^. Until now the only thing that could fill that line was
 * operator.timeUsed -- a fixture construction path -- so on every real deposition the certificate
 * made that statement over an empty line, and nothing raised it. The blank guard could not: the
 * line is composed in build-pages and never reaches fieldValues, so it is named in no inventory.
 *
 * This is the writer that gives the clause a source. It records what the certificate attributes to
 * a party and nothing else -- not the total, which is a fact about the recording rather than about
 * any party, and not the reconciliation between them, which validate.mjs already reports and can
 * only report once both exist.
 *
 * Minutes are whole and may be zero. A party who used none is an answer the certificate can state
 * -- "Dana Counsel - 00 HOURS:00 MINUTES" -- so the check is `>= 0` rather than truthiness.
 * Dropping a zero would remove a party from a certified list on the strength of their number.
 *
 * Order is preserved as written. The certificate lists parties, and a list a reporter ordered is
 * not the store's to re-sort.
 */
const attorneyTimeEntries = (attorneyTime) => {
  if (!Array.isArray(attorneyTime))
    throw new Error("Attorney time must be an array.");
  return attorneyTime.map((party, index) => {
    const unknown = Object.keys(party ?? {}).filter(
      (key) => key !== "name" && key !== "minutes",
    );
    if (unknown.length)
      throw new Error(`Unsupported attorney time field: ${unknown.join(", ")}`);
    const name = String(party?.name ?? "").trim();
    if (!name)
      throw new Error(`Attorney time entry ${index + 1} requires a name.`);
    const minutes =
      typeof party?.minutes === "string" && party.minutes.trim() !== ""
        ? Number(party.minutes)
        : party?.minutes;
    if (!Number.isInteger(minutes) || minutes < 0)
      throw new Error(
        `Attorney time for ${name} must be a whole number of minutes, and not negative.`,
      );
    return {
      name: field(name, {
        source: "REPORTER_ENTERED",
        state: "REPORTER_ADDED",
      }),
      minutes: field(minutes, {
        source: "REPORTER_ENTERED",
        state: "REPORTER_ADDED",
      }),
    };
  });
};

/**
 * What a form has to show, in the shape it shows it.
 *
 * Same rule as readDepositionCertification above: a screen that writes without loading first
 * erases what it never displayed, and this writer replaces the whole list rather than merging into
 * it -- a merge-only writer would mean a party entered by mistake could never be removed.
 */
export function readDepositionAttorneyTime(
  root,
  { depositionId, storageRoot } = {},
) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const attorneyTime = (record.certification?.attorneyTime ?? []).map(
    (party) => ({
      name: party?.name?.value ?? "",
      minutes: party?.minutes?.value ?? null,
    }),
  );
  return { depositionId, attorneyTime };
}

export function writeDepositionAttorneyTime(
  root,
  { depositionId, attorneyTime, storageRoot } = {},
) {
  const entries = attorneyTimeEntries(attorneyTime);
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  atomicJson(file, {
    ...record,
    certification: { ...record.certification, attorneyTime: entries },
  });
  return { depositionId, attorneyTime: entries };
}

export function readDepositionVideographers(
  root,
  { depositionId, storageRoot } = {},
) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    depositionId,
    videographers: (record.participants?.videographers ?? []).map((person) => ({
      id: person.id,
      fullName: person.fullName?.value ?? "",
    })),
  };
}

export function writeDepositionVideographers(
  root,
  { depositionId, videographers, storageRoot } = {},
) {
  if (!Array.isArray(videographers))
    throw new Error("Videographers must be an array.");
  const entries = videographers.map((person, index) => {
    const fullName = String(person?.fullName ?? "").trim();
    if (!fullName)
      throw new Error(`Videographer ${index + 1} requires a name.`);
    return {
      id: String(person?.id || `videographer-${crypto.randomUUID()}`),
      fullName: field(fullName, {
        source: "REPORTER_ENTERED",
        state: "REPORTER_ADDED",
      }),
    };
  });
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  atomicJson(file, {
    ...record,
    participants: { ...record.participants, videographers: entries },
  });
  return { depositionId, videographers: entries };
}

/**
 * Where the deposition was taken, and in what court.
 *
 * These four have slots in the canonical record and a place on the certified page, and until now
 * no screen could set any of them. They are written only by buildCanonicalRecord at intake, from a
 * Notice the manual route does not have -- so a deposition created by the manual route could never
 * produce a complete transcript, at any point in its life. This is the missing writer.
 *
 * `remote` is three-state and stays that way. A boolean defaulting to false records "taken in
 * person" when nobody said so, which is the defect the note at the top of
 * canonical-deposition-record.mjs already names: an unticked checkbox becoming a finding of the
 * source document. Undefined means unrecorded and keeps blocking, which is correct -- validate.mjs
 * refuses rather than guessing, because "a certificate that guesses is worse than one that is
 * refused".
 *
 * An untouched text control writes null with state MISSING, never "". isBlank collapses the two,
 * so an empty string would render a dropped clause with a clean bill of health -- exactly what
 * UNEXPECTED_BLANK exists to catch. Same rule as writeDepositionCertification above, for the same
 * reason.
 */
const PROCEEDING_TEXT_FIELDS = Object.freeze([
  "court",
  "location",
  "remotePlatform",
]);

export function writeDepositionProceeding(
  root,
  {
    depositionId,
    proceeding = {},
    why = "Reporter recorded the court and how the deposition was taken.",
    storageRoot,
  } = {},
) {
  if (
    !proceeding ||
    typeof proceeding !== "object" ||
    Array.isArray(proceeding)
  )
    throw new Error("Proceeding must be an object.");
  const unknown = Object.keys(proceeding).filter(
    (key) => key !== "remote" && !PROCEEDING_TEXT_FIELDS.includes(key),
  );
  if (unknown.length)
    throw new Error(`Unsupported proceeding field: ${unknown.join(", ")}`);
  if (
    proceeding.remote !== undefined &&
    proceeding.remote !== null &&
    typeof proceeding.remote !== "boolean"
  ) {
    throw new Error(
      "Whether the deposition was remote must be true, false, or null for unrecorded.",
    );
  }

  const entry = (value) => {
    const text =
      typeof value === "string"
        ? value.trim()
        : value == null
          ? ""
          : String(value).trim();
    return text
      ? field(text, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" })
      : field(null, { source: "REPORTER_ENTERED", state: "MISSING" });
  };
  // Not entry(). entry() reads false as blank and would erase an answer of "in person" into
  // MISSING, which is the same field saying the reporter never answered.
  const method = (value) =>
    typeof value === "boolean"
      ? field(value, { source: "REPORTER_ENTERED", state: "REPORTER_ADDED" })
      : field(null, { source: "REPORTER_ENTERED", state: "MISSING" });

  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const file = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));

  // THESE ARE CANONICAL DEPOSITION FACTS AND THEY GO THROUGH THE CORRECTION LOG NOW.
  //
  // This used to overwrite the record with atomicJson: no previous value, no who, no when, no why.
  // An honorific had an audit trail and the court a deposition was taken in did not, and both reach
  // a certified page. Two standards for one kind of fact is not a standard.
  //
  // Etminan's log already carries deposition.remote and deposition.remotePlatform corrections made
  // this way, so the path is not new to these fields -- only to this caller.
  //
  // ONLY WHAT CHANGED IS SUBMITTED. The Workspace form posts all four every time it is saved, and
  // the correction log refuses a correction that changes nothing, correctly: an entry recording that
  // a value stayed the same is history nobody can read. So the diff happens here rather than being
  // demanded of every caller.
  const next = {
    "case.court": entry(proceeding.court),
    "deposition.location": entry(proceeding.location),
    "deposition.remotePlatform": entry(proceeding.remotePlatform),
    "deposition.remote": method(proceeding.remote),
  };
  const supplied = new Set(Object.keys(proceeding));
  const corrections = [];
  for (const [fieldPath, envelope] of Object.entries(next)) {
    const key = fieldPath.split(".").at(-1);
    if (!supplied.has(key)) continue;
    const current = fieldPath
      .split(".")
      .reduce((node, part) => (node == null ? node : node[part]), record);
    if (!current || typeof current !== "object") continue;
    if (
      JSON.stringify(current.value ?? null) ===
      JSON.stringify(envelope.value ?? null)
    )
      continue;
    corrections.push({
      path: fieldPath,
      from: current.value ?? null,
      to: envelope.value ?? null,
      why,
    });
  }
  if (corrections.length) {
    appendDepositionCorrections(root, {
      depositionId,
      storageRoot,
      who: readCorrectionAuthority(root, { depositionId, storageRoot }),
      corrections,
    });
  }

  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    depositionId,
    court: saved.case?.court,
    remote: saved.deposition?.remote,
    location: saved.deposition?.location,
    remotePlatform: saved.deposition?.remotePlatform,
    corrections: corrections.length,
  };
}

export function readDepositionRecord(root, id, options = {}) {
  const file = path.join(
    depositionDirectory(root, id, options),
    "deposition.json",
  );
  if (!fs.existsSync(file)) throw new Error("Deposition record was not found.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
/**
 * Appends corrections to the canonical record, and to the log beside it.
 *
 * The store boundary is where append-only is enforced, because it is the only place that touches
 * the file. There is deliberately no update, no delete, and no compaction: not "none implemented
 * yet" but none, so that a later caller reaching for one finds nothing to reach for. The log is
 * evidence about a certified record; a history that can be rewritten is not one.
 *
 * The whole file is rewritten temp-then-rename rather than opened for append. An interrupted
 * append can leave a half-written final line, and a truncated JSONL log is one that parseCorrection
 * Log will refuse to read at all -- losing every prior correction to save one.
 */
export function appendDepositionCorrections(
  root,
  {
    depositionId,
    corrections,
    who,
    at = new Date().toISOString(),
    storageRoot,
  } = {},
) {
  const proposed = Array.isArray(corrections)
    ? corrections
    : [corrections].filter(Boolean);
  if (!proposed.length) throw new Error("At least one correction is required.");
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const recordFile = path.join(
    directory,
    "intake",
    "canonical-deposition-record.json",
  );
  const logFile = path.join(directory, "intake", "canonical-corrections.jsonl");
  if (!fs.existsSync(recordFile))
    throw new Error("The Canonical Deposition Data Record was not found.");

  let record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  const existing = fs.existsSync(logFile)
    ? parseCorrectionLog(fs.readFileSync(logFile, "utf8"))
    : [];
  const seen = new Set(existing.map((entry) => entry.id));
  const appended = [];

  // Validated against the record as it stands after the previous correction in this batch, so two
  // corrections to one field in a single call are checked in the order they will be applied.
  for (const input of proposed) {
    const result = validateCorrection(record, {
      ...input,
      depositionId,
      who: input.who ?? who,
      at: input.at ?? at,
    });
    if (!result.ok) throw new Error(result.message);
    if (seen.has(result.entry.id))
      throw new Error(
        `This correction to ${result.entry.path} is already in the log.`,
      );
    seen.add(result.entry.id);
    record = applyCorrection(record, result.entry);
    appended.push(result.entry);
  }

  atomicText(logFile, serializeCorrectionLog([...existing, ...appended]));
  atomicJson(recordFile, record);
  return {
    depositionId,
    appended,
    corrections: [...existing, ...appended].length,
  };
}

export function readDepositionCorrections(root, id, options = {}) {
  const file = path.join(
    depositionDirectory(root, id, options),
    "intake",
    "canonical-corrections.jsonl",
  );
  return fs.existsSync(file)
    ? parseCorrectionLog(fs.readFileSync(file, "utf8"))
    : [];
}

/** Resolves one generated transcript designation through the existing canonical correction log. */
export function writeParticipantHonorific(
  root,
  { depositionId, participantId, honorific, storageRoot } = {},
) {
  // WHO IS NOT A PARAMETER. It used to be, defaulting to "Workspace reporter", and the route handed
  // it straight through from the request body -- so anything that could reach the local API could
  // name anyone it liked as the author of a change to a canonical record. That was the only live
  // forgery of attribution in the application, and withholding the capability is a stronger fix
  // than declining to use it.
  //
  // The label is a CALL-SITE CONSTANT and says only what this code path can honestly claim: a
  // reporter did this, through the Workspace. It does not name a person, because the application
  // has no signed-in user and cannot know which person acted -- and naming the deposition's CSR
  // would assert exactly the thing it cannot establish.
  const who = "Workspace reporter";
  const directory = depositionDirectory(root, depositionId, { storageRoot }),
    file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8")),
    index = (record.counsel || []).findIndex(
      (item) => item.id === participantId,
    );
  if (index < 0)
    throw new Error(
      "Honorific resolution currently requires a canonical counsel participant.",
    );
  const current = record.counsel[index]?.honorific?.value ?? null,
    next =
      honorific === null
        ? "NONE"
        : String(honorific ?? "")
            .trim()
            .toUpperCase()
            .replace(/\.?$/, ".");
  if (next !== "NONE" && !/^[A-Z][A-Z .'-]{0,19}\.$/.test(next))
    throw new Error(
      "Enter a short honorific containing letters, spaces, apostrophes, or hyphens.",
    );
  // Records created before counsel honorifics entered the canonical schema legitimately lack the
  // envelope. Add only that declared field, as MISSING, before using the ordinary append-only
  // correction path. This is not an inferred title and does not touch testimony or evidence.
  if (!record.counsel[index].honorific) {
    record.counsel[index] = {
      ...record.counsel[index],
      honorific: field(null, { source: "REPORTER_ENTERED", state: "MISSING" }),
    };
    atomicJson(file, record);
  }
  return appendDepositionCorrections(root, {
    depositionId,
    storageRoot,
    who,
    corrections: [
      {
        path: `counsel.${index}.honorific`,
        from: current,
        to: next,
        why: "Reporter resolved the generated transcript speaker designation.",
      },
    ],
  });
}

/**
 * Records the reporter's attestation that the witness was, or was not, put under oath.
 *
 * This is deliberately a separate call from saving the Opening screen's `witnessOathSelection`.
 * That selector is a workflow value: it lives in workflow/opening-procedures.json, carries no who
 * and no at, and under ADR-0021 it may never influence certified output. This writes an attested
 * fact to the canonical record through the ordinary correction log, which is the path that is
 * allowed to reach a certified page precisely because it demands attribution.
 *
 * Changing the selector must never call this. Attribution attached to an act the reporter did not
 * intend as an attestation is worse than no attribution, because it reads as provenance.
 *
 * `sworn` is a strict boolean and is not coerced. false is an answer -- "the witness affirmed" --
 * and is the case the certification page refuses. Absence is a different fact and stays MISSING.
 */
export function attestWitnessSworn(
  root,
  { depositionId, sworn, who, why, at, storageRoot } = {},
) {
  if (sworn !== true && sworn !== false)
    throw new Error(
      "An oath attestation must be true or false. Absence is not an attestation.",
    );
  if (!String(who ?? "").trim())
    throw new Error("An oath attestation requires who made it.");
  if (!String(why ?? "").trim())
    throw new Error(
      "An oath attestation requires why it was made. A certified record has to say what a value rests on.",
    );
  const directory = depositionDirectory(root, depositionId, { storageRoot }),
    file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  // Records created before witnessSworn entered the canonical schema legitimately lack the
  // envelope. Add only that declared field, as MISSING, before the append-only correction path --
  // the same repair writeParticipantHonorific makes, and for the same reason.
  if (!record.deposition?.witnessSworn) {
    record.deposition = {
      ...record.deposition,
      witnessSworn: field(null, {
        source: "REPORTER_ENTERED",
        state: "MISSING",
      }),
    };
    atomicJson(file, record);
  }
  const current = record.deposition?.witnessSworn?.value ?? null;
  return appendDepositionCorrections(root, {
    depositionId,
    storageRoot,
    who,
    ...(at ? { at } : {}),
    corrections: [
      { path: "deposition.witnessSworn", from: current, to: sworn, why },
    ],
  });
}

/**
 * The provable write channel as it goes into the history of a certified record.
 *
 * Never accepted from a caller. The local service has no authenticated human identity, so it
 * records that limitation instead of substituting the reporter assigned to the deposition.
 */
export function readCorrectionAuthority(
  root,
  { depositionId, storageRoot } = {},
) {
  // The local API does not authenticate its operator. The reporter assigned to a deposition is a
  // subject of the record, not evidence that they made an HTTP request. Attribute the mechanism
  // we can prove and explicitly preserve the identity limitation; never turn assignment into an
  // assertion of authorship.
  const file = path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!String(record?.reporter?.fullName?.value ?? "").trim())
    throw new Error(
      "This deposition has no deposition officer on its canonical record, so an attributed correction or attestation cannot be recorded.",
    );
  return "DepoPro local opening screen (operator identity not authenticated)";
}

export function setOpeningParticipantAttendance(
  root,
  { depositionId, participantId, attendance, why, storageRoot } = {},
) {
  if (!["IN_PERSON", "REMOTE", "ABSENT"].includes(attendance))
    throw new Error("Attendance must be in person, remote, or absent.");
  if (!String(why ?? "").trim())
    throw new Error("An attendance change requires its basis.");
  const directory = depositionDirectory(root, depositionId, { storageRoot }),
    file = path.join(directory, "intake", "canonical-deposition-record.json");
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const collections = [
    ["counsel", record.counsel || []],
    ["participants.interpreters", record.participants?.interpreters || []],
    ["participants.videographers", record.participants?.videographers || []],
    ["participants.otherAttendees", record.participants?.otherAttendees || []],
  ];
  const match = collections
    .map(([base, items]) => ({
      base,
      items,
      index: items.findIndex((item) => item.id === participantId),
    }))
    .find((item) => item.index >= 0);
  if (!match)
    throw new Error("That participant is not in the canonical roster.");
  const participant = match.items[match.index];
  let seeded = false;
  for (const key of ["actualAppearance", "remoteAppearance"]) {
    if (!participant[key]) {
      participant[key] = field(null, {
        source: "REPORTER_ENTERED",
        state: "MISSING",
      });
      seeded = true;
    }
  }
  if (seeded) atomicJson(file, record);
  const values =
    attendance === "IN_PERSON"
      ? [true, false]
      : attendance === "REMOTE"
        ? [true, true]
        : [false, null];
  const corrections = [];
  for (const [offset, key] of [
    "actualAppearance",
    "remoteAppearance",
  ].entries()) {
    const current = participant[key].value ?? null,
      to = values[offset];
    if (JSON.stringify(current) !== JSON.stringify(to))
      corrections.push({
        path: `${match.base}.${match.index}.${key}`,
        from: current,
        to,
        why: String(why).trim(),
      });
  }
  if (!corrections.length)
    return {
      depositionId,
      appended: [],
      corrections: readDepositionCorrections(root, depositionId, {
        storageRoot,
      }).length,
    };
  return appendDepositionCorrections(root, {
    depositionId,
    storageRoot,
    who: readCorrectionAuthority(root, { depositionId, storageRoot }),
    corrections,
  });
}

/**
 * One reporter correction to one canonical deposition fact.
 *
 * `from` is read here rather than accepted, so a caller cannot describe a value the record does not
 * hold; validateCorrection then refuses anything written against a stale reading. The actor label
 * describes the server-side channel. What the caller supplies is the new value and the reason.
 *
 * `allowed` is passed in rather than defined here: which facts a reporter may correct is a decision
 * about the screen offering them, not about the store.
 *
 * Named for what it does. The store's only correction verbs are append and read -- there is no
 * update, no delete and no compaction, so a later caller finds nothing to reach for -- and a guard
 * in the tests holds that by inspecting these names. This appends.
 */
export function appendFieldCorrection(
  root,
  { depositionId, path: fieldPath, to, why, allowed, storageRoot } = {},
) {
  const target = String(fieldPath ?? "").trim();
  if (!target) throw new Error("A correction requires the field it changes.");
  if (allowed && !allowed.has(target))
    throw new Error(
      `${target} is not a reporter-correctable fact on this screen.`,
    );
  const file = path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file))
    throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const resolved = target
    .split(".")
    .reduce((node, key) => (node == null ? node : node[key]), record);
  if (!resolved || typeof resolved !== "object")
    throw new Error(
      `${target} is not a field on this canonical record. A correction cannot create one.`,
    );
  const who = readCorrectionAuthority(root, { depositionId, storageRoot });
  return appendDepositionCorrections(root, {
    depositionId,
    storageRoot,
    who,
    corrections: [
      { path: target, from: resolved.value ?? null, to: to ?? null, why },
    ],
  });
}

export function recordLiveCaptureActualStart(
  root,
  { depositionId, startedAt, storageRoot } = {},
) {
  if (!depositionId) return null;
  const at = String(startedAt ?? "");
  if (Number.isNaN(Date.parse(at)))
    throw new Error("Live capture start requires an ISO 8601 timestamp.");
  const file = path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "intake",
    "canonical-deposition-record.json",
  );
  // Recording must not be lost if a legacy capture fixture predates canonical intake storage.
  // Depositions created through the application always have this file and use the path below.
  if (!fs.existsSync(file)) return null;
  const record = JSON.parse(fs.readFileSync(file, "utf8")),
    current = record.deposition?.actualStart?.value ?? null;
  if (current !== null && current !== undefined && current !== "")
    return { depositionId, recorded: false, value: current };
  const instant = new Date(at),
    timeZone =
      String(record.deposition?.timeZone?.value ?? "").trim() || undefined;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(instant);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
  }
  const value = `${parts.find((item) => item.type === "hour")?.value}:${parts.find((item) => item.type === "minute")?.value}`;
  const written = appendDepositionCorrections(root, {
    depositionId,
    storageRoot,
    who: "DepoPro live capture service (automatic)",
    at,
    corrections: [
      {
        path: "deposition.actualStart",
        from: null,
        to: value,
        why: `Automatically recorded from the first local capture start event at ${at}.`,
        valueSource: "SYSTEM_CAPTURED",
      },
    ],
  });
  return { ...written, recorded: true, value };
}

export function recordLiveCaptureActualEnd(
  root,
  { depositionId, endedAt, storageRoot } = {},
) {
  if (!depositionId) return null;
  const at = String(endedAt ?? "");
  if (Number.isNaN(Date.parse(at)))
    throw new Error("Live capture end requires an ISO 8601 timestamp.");
  const file = path.join(
    depositionDirectory(root, depositionId, { storageRoot }),
    "intake",
    "canonical-deposition-record.json",
  );
  if (!fs.existsSync(file)) return null;
  const record = JSON.parse(fs.readFileSync(file, "utf8")),
    current = record.deposition?.actualEnd?.value ?? null,
    instant = new Date(at),
    timeZone =
      String(record.deposition?.timeZone?.value ?? "").trim() || undefined;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(instant);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
  }
  const value = `${parts.find((item) => item.type === "hour")?.value}:${parts.find((item) => item.type === "minute")?.value}`;
  if (current === value) return { depositionId, recorded: false, value };
  const written = appendDepositionCorrections(root, {
    depositionId,
    storageRoot,
    who: "DepoPro live capture service (automatic)",
    at,
    corrections: [
      {
        path: "deposition.actualEnd",
        from: current,
        to: value,
        why: `Automatically recorded from the latest observed local capture stop event at ${at}.`,
        valueSource: "SYSTEM_CAPTURED",
      },
    ],
  });
  return { ...written, recorded: true, value };
}

export function readDepositionIntake(root, id, options = {}) {
  const file = path.join(
    depositionDirectory(root, id, options),
    "intake",
    "intake.json",
  );
  if (!fs.existsSync(file))
    throw new Error("Deposition intake record was not found.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function resolveDepositionAudio(root, id, index, options = {}) {
  const directory = depositionDirectory(root, id, options),
    record = JSON.parse(
      fs.readFileSync(path.join(directory, "deposition.json"), "utf8"),
    ),
    item = record.audio?.[Number(index)];
  if (!item) throw new Error("Deposition audio was not found.");
  const file = path.resolve(directory, ...String(item.path).split("/"));
  if (!within(file, directory) || !fs.existsSync(file))
    throw new Error("Deposition audio reference is invalid.");
  return { file, item };
}

export const _testing = {
  within,
  safeName,
  pathPart,
  personName,
  reporterFolder,
  causeFolder,
  depositionFolder,
  atomicJson,
  commitDirectory,
  ID_PATTERN,
  resolveDefaultDepositionsRoot,
};
