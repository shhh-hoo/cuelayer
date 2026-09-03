import type { CanonicalSpeechSpan } from "../session/speech-types";
import type { CompactEvidenceCheckpoint, GroundingRecord, SpeechEvidenceWarning } from "./contracts";

const LEXICAL = /[\p{L}\p{N}]/u;

function normalizedText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function evidenceWarningsFor(span: CanonicalSpeechSpan): SpeechEvidenceWarning[] {
  const lowConfidence = span.words.some((word) => word.confidence !== undefined && word.confidence < 0.65);
  return lowConfidence ? [{ code: "low_confidence" }] : [];
}

export function checkpointFromClosedSpan(
  span: CanonicalSpeechSpan,
  speechRunId: number,
  lessonSequence: number,
): { checkpoint: CompactEvidenceCheckpoint; grounding: GroundingRecord } | undefined {
  const text = normalizedText(span.text);
  if (span.status !== "closed" || !LEXICAL.test(text)) return undefined;
  const checkpointId = `checkpoint-${speechRunId}-${span.id}-${span.revision}`;
  return {
    checkpoint: {
      checkpointId,
      lessonSequence,
      speechRunId,
      startMs: span.startMs,
      endMs: span.endMs,
      text,
      sourceFinalIds: [...span.sourceFinalIds],
      warnings: evidenceWarningsFor(span),
    },
    grounding: {
      checkpointId,
      canonicalSpanIds: [{ spanId: span.id, spanRevision: span.revision }],
      words: span.words.map((word) => ({ ...word })),
      providerEvidence: span.sourceFinalIds.map((providerFinalId) => ({ providerFinalId })),
    },
  };
}

export function exactSpeechReferenceIsGrounded(reference: { checkpointId: string; quote: string }, checkpoints: readonly CompactEvidenceCheckpoint[]) {
  const checkpoint = checkpoints.find((item) => item.checkpointId === reference.checkpointId);
  return Boolean(checkpoint && reference.quote.trim() && checkpoint.text.includes(reference.quote));
}
