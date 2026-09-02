import type { EffectCue } from "../types";
import type { DisplayIntent, LearnerIntent, PlannerInput, RuntimeDecision } from "../planner/contracts";
import type { PresentationMode } from "./presentation-mode";

export const DEFAULT_TRACE_LIMIT = 160;

export type TeachingTraceStage = "asr" | "commit" | "span" | "planner_gate" | "planner" | "compile" | "render";

type TraceBase = {
  id: string;
  traceId: string;
  stage: TeachingTraceStage;
  timestamp: number;
  segmentId?: string;
  speechEventId?: string;
  commitId?: string;
  finalId?: string;
  spanId?: string;
  spanRevision?: number;
  requestId?: number;
  cueId?: string;
  reason?: string;
  latencyMs?: number;
  source?: "live" | "synthetic";
  provider?: unknown;
};

export type PlannerInputSummary = {
  recentSpeech: Array<{ spanId: string; transcript: string }>;
  activeCaption?: PlannerInput["activeCaption"];
  lockedCaption?: PlannerInput["lockedCaption"];
};

export type TeachingTraceEvent =
  | TraceBase & { stage: "asr"; decision: "partial" | "final" | "punctuation" | "error"; transcript?: string; isFinal: boolean; errorCode?: string }
  | TraceBase & { stage: "commit"; decision: "committed" | "rejected"; transcript: string }
  | TraceBase & { stage: "span"; decision: "opened" | "appended" | "closed" | "punctuation_attached"; transcript: string; sourceFinalIds: string[] }
  | TraceBase & { stage: "planner_gate"; decision: "run" | "skip"; input?: PlannerInputSummary }
  | TraceBase & { stage: "planner"; decision: "started" | "completed" | "failed" | "aborted" | "stale" | "structured_output_invalid" | "validation_degraded"; input?: PlannerInputSummary; output?: RuntimeDecision }
  | TraceBase & { stage: "compile"; decision: "emit" | "no_emit" | "failed"; displayIntent?: DisplayIntent; learnerIntent?: LearnerIntent; effectCue?: EffectCue }
  | TraceBase & { stage: "render"; decision: "activated" | "replaced" | "expired" | "stale_suppressed"; status: "rendered" | "expired" | "suppressed"; presentationMode?: PresentationMode; effectCue?: EffectCue; rendererState?: unknown };

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
export type TeachingTraceEventDraft = WithoutId<TeachingTraceEvent>;

export type TeachingTraceState = {
  enabled: boolean;
  limit: number;
  nextEventId: number;
  events: TeachingTraceEvent[];
};

export function createTeachingTraceState(enabled = false, limit = DEFAULT_TRACE_LIMIT): TeachingTraceState {
  return { enabled, limit: Math.max(1, limit), nextEventId: 1, events: [] };
}

export function appendTeachingTraceEvents(state: TeachingTraceState, drafts: TeachingTraceEventDraft[]): TeachingTraceState {
  if (!state.enabled || !drafts.length) return state;
  let nextEventId = state.nextEventId;
  const appended = drafts.map((draft) => ({ ...draft, id: `trace-event-${nextEventId++}` }) as TeachingTraceEvent);
  return { ...state, nextEventId, events: [...state.events, ...appended].slice(-state.limit) };
}

export function traceIdFor(runId: number, segmentId: string) {
  return `speech-${runId}:${segmentId}`;
}

export function spanTraceIdFor(runId: number, spanId: string, spanRevision: number) {
  return `speech-${runId}:${spanId}:rev-${spanRevision}`;
}

export function plannerInputSummary(input: PlannerInput): PlannerInputSummary {
  return {
    recentSpeech: input.recentSpeech.map((turn) => ({ spanId: turn.id, transcript: turn.text })),
    activeCaption: input.activeCaption,
    lockedCaption: input.lockedCaption,
  };
}

export function spanRevisionTimestampFor(state: TeachingTraceState, spanId: string, spanRevision: number): number | undefined {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (event?.stage === "span" && event.spanId === spanId && event.spanRevision === spanRevision) return event.timestamp;
  }
  return undefined;
}

export function elapsedMs(startedAt: number | undefined, finishedAt: number): number | undefined {
  return startedAt === undefined ? undefined : Math.max(0, Math.round(finishedAt - startedAt));
}
