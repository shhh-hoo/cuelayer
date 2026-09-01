import type { CanonicalSpeechSpanCloseReason, CanonicalSpeechState, SpeechDebugState, SpeechError, SpeechEvent, SpeechStatus } from "./speech-types";
import type { CaptionEpisode, PlannerDebugState, PlannerInput, RuntimeDecision } from "../planner/contracts";
import type { TeachingTraceState } from "./teaching-trace";
import type { PresentationMode } from "./presentation-mode";

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
  planner: PlannerDebugState;
  trace: TeachingTraceState;
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
  | { type: "speech-stopped"; runId: number }
  | { type: "planner-gate"; runId: number; spanId: string; spanRevision: number; segmentIds: string[]; decision: "run" | "skip"; reason: string; now: number; requestId?: number; input?: PlannerInput }
  | { type: "planner-requested"; requestId: number; runId: number; spanId: string; spanRevision: number; input?: PlannerInput; segmentIds?: string[]; now?: number }
  | { type: "planner-aborted"; requestId: number; runId: number; spanId: string; spanRevision: number; input: PlannerInput; reason: "live_budget_timeout" | "superseded_by_newer_checkpoint" | "session_stopped"; now: number; startedAt?: number; segmentIds?: string[] }
  | { type: "planner-decision"; requestId: number; runId: number; spanId: string; spanRevision: number; input: PlannerInput; decision: unknown; now: number; startedAt?: number; segmentIds?: string[] }
  | { type: "planner-failed"; requestId: number; runId: number; spanId: string; spanRevision: number; input: PlannerInput; message: string; now?: number; startedAt?: number; segmentIds?: string[] }
  | { type: "debug-inject-decision"; traceId: string; episodeId: string; input: PlannerInput; decision: RuntimeDecision; now: number }
  | { type: "renderer-activated"; episode: CaptionEpisode; now: number; presentationMode?: PresentationMode; surfaceSource?: "semantic" | "canonical_fallback"; previousEpisodeId?: string; suppressedEpisodeId?: string; rendererState?: unknown }
  | { type: "caption-expired"; episodeId: string; now?: number; presentationMode?: PresentationMode }
  | { type: "learner-cue-expired"; cueId: string }
  | { type: "toggle-caption-lock" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "end" };
