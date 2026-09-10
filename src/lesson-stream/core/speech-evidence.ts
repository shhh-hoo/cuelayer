import type { ImmutableSpeechEvidence } from "../../session/immutable-speech-evidence.ts";
import { speechEvidenceId } from "../../session/immutable-speech-evidence.ts";
import type { CompactEvidenceCheckpoint, GroundingRecord } from "../contracts.ts";

export function checkpointFromSpeechEvidence(evidence: ImmutableSpeechEvidence, lessonSequence: number): { checkpoint: CompactEvidenceCheckpoint; grounding: GroundingRecord } {
  if (evidence.evidenceId !== speechEvidenceId(evidence.speechRunId, evidence.providerFinalId)) throw new Error("core-speech-evidence-identity-invalid");
  const checkpointId = JSON.stringify(["checkpoint", evidence.evidenceId]);
  const { evidenceId, providerFinalId, speechRunId, speechEventId, receivedAt, receiptSequence } = evidence;
  return { checkpoint: { checkpointId, lessonSequence, speechRunId,
    startMs: evidence.startMs, endMs: evidence.endMs, text: evidence.text, sourceFinalIds: [evidenceId],
    warnings: evidence.words.some(w => w.confidence !== undefined && w.confidence < 0.65) ? [{ code: "low_confidence" }] : [] },
    grounding: { checkpointId, canonicalSpanIds: [], words: evidence.words.map(w => ({ ...w })),
      providerEvidence: [{ providerFinalId: evidenceId }],
      immutableFinal: { version: "immutable-speech-v1", evidenceId, providerFinalId, speechRunId, speechEventId, receivedAt, receiptSequence } } };
}
