import type { CanonicalSpeechSpanCloseReason, CanonicalSpeechState, SpeechDebugState, SpeechError, SpeechEvent, SpeechStatus } from "./speech-types";

export type SessionStatus = "idle" | "active" | "paused" | "ended";

export type CaptureErrorKind = "unsupported" | "cancelled" | "permission-denied" | "unknown";

export type CaptureError = {
  kind: CaptureErrorKind;
  message: string;
};

export type PresentationStatus = "empty" | "starting" | "ready" | "ended" | "error";

export type SessionState = {
  status: SessionStatus;
  presentation: {
    status: PresentationStatus;
    stream: MediaStream | null;
    error?: CaptureError;
  };
  speech: {
    status: SpeechStatus;
    canonical: CanonicalSpeechState;
    debug: SpeechDebugState;
    error?: SpeechError;
  };
};

export type SessionAction =
  | { type: "begin-capture" }
  | { type: "capture-ready"; stream: MediaStream }
  | { type: "capture-failed"; error: CaptureError }
  | { type: "capture-ended" }
  | { type: "begin-speech"; runId: number }
  | { type: "speech-ready"; runId: number }
  | { type: "speech-event"; runId: number; event: SpeechEvent; now?: number }
  | { type: "close-speech-span"; runId: number; spanId: string; spanRevision: number; reason: CanonicalSpeechSpanCloseReason; now: number }
  | { type: "speech-paused"; runId: number }
  | { type: "speech-resumed"; runId: number }
  | { type: "speech-stopped"; runId: number; now?: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "end"; now?: number };
