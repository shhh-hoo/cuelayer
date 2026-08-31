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
};

export type SessionAction =
  | { type: "begin-capture" }
  | { type: "capture-ready"; stream: MediaStream }
  | { type: "capture-failed"; error: CaptureError }
  | { type: "capture-ended" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "end" };
