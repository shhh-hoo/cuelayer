import type { AddPartialTranscript, AddTranscript, ErrorType, RealtimeServerMessage } from "@speechmatics/real-time-client";
import type { SpeechEvent, SpeechWord } from "./speech-types";

type TranscriptMessage = AddPartialTranscript | AddTranscript;
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

function transcriptEvent(message: TranscriptMessage, kind: "provisional" | "committed"): SpeechEvent | undefined {
  const rawText = message.metadata?.transcript;
  const text = typeof rawText === "string" ? rawText.trim() : undefined;
  if (!text) return undefined;
  const timestamps = message.results.flatMap((result) => [result.start_time, result.end_time]).filter(Number.isFinite);
  const provider = {
    message: message.message,
    format: message.format,
    channel: message.channel,
    resultCount: message.results.length,
    startMs: timestamps.length ? Math.round(Math.min(...timestamps) * 1000) : undefined,
    endMs: timestamps.length ? Math.round(Math.max(...timestamps) * 1000) : undefined,
  } as const;
  if ((message.results.length > 0 && message.results.every((result) => result.type === "punctuation")) || PUNCTUATION_ONLY.test(text)) {
    return { kind: "punctuation", text, attachesTo: "previous", isEos: /[.!?。！？…][\s'’"”)}\]）】》」』]*$/u.test(text), provider };
  }
  return {
    kind,
    text,
    words: wordsFromSpeechmatics(message),
    provider,
  };
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
