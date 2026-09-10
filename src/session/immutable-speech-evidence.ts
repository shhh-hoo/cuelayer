import type { SpeechRunId, SpeechWord } from "./speech-types.ts";

/** Provider-neutral final, independent of human-readable transcript grouping.
 * Receipt order is diagnostic; durable lessonSequence owns admission order. */
export type ImmutableSpeechEvidence = Readonly<{
  evidenceId: string;
  speechRunId: SpeechRunId;
  providerFinalId: string;
  speechEventId: string;
  receivedAt: number;
  receiptSequence: number;
  text: string;
  startMs: number;
  endMs: number;
  words: readonly Readonly<SpeechWord>[];
}>;
export const speechEvidenceId = (run: SpeechRunId, providerFinalId: string) => JSON.stringify(["speech-final", run, providerFinalId]);

export function immutableSpeechEvidence(input: Omit<ImmutableSpeechEvidence, "evidenceId">): ImmutableSpeechEvidence {
  return Object.freeze({ ...input, evidenceId: speechEvidenceId(input.speechRunId, input.providerFinalId),
    words: Object.freeze(input.words.map(word => Object.freeze({ ...word }))) });
}
