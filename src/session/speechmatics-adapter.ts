import type { AddPartialTranscript, AddTranscript, ErrorType, RealtimeServerMessage } from "@speechmatics/real-time-client";
import type { SpeechEvent, SpeechWord } from "./speech-types";

import { immutableSpeechEvidence } from "./immutable-speech-evidence";
import type { SpeechRunId } from "./speech-types";

type Receipt = { speechRunId: SpeechRunId; receivedAt: number; receiptSequence: number; speechEventId: string };

type TranscriptMessage = AddPartialTranscript | AddTranscript;

function transcriptEvent(message: TranscriptMessage, kind: "provisional" | "committed"): SpeechEvent | undefined {
  const text = message.metadata?.transcript?.trim();
  if (!text) return undefined;
  return { kind, text, words: wordsFromSpeechmatics(message) };
}

function wordsFromSpeechmatics(message: TranscriptMessage): SpeechWord[] {
  return message.results.flatMap((result) => {
    const alternative = result.alternatives?.[0];
    if (!alternative || result.type !== "word") return [];
    return [{
      text: alternative.content,
      startMs: Math.round(result.start_time * 1000),
      endMs: Math.round(result.end_time * 1000),
      confidence: alternative.confidence,
    }];
  });
}

function providerError(message: ErrorType): SpeechEvent {
  return { kind: "error", code: message.type, message: message.reason || "Speechmatics could not continue transcription." };
}

/** The only module that understands Speechmatics transcript message shapes. */
export function speechEventFromSpeechmatics(message: RealtimeServerMessage, receipt?: Receipt): SpeechEvent | undefined {
  switch (message.message) {
    case "AddPartialTranscript": return transcriptEvent(message, "provisional");
    case "AddTranscript": {
      const event = transcriptEvent(message, "committed");
      if (!receipt || event?.kind !== "committed") return event;
      // The wire message has no final ID. Audio interval + channel identifies a
      // final within a run; never use transcript wording or receipt count as ID.
      const providerFinalId = JSON.stringify(["speechmatics", message.channel ?? null, message.metadata.start_time, message.metadata.end_time]);
      return { ...event, speechEventId: receipt.speechEventId, evidence: immutableSpeechEvidence({ ...receipt,
        providerFinalId, text: event.text, words: event.words,
        startMs: message.metadata.start_time * 1000, endMs: message.metadata.end_time * 1000 }) };
    }
    case "Error": return providerError(message);
    default: return undefined;
  }
}
