// Joining the projection, the evidence, and the labels into something a Workspace can render.
//
// The Workspace needs three things the existing screens do not provide: paragraphs carrying
// transcript labels rather than role enums, a timestamp per paragraph that can seek audio, and
// words that are individually addressable. That last one is the reason this module returns word
// spans rather than a text string -- to split a paragraph at "Yes." the UI has to turn a text
// selection into a specific Deepgram word id, and that is only exact if each word is a distinct
// object carrying its own id and time.
//
// Pure. No filesystem, no fetch. The caller reads working.json and asr-evidence.json; this
// decides what the reader sees.
import { groupTranscriptSegments } from "../app/transcript-paragraphs.mjs";
import { joinStyled, styleWords } from "./transcript-style.mjs";
import { buildSpeakerLabels, labelParagraphs } from "./transcript-labels.mjs";
import { applyOverlay, emptyOverlay } from "./reporter-overlay.mjs";
import { computeRenderedContentHash } from "./transcript-content-hash.mjs";

/**
 * Indexes ASR word evidence by word id. Evidence arrives per job -- a deposition with three
 * audio files has three evidence documents -- and word ids are namespaced by job identity, so
 * a flat index is safe across all of them.
 */
export function indexEvidenceWords(evidenceDocuments = []) {
  const words = new Map();
  const duplicates = [];
  for (const document of evidenceDocuments) {
    for (const word of document?.words || []) {
      if (!word?.id) continue;
      if (words.has(word.id)) { duplicates.push(word.id); continue; }
      words.set(word.id, word);
    }
  }
  return { words, duplicates };
}

/**
 * Renders the working transcript for reading and editing.
 *
 * Findings are returned rather than thrown. A transcript with an unassigned speaker or a word
 * the evidence cannot resolve is still worth showing -- refusing to render it leaves the
 * reporter with a blank screen and no way to see what is wrong.
 */
export function renderTranscript({ working, evidence = [], speakerCandidates = [], examinerIdentity = null, overlay = null, sourceAudio = [] } = {}) {
  const findings = [];
  const projected = working?.segments || [];
  // The evidence store for a transcript is the evidence that transcript derives from, not every
  // job on disk. A superseded run leaves its asr-evidence.json in place -- immutable, hashed and
  // rebuildable -- and reading it here put 12,185 words into the store that appear in no
  // paragraph. That is not merely noise: OI-3 V1 admits a proposal whose word_id "exists in the
  // canonical Deepgram store", and an unscoped store would let a correction anchor to a word
  // that is not in the transcript at all while passing the check meant to catch exactly that.
  //
  // Narrows only when derivedFrom says something. A record without it keeps every document,
  // because not knowing which job a transcript came from is a reason to show the reader
  // everything, not a reason to show them nothing.
  const derivedFrom = new Set(working?.derivedFrom ?? []);
  const scopedEvidence = derivedFrom.size ? evidence.filter(document => derivedFrom.has(document?.jobIdentity)) : evidence;
  const { words, duplicates } = indexEvidenceWords(scopedEvidence);
  for (const id of duplicates) findings.push({ code:"DUPLICATE_WORD_ID", wordId:id, message:`Word id ${id} appears in more than one evidence document.` });

  const { labels, findings:labelFindings } = buildSpeakerLabels(speakerCandidates);
  findings.push(...labelFindings);

  // projection + overlay. The projection itself is never modified -- applyOverlay copies.
  const applied = applyOverlay(projected, overlay ?? emptyOverlay(), { knownWordIds:new Set(words.keys()) });
  const segments = applied.segments;
  for (const orphan of applied.orphaned) findings.push({ code:"ORPHANED_OPERATION", index:orphan.index, operation:orphan.operation, reason:orphan.reason, message:`Overlay operation ${orphan.index + 1} (${orphan.operation.op}) no longer has an anchor: ${orphan.reason}. It was not applied.` });

  // A split changes where a paragraph begins, so its text has to come from the words it now
  // holds rather than from the utterance transcript it inherited.
  const withText = segments.map(segment => {
    const parts = [];
    for (const id of segment.asrWordIds) {
      if (applied.deleted.has(id)) { for (const extra of applied.inserted.get(id) ?? []) parts.push(extra.text); continue; }
      const word = words.get(id);
      parts.push(applied.replaced.get(id) ?? word?.punctuatedWord ?? word?.word ?? "");
      for (const extra of applied.inserted.get(id) ?? []) parts.push(extra.text);
    }
    const rebuilt = parts.filter(Boolean).join(" ").replace(/\s+([,.;:!?])/g, "$1").trim();
    return { ...segment, text:rebuilt || segment.text };
  });

  const grouped = groupTranscriptSegments(withText);
  const labelled = labelParagraphs(grouped, { labels, examinerIdentity });

  const seen = new Set();
  const paragraphs = labelled.map((paragraph, index) => {
    const resolved = [];
    for (const id of paragraph.asrWordIds || []) {
      const word = words.get(id);
      if (!word) { findings.push({ code:"WORD_NOT_IN_EVIDENCE", wordId:id, paragraphIndex:index, message:`Segment word ${id} has no matching ASR evidence.` }); continue; }
      if (seen.has(id)) { findings.push({ code:"WORD_RENDERED_TWICE", wordId:id, paragraphIndex:index, message:`Word ${id} is claimed by more than one segment.` }); continue; }
      seen.add(id);
      const original = word.punctuatedWord ?? word.word ?? "";
      const override = applied.replaced.get(id);
      resolved.push({
        id:word.id, text:override ?? original, start:word.start, end:word.end,
        confidence:word.confidence, deepgramSpeaker:word.deepgramSpeaker,
        // A deleted word keeps its id and its original text. It is struck from the reading, not
        // removed from the record -- I1 -- so the evidence chain survives the edit.
        ...(override === undefined ? {} : { edited:true, originalText:original }),
        ...(applied.deleted.has(id) ? { deleted:true, originalText:original } : {}),
        // The word reads exactly as it did unflagged. `flaggedFrom` names the passage it belongs
        // to so a click anywhere inside one can clear all of it.
        ...(applied.flagged.has(id) ? { flagged:true, flaggedFrom:applied.flagged.get(id) } : {}),
      });
      // Reporter-authored text carries no Deepgram anchor, which is what keeps audio-derived and
      // human-added words distinguishable at a glance.
      for (const extra of applied.inserted.get(id) ?? []) resolved.push({ id:extra.id, text:extra.text, start:null, end:null, confidence:null, deepgramSpeaker:null, authored:true });
    }
    // `start` is what a click seeks to. It prefers the first resolved word's own timestamp over
    // the segment's, because the segment boundary is derived and the word time is measured --
    // and after a split the second half keeps the segment's start while its first word begins
    // seconds later, so seeking to the segment replays audio the reporter already heard.
    const styled = styleWords(resolved);
    const start = resolved.find(word => Number.isFinite(word.start))?.start ?? paragraph.start ?? null;
    const end = [...resolved].reverse().find(word => Number.isFinite(word.end))?.end ?? paragraph.end ?? null;
    return {
      id:`paragraph:${index + 1}`, elementType:paragraph.elementType, label:paragraph.label, byLine:paragraph.byLine,
      layout:paragraph.layout, speakerIdentity:paragraph.speakerIdentity ?? null, transcriptRole:paragraph.transcriptRole ?? null,
      deepgramSpeaker:paragraph.deepgramSpeaker ?? null, unlabeledSpeaker:Boolean(paragraph.unlabeledSpeaker),
      // Carried, not parsed. speakerBuckets keys the speaker map by (job, speaker) and had to
      // recover the job by splitting segmentIds[0] on a colon -- a dependency on the shape of an
      // id string, where a format change would silently collapse every bucket back to speaker
      // index and merge unrelated people. The segment already knows.
      sourceJobIdentity:paragraph.sourceJobIdentity ?? String(paragraph.segmentIds?.[0] ?? "").split(":")[0],
      // Style is applied to the reading, not the record: the words keep their ASR ids and their
      // evidence text, and gain a display form. paragraph.text is rebuilt from the same display
      // words so the screen and the paragraph string can never disagree.
      // styleWords runs once. It ran twice here, which is both wasted work and a place for the
      // two forms to diverge.
      //
      // The text excludes struck words; the word list keeps them. A deletion strikes a word from
      // the reading without removing it from the record, so words[] carries it with deleted:true
      // for the Workspace to render struck -- but paragraph.text is the reading, and a struck
      // word belongs in neither the reading nor anything built from it. Building the text from
      // the unfiltered list put it back: the screen looked right because it renders words[],
      // while every consumer of paragraph.text -- an exporter, correction-pass chunking, a
      // certified page -- got the struck word again.
      start, end, text:joinStyled(styled.filter(word => !word.deleted)) || paragraph.text || "", words:styled,
      segmentIds:paragraph.segmentIds ?? [], asrWordIds:paragraph.asrWordIds ?? [],
    };
  });

  // Every evidence word that no segment claimed. Not an error on its own -- a rebuild in
  // progress can leave one -- but it means the reader is not being shown the whole record, and
  // silence about that is the thing to avoid.
  const unclaimed = [...words.keys()].filter(id => !seen.has(id));
  if (unclaimed.length) findings.push({ code:"EVIDENCE_NOT_RENDERED", count:unclaimed.length, wordIds:unclaimed.slice(0, 10), message:`${unclaimed.length} ASR word(s) exist in evidence but appear in no paragraph.` });

  // One finding, not 53. The reporter needs a list to scan, and a finding per word would bury
  // every other finding on the screen.
  const assumed = paragraphs.flatMap(paragraph => paragraph.words.filter(word => word.honorificAssumed));
  if (assumed.length) findings.push({ code:"HONORIFIC_ASSUMED", count:assumed.length, wordIds:assumed.slice(0, 10).map(word => word.id),
    message:`${assumed.length} spoken "miss" written as "Ms." A certified record distinguishes Miss, Ms. and Mrs., and the recording does not; each of these is the standard form applied, not a title heard.` });

  // Multi-volume is not supported, and the screen must say so rather than seek against the wrong
  // recording. The Workspace player is hardcoded to audio index 0 -- correct today only because
  // every deposition in the library has exactly one transcribed source, which is an accident of
  // the current data rather than a property anything enforces. This is that assertion.
  //
  // Two independent conditions, because they fail differently. More than one job means paragraphs
  // come from different recordings and Deepgram timestamps restart per job, so a seek lands in
  // the wrong audio. More than one source audio means index 0 is a guess even with a single job --
  // a live capture registered alongside a transcribed file is exactly that case.
  //
  // Resolving it properly is job -> sourceAudio -> index. That is not built, and building the
  // job-identity half alone would not do it, so this refuses instead of guessing.
  const jobCount = new Set(working?.derivedFrom ?? []).size;
  const audioCount = Array.isArray(sourceAudio) ? sourceAudio.length : 0;
  if (jobCount > 1 || audioCount > 1) findings.push({ code:"MULTI_VOLUME_UNSUPPORTED", severity:"blocking", jobs:jobCount, audio:audioCount,
    message:`This deposition has ${jobCount} transcription job${jobCount === 1 ? "" : "s"} and ${audioCount} source recording${audioCount === 1 ? "" : "s"}. Playback cannot choose which recording a paragraph belongs to, so seeking is refused rather than played against the first one.` });

  const diarized = [...words.values()].some(word => Number.isInteger(word?.deepgramSpeaker));
  if (words.size && !diarized) findings.push({ code:"NO_DIARIZATION", message:"No ASR word carries a speaker number. Every paragraph will collapse into one speaker, and no speaker map can be assigned." });

  return {
    schemaVersion:"1.1.0", recordType:"RENDERED_TRANSCRIPT",
    // withTranscriptContentHash writes transcript_hash; this read asked for a key the working
    // transcript has never carried, so the rendered payload reported null for every transcript
    // since the field was added. Nothing consumed it, which is why nothing caught it.
    //
    // What it covers, precisely: the segments and the speaker map of working.json. It does NOT
    // observe the reporter overlay, which lives beside working.json and is applied at render.
    // Two transcripts differing only by a reporter edit therefore carry the same hash. Calling
    // it "the transcript's identity" overstated it, and a correction pass cannot invalidate
    // against it alone without treating an edited transcript as unedited.
    transcriptContentHash:working?.transcript_hash ?? working?.transcriptContentHash ?? null,
    // What this rendering is, as opposed to what the stored projection is. Differs from
    // transcriptContentHash whenever the reporter has edited, which is the whole point.
    renderedContentHash:computeRenderedContentHash(working, overlay ?? emptyOverlay()),
    // The jobs this transcript derives from, carried so a reader can see how many sources are
    // behind it without opening the working file.
    derivedFrom:working?.derivedFrom ?? [],
    speakerMap:working?.speakerMap ?? null, labels, examinerIdentity,
    counts:{ segments:segments.length, projectedSegments:projected.length, paragraphs:paragraphs.length, words:seen.size, evidenceWords:words.size,
      operations:overlay?.operations?.length ?? 0, orphaned:applied.orphaned.length,
      // Passages, not words. "31 flagged" would mean nothing to a scopist working through them;
      // the number they care about is how many places still need another listen.
      flags:new Set(applied.flagged.values()).size },
    diarized, paragraphs, findings,
  };
}
