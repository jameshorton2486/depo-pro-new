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
export function renderTranscript({ working, evidence = [], speakerCandidates = [], examinerIdentity = null, overlay = null } = {}) {
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
      });
      // Reporter-authored text carries no Deepgram anchor, which is what keeps audio-derived and
      // human-added words distinguishable at a glance.
      for (const extra of applied.inserted.get(id) ?? []) resolved.push({ id:extra.id, text:extra.text, start:null, end:null, confidence:null, deepgramSpeaker:null, authored:true });
    }
    // `start` is what a click seeks to. It prefers the first resolved word's own timestamp over
    // the segment's, because the segment boundary is derived and the word time is measured --
    // and after a split the second half keeps the segment's start while its first word begins
    // seconds later, so seeking to the segment replays audio the reporter already heard.
    const start = resolved.find(word => Number.isFinite(word.start))?.start ?? paragraph.start ?? null;
    const end = [...resolved].reverse().find(word => Number.isFinite(word.end))?.end ?? paragraph.end ?? null;
    return {
      id:`paragraph:${index + 1}`, elementType:paragraph.elementType, label:paragraph.label, byLine:paragraph.byLine,
      layout:paragraph.layout, speakerIdentity:paragraph.speakerIdentity ?? null, transcriptRole:paragraph.transcriptRole ?? null,
      deepgramSpeaker:paragraph.deepgramSpeaker ?? null, unlabeledSpeaker:Boolean(paragraph.unlabeledSpeaker),
      // Style is applied to the reading, not the record: the words keep their ASR ids and their
      // evidence text, and gain a display form. paragraph.text is rebuilt from the same display
      // words so the screen and the paragraph string can never disagree.
      start, end, text:joinStyled(styleWords(resolved)) || paragraph.text || "", words:styleWords(resolved),
      segmentIds:paragraph.segmentIds ?? [], asrWordIds:paragraph.asrWordIds ?? [],
    };
  });

  // Every evidence word that no segment claimed. Not an error on its own -- a rebuild in
  // progress can leave one -- but it means the reader is not being shown the whole record, and
  // silence about that is the thing to avoid.
  const unclaimed = [...words.keys()].filter(id => !seen.has(id));
  if (unclaimed.length) findings.push({ code:"EVIDENCE_NOT_RENDERED", count:unclaimed.length, wordIds:unclaimed.slice(0, 10), message:`${unclaimed.length} ASR word(s) exist in evidence but appear in no paragraph.` });

  const diarized = [...words.values()].some(word => Number.isInteger(word?.deepgramSpeaker));
  if (words.size && !diarized) findings.push({ code:"NO_DIARIZATION", message:"No ASR word carries a speaker number. Every paragraph will collapse into one speaker, and no speaker map can be assigned." });

  return {
    schemaVersion:"1.1.0", recordType:"RENDERED_TRANSCRIPT",
    transcriptContentHash:working?.transcriptContentHash ?? null,
    speakerMap:working?.speakerMap ?? null, labels, examinerIdentity,
    counts:{ segments:segments.length, projectedSegments:projected.length, paragraphs:paragraphs.length, words:seen.size, evidenceWords:words.size,
      operations:overlay?.operations?.length ?? 0, orphaned:applied.orphaned.length },
    diarized, paragraphs, findings,
  };
}
