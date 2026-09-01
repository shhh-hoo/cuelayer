import type { AddPartialTranscript, AddTranscript, ErrorType, RealtimeServerMessage } from "@speechmatics/real-time-client";
import type { SpeechEvent, SpeechWord } from "./speech-types";

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
export function speechEventFromSpeechmatics(message: RealtimeServerMessage): SpeechEvent | undefined {
  switch (message.message) {
    case "AddPartialTranscript": return transcriptEvent(message, "provisional");
    case "AddTranscript": return transcriptEvent(message, "committed");
    case "Error": return providerError(message);
    default: return undefined;
  }
}
