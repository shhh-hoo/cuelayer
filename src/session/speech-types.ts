export type SpeechWord = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type SpeechEvent =
  | { kind: "provisional"; text: string; words: SpeechWord[] }
  | { kind: "committed"; text: string; words: SpeechWord[] }
  | { kind: "error"; code: string; message: string };

export type CanonicalSpeechSegment = {
  id: string;
  text: string;
  words: SpeechWord[];
};

export type CanonicalSpeechState = {
  committed: CanonicalSpeechSegment[];
  provisional?: CanonicalSpeechSegment;
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
