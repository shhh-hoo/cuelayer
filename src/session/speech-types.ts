export type SpeechWord = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type SpeechEvent =
  | { kind: "provisional"; text: string; words: SpeechWord[] }
  | { kind: "committed"; text: string; words: SpeechWord[]; speechEventId?: string }
  | { kind: "error"; code: string; message: string };

export type ProviderFinal = {
  id: string;
  speechEventId?: string;
  text: string;
  words: SpeechWord[];
  committedAtMs: number;
};

export type CanonicalSpeechSpanCloseReason = "meaningful_pause" | "timing_gap" | "terminal_punctuation" | "max_duration" | "max_words" | "explicit_stop";

export type CanonicalSpeechSpan = {
  id: string;
  revision: number;
  sourceFinalIds: string[];
  text: string;
  words: SpeechWord[];
  startMs: number;
  endMs: number;
  openedAtMs: number;
  updatedAtMs: number;
  status: "open" | "closed";
  closeReason?: CanonicalSpeechSpanCloseReason;
};

export type CanonicalSpeechState = {
  finals: ProviderFinal[];
  spans: CanonicalSpeechSpan[];
  provisional?: { id: string; text: string; words: SpeechWord[] };
};

export type SpeechStatus = "off" | "starting" | "ready" | "paused" | "error" | "ended";

export type SpeechError = {
  code: string;
  message: string;
};

export type SpeechDebugState = {
  runId: number;
  provisionalEvents: number;
  committedEvents: number;
  lastError?: SpeechError;
};
